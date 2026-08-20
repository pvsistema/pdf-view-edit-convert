import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Просмотрщик подключается при открытии первого документа, а не при запуске:
// пустое окно программы появляется заметно быстрее
type PdfJs = typeof import('pdfjs-dist');

let engine: PdfJs | null = null;
let loading: Promise<PdfJs> | null = null;

const engineReady = () => {
  if (engine) return Promise.resolve(engine);
  if (!loading) {
    loading = import('pdfjs-dist').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = workerSrc;
      engine = lib;
      return lib;
    });
  }
  return loading;
};

// Заранее готовим просмотрщик в свободную минуту, чтобы первый документ
// открывался без задержки
export const warmupEngine = () => {
  void engineReady();
};

export type PageMeta = {
  id: string;
  srcIndex: number;
  rotation: number;
  label: number;
};

// Документ из памяти: используется, когда байты уже прочитаны
export const loadDocFromBytes = async (data: ArrayBuffer) => {
  const lib = await engineReady();
  // Копия нужна: просмотрщик забирает буфер себе, а исходные байты
  // ещё понадобятся при сохранении и печати
  const task = lib.getDocument({ data: data.slice(0) });
  return task.promise;
};

// Документ по адресу: программа читает только те куски файла, которые
// нужны прямо сейчас. Документ на сотни мегабайт открывается почти мгновенно,
// вместо ожидания, пока весь файл окажется в памяти
export const loadDocFromUrl = async (url: string) => {
  const lib = await engineReady();
  const task = lib.getDocument({
    url,
    // Читаем частями по мере надобности и не докачиваем остаток в фоне:
    // память не занимается страницами, которые пользователь не открывал
    disableAutoFetch: true,
    disableStream: false,
    rangeChunkSize: 1 << 18,
  });
  return task.promise;
};

export const loadDoc = loadDocFromBytes;

// Закрываем документ и освобождаем занятую им память
export const closeDoc = (doc: any) => {
  try {
    doc?.cleanup?.();
    doc?.destroy?.();
  } catch {
    /* документ уже закрыт */
  }
};

// Плотность точек экрана: на мониторах с масштабом Windows 125-150%
// рисуем страницу крупнее, иначе текст выглядит мыльным
export const screenDensity = () => {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(3, Math.max(1, dpr));
};

// Память отрисованных страниц: листание вперёд-назад происходит мгновенно,
// потому что страница берётся готовой, а не рисуется заново.
// Храним ограниченное число страниц, самые старые вытесняются
const CACHE_LIMIT = 40;
// Примерно 250 МБ картинок — достаточно для быстрого листания
// и безопасно для компьютеров с небольшой памятью
const CACHE_PIXELS = 64_000_000;
const renderCache = new Map<string, HTMLCanvasElement>();
const renderQueue = new Map<string, Promise<HTMLCanvasElement>>();

// Текст страниц запоминаем: повторный поиск и выгрузка в Word
// больше не перечитывают документ целиком
const textCache = new Map<string, string>();

// Размеры листов: нужны для правильной высоты ленты
const sizeCache = new Map<string, { w: number; h: number }>();

let docSeq = 0;
const docKeys = new WeakMap<object, string>();
const keyOfDoc = (doc: any) => {
  let k = docKeys.get(doc);
  if (!k) {
    k = `d${++docSeq}`;
    docKeys.set(doc, k);
  }
  return k;
};

// Одновременно рисуем не больше двух страниц. Раньше при открытии
// документа стартовали все миниатюры сразу и программа замирала:
// сотни отрисовок соперничали за один и тот же поток
const MAX_PARALLEL = 2;
let running = 0;
type Job = { run: () => void; priority: number };
const waiting: Job[] = [];

const pump = () => {
  while (running < MAX_PARALLEL && waiting.length) {
    // Сначала то, что пользователь видит прямо сейчас
    let best = 0;
    for (let i = 1; i < waiting.length; i++) {
      if (waiting[i].priority > waiting[best].priority) best = i;
    }
    const job = waiting.splice(best, 1)[0];
    running++;
    job.run();
  }
};

const schedule = <T>(priority: number, task: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    waiting.push({
      priority,
      run: () => {
        task()
          .then(resolve, reject)
          .finally(() => {
            running--;
            pump();
          });
      },
    });
    pump();
  });

export const clearPageCache = () => {
  renderCache.clear();
  renderQueue.clear();
  textCache.clear();
  sizeCache.clear();
  waiting.length = 0;
};

// Освобождаем память только от закрытого документа: у остальных вкладок
// страницы остаются готовыми, и переключение между ними мгновенное
export const forgetDoc = (doc: any) => {
  if (!doc) return;
  const prefix = `${keyOfDoc(doc)}|`;
  for (const key of [...renderCache.keys()]) {
    if (key.startsWith(prefix)) renderCache.delete(key);
  }
  for (const key of [...renderQueue.keys()]) {
    if (key.startsWith(prefix)) renderQueue.delete(key);
  }
  for (const key of [...textCache.keys()]) {
    if (key.startsWith(prefix)) textCache.delete(key);
  }
  for (const key of [...sizeCache.keys()]) {
    if (key.startsWith(prefix)) sizeCache.delete(key);
  }
};

const rememberCanvas = (key: string, canvas: HTMLCanvasElement) => {
  renderCache.set(key, canvas);

  let used = 0;
  for (const c of renderCache.values()) used += c.width * c.height;

  while (renderCache.size > 1 && (renderCache.size > CACHE_LIMIT || used > CACHE_PIXELS)) {
    const oldest = renderCache.keys().next().value as string | undefined;
    if (oldest === undefined || oldest === key) break;
    const drop = renderCache.get(oldest)!;
    used -= drop.width * drop.height;
    renderCache.delete(oldest);
  }
};

export const renderPage = async (
  doc: any,
  pageIndex: number,
  scale: number,
  extraRotation = 0,
  sharpen = 1,
  priority = 0,
): Promise<HTMLCanvasElement> => {
  const key = `${keyOfDoc(doc)}|${pageIndex}|${scale}|${extraRotation}|${sharpen}`;

  const ready = renderCache.get(key);
  if (ready) {
    // Освежаем позицию: недавно просмотренные страницы держим дольше
    renderCache.delete(key);
    renderCache.set(key, ready);
    return copyCanvas(ready);
  }

  const started = renderQueue.get(key);
  if (started) return started.then(copyCanvas);

  const job = schedule(priority, () => drawPage(doc, pageIndex, scale, extraRotation, sharpen))
    .then((canvas) => {
      rememberCanvas(key, canvas);
      return canvas;
    })
    .finally(() => renderQueue.delete(key));

  renderQueue.set(key, job);
  return job.then(copyCanvas);
};

// Одну и ту же картинку нельзя показать сразу в двух местах,
// поэтому отдаём быструю копию: она готовится мгновенно
const copyCanvas = (src: HTMLCanvasElement) => {
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.style.width = src.style.width;
  canvas.style.height = src.style.height;
  canvas.getContext('2d', { alpha: false })!.drawImage(src, 0, 0);
  return canvas;
};

// Разовая отрисовка без запоминания: для экспорта и распознавания,
// где страницы крупные и второй раз не понадобятся
export const renderPageOnce = (
  doc: any,
  pageIndex: number,
  scale: number,
  extraRotation = 0,
  sharpen = 1,
) => drawPage(doc, pageIndex, scale, extraRotation, sharpen);

// Готовим страницу заранее, не дожидаясь перехода на неё.
// Приоритет ниже, чем у того, что пользователь смотрит сейчас
export const prefetchPage = (
  doc: any,
  pageIndex: number,
  scale: number,
  extraRotation = 0,
  sharpen = 1,
) => {
  void renderPage(doc, pageIndex, scale, extraRotation, sharpen, PRIORITY.prefetch).catch(
    () => undefined,
  );
};

export const PRIORITY = { view: 100, prefetch: 50, thumb: 10 };

const drawPage = async (
  doc: any,
  pageIndex: number,
  scale: number,
  extraRotation = 0,
  sharpen = 1,
): Promise<HTMLCanvasElement> => {
  const page = await doc.getPage(pageIndex + 1);
  const rotation = (page.rotate + extraRotation) % 360;

  // Размер на экране остаётся прежним, а точек внутри становится больше
  const view = page.getViewport({ scale, rotation });
  const viewport = page.getViewport({ scale: scale * sharpen, rotation });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(view.width)}px`;
  canvas.style.height = `${Math.floor(view.height)}px`;

  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
};

export const pageText = async (doc: any, pageIndex: number) => {
  const key = `${keyOfDoc(doc)}|${pageIndex}`;
  const ready = textCache.get(key);
  if (ready !== undefined) return ready;

  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  let out = '';
  let lastY: number | null = null;
  for (const item of content.items as any[]) {
    const y = item.transform?.[5];
    if (lastY !== null && Math.abs(y - lastY) > 4) out += '\n';
    out += item.str;
    lastY = y;
  }
  const text = out.trim();

  // Освобождаем внутренние данные страницы — их держит просмотрщик
  try {
    page.cleanup();
  } catch {
    /* страница уже освобождена */
  }

  if (textCache.size > 2000) textCache.clear();
  textCache.set(key, text);
  return text;
};

// Размер страницы нужен заранее: по нему лента сразу получает
// правильную высоту и не дёргается при подгрузке листов
export const pageSize = async (doc: any, pageIndex: number, extraRotation = 0) => {
  const key = `${keyOfDoc(doc)}|${pageIndex}|${extraRotation}`;
  const ready = sizeCache.get(key);
  if (ready) return ready;

  const page = await doc.getPage(pageIndex + 1);
  const rotation = (page.rotate + extraRotation) % 360;
  const v = page.getViewport({ scale: 1, rotation });
  const size = { w: v.width, h: v.height };
  sizeCache.set(key, size);
  return size;
};

// Места на странице, где встретилось искомое. Доли от размера страницы,
// поэтому подсветка правильно ложится при любом увеличении
export type TextHit = { x: number; y: number; w: number; h: number };

export const findOnPage = async (
  doc: any,
  pageIndex: number,
  needle: string,
  extraRotation = 0,
): Promise<TextHit[]> => {
  const q = needle.trim().toLowerCase();
  if (!q) return [];

  const { Util: util } = await engineReady();

  const page = await doc.getPage(pageIndex + 1);
  const rotation = (page.rotate + extraRotation) % 360;
  const viewport = page.getViewport({ scale: 1, rotation });
  const content = await page.getTextContent();

  const out: TextHit[] = [];

  // Если ищут целую фразу, она может быть разбита на части.
  // Тогда подсвечиваем каждое слово отдельно
  const words = q.split(/\s+/).filter((w) => w.length > 1);
  const targets = words.length > 1 ? [q, ...words] : [q];

  const markItem = (item: any, needleText: string) => {
    const str = String(item.str || '');
    const low = str.toLowerCase();
    if (!low.includes(needleText)) return false;

    // Положение и наклон куска текста на странице
    const tr = util.transform(viewport.transform, item.transform);
    const height = Math.hypot(tr[2], tr[3]) || 10;
    const dirX = Math.hypot(tr[0], tr[1]) || 1;
    const fullW = (item.width || 0) * (viewport.scale || 1) || dirX * str.length * 0.5;
    const perChar = fullW / Math.max(1, str.length);

    let from = 0;
    let hit = false;
    for (;;) {
      const at = low.indexOf(needleText, from);
      if (at < 0) break;
      hit = true;

      const x = tr[4] + perChar * at;
      const y = tr[5] - height;

      out.push({
        x: x / viewport.width,
        y: y / viewport.height,
        w: (perChar * needleText.length) / viewport.width,
        h: height / viewport.height,
      });
      from = at + needleText.length;
    }
    return hit;
  };

  for (const item of content.items as any[]) {
    // Сначала пробуем найти запрос целиком, потом по словам
    for (const t of targets) {
      if (markItem(item, t)) break;
    }
  }

  try {
    page.cleanup();
  } catch {
    /* страница уже освобождена */
  }

  return out;
};

// Сохранение и печать вынесены в @/lib/files — их можно использовать
// без загрузки движка просмотра
export { downloadBlob, canvasToBlob, printBlob, formatSize } from '@/lib/files';