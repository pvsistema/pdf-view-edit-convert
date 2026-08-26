// Сборка PDF из снимков сканера. Каждая картинка становится страницей
// в размер листа, чтобы документ печатался и открывался как обычный PDF

const A4 = { w: 595.28, h: 841.89 };

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Снимок не читается'));
    img.src = url;
  });

// Снимок ужимаем до разумного размера: страница в 300 точек на дюйм
// весит десятки мегабайт, а на печати разницы не видно
const MAX_SIDE = 2400;

const toJpeg = async (img: HTMLImageElement, quality: number) => {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Не удалось обработать снимок');

  // Белая подложка: у чёрно-белых снимков бывает прозрачный фон
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('Не удалось обработать снимок');
  return new Uint8Array(await blob.arrayBuffer());
};

export type BuildOptions = {
  quality?: number;
  onPage?: (done: number, total: number) => void;
};

export const scansToPdf = async (urls: string[], opts: BuildOptions = {}) => {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const quality = opts.quality ?? 0.82;

  for (let i = 0; i < urls.length; i++) {
    const img = await loadImage(urls[i]);
    const bytes = await toJpeg(img, quality);
    const embedded = await out.embedJpg(bytes);

    // Лист держим в пропорциях снимка: альбомный оригинал
    // не должен обрезаться на книжной странице
    const wide = embedded.width > embedded.height;
    const page = out.addPage(wide ? [A4.h, A4.w] : [A4.w, A4.h]);

    const size = page.getSize();
    const scale = Math.min(size.width / embedded.width, size.height / embedded.height);
    const w = embedded.width * scale;
    const h = embedded.height * scale;

    page.drawImage(embedded, {
      x: (size.width - w) / 2,
      y: (size.height - h) / 2,
      width: w,
      height: h,
    });

    opts.onPage?.(i + 1, urls.length);
  }

  return out.save();
};

export const scanFileName = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `Скан ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}-${p(d.getMinutes())}.pdf`;
};
