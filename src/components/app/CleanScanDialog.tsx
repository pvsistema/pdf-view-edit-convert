import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import DraggableDialog from '@/components/app/DraggableDialog';
import { useDoc } from '@/context/DocContext';
import { pageSize, renderPageOnce } from '@/lib/pdf';
import { tidyScan, type TidyOptions } from '@/lib/scanTidy';
import { parseRange } from '@/components/app/PrintDialog';
import { toast } from '@/hooks/use-toast';
import { useLicense } from '@/context/LicenseContext';
import { ModuleLocked } from '@/lib/secureModule';
import { createOcrWorker, textLayerOf } from '@/lib/ocrEngine';
import { logError } from '@/lib/desktop';

// Разрешение, в котором лист очищается и остаётся в документе.
// 200 точек на дюйм — читаемо при печати и не раздувает файл
const DPI = 200;
// Для распознавания лист нужен крупнее: на 300 точках движок путает
// буквы заметно реже. Слой потом ложится на страницу в любом размере
const OCR_DPI = 300;
const PREVIEW_SCALE = 0.9;

type Scope = 'current' | 'all' | 'range';

const readOpts = (): TidyOptions => {
  try {
    const v = JSON.parse(localStorage.getItem('pvs-tidy') || '{}');
    return {
      specks: v.specks !== false,
      strength: typeof v.strength === 'number' ? v.strength : 40,
      gray: !!v.gray,
    };
  } catch {
    return { specks: true, strength: 40, gray: false };
  }
};

const canvasBytes = (c: HTMLCanvasElement, type: 'png' | 'jpeg') =>
  new Promise<Uint8Array>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error('Картинка не создалась'))),
      type === 'png' ? 'image/png' : 'image/jpeg',
      0.9,
    ),
  );

// Очистка фона скана: серый оттенок, тени, желтизна и мелкие точки.
// Страницы заменяются очищенными картинками; Ctrl+Z возвращает прежние
const CleanScanDialog = ({ onClose }: { onClose: () => void }) => {
  const { pages, active, docOf, replaceWithImages } = useDoc();
  const { isFull, license } = useLicense();
  // Сразу распознать текст: страница остаётся доступной для поиска
  // и копирования. Только в полной версии — как и само распознавание
  const [ocr, setOcrRaw] = useState(() => localStorage.getItem('pvs-tidy-ocr') !== '0');
  const setOcr = (v: boolean) => {
    setOcrRaw(v);
    try {
      localStorage.setItem('pvs-tidy-ocr', v ? '1' : '0');
    } catch {
      /* хранилище недоступно — не страшно */
    }
  };
  const withOcr = ocr && isFull;
  const [stage, setStage] = useState('');
  const [opts, setOptsRaw] = useState<TidyOptions>(readOpts);
  const [scope, setScope] = useState<Scope>('current');
  const [range, setRange] = useState('');
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [split, setSplit] = useState(50);
  const before = useRef<HTMLCanvasElement | null>(null);
  const [preview, setPreview] = useState<{ a: string; b: string } | null>(null);
  const stop = useRef(false);

  const setOpts = (patch: Partial<TidyOptions>) =>
    setOptsRaw((o) => {
      const next = { ...o, ...patch };
      try {
        localStorage.setItem('pvs-tidy', JSON.stringify(next));
      } catch {
        /* хранилище недоступно — не страшно */
      }
      return next;
    });

  const page = pages[active];

  // Исходный вид текущей страницы — один раз
  useEffect(() => {
    let off = false;
    if (!page) return;
    const doc = docOf(page);
    if (!doc) return;
    renderPageOnce(doc, page.src, PREVIEW_SCALE, page.rotation)
      .then((c) => {
        if (off) return;
        before.current = c;
        setPreview((p) => ({ a: c.toDataURL('image/jpeg', 0.85), b: p?.b || '' }));
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [page, docOf]);

  // Очищенный вид — при каждой смене настроек, с небольшой паузой
  useEffect(() => {
    const t = setTimeout(() => {
      const c = before.current;
      if (!c) return;
      const { canvas } = tidyScan(c, opts);
      setPreview((p) => ({ a: p?.a || '', b: canvas.toDataURL('image/jpeg', 0.85) }));
    }, 120);
    return () => clearTimeout(t);
  }, [opts, preview?.a]);

  const targets = () => {
    if (scope === 'current') return page ? [page] : [];
    if (scope === 'all') return pages;
    return parseRange(range, pages.length).map((i) => pages[i]);
  };

  const run = async () => {
    const list = targets();
    if (!list.length) {
      toast({ title: 'Страницы не выбраны', description: 'Проверьте номера страниц' });
      return;
    }
    stop.current = false;
    setBusy({ done: 0, total: list.length });
    const images: { bytes: Uint8Array; type: 'png' | 'jpeg'; w: number; h: number; text?: Uint8Array | null }[] = [];
    let specks = 0;
    let recognized = 0;
    let worker: Awaited<ReturnType<typeof createOcrWorker>> | null = null;
    try {
      if (withOcr) {
        setStage('Запускаю распознавание…');
        try {
          worker = await createOcrWorker(license?.key || '', OCR_DPI);
        } catch (e) {
          // Распознавание не завелось — чистим всё равно, без текста
          logError('очистка фона: распознавание', e);
          toast({
            title: e instanceof ModuleLocked ? 'Распознавание недоступно' : 'Распознавание не запустилось',
            description: 'Страницы будут очищены без текстового слоя',
          });
        }
      }
      for (let i = 0; i < list.length; i++) {
        if (stop.current) {
          toast({ title: 'Остановлено', description: 'Документ не изменён' });
          return;
        }
        const p = list[i];
        const doc = docOf(p);
        const size = await pageSize(doc, p.src, p.rotation);
        setStage(`Очищаю страницу ${i + 1} из ${list.length}`);
        const c = await renderPageOnce(doc, p.src, (worker ? OCR_DPI : DPI) / 72, p.rotation);
        const res = tidyScan(c, opts);
        specks += res.specks;

        let text: Uint8Array | null = null;
        if (worker) {
          setStage(`Распознаю текст: страница ${i + 1} из ${list.length}`);
          // Читаем уже очищенный лист: на белом фоне движок ошибается реже
          const layer = await textLayerOf(worker, res.canvas).catch((e) => {
            logError('очистка фона: распознавание страницы', e);
            return null;
          });
          if (layer?.pdf && layer.text) {
            text = layer.pdf;
            recognized++;
          }
        }

        // В документ кладём лист в 200 точек: больше для чтения и печати
        // не нужно, а файл не раздувается
        let picture = res.canvas;
        if (worker) {
          const small = document.createElement('canvas');
          small.width = Math.round((res.canvas.width * DPI) / OCR_DPI);
          small.height = Math.round((res.canvas.height * DPI) / OCR_DPI);
          const sctx = small.getContext('2d')!;
          sctx.imageSmoothingQuality = 'high';
          sctx.drawImage(res.canvas, 0, 0, small.width, small.height);
          picture = small;
        }

        // Чёрно-белый лист без полутонов сжимается в PNG лучше и
        // остаётся резким; цветной — в JPEG, иначе файл раздуется
        const type = opts.gray ? 'png' : 'jpeg';
        images.push({ bytes: await canvasBytes(picture, type), type, w: size.w, h: size.h, text });
        setBusy({ done: i + 1, total: list.length });
        // Отдаём управление окну, чтобы был виден ход работы
        await new Promise((r) => setTimeout(r, 0));
      }
      await replaceWithImages(
        list.map((p) => p.uid),
        images,
        list.length > 1 ? `очистку фона (${list.length} стр.)` : 'очистку фона',
      );
      const parts = [
        opts.specks && specks ? `убрано точек: ${specks}` : '',
        worker ? (recognized ? `текст распознан на ${recognized} из ${list.length} стр.` : 'текст не найден') : '',
      ].filter(Boolean);
      toast({
        title: list.length > 1 ? `Очищено страниц: ${list.length}` : 'Страница очищена',
        description: (parts.length ? parts.join(', ') + '. ' : '') + 'Вернуть — Ctrl+Z',
      });
      onClose();
    } catch (e) {
      toast({ title: 'Не удалось очистить', description: e instanceof Error ? e.message : '' });
    } finally {
      await worker?.terminate().catch(() => undefined);
      setBusy(null);
      setStage('');
    }
  };

  const chip = (on: boolean) =>
    `border px-3 py-2 text-[0.8rem] transition-colors ${
      on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-foreground'
    }`;

  return (
    <DraggableDialog
      title="Очистить фон скана"
      onClose={() => {
        stop.current = true;
        onClose();
      }}
      width={900}
      height={640}
      minWidth={620}
      minHeight={460}
      footer={
        <div className="flex items-center gap-3 p-4">
          <p className="flex-1 text-[0.76rem] text-muted-foreground">
            {busy
              ? stage || `Обрабатываю: ${busy.done} из ${busy.total}`
              : withOcr
                ? 'Страница станет картинкой с текстом под ней. Отменить — Ctrl+Z.'
                : 'Страница станет картинкой. Отменить можно через Ctrl+Z.'}
          </p>
          {busy ? (
            <button
              onClick={() => (stop.current = true)}
              className="border border-border px-4 py-2.5 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] hover:border-foreground"
            >
              Остановить
            </button>
          ) : (
            <button
              onClick={onClose}
              className="border border-border px-4 py-2.5 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] hover:border-foreground"
            >
              Отмена
            </button>
          )}
          <button
            onClick={() => void run()}
            disabled={!!busy}
            className="flex items-center gap-2 border border-primary bg-primary px-5 py-2.5 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Icon name={busy ? 'LoaderCircle' : 'Sparkles'} size={14} className={busy ? 'animate-spin' : ''} />
            Очистить
          </button>
        </div>
      }
    >
      <div className="grid h-full min-h-0 grid-cols-[260px_1fr] gap-0">
        <div className="space-y-5 overflow-y-auto border-r border-border p-5">
          <div>
            <div className="label-caps">Страницы</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={chip(scope === 'current')} onClick={() => setScope('current')}>
                Текущая
              </button>
              <button className={chip(scope === 'all')} onClick={() => setScope('all')}>
                Все ({pages.length})
              </button>
              <button className={chip(scope === 'range')} onClick={() => setScope('range')}>
                Выбрать
              </button>
            </div>
            {scope === 'range' && (
              <input
                value={range}
                onChange={(e) => setRange(e.target.value)}
                placeholder="Например: 1-3, 5"
                autoFocus
                className="mt-2 w-full border border-border bg-background px-3 py-2 text-[0.86rem] outline-none focus:border-primary"
              />
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="label-caps">Сила очистки</span>
              <span className="font-head text-[0.76rem] font-bold">{opts.strength}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={opts.strength}
              onChange={(e) => setOpts({ strength: Number(e.target.value) })}
              className="mt-2 w-full accent-primary"
            />
            <div className="flex justify-between text-[0.7rem] text-muted-foreground">
              <span>бережно</span>
              <span>сильно</span>
            </div>
            <p className="mt-2 text-[0.74rem] leading-snug text-muted-foreground">
              Сильнее — белее фон и темнее буквы. Если бледный текст начал пропадать, убавьте.
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-[0.84rem]">
            <input
              type="checkbox"
              checked={opts.specks}
              onChange={(e) => setOpts({ specks: e.target.checked })}
              className="mt-1 accent-primary"
            />
            <span>
              Убрать мелкие точки
              <span className="block text-[0.74rem] text-muted-foreground">
                Пыль и крошки тонера на чистом поле. Точки в тексте остаются
              </span>
            </span>
          </label>

          <label
            className={`flex items-start gap-2 text-[0.84rem] ${isFull ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
          >
            <input
              type="checkbox"
              checked={withOcr}
              disabled={!isFull}
              onChange={(e) => setOcr(e.target.checked)}
              className="mt-1 accent-primary"
            />
            <span>
              Сразу распознать текст
              <span className="block text-[0.74rem] text-muted-foreground">
                {isFull
                  ? 'Страница останется доступной для поиска и копирования текста. Займёт несколько секунд на лист'
                  : 'Доступно в полной версии'}
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2 text-[0.84rem]">
            <input
              type="checkbox"
              checked={opts.gray}
              onChange={(e) => setOpts({ gray: e.target.checked })}
              className="mt-1 accent-primary"
            />
            <span>
              Чёрно-белый результат
              <span className="block text-[0.74rem] text-muted-foreground">
                Для документов без цветных печатей — файл получится меньше
              </span>
            </span>
          </label>
        </div>

        {/* Сравнение «до/после»: ползунок делит лист пополам */}
        <div className="flex min-h-0 flex-col p-4">
          <div className="flex items-center justify-between text-[0.72rem] text-muted-foreground">
            <span>До</span>
            <span>Страница {active + 1} — двигайте разделитель</span>
            <span>После</span>
          </div>
          <div className="relative mt-2 min-h-0 flex-1 overflow-auto bg-card">
            {preview?.a ? (
              <div className="relative mx-auto w-fit">
                <img
                  src={preview.b || preview.a}
                  alt=""
                  className="block"
                  style={{ width: before.current ? `${before.current.width}px` : undefined, maxWidth: 'none' }}
                  draggable={false}
                />
                <div className="absolute inset-0 overflow-hidden" style={{ width: `${split}%` }}>
                  <img
                    src={preview.a}
                    alt=""
                    className="block"
                    style={{ width: before.current ? `${before.current.width}px` : undefined, maxWidth: 'none' }}
                    draggable={false}
                  />
                </div>
                <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary" style={{ left: `${split}%` }} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <Icon name="LoaderCircle" size={20} className="animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
            className="mt-3 w-full accent-primary"
          />
        </div>
      </div>
    </DraggableDialog>
  );
};

export default CleanScanDialog;
