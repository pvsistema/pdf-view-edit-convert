// Подготовка скана к распознаванию.
//
// Бледные копии, серый фон от лампы сканера, крапины от пыли — всё это
// сбивает разбор текста. Здесь лист приводится к виду, удобному движку:
// убирается цвет, выравнивается освещённость, гасится мелкий мусор,
// а текст отделяется от фона по месту, а не по всему листу сразу.
// Так же поступают промышленные программы распознавания.

// Яркость точки. Глаз сильнее всего чувствует зелёный, поэтому веса разные
const grayOf = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000;

// Суммы по прямоугольнику: позволяют мгновенно узнать среднее и разброс
// яркости в любом окне, не пересчитывая точки заново. Без этого обработка
// большого листа заняла бы десятки секунд
const buildSums = (gray: Float64Array, w: number, h: number) => {
  const sum = new Float64Array((w + 1) * (h + 1));
  const sq = new Float64Array((w + 1) * (h + 1));

  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      rowSum += v;
      rowSq += v * v;
      const i = (y + 1) * (w + 1) + (x + 1);
      sum[i] = sum[i - (w + 1)] + rowSum;
      sq[i] = sq[i - (w + 1)] + rowSq;
    }
  }
  return { sum, sq };
};

const areaOf = (t: Float64Array, w: number, x0: number, y0: number, x1: number, y1: number) => {
  const W = w + 1;
  return t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0];
};

// Порог яркости, ниже которого точка считается краской.
// Считается для каждой точки по её окрестности, поэтому тень в углу
// страницы или затемнение у переплёта не съедают текст
const sauvola = (
  gray: Float64Array,
  w: number,
  h: number,
  radius: number,
  k: number,
  out: Uint8ClampedArray,
) => {
  const { sum, sq } = buildSums(gray, w, h);
  const R = 128; // половина шкалы яркости

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);

    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const n = (x1 - x0) * (y1 - y0);

      const s = areaOf(sum, w, x0, y0, x1, y1);
      const s2 = areaOf(sq, w, x0, y0, x1, y1);
      const mean = s / n;
      const variance = Math.max(0, s2 / n - mean * mean);
      const dev = Math.sqrt(variance);

      const threshold = mean * (1 + k * (dev / R - 1));
      out[y * w + x] = gray[y * w + x] > threshold ? 255 : 0;
    }
  }
};

// Уборка крапин. Пыль и точки от грязного стекла сканера образуют
// крошечные пятнышки, буквы — пятна заметно крупнее. Поэтому считаем
// размер каждого связного пятна и убираем те, что мельче порога.
// Проверка соседей тут не годится: пятнышко даже в две точки её проходит
const despeckle = (bin: Uint8ClampedArray, w: number, h: number, minArea: number) => {
  const out = new Uint8ClampedArray(bin);
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const blob = new Int32Array(1024);

  for (let start = 0; start < w * h; start++) {
    if (bin[start] !== 0 || seen[start]) continue;

    let top = 0;
    let size = 0;
    stack[top++] = start;
    seen[start] = 1;
    let tooBig = false;

    while (top > 0) {
      const i = stack[--top];
      if (size < blob.length) blob[size] = i;
      size++;

      // Крупное пятно — это буква, дальше считать незачем
      if (size > minArea) {
        tooBig = true;
        break;
      }

      const x = i % w;
      const y = (i / w) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (bin[j] === 0 && !seen[j]) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
    }

    // Мелкое пятно возвращаем фону
    if (!tooBig && size <= minArea) {
      for (let k = 0; k < size && k < blob.length; k++) out[blob[k]] = 255;
    }
  }

  return out;
};

// Доля краски на листе. Нужна, чтобы отличить документ от фотографии:
// на фотографии «краской» оказывается половина листа, и чистить её нельзя
const inkShare = (bin: Uint8ClampedArray) => {
  let dark = 0;
  for (let i = 0; i < bin.length; i++) if (bin[i] === 0) dark++;
  return dark / bin.length;
};

// Главная обработка. Возвращает подготовленный лист либо исходный,
// если снимок не похож на документ и чистка сделала бы хуже
export const cleanScan = (src: HTMLCanvasElement): HTMLCanvasElement => {
  const w = src.width;
  const h = src.height;
  if (!w || !h) return src;

  const ctx = src.getContext('2d', { willReadFrequently: true });
  if (!ctx) return src;

  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const n = w * h;

  const gray = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    gray[i] = grayOf(px[p], px[p + 1], px[p + 2]);
  }

  // Растяжка яркости: самые светлые места делаем белыми, самые тёмные —
  // чёрными. Бледная копия после этого читается как свежая
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i] | 0]++;

  const cut = Math.max(1, Math.round(n * 0.005));
  let lo = 0;
  let hi = 255;
  for (let acc = 0, v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc > cut) {
      lo = v;
      break;
    }
  }
  for (let acc = 0, v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc > cut) {
      hi = v;
      break;
    }
  }

  if (hi - lo > 10) {
    const scale = 255 / (hi - lo);
    for (let i = 0; i < n; i++) gray[i] = Math.min(255, Math.max(0, (gray[i] - lo) * scale));
  }

  // Окно подбираем от размера листа: примерно с высоту строки текста
  const radius = Math.max(8, Math.round(Math.min(w, h) / 90));

  const bin = new Uint8ClampedArray(n);
  sauvola(gray, w, h, radius, 0.25, bin);

  // Снимок с большой долей тёмного — это фотография или чертёж с заливкой.
  // Чистка такого листа только навредит, поэтому отдаём как есть
  const share = inkShare(bin);
  if (share > 0.45 || share < 0.0003) return src;

  // Порог мусора зависит от размера листа: на плотной отрисовке точка
  // пыли крупнее в пикселях, но относительно листа такая же мелкая
  const minArea = Math.max(4, Math.round((w * h) / 120000));
  const clean = despeckle(bin, w, h, minArea);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d', { alpha: false });
  if (!octx) return src;

  const dst = octx.createImageData(w, h);
  const dp = dst.data;
  for (let i = 0; i < n; i++) {
    const v = clean[i];
    const p = i * 4;
    dp[p] = v;
    dp[p + 1] = v;
    dp[p + 2] = v;
    dp[p + 3] = 255;
  }
  octx.putImageData(dst, 0, 0);
  return out;
};