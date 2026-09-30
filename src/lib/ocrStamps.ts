// Печати, подписи и пометки цветными чернилами.
//
// Печать почти всегда ставят поверх текста — на должность и фамилию.
// Движок распознавания видит в ней мешанину букв: строка под печатью
// рвалась, слова терялись, а сама печать пропадала или разваливалась
// на куски. С подписью то же самое.
//
// Печать и подпись ставятся цветными чернилами — синими, фиолетовыми,
// реже красными, а текст напечатан чёрным. По цвету их и отделяем:
// 1. Находим на листе цветную краску и собираем её в пятна.
// 2. Крупные пятна — это печати, подписи, пометки от руки.
// 3. Для распознавания стираем их с копии листа — текст под печатью
//    снова читается.
// 4. Сами пятна вырезаем в картинку с прозрачным фоном и ставим в Word
//    поверх текста на то же место, как на бумаге.

export type Stamp = {
  // Место на листе, в точках картинки
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  // Картинка с прозрачным фоном: видны только сами чернила
  png: Uint8Array | null;
};

// Цветная краска: заметная насыщенность и не бледная. Чёрный текст
// под печатью остаётся тёмным и почти серым — его не трогаем
const SAT = 45;
const inkOf = (r: number, g: number, b: number) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx - mn >= SAT && mx < 250 && mn < 225;
};

// Поиск цветных пятен. dpi нужен, чтобы размеры считать в долях дюйма:
// так мерки не зависят от разрешения скана
export const findStamps = (src: HTMLCanvasElement, dpi: number): Stamp[] => {
  const w = src.width;
  const h = src.height;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  if (!ctx || w < 50 || h < 50) return [];
  const data = ctx.getImageData(0, 0, w, h).data;

  // Клетка в двенадцатую долю дюйма: штрихи одной подписи и буквы по
  // кругу печати сливаются в одно пятно, соседние печати — нет
  const C = Math.max(4, Math.round(dpi / 12));
  const CW = Math.ceil(w / C);
  const CH = Math.ceil(h / C);
  const cnt = new Uint16Array(CW * CH);
  let total = 0;
  for (let y = 0; y < h; y += 2)
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (inkOf(data[i], data[i + 1], data[i + 2])) {
        cnt[((y / C) | 0) * CW + ((x / C) | 0)]++;
        total++;
      }
    }
  // Цветной лист целиком (цветная бумага, фотография) — это не печать
  if (total > (w * h) / 4 / 4) return [];

  const on = new Uint8Array(CW * CH);
  for (let i = 0; i < on.length; i++) on[i] = cnt[i] >= 2 ? 1 : 0;

  // Сливаем соседние клетки через одну: в подписи бывают разрывы
  const seen = new Uint8Array(CW * CH);
  const out: Stamp[] = [];
  const stack: number[] = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || seen[i]) continue;
    let x0 = CW;
    let y0 = CH;
    let x1 = 0;
    let y1 = 0;
    let ink = 0;
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const k = stack.pop()!;
      const cx = k % CW;
      const cy = (k / CW) | 0;
      ink += cnt[k];
      if (cx < x0) x0 = cx;
      if (cy < y0) y0 = cy;
      if (cx > x1) x1 = cx;
      if (cy > y1) y1 = cy;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
          const n = ny * CW + nx;
          if (on[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
    }
    const bw = (x1 - x0 + 1) * C;
    const bh = (y1 - y0 + 1) * C;
    // Мелочь — пятнышки и цветные искры сканера. Цветная строка текста
    // (красный заголовок) ниже пятой доли дюйма — её оставляем тексту
    if (Math.max(bw, bh) < dpi * 0.35 || bh < dpi * 0.2 || ink < 40) continue;
    const pad = C;
    out.push({
      x0: Math.max(0, x0 * C - pad),
      y0: Math.max(0, y0 * C - pad),
      x1: Math.min(w, (x1 + 1) * C + pad),
      y1: Math.min(h, (y1 + 1) * C + pad),
      png: null,
    });
  }
  if (out.length > 12) return [];

  for (const s of out) s.png = cropInk(data, w, s);
  return out;
};

// Вырезка пятна с прозрачным фоном. Непрозрачны только цветные чернила,
// бумага и чёрный текст под печатью — прозрачны: в Word под картинкой
// лежит свой текст, и он не должен двоиться
const cropInk = (data: Uint8ClampedArray, w: number, s: Stamp): Uint8Array | null => {
  const cw = s.x1 - s.x0;
  const ch = s.y1 - s.y0;
  if (cw < 2 || ch < 2) return null;
  try {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const i = ((s.y0 + y) * w + s.x0 + x) * 4;
        const o = (y * cw + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const sat = mx - mn;
        if (sat < SAT * 0.6 || mn > 235) continue;
        // Прозрачность по насыщенности: плотная краска — плотная,
        // бледный край штриха — полупрозрачный. Цвет делаем чуть
        // насыщеннее, как у свежих чернил
        const a = Math.min(255, Math.round(((sat - SAT * 0.6) / (SAT * 1.4)) * 255));
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = a;
      }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL('image/png');
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
};

// Копия листа без цветных чернил — для распознавания. Цветную краску
// заменяем цветом бумаги вокруг, чёрный текст под печатью оставляем
export const withoutInk = (src: HTMLCanvasElement, stamps: Stamp[]) => {
  if (!stamps.length) return src;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  for (const s of stamps) {
    const cw = s.x1 - s.x0;
    const ch = s.y1 - s.y0;
    const img = ctx.getImageData(s.x0, s.y0, cw, ch);
    const d = img.data;
    // Цвет бумаги — самые светлые точки вокруг
    let paper = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (v > paper) paper = v;
    }
    paper = Math.max(200, paper - 8);
    // Чернила печати и чёрная краска букв на бумаге складываются, как
    // светофильтры. Синие чернила почти не задерживают синий свет, а
    // чёрная буква задерживает всё. Поэтому самый светлый из трёх цветов
    // точки показывает только букву: где буква есть — он тёмный, где
    // одни чернила — светлый. По нему и восстанавливаем лист. Раньше
    // цветные точки просто заливались белым, и в буквах под печатью
    // оставались дыры: «Контроль» читалось как «Контродь»
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx - mn < SAT * 0.4) continue;
      // Самый светлый цвет точки ярче половины бумаги — это одни чернила,
      // даже густые (подпись, надпись в печати). Буква под ними темнее
      const v = mx > paper * 0.5 ? paper : Math.round((mx / paper) * 255 * 0.9);
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, v);
    }
    ctx.putImageData(img, s.x0, s.y0);
  }
  return out;
};

// Лист в JPEG — подложка для PDF с поиском. Печать и подпись в нём
// остаются: текстовый слой строится по очищенному листу, а видно
// человеку исходный скан
export const canvasJpeg = async (src: HTMLCanvasElement): Promise<Uint8Array | null> => {
  const blob: Blob | null = await new Promise((res) => src.toBlob(res, 'image/jpeg', 0.85));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
};
