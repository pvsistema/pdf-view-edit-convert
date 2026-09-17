import { Fragment, useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useDoc } from '@/context/DocContext';
import { canvasToBlob, downloadBlob } from '@/lib/files';
import { pageText, renderPageOnce } from '@/lib/pdf';
import { toast } from '@/hooks/use-toast';
import { useLicense } from '@/context/LicenseContext';
import { loadOcrModule, ModuleLocked } from '@/lib/secureModule';
import ActivateDialog from '@/components/app/ActivateDialog';
import { parseRange } from '@/components/app/PrintDialog';
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

// Распознанный лист: настоящий номер страницы и её текст
export type OcrSheet = { no: number; text: string };

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
        toast({
          title: 'Не удалось выполнить',
          description: 'Попробуйте другой файл или операцию',
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
      const body = chunks
        .map(
          (t, i) =>
            `<div style="page-break-after:always"><p>${t
              .split('\n')
              .map((l) => l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!))
              .join('</p><p>')}</p><small>Стр. ${i + 1}</small></div>`,
        )
        .join('');
      const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body style="font-family:Times New Roman,serif">${body}</body></html>`;
      downloadBlob(new Blob(['\ufeff', html], { type: 'application/msword' }), `${baseName(name)}.doc`);
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
      const base = `${location.origin}${import.meta.env.BASE_URL}tessdata`;

      const worker = await createWorker('rus+eng', 1, {
        langPath: base,
        workerPath: `${base}/worker.min.js`,
        corePath: `${base}/core`,
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100));
        },
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
      const sheets: { no: number; text: string }[] = [];

      for (let n = 0; n < picked.length; n++) {
        const i = picked[n];
        const pg = pages[i];
        const doc = docOf(pg);
        if (!doc) continue;

        // Чем крупнее отрисовка, тем точнее распознавание.
        // 300 точек на дюйм — то, к чему привык сканер
        const canvas = await renderPageOnce(doc, pg.src, 3, pg.rotation);
        const { data } = await worker.recognize(canvas);

        // Пустую страницу тоже запоминаем, чтобы нумерация листов
        // в Word совпадала с нумерацией в самом документе
        sheets.push({ no: i + 1, text: (data.text || '').trim() });

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
    const esc = (t: string) =>
      t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

    const asParagraphs = (t: string) =>
      t
        .split('\n')
        .map((l) => `<p>${esc(l) || '&nbsp;'}</p>`)
        .join('');

    // Пока текст не трогали, раскладываем по страницам. После правки
    // границы страниц теряются — тогда сохраняем одним листом
    const edited = ocrPages.length > 0 && ocrText !== joinPages(ocrPages);

    const body =
      edited || ocrPages.length < 2
        ? asParagraphs(ocrText)
        : ocrPages
            .map(
              (s) =>
                `<div style="page-break-after:always">${asParagraphs(
                  s.text,
                )}<small>Стр. ${s.no}</small></div>`,
            )
            .join('');

    const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body style="font-family:Times New Roman,serif">${body}</body></html>`;

    downloadBlob(
      new Blob(['\ufeff', html], { type: 'application/msword' }),
      `${baseName(name)}-распознано.doc`,
    );
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
    <aside className="flex h-full w-[290px] shrink-0 flex-col border-l border-border bg-card">
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