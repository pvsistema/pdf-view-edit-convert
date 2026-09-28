import { Fragment, useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useDoc } from '@/context/DocContext';
import { canvasToBlob, downloadBlob } from '@/lib/files';
import { pageText, pageTextLayout, renderPageOnce, type TextPiece } from '@/lib/pdf';
import { toast } from '@/hooks/use-toast';
import { useLicense } from '@/context/LicenseContext';
import { loadOcrModule, ModuleLocked } from '@/lib/secureModule';
import ActivateDialog from '@/components/app/ActivateDialog';
import { parseRange } from '@/components/app/PrintDialog';
import { cleanScan } from '@/lib/scanClean';
import { buildDocx, DOCX_TYPE } from '@/lib/docx';
import { readLayout, type OcrPart } from '@/lib/ocrLayout';
import { layoutFromPieces } from '@/lib/pdfLayout';
import { isDesktop, nativeSaveMany } from '@/lib/desktop';
import {
  isTrialTool,
  leftWord,
  onTrialChange,
  spendTrial,
  trialLeft,
  TRIAL_LIMIT,
} from '@/lib/trial';

const baseName = (n: string) => n.replace(/\.pdf$/i, '') || 'document';

// Может ли этот компьютер взять ускоренное ядро распознавания.
// Проверяем крошечной пробной программой: если процессор умеет считать
// пачками, она запустится. На старых машинах — нет, и тогда берём обычное
let fastCore: boolean | null = null;

const canFast = async () => {
  if (fastCore !== null) return fastCore;
  try {
    // Это готовый образец из описания WebAssembly: одна операция над пачкой
    await WebAssembly.instantiate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 98, 11,
      ]),
    );
    fastCore = true;
  } catch {
    fastCore = false;
  }
  return fastCore;
};

// Разрешение, в котором лист уходит на распознавание. 300 точек на дюйм —
// то, с чем работают промышленные программы разбора документов: мельче
// движок путает похожие буквы, крупнее — только дольше считает
const OCR_DPI = 300;

// Распознанный лист: номер страницы, её текст и разметка —
// где заголовки, где абзацы, что набрано жирным
export type OcrSheet = { no: number; text: string; parts?: OcrPart[] };

// Готовый текст страницы, если он в ней уже записан.
//
// Обычный документ (не скан) хранит текст как текст — его можно взять
// точно, без единой ошибки. Разбирать такую страницу картинкой значит
// своими руками портить готовое. Возвращаем пусто, если текста мало:
// у скана иногда есть жалкий слой в пару слов, ему верить нельзя
const readyText = async (doc: unknown, pageIndex: number) => {
  const pieces = await pageTextLayout(doc, pageIndex).catch(() => [] as TextPiece[]);

  const text = pieces
    .map((p) => p.str)
    .join('')
    .trim();

  // Меньше сотни знаков на лист — это не текстовый документ,
  // а скан с обрывками. Такую страницу разбираем движком
  if (text.length < 100) return null;

  const parts = layoutFromPieces(pieces);
  if (!parts.length) return null;

  return { text: parts.map((p) => p.text).join('\n\n'), parts };
};

// Нужна ли странице подготовка перед разбором.
//
// Чистка задумана для сканов: бледных, серых, с пылью. Но на чёткой
// странице она огрубляет буквы и текст разбирается заметно хуже —
// проверка показала 55 ошибок против нуля. Поэтому сначала смотрим,
// похож ли лист на скан: у скана фон шумный, а у чистой страницы
// он ровный белый
const needsClean = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;

  // Берём небольшой кусок в середине листа — там обычно текст
  const w = Math.min(600, canvas.width);
  const h = Math.min(600, canvas.height);
  const x = Math.max(0, ((canvas.width - w) / 2) | 0);
  const y = Math.max(0, ((canvas.height - h) / 2) | 0);

  const px = ctx.getImageData(x, y, w, h).data;

  // Считаем, сколько точек «серые» — не белые и не чёрные.
  // У чистой страницы их почти нет, у скана — заметная доля
  let gray = 0;
  let total = 0;
  for (let i = 0; i < px.length; i += 16) {
    const v = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    total++;
    if (v > 60 && v < 200) gray++;
  }

  return total > 0 && gray / total > 0.08;
};

// Как распознанные страницы складываются в один текст для показа.
// Тем же способом потом проверяем, правил ли человек результат руками
const joinPages = (sheets: OcrSheet[]) =>
  sheets
    .map((s) => (s.text ? (sheets.length > 1 ? `— Страница ${s.no} —\n\n${s.text}` : s.text) : ''))
    .filter(Boolean)
    .join('\n\n');

const ToolsPanel = () => {
  const { pages, name, active, docOf, buildPdf } = useDoc();
  const { isFull, license } = useLicense();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [ocrText, setOcrText] = useState('');
  // Тот же текст, но разложенный по страницам: нужен для выгрузки
  // в Word, где каждая страница должна лечь на отдельный лист
  const [ocrPages, setOcrPages] = useState<OcrSheet[]>([]);
  // Какие страницы распознавать. В толстом скане обычно нужна пара
  // листов, а разбор всей пачки занял бы много времени
  const [ocrScope, setOcrScope] = useState<'all' | 'current' | 'range'>('all');
  const [ocrRange, setOcrRange] = useState('');
  // Подготовка скана перед разбором. По умолчанию включена: выцветшие
  // копии без неё почти не читаются
  const [clean, setClean] = useState(true);

  // Сколько листов уйдёт в работу при нынешнем выборе —
  // по этому числу считается полоса хода у распознавания
  const ocrCount =
    ocrScope === 'current' ? 1 : ocrScope === 'range' ? parseRange(ocrRange, pages.length).length : pages.length;
  const [showAct, setShowAct] = useState(false);
  const [left, setLeft] = useState(() => trialLeft());
  const desktop = isDesktop();

  // Остаток попыток может измениться в другом окне программы
  useEffect(() => onTrialChange(() => setLeft(trialLeft())), []);

  const run = async (key: string, trial: boolean, fn: () => Promise<void>) => {
    setBusy(key);
    setProgress(0);
    try {
      await fn();
      // Попытку списываем только за удавшуюся работу: сорвалась —
      // человек не должен терять пробный запуск
      if (trial) {
        const rest = spendTrial(key);
        setLeft(rest);
        toast({
          title: rest > 0 ? `Осталось ${leftWord(rest)}` : 'Пробные попытки закончились',
          description:
            rest > 0
              ? 'Пробный режим: платные инструменты работают ограниченное число раз'
              : 'Активируйте полную версию, чтобы продолжить',
        });
        if (rest === 0) setShowAct(true);
      }
    } catch (e) {
      // Модуль не открылся: лицензия кончилась или компьютер не активирован
      if (e instanceof ModuleLocked) {
        toast({ title: 'Нужна полная версия', description: e.message });
        setShowAct(true);
      } else {
        // Настоящую причину пишем в журнал: без неё сбой у пользователя
        // не отличить от сбоя в документе
        console.error('Сбой инструмента', key, e);

        // Движок распознавания сообщает о сбое простой строкой, а не
        // полноценной ошибкой. Раньше такую строку отбрасывали и писали
        // «попробуйте другой файл», хотя дело было вовсе не в файле
        const why =
          e instanceof Error ? e.message : typeof e === 'string' && e.trim() ? e.trim() : '';

        toast({
          title: 'Не удалось выполнить',
          description: why || 'Попробуйте другой файл или операцию',
        });
      }
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  // Короткая пауза, чтобы окно успевало перерисоваться:
  // без неё полоска выполнения замирает на долгих документах
  const breathe = () => new Promise((r) => setTimeout(r, 0));

  // Текст читаем небольшими группами страниц сразу, а не строго по одной:
  // ожидание страниц накладывается друг на друга и документ обрабатывается
  // заметно быстрее. Группа маленькая, чтобы не забивать память
  const collectText = async () => {
    const chunks: string[] = [];
    const STEP = 8;

    for (let i = 0; i < pages.length; i += STEP) {
      const part = pages.slice(i, i + STEP);
      const got = await Promise.all(
        part.map(async (p) => {
          const doc = docOf(p);
          return doc ? await pageText(doc, p.src) : '';
        }),
      );
      chunks.push(...got);
      setProgress(Math.round((Math.min(i + STEP, pages.length) / pages.length) * 100));
      await breathe();
    }
    return chunks;
  };

  const toPdf = () =>
    run('pdf', false, async () => {
      const bytes = await buildPdf();
      downloadBlob(
        new Blob([bytes as BlobPart], { type: 'application/pdf' }),
        `${baseName(name)}-изменённый.pdf`,
      );
      if (!desktop) toast({ title: 'Файл сохранён', description: 'Документ PDF со всеми изменениями' });
    });

  const toWord = () =>
    run('word', !isFull, async () => {
      const chunks = await collectText();
      const bytes = buildDocx(
        chunks.map((t, i) => ({ no: i + 1, text: t })),
        chunks.length > 1,
      );
      downloadBlob(new Blob([bytes as BlobPart], { type: DOCX_TYPE }), `${baseName(name)}.docx`);
      if (!desktop)
        toast({ title: 'Готов файл Word', description: 'Открывается в Word и в редакторах документов' });
    });

  const toExcel = () =>
    run('excel', !isFull, async () => {
      const chunks = await collectText();
      const rows = chunks
        .flatMap((t, i) =>
          t
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const cells = line.split(/\s{2,}|\t/).filter(Boolean);
              return `<tr><td>${i + 1}</td>${cells
                .map((c) => `<td>${c.replace(/[&<>]/g, '')}</td>`)
                .join('')}</tr>`;
            }),
        )
        .join('');
      const html = `<html><head><meta charset="utf-8"></head><body><table border="1"><tr><th>Стр.</th><th>Данные</th></tr>${rows}</table></body></html>`;
      downloadBlob(new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel' }), `${baseName(name)}.xls`);
      if (!desktop) toast({ title: 'Готова таблица', description: 'Файл открывается в Excel' });
    });

  const toText = () =>
    run('text', false, async () => {
      const chunks = await collectText();
      const text = chunks.map((t, i) => `--- Страница ${i + 1} ---\n${t}`).join('\n\n');
      downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${baseName(name)}.txt`);
      if (!desktop) toast({ title: 'Готов текстовый файл' });
    });

  const toImages = () =>
    run('jpg', !isFull, async () => {
      const items: { blob: Blob; name: string }[] = [];
      for (let i = 0; i < pages.length; i++) {
        const doc = docOf(pages[i]);
        if (!doc) continue;
        const canvas = await renderPageOnce(doc, pages[i].src, 2, pages[i].rotation);
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
        const file = `${baseName(name)}-${String(i + 1).padStart(3, '0')}.jpg`;
        setProgress(Math.round(((i + 1) / pages.length) * 100));

        if (desktop) {
          items.push({ blob, name: file });
          if (i % 3 === 2) await breathe();
        } else {
          downloadBlob(blob, file);
          await new Promise((r) => setTimeout(r, 250));
        }
      }

      // В программе папку выбираем один раз, а не окно на каждую страницу
      if (desktop) {
        await nativeSaveMany(items);
        return;
      }
      toast({ title: 'Страницы сохранены', description: `${pages.length} изображений JPG` });
    });

  const splitCurrent = () =>
    run('split', false, async () => {
      const bytes = await buildPdf([pages[active]]);
      downloadBlob(
        new Blob([bytes as BlobPart], { type: 'application/pdf' }),
        `${baseName(name)}-страница-${active + 1}.pdf`,
      );
      if (!desktop) toast({ title: 'Страница сохранена отдельным файлом' });
    });

  const runOcr = () =>
    run('ocr', false, async () => {
      // Модуль распознавания хранится зашифрованным, ключ даёт сервер
      // по действующей лицензии — иначе он просто не запустится
      const mod = (await loadOcrModule(license?.key || '')) as {
        createWorker: typeof import('tesseract.js').createWorker;
      };
      const { createWorker } = mod;

      // Словари и сам движок лежат внутри программы, поэтому
      // распознавание работает без интернета и не качает по 20 МБ
      // при каждом запуске. Готовые настройки tesseract тянут всё
      // это с чужого сервера — на рабочем месте без сети это провал
      //
      // Адрес собираем средствами браузера, а не склейкой строк. Раньше
      // тут склеивалось «адрес окна» + «./» и получалось pvspdf.local./tessdata
      // — с лишней точкой. Для браузера это ЧУЖОЙ адрес, и запуск
      // распознавания он запрещал: «cannot be accessed from origin»
      const base = new URL(`${import.meta.env.BASE_URL}tessdata`, location.href).href.replace(
        /\/$/,
        '',
      );

      // Ядро распознавания есть в двух видах: ускоренное и обычное.
      // Ускоренное работает заметно быстрее, но идёт не на любом
      // процессоре — какое взять, решаем по самому компьютеру
      const fast = await canFast();

      const worker = await createWorker('rus+eng', 1, {
        langPath: base,
        workerPath: `${base}/worker.min.js`,
        // Указываем файл ядра прямо. Сам движок искал бы файлы без
        // пометки lstm, которых в программе нет: он их не находил и
        // распознавание обрывалось
        corePath: `${base}/core/tesseract-core${fast ? '-simd' : ''}-lstm.wasm.js`,
        // Рабочий поток запускаем напрямую из файла программы.
        // Обычно движок делает это в обход — через кусок кода в памяти,
        // но в программе такой запуск запрещён, и распознавание падало
        // с жалобой на worker.min.js
        workerBlobURL: false,
        gzip: true,
        // Словари берём только из файлов программы и НЕ складываем в
        // память браузера. Иначе после обновления программы там остаются
        // словари от прошлой сборки: движок молча берёт старые, спотыкается
        // на них и распознавание срывается без внятной причины
        cacheMethod: 'none',
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100));
        },
      });

      await worker.setParameters({
        // Сохраняем пробелы между словами: без этого столбцы и отступы
        // в актах и накладных слипались в сплошную строку
        preserve_interword_spaces: '1',
        // Говорим движку настоящее разрешение листа. Без этого он гадает
        // по картинке, ошибается в размере букв и путает похожие знаки —
        // отсюда были искажённые слова
        user_defined_dpi: String(OCR_DPI),
      });

      // Какие листы разбирать. По умолчанию весь документ, но в толстом
      // скане можно указать только нужные — это экономит много времени
      const picked =
        ocrScope === 'current'
          ? [active]
          : ocrScope === 'range'
            ? parseRange(ocrRange, pages.length)
            : pages.map((_, i) => i);

      if (!picked.length) {
        toast({ title: 'Страницы не выбраны', description: 'Проверьте указанный диапазон' });
        return;
      }

      // Держим настоящий номер листа рядом с текстом: при выборочном
      // разборе третья страница должна остаться третьей, а не первой
      const sheets: OcrSheet[] = [];

      for (let n = 0; n < picked.length; n++) {
        const i = picked[n];
        const pg = pages[i];
        const doc = docOf(pg);
        if (!doc) continue;

        // Если страница не сканированная — текст в ней уже записан, и его можно
        // взять напрямую, без разбора картинки. Это и точнее (ни одной
        // ошибки), и быстрее. Разбираем только то, что снято сканером —
        // так же поступают промышленные программы распознавания
        const ready = await readyText(doc, pg.src);
        if (ready) {
          sheets.push({ no: i + 1, text: ready.text, parts: ready.parts });
          setProgress(Math.round(((n + 1) / picked.length) * 100));
          continue;
        }

        // Чем крупнее отрисовка, тем точнее распознавание. Раньше здесь
        // стояло втрое — это всего 216 точек на дюйм, движку не хватало
        // деталей и он путал похожие буквы. 300 — то, к чему привык сканер
        const canvas = await renderPageOnce(doc, pg.src, OCR_DPI / 72, pg.rotation);

        // Чистку применяем только к настоящим сканам — бледным, серым,
        // с пылью. Чёткую страницу она портит: буквы огрубляются и текст
        // разбирается заметно хуже, чем без всякой подготовки
        const sheet = clean && needsClean(canvas) ? cleanScan(canvas) : canvas;

        // Лист, положенный в сканер с перекосом, программа выравнивает
        // сама — иначе строки распознаются с ошибками.
        // Вместе с текстом забираем разметку листа: где абзацы, где
        // заголовки, какие слова крупнее и жирнее. По ней документ
        // потом собирается в Word похожим на исходник
        const { data } = await worker.recognize(sheet, { rotateAuto: true }, { blocks: true });

        // Пустую страницу тоже запоминаем, чтобы нумерация листов
        // в Word совпадала с нумерацией в самом документе
        sheets.push({
          no: i + 1,
          text: (data.text || '').trim(),
          parts: readLayout(data),
        });

        // Ход считаем по выбранным листам, а не по всему документу
        setProgress(Math.round(((n + 1) / picked.length) * 100));
      }

      await worker.terminate();

      const all = joinPages(sheets);
      setOcrText(all);
      setOcrPages(sheets);

      toast({
        title: all ? 'Текст распознан' : 'Текст не найден',
        description: all
          ? `Обработано страниц: ${sheets.length}`
          : 'На страницах не удалось разобрать текст',
      });
    });

  // Распознанный текст — в Word. Каждая страница документа ложится
  // на отдельный лист, как в исходнике. Если текст правили руками
  // в окне ниже, выгружаем именно правленый
  const ocrToWord = () => {
    // Пока текст не трогали, раскладываем по страницам. После правки
    // границы страниц теряются — тогда сохраняем одним листом
    const edited = ocrPages.length > 0 && ocrText !== joinPages(ocrPages);

    // Пока текст не правили, несём в Word и разметку страницы: заголовки,
    // выравнивание, жирный шрифт. После ручной правки разметка уже не
    // соответствует тексту, поэтому сохраняем просто абзацами
    const sheets: OcrSheet[] = edited
      ? [{ no: ocrPages[0]?.no ?? 1, text: ocrText }]
      : ocrPages.length < 2
        ? [{ no: ocrPages[0]?.no ?? 1, text: ocrText, parts: ocrPages[0]?.parts }]
        : ocrPages;

    const bytes = buildDocx(sheets, !edited && ocrPages.length > 1);

    downloadBlob(new Blob([bytes as BlobPart], { type: DOCX_TYPE }), `${baseName(name)}-распознано.docx`);
    if (!desktop) toast({ title: 'Готов файл Word', description: 'Распознанный текст' });
  };

  const TOOLS = [
    { key: 'pdf', icon: 'Save', label: 'Сохранить PDF', note: 'Со всеми правками', fn: toPdf },
    { key: 'word', icon: 'FileText', label: 'В Word', note: 'Редактируемый документ', fn: toWord, pro: true },
    { key: 'excel', icon: 'Table', label: 'В Excel', note: 'Таблица из документа', fn: toExcel, pro: true },
    { key: 'jpg', icon: 'Image', label: 'В JPG', note: 'Каждая страница картинкой', fn: toImages, pro: true },
    { key: 'text', icon: 'AlignLeft', label: 'В текст', note: 'Простой файл TXT', fn: toText },
    { key: 'split', icon: 'Scissors', label: 'Выделить страницу', note: 'Текущая — отдельным файлом', fn: splitCurrent },
    { key: 'ocr', icon: 'ScanText', label: 'Распознать (OCR)', note: 'Русский и английский', fn: runOcr, pro: true },
  ];

  return (
    <aside className="flex h-full w-[min(290px,85vw)] shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="label-caps">Инструменты</span>
        {!isFull && (
          <span className="font-head text-[0.66rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {left > 0 ? `Проба: ${left} из ${TRIAL_LIMIT}` : 'Бесплатная версия'}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {TOOLS.map((t) => {
          // Пробные инструменты работают, пока остались попытки:
          // человек видит настоящий результат, а не замок
          const trial = !!t.pro && !isFull && isTrialTool(t.key);
          const locked = !!t.pro && !isFull && (!trial || left === 0);
          return (
          <Fragment key={t.key}>
          <button
            onClick={locked ? () => setShowAct(true) : t.fn}
            disabled={!!busy}
            className="flex w-full items-start gap-3 border-b border-border px-4 py-4 text-left transition-colors hover:bg-background disabled:opacity-50"
          >
            <Icon
              name={busy === t.key ? 'LoaderCircle' : locked ? 'Lock' : t.icon}
              size={18}
              className={`mt-0.5 shrink-0 ${locked ? 'text-muted-foreground' : 'text-primary'} ${
                busy === t.key ? 'animate-spin' : ''
              }`}
            />
            <span className="min-w-0">
              <span className="block font-head text-[0.92rem] font-bold uppercase tracking-[-0.01em]">
                {t.label}
              </span>
              <span className="mt-0.5 block text-[0.8rem] text-muted-foreground">
                {locked
                  ? 'Доступно в полной версии'
                  : trial
                    ? `${t.note} — проба, осталось ${left}`
                    : t.note}
              </span>
              {busy === t.key && (
                <>
                  <span className="mt-2 block h-1 w-full bg-border">
                    <span
                      className="block h-full bg-primary transition-all"
                      style={{ width: `${Math.max(3, progress)}%` }}
                    />
                  </span>
                  <span className="mt-1 block text-[0.75rem] text-muted-foreground">
                    {(() => {
                      const total = t.key === 'ocr' ? ocrCount || pages.length : pages.length;
                      return progress > 0
                        ? `Обработано ${Math.round((progress / 100) * total)} из ${total} стр.`
                        : 'Подготовка';
                    })()}
                  </span>
                </>
              )}
            </span>
          </button>

          {/* Подготовка скана. Бледные и запылённые копии без неё
              распознаются плохо, но на чистой цифровой выкладке
              её можно выключить */}
          {t.key === 'ocr' && !locked && (
            <label className="flex cursor-pointer items-start gap-2 border-b border-border px-4 py-3">
              <input
                type="checkbox"
                checked={clean}
                disabled={!!busy}
                onChange={(e) => setClean(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary disabled:opacity-50"
              />
              <span className="min-w-0">
                <span className="block text-[0.82rem] font-bold">Улучшать скан</span>
                <span className="mt-0.5 block text-[0.76rem] leading-snug text-muted-foreground">
                  Выравнивает контраст и убирает пятна
                </span>
              </span>
            </label>
          )}

          {/* Выбор листов показываем только у распознавания: в толстом
              скане обычно нужна пара страниц, а не вся пачка */}
          {t.key === 'ocr' && !locked && pages.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              {(
                [
                  ['all', 'Все'],
                  ['current', `Текущая (${active + 1})`],
                  ['range', 'Выбрать'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  disabled={!!busy}
                  onClick={() => setOcrScope(id)}
                  className={`border px-3 py-1.5 text-[0.78rem] transition-colors disabled:opacity-50 ${
                    ocrScope === id
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:bg-background'
                  }`}
                >
                  {label}
                </button>
              ))}

              {ocrScope === 'range' && (
                <input
                  value={ocrRange}
                  onChange={(e) => setOcrRange(e.target.value)}
                  disabled={!!busy}
                  placeholder={`например 1-3, 7 (всего ${pages.length})`}
                  className="min-w-0 flex-1 border border-border bg-background px-3 py-1.5 text-[0.78rem] outline-none focus:border-primary disabled:opacity-50"
                />
              )}
            </div>
          )}
          </Fragment>
          );
        })}

        {!isFull && (
          <button
            onClick={() => setShowAct(true)}
            className="flex w-full items-center gap-3 border-b border-border bg-primary/5 px-4 py-4 text-left transition-colors hover:bg-primary/10"
          >
            <Icon name="KeyRound" size={18} className="shrink-0 text-primary" />
            <span>
              <span className="block font-head text-[0.9rem] font-bold uppercase text-primary">
                Активировать
              </span>
              <span className="mt-0.5 block text-[0.78rem] text-muted-foreground">
                {left > 0
                  ? `Пробных попыток осталось: ${left}`
                  : 'Пробные попытки закончились'}
              </span>
            </span>
          </button>
        )}

        {ocrText && (
          <div className="border-b border-border p-4">
            <div className="flex items-center justify-between">
              <span className="label-caps">Распознанный текст</span>
              <span className="flex items-center gap-3">
                <button
                  className="text-primary hover:opacity-70"
                  title="Сохранить в Word — каждая страница на своём листе"
                  onClick={ocrToWord}
                >
                  <Icon name="FileText" size={15} />
                </button>
                <button
                  className="text-primary hover:opacity-70"
                  title="Сохранить простым текстом"
                  onClick={() =>
                    downloadBlob(
                      new Blob([ocrText], { type: 'text/plain;charset=utf-8' }),
                      `${baseName(name)}-распознано.txt`,
                    )
                  }
                >
                  <Icon name="Download" size={15} />
                </button>
              </span>
            </div>
            <textarea
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              rows={12}
              className="mt-3 w-full resize-y border border-border bg-background p-3 text-[0.82rem] leading-relaxed outline-none focus:border-primary"
            />
          </div>
        )}
      </div>

      {showAct && <ActivateDialog onClose={() => setShowAct(false)} />}
    </aside>
  );
};

export default ToolsPanel;