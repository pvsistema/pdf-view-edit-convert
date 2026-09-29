// Подготовка скана к распознаванию.
//
// Раньше лист переводился в чисто чёрно-белый вид. На бледных бланках
// с тонким шрифтом это губило текст: буквы рассыпались на обрывки
// штрихов, и движок выдавал бессмыслицу вместо слов. Промышленные
// программы (FineReader) поступают бережнее — так делаем и мы:
// лист остаётся в оттенках серого, выравнивается только фон.
//
// 1. Находим фон листа: уменьшенную копию «раздуваем» по светлому, чтобы
//    буквы исчезли, и размываем. Остаётся картина освещения — тень
//    у переплёта, серая лампа сканера, желтизна бумаги.
// 2. Делим лист на этот фон: бумага везде становится белой, а буквы
//    сохраняют свою форму и толщину.
// 3. Растягиваем яркость: бледная копия читается как свежая.

const grayOf = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000;

// Самое светлое значение в окне — по строкам, потом по столбцам.
// Так буквы (тёмные) пропадают, и остаётся только бумага
const maxFilter = (src: Float32Array, w: number, h: number, r: number) => {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++)
        m = Math.max(m, src[y * w + k]);
      tmp[y * w + x] = m;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++)
        m = Math.max(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  return out;
};

// Сглаживание картины освещения, чтобы на ней не было ступенек
const boxBlur = (src: Float32Array, w: number, h: number, r: number) => {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
        s += src[y * w + k];
        n++;
      }
      tmp[y * w + x] = s / n;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        s += tmp[k * w + x];
        n++;
      }
      out[y * w + x] = s / n;
    }
  return out;
};

export const cleanScan = (src: HTMLCanvasElement): HTMLCanvasElement => {
  const w = src.width;
  const h = src.height;
  if (!w || !h) return src;

  const ctx = src.getContext('2d', { willReadFrequently: true });
  if (!ctx) return src;

  // Картина освещения считается на уменьшенной копии: фон меняется
  // плавно, и полный размер для него не нужен — так в десятки раз быстрее
  const STEP = 8;
  const sw = Math.max(1, Math.round(w / STEP));
  const sh = Math.max(1, Math.round(h / STEP));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  if (!sctx) return src;
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(src, 0, 0, sw, sh);

  const sp = sctx.getImageData(0, 0, sw, sh).data;
  const sg = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) sg[i] = grayOf(sp[i * 4], sp[i * 4 + 1], sp[i * 4 + 2]);

  const bgSmall = boxBlur(maxFilter(sg, sw, sh, 3), sw, sh, 4);

  // Возвращаем картину освещения к полному размеру — браузер делает
  // это плавно, без ступенек
  const bgImg = sctx.createImageData(sw, sh);
  for (let i = 0; i < sw * sh; i++) {
    const v = bgSmall[i];
    bgImg.data[i * 4] = v;
    bgImg.data[i * 4 + 1] = v;
    bgImg.data[i * 4 + 2] = v;
    bgImg.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(bgImg, 0, 0);

  const bgFull = document.createElement('canvas');
  bgFull.width = w;
  bgFull.height = h;
  const bctx = bgFull.getContext('2d', { willReadFrequently: true });
  if (!bctx) return src;
  bctx.imageSmoothingEnabled = true;
  bctx.drawImage(small, 0, 0, w, h);
  const bp = bctx.getImageData(0, 0, w, h).data;

  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const n = w * h;

  // Лист, делённый на фон: бумага белая, буквы — своей формы
  const norm = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const g = grayOf(px[p], px[p + 1], px[p + 2]);
    const v = Math.min(255, (g / Math.max(bp[p], 1)) * 255);
    norm[i] = v;
    hist[v | 0]++;
  }

  // Растяжка яркости: самые тёмные полпроцента точек — чёрные
  const cut = Math.max(1, Math.round(n * 0.005));
  let lo = 0;
  for (let acc = 0, v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc > cut) {
      lo = v;
      break;
    }
  }
  const hi = 250;
  const scale = hi - lo > 10 ? 255 / (hi - lo) : 1;

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d', { alpha: false });
  if (!octx) return src;
  const dst = octx.createImageData(w, h);
  const dp = dst.data;
  for (let i = 0; i < n; i++) {
    const v = Math.min(255, Math.max(0, (norm[i] - lo) * scale));
    const p = i * 4;
    dp[p] = v;
    dp[p + 1] = v;
    dp[p + 2] = v;
    dp[p + 3] = 255;
  }
  octx.putImageData(dst, 0, 0);
  return out;
};
