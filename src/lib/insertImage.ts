// Картинка для вставки в документ: подпись, печать, логотип.
//
// Фото с телефона бывает по 4000 точек и 5 МБ — такая подпись раздула бы
// PDF и тормозила бы лист. Подгоняем: длинная сторона не больше 2000 точек
// (с запасом для печати подписи размером с ладонь). Небольшие картинки
// оставляем как есть, без пересжатия

const MAX_SIDE = 2000;

export type Picture = { src: string; w: number; h: number };
// После обрезки пустых полей: какая часть исходной картинки осталась
export type Cleared = Picture & { crop?: { x0: number; y0: number; cw: number; ch: number; w: number; h: number } };

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Файл не похож на картинку PNG или JPEG'));
    img.src = src;
  });

const readAsData = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Файл не читается'));
    r.readAsDataURL(file);
  });

export const readPicture = async (file: File): Promise<Picture> => {
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
  if (!isPng && !isJpeg) throw new Error('Подойдёт картинка PNG или JPEG');

  const data = await readAsData(file);
  const img = await loadImage(data);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('Картинка пустая');

  if (Math.max(w, h) <= MAX_SIDE && file.size < 3 * 1024 * 1024) {
    // У некоторых файлов тип в адресе не указан — проставляем верный,
    // по нему PDF решает, как встроить картинку
    const fixed = data.replace(/^data:[^;,]*/, isPng ? 'data:image/png' : 'data:image/jpeg');
    return { src: fixed, w, h };
  }

  const k = MAX_SIDE / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * Math.min(1, k)));
  c.height = Math.max(1, Math.round(h * Math.min(1, k)));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  // PNG остаётся PNG — иначе пропадёт прозрачность подписи
  return {
    src: isPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9),
    w: c.width,
    h: c.height,
  };
};

// Белый фон — прозрачный. Подпись, снятая на белой бумаге, после этого
// ложится на документ как чернила: текст и линии бланка под ней видны.
// Переход плавный: светлые точки становятся полупрозрачными, поэтому
// края штрихов не рваные. Заодно обрезаем пустые поля вокруг подписи
export const clearWhite = async (src: string): Promise<Cleared> => {
  const img = await loadImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  // Цвет бумаги — по самым светлым точкам: на фото с телефона бумага
  // обычно серая или желтоватая, а не чисто белая
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const v = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    hist[v | 0]++;
  }
  let paper = 255;
  for (let acc = 0, v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc > (w * h) / 2) {
      paper = v;
      break;
    }
  }
  const hi = Math.max(60, paper - 12);
  const lo = Math.max(0, hi - 90);

  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      const a = v >= hi ? 0 : v <= lo ? 1 : (hi - v) / (hi - lo);
      const alpha = Math.round(a * (px[i + 3] / 255) * 255);
      // Цвет чернил делаем насыщеннее: полупрозрачная серая кайма
      // по краям штриха иначе выглядит грязной
      if (alpha > 0 && a < 1) {
        const k = Math.min(1, (paper - v) / Math.max(1, paper - lo));
        px[i] = Math.round(px[i] * k);
        px[i + 1] = Math.round(px[i + 1] * k);
        px[i + 2] = Math.round(px[i + 2] * k);
      }
      px[i + 3] = alpha;
      if (alpha > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  ctx.putImageData(data, 0, 0);

  // Ничего тёмного не нашлось — возвращаем как есть, без обрезки
  if (x1 < 0) return { src: c.toDataURL('image/png'), w, h };

  const pad = Math.round(Math.max(w, h) * 0.01);
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d')!.drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
  return { src: out.toDataURL('image/png'), w: cw, h: ch, crop: { x0, y0, cw, ch, w, h } };
};
