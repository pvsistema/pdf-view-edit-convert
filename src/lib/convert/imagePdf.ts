// Сборка PDF из изображений. Форматы, которые браузер сам не открывает
// (HEIC с телефона, многостраничный TIFF со сканера), разбираем отдельно

import { PAPERS } from '@/context/DocContext';

export type Sheet = { width: number; height: number; jpeg: Uint8Array };

const canvasToJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Uint8Array>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)))
          : reject(new Error('Не удалось подготовить изображение')),
      'image/jpeg',
      quality,
    ),
  );

// Очень большие снимки уменьшаем: 4000 точек по длинной стороне хватает
// для печати, а файл выходит в разы легче
const LIMIT = 4000;

const drawToSheet = async (
  src: CanvasImageSource,
  w: number,
  h: number,
  quality: number,
): Promise<Sheet> => {
  const k = Math.min(1, LIMIT / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d', { alpha: false })!;
  // Белая подложка: прозрачные места PNG иначе станут чёрными
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, jpeg: await canvasToJpeg(canvas, quality) };
};

const isHeic = (f: File) =>
  /\.hei[cf]$/i.test(f.name) || f.type === 'image/heic' || f.type === 'image/heif';

const isTiff = (f: File) => /\.tiff?$/i.test(f.name) || /tiff?$/.test(f.type);

// Один файл может дать несколько листов: в TIFF со сканера
// страницы лежат внутри одного файла
export const fileToSheets = async (file: File, quality = 0.85): Promise<Sheet[]> => {
  if (isTiff(file)) {
    const UTIF = (await import('utif')).default;
    const raw = await file.arrayBuffer();
    const pages = UTIF.decode(raw);
    const out: Sheet[] = [];
    for (const page of pages) {
      UTIF.decodeImage(raw, page);
      const rgba = UTIF.toRGBA8(page);
      const w = page.width;
      const h = page.height;
      if (!w || !h) continue;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
      out.push(await drawToSheet(canvas, w, h, quality));
    }
    if (!out.length) throw new Error('В файле TIFF не нашлось изображений');
    return out;
  }

  if (isHeic(file)) {
    const decode = (await import('heic-decode')).default;
    const { width, height, data } = await decode({
      buffer: new Uint8Array(await file.arrayBuffer()),
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    return [await drawToSheet(canvas, width, height, quality)];
  }

  // Обычные JPG и PNG открывает сам браузер
  const bitmap = await createImageBitmap(file);
  const sheet = await drawToSheet(bitmap, bitmap.width, bitmap.height, quality);
  bitmap.close();
  return [sheet];
};

export type ImagePdfOptions = {
  // Лист A4 с полями или страница точно по размеру снимка
  paper?: 'a4' | 'fit';
  margin?: number;
  quality?: number;
  onStep?: (done: number, total: number) => void;
};

export const imagesToPdf = async (files: File[], opts: ImagePdfOptions = {}) => {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const paper = opts.paper ?? 'fit';
  const margin = opts.margin ?? 24;
  const quality = opts.quality ?? 0.85;

  let done = 0;
  for (const file of files) {
    const sheets = await fileToSheets(file, quality);
    for (const sheet of sheets) {
      const img = await out.embedJpg(sheet.jpeg);

      if (paper === 'fit') {
        const page = out.addPage([sheet.width, sheet.height]);
        page.drawImage(img, { x: 0, y: 0, width: sheet.width, height: sheet.height });
      } else {
        // Снимок в альбомной ориентации кладём на лист боком —
        // так он занимает страницу целиком, а не узкую полоску
        const land = sheet.width > sheet.height;
        const [pw, ph] = land ? [PAPERS.a4[1], PAPERS.a4[0]] : PAPERS.a4;
        const page = out.addPage([pw, ph]);
        const availW = pw - margin * 2;
        const availH = ph - margin * 2;
        const k = Math.min(availW / sheet.width, availH / sheet.height);
        const dw = sheet.width * k;
        const dh = sheet.height * k;
        page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
      }
    }
    done++;
    opts.onStep?.(done, files.length);
    // Отдаём управление окну: полоска выполнения не должна замирать
    await new Promise((r) => setTimeout(r, 0));
  }

  if (!out.getPageCount()) throw new Error('Не удалось прочитать ни одного изображения');
  return out.save();
};
