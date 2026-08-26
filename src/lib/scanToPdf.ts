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

// Снимок готовим сразу повёрнутым: в PDF он попадает уже ровным,
// и документ открывается правильно в любой программе
const toJpeg = async (img: HTMLImageElement, quality: number, turn: number) => {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const angle = ((turn % 360) + 360) % 360;
  const sideways = angle === 90 || angle === 270;

  const canvas = document.createElement('canvas');
  canvas.width = sideways ? h : w;
  canvas.height = sideways ? w : h;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Не удалось обработать снимок');

  // Белая подложка: у чёрно-белых снимков бывает прозрачный фон
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.translate(canvas.width / 2, canvas.height / 2);
  if (angle) ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);

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

export type Shot = { url: string; turn?: number };

export const scansToPdf = async (shots: Shot[], opts: BuildOptions = {}) => {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const quality = opts.quality ?? 0.82;

  for (let i = 0; i < shots.length; i++) {
    const img = await loadImage(shots[i].url);
    const bytes = await toJpeg(img, quality, shots[i].turn ?? 0);
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

    opts.onPage?.(i + 1, shots.length);
  }

  return out.save();
};

export const scanFileName = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `Скан ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}-${p(d.getMinutes())}.pdf`;
};
