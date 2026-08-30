// Действия над готовыми PDF: сжатие, объединение, страницы.
// Всё считается на компьютере пользователя, файлы никуда не отправляются

import { PAPERS } from '@/context/DocContext';
import { loadDocFromBytes, renderPageOnce, closeDoc } from '@/lib/pdf';

const readBytes = async (file: File) => new Uint8Array(await file.arrayBuffer());

// Объединение нескольких файлов в один документ
export const mergePdfs = async (
  files: File[],
  onStep?: (done: number, total: number) => void,
) => {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();

  let done = 0;
  for (const file of files) {
    const lib = await PDFDocument.load(await readBytes(file), { ignoreEncryption: true });
    const pages = await out.copyPages(lib, lib.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    onStep?.(++done, files.length);
    await new Promise((r) => setTimeout(r, 0));
  }

  if (!out.getPageCount()) throw new Error('В выбранных файлах нет страниц');
  return out.save();
};

export type CompressLevel = 'light' | 'medium' | 'strong';

// Насколько мельче делаем страницу и с каким качеством пересобираем.
// Чем сильнее сжатие, тем меньше вес и тем заметнее потеря чёткости
const PRESET: Record<CompressLevel, { scale: number; quality: number }> = {
  light: { scale: 1.6, quality: 0.82 },
  medium: { scale: 1.15, quality: 0.68 },
  strong: { scale: 0.85, quality: 0.52 },
};

// Сжатие: каждая страница пересобирается снимком. Текст перестаёт
// выделяться, зато тяжёлые сканы уменьшаются в разы
export const compressPdf = async (
  file: File,
  level: CompressLevel = 'medium',
  onStep?: (done: number, total: number) => void,
) => {
  const { PDFDocument } = await import('pdf-lib');
  const { scale, quality } = PRESET[level];

  const raw = await file.arrayBuffer();
  const doc = await loadDocFromBytes(raw);
  const out = await PDFDocument.create();

  try {
    for (let i = 0; i < doc.numPages; i++) {
      const canvas = await renderPageOnce(doc, i, scale);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('Страница не собралась'))), 'image/jpeg', quality),
      );
      const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));

      // Размер листа сохраняем прежним, меняется только плотность точек
      const page = await doc.getPage(i + 1);
      const view = page.getViewport({ scale: 1 });
      const sheet = out.addPage([view.width, view.height]);
      sheet.drawImage(img, { x: 0, y: 0, width: view.width, height: view.height });

      onStep?.(i + 1, doc.numPages);
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    closeDoc(doc);
  }

  return out.save();
};

// Разбор записи вида «1-3, 7, 12» в список номеров страниц
export const parseRange = (input: string, total: number) => {
  const picked = new Set<number>();
  for (const part of input.split(/[,;]/)) {
    const t = part.trim();
    if (!t) continue;
    const range = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(t);
    if (range) {
      const from = Math.max(1, Number(range[1]));
      const to = Math.min(total, Number(range[2]));
      for (let i = from; i <= to; i++) picked.add(i);
      continue;
    }
    const one = Number(t);
    if (Number.isInteger(one) && one >= 1 && one <= total) picked.add(one);
  }
  return [...picked].sort((a, b) => a - b);
};

// Удаление указанных страниц
export const dropPages = async (file: File, drop: number[]) => {
  const { PDFDocument } = await import('pdf-lib');
  const lib = await PDFDocument.load(await readBytes(file), { ignoreEncryption: true });
  const total = lib.getPageCount();
  const gone = new Set(drop.map((n) => n - 1));
  const keep = lib.getPageIndices().filter((i) => !gone.has(i));

  if (!keep.length) throw new Error('Нельзя удалить все страницы документа');
  if (keep.length === total) throw new Error('Не выбрано ни одной страницы');

  const out = await PDFDocument.create();
  const pages = await out.copyPages(lib, keep);
  pages.forEach((p) => out.addPage(p));
  return out.save();
};

// Оставить только указанные страницы — обратное действие
export const keepPages = async (file: File, keep: number[]) => {
  const { PDFDocument } = await import('pdf-lib');
  const lib = await PDFDocument.load(await readBytes(file), { ignoreEncryption: true });
  const idx = keep.map((n) => n - 1).filter((i) => i >= 0 && i < lib.getPageCount());
  if (!idx.length) throw new Error('Не выбрано ни одной страницы');

  const out = await PDFDocument.create();
  const pages = await out.copyPages(lib, idx);
  pages.forEach((p) => out.addPage(p));
  return out.save();
};

// Последовательность страниц ровно в том виде, как её написал человек:
// порядок сохраняется, повторы допустимы. Для перестановки страниц
// сортировать номера нельзя — иначе «3, 1, 2» снова стало бы «1, 2, 3»
export const parseOrder = (input: string, total: number) => {
  const out: number[] = [];
  for (const part of input.split(/[,;]/)) {
    const t = part.trim();
    if (!t) continue;
    const range = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(t);
    if (range) {
      const from = Math.max(1, Number(range[1]));
      const to = Math.min(total, Number(range[2]));
      // Диапазон может идти и в обратную сторону: «5-1» перевернёт листы
      if (from <= to) for (let i = from; i <= to; i++) out.push(i);
      else for (let i = Math.min(from, total); i >= to; i--) out.push(i);
      continue;
    }
    const one = Number(t);
    if (Number.isInteger(one) && one >= 1 && one <= total) out.push(one);
  }
  return out;
};

// Новый порядок страниц: список номеров в нужной последовательности
export const reorderPages = async (file: File, order: number[]) => {
  const { PDFDocument } = await import('pdf-lib');
  const lib = await PDFDocument.load(await readBytes(file), { ignoreEncryption: true });
  const total = lib.getPageCount();
  const idx = order.map((n) => n - 1).filter((i) => i >= 0 && i < total);
  if (!idx.length) throw new Error('Не выбрано ни одной страницы');

  const out = await PDFDocument.create();
  // Каждый номер копируем отдельно: страницу могли указать дважды,
  // а одну и ту же копию нельзя вставить в документ два раза
  for (const i of idx) {
    const [page] = await out.copyPages(lib, [i]);
    out.addPage(page);
  }
  return out.save();
};

// Чистые листы: вставляются перед указанной страницей или в конец
export const insertBlank = async (file: File, at: number, count = 1) => {
  const { PDFDocument } = await import('pdf-lib');
  const lib = await PDFDocument.load(await readBytes(file), { ignoreEncryption: true });

  // Размер чистого листа берём у соседней страницы, чтобы документ
  // остался ровным при печати
  const near = lib.getPage(Math.max(0, Math.min(at - 1, lib.getPageCount() - 1)));
  const { width, height } = near ? near.getSize() : { width: PAPERS.a4[0], height: PAPERS.a4[1] };

  for (let i = 0; i < count; i++) {
    const page = lib.insertPage(Math.max(0, Math.min(at - 1 + i, lib.getPageCount())), [width, height]);
    page.drawRectangle({ x: 0, y: 0, width, height, color: undefined });
  }
  return lib.save();
};

export type EnhanceOptions = {
  // Насколько растянуть яркость: серый фон скана становится белым
  strength?: number;
  gray?: boolean;
  onStep?: (done: number, total: number) => void;
};

// Улучшение скана: выравниваем освещённость и поднимаем контраст,
// чтобы серая бумага стала белой, а бледный текст — читаемым
export const enhanceScan = async (file: File, opts: EnhanceOptions = {}) => {
  const { PDFDocument } = await import('pdf-lib');
  const strength = opts.strength ?? 0.6;
  const raw = await file.arrayBuffer();
  const doc = await loadDocFromBytes(raw);
  const out = await PDFDocument.create();

  try {
    for (let i = 0; i < doc.numPages; i++) {
      const canvas = await renderPageOnce(doc, i, 2);
      const ctx = canvas.getContext('2d')!;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = data.data;

      // Находим, где на листе «бумага», а где «чернила»: берём не самые
      // крайние точки, иначе одно пятно испортит расчёт для всей страницы
      const hist = new Uint32Array(256);
      for (let p = 0; p < px.length; p += 4) {
        hist[(px[p] * 299 + px[p + 1] * 587 + px[p + 2] * 114) / 1000 | 0]++;
      }
      const total = canvas.width * canvas.height;
      let acc = 0;
      let dark = 0;
      let light = 255;
      for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc > total * 0.02) {
          dark = v;
          break;
        }
      }
      acc = 0;
      for (let v = 255; v >= 0; v--) {
        acc += hist[v];
        if (acc > total * 0.12) {
          light = v;
          break;
        }
      }
      if (light - dark < 24) light = Math.min(255, dark + 24);

      // Таблица пересчёта: считаем один раз на страницу, а не на каждую точку
      const map = new Uint8Array(256);
      for (let v = 0; v < 256; v++) {
        const norm = ((v - dark) / (light - dark)) * 255;
        map[v] = Math.max(0, Math.min(255, Math.round(v + (norm - v) * strength)));
      }

      for (let p = 0; p < px.length; p += 4) {
        if (opts.gray) {
          const g = map[(px[p] * 299 + px[p + 1] * 587 + px[p + 2] * 114) / 1000 | 0];
          px[p] = px[p + 1] = px[p + 2] = g;
        } else {
          px[p] = map[px[p]];
          px[p + 1] = map[px[p + 1]];
          px[p + 2] = map[px[p + 2]];
        }
      }
      ctx.putImageData(data, 0, 0);

      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('Страница не собралась'))), 'image/jpeg', 0.86),
      );
      const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));

      const page = await doc.getPage(i + 1);
      const view = page.getViewport({ scale: 1 });
      const sheet = out.addPage([view.width, view.height]);
      sheet.drawImage(img, { x: 0, y: 0, width: view.width, height: view.height });

      opts.onStep?.(i + 1, doc.numPages);
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    closeDoc(doc);
  }

  return out.save();
};

// Сколько страниц в файле — нужно для подсказок в окне инструмента
export const countPages = async (file: File) => {
  const { PDFDocument } = await import('pdf-lib');
  const lib = await PDFDocument.load(await readBytes(file), { ignoreEncryption: true });
  return lib.getPageCount();
};