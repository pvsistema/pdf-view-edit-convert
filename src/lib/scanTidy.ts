// «Очистить фон скана» — для самого документа, а не для распознавания.
//
// 1. Фон. Находим картину освещения (серость лампы, тень у переплёта,
//    желтизну бумаги) и делим лист на неё: бумага становится белой,
//    а синие печати и подписи сохраняют свой цвет.
// 2. Белая точка. Почти белые места доводим до чисто белого — уходит
//    остаточная серая «вуаль» сканера.
// 3. Мелкие точки. Крошечные тёмные пятнышки на белом (пыль, крошки
//    тонера) убираем, если вокруг только чистый фон. Точки над «й»,
//    запятые и тонкие линии рядом с текстом не трогаем.

export type TidyOptions = {
  // Убирать мелкие точки
  specks: boolean;
  // Сила: 0 — бережно, 100 — сильно
  strength: number;
  // Чёрно-белый результат — для документов без печатей
  gray: boolean;
};

const lumaOf = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000;

const maxFilter = (src: Float32Array, w: number, h: number, r: number) => {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0;
      const a = Math.max(0, x - r);
      const b = Math.min(w - 1, x + r);
      for (let k = a; k <= b; k++) m = Math.max(m, src[y * w + k]);
      tmp[y * w + x] = m;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0;
      const a = Math.max(0, y - r);
      const b = Math.min(h - 1, y + r);
      for (let k = a; k <= b; k++) m = Math.max(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  return out;
};

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

// Картина освещения по каждому цвету — в полном размере листа
const backgroundOf = (src: HTMLCanvasElement) => {
  const w = src.width;
  const h = src.height;
  const STEP = 8;
  const sw = Math.max(1, Math.round(w / STEP));
  const sh = Math.max(1, Math.round(h / STEP));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(src, 0, 0, sw, sh);
  const sp = sctx.getImageData(0, 0, sw, sh).data;

  const bgImg = sctx.createImageData(sw, sh);
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) ch[i] = sp[i * 4 + c];
    const bg = boxBlur(maxFilter(ch, sw, sh, 3), sw, sh, 4);
    for (let i = 0; i < sw * sh; i++) bgImg.data[i * 4 + c] = bg[i];
  }
  for (let i = 0; i < sw * sh; i++) bgImg.data[i * 4 + 3] = 255;
  sctx.putImageData(bgImg, 0, 0);

  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  const fctx = full.getContext('2d', { willReadFrequently: true })!;
  fctx.imageSmoothingEnabled = true;
  fctx.drawImage(small, 0, 0, w, h);
  return fctx.getImageData(0, 0, w, h).data;
};

// Мелкие тёмные пятнышки, окружённые чистым фоном
const dropSpecks = (px: Uint8ClampedArray, w: number, h: number, maxArea: number) => {
  const n = w * h;
  const dark = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (lumaOf(px[p], px[p + 1], px[p + 2]) < 200) dark[i] = 1;
  }

  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const comp: number[] = [];
  // Вокруг пятна смотрим на полосу такой ширины: рядом есть буквы — это
  // часть текста (точка над «ё», запятая), её не трогаем
  const ring = Math.max(3, Math.round(Math.sqrt(maxArea)));
  let removed = 0;

  for (let start = 0; start < n; start++) {
    if (!dark[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    comp.length = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let big = false;
    while (top) {
      const i = stack[--top];
      if (!big) comp.push(i);
      if (comp.length > maxArea) big = true;
      const x = i % w;
      const y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (dark[q] && !seen[q]) {
            seen[q] = 1;
            stack[top++] = q;
          }
        }
    }
    if (big) continue;

    // Есть ли рядом другие тёмные места
    let lonely = true;
    const ax = Math.max(0, x0 - ring);
    const bx = Math.min(w - 1, x1 + ring);
    const ay = Math.max(0, y0 - ring);
    const by = Math.min(h - 1, y1 + ring);
    outer: for (let y = ay; y <= by; y++)
      for (let x = ax; x <= bx; x++) {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
        if (dark[y * w + x]) {
          lonely = false;
          break outer;
        }
      }
    if (!lonely) continue;

    for (const i of comp) {
      const p = i * 4;
      px[p] = 255;
      px[p + 1] = 255;
      px[p + 2] = 255;
    }
    removed++;
  }
  return removed;
};

export const tidyScan = (src: HTMLCanvasElement, opt: TidyOptions) => {
  const w = src.width;
  const h = src.height;
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const bg = backgroundOf(src);

  const s = Math.min(100, Math.max(0, opt.strength)) / 100;
  // Выше этой яркости (после выравнивания) — уже бумага
  const white = 245 - s * 40;
  // Ниже — самая тёмная краска остаётся как есть
  const black = 20 + s * 25;

  const n = w * h;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    let r = Math.min(255, (px[p] / Math.max(bg[p], 1)) * 255);
    let g = Math.min(255, (px[p + 1] / Math.max(bg[p + 1], 1)) * 255);
    let b = Math.min(255, (px[p + 2] / Math.max(bg[p + 2], 1)) * 255);

    if (opt.gray) {
      const v = lumaOf(r, g, b);
      r = v;
      g = v;
      b = v;
    }

    // Растяжка: [black..white] → [0..255]. Белое — чисто белое,
    // а оттенок печати сохраняется, потому что тянем каждый цвет одинаково
    const k = 255 / (white - black);
    r = (r - black) * k;
    g = (g - black) * k;
    b = (b - black) * k;

    px[p] = r < 0 ? 0 : r > 255 ? 255 : r;
    px[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    px[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    px[p + 3] = 255;
  }

  let specks = 0;
  if (opt.specks) {
    // Размер «пылинки» — доля от размера листа: на 200 и 300 точках
    // на дюйм она одинакова по-настоящему
    const side = Math.max(w, h);
    const maxArea = Math.max(4, Math.round((side / 1000) ** 2 * (6 + s * 18)));
    specks = dropSpecks(px, w, h, maxArea);
  }

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d', { alpha: false })!.putImageData(img, 0, 0);
  return { canvas: out, specks };
};
