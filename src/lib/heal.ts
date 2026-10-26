// Восстанавливающая кисть, как в Фотошопе.
//
// Обычный штамп переносит пиксели как есть: если источник чуть светлее
// или другого оттенка, заплатка видна пятном. Здесь из источника берётся
// только «рисунок» (зерно бумаги, мелкие детали), а цвет и яркость
// подбираются по краю закрашенного места. Разница между листом и
// источником известна вокруг мазка; внутрь она протягивается плавно,
// как натянутая плёнка, — помарку под мазком она не учитывает, поэтому
// пятно исчезает, а переход к соседним местам остаётся незаметным

// Сторона сетки, на которой считается поправка. Поправка плавная,
// поэтому мелкая сетка не теряет качества, а работает мгновенно
const GRID = 96;

export const healMargin = (w: number, h: number) =>
  Math.max(8, Math.ceil(Math.max(w, h) / GRID) * 3);

export const healPatch = (
  src: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  x0: number,
  y0: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
): HTMLCanvasElement => {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d', { willReadFrequently: true })!;

  const T = src.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, w, h).data;
  const M = mask.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, w, h).data;

  // Что кладёт источник в каждую точку мазка
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cctx = c.getContext('2d', { willReadFrequently: true })!;
  cctx.drawImage(src, x0 + dx, y0 + dy, w, h, 0, 0, w, h);
  const C = cctx.getImageData(0, 0, w, h).data;

  const cell = Math.max(1, Math.ceil(Math.max(w, h) / GRID));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const n = gw * gh;
  const sum = new Float32Array(n * 3);
  const cnt = new Uint32Array(n);
  const inside = new Uint8Array(n);

  // Разница «лист минус источник» вокруг мазка — известные края
  for (let y = 0; y < h; y++) {
    const gy = (y / cell) | 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = gy * gw + ((x / cell) | 0);
      if (M[i + 3] > 8) {
        inside[g] = 1;
      } else if (C[i + 3] > 0) {
        sum[g * 3] += T[i] - C[i];
        sum[g * 3 + 1] += T[i + 1] - C[i + 1];
        sum[g * 3 + 2] += T[i + 2] - C[i + 2];
        cnt[g]++;
      }
    }
  }

  const D = new Float32Array(n * 3);
  const fixed = new Uint8Array(n);
  const mean = [0, 0, 0];
  let known = 0;
  for (let g = 0; g < n; g++) {
    if (inside[g] || !cnt[g]) continue;
    fixed[g] = 1;
    known++;
    for (let k = 0; k < 3; k++) {
      D[g * 3 + k] = sum[g * 3 + k] / cnt[g];
      mean[k] += D[g * 3 + k];
    }
  }

  // Вокруг мазка ничего не известно (мазок у самого края листа) —
  // оставляем обычный штамп
  if (!known) {
    octx.drawImage(mask, x0, y0, w, h, 0, 0, w, h);
    return out;
  }

  for (let k = 0; k < 3; k++) mean[k] /= known;
  for (let g = 0; g < n; g++) {
    if (fixed[g]) continue;
    for (let k = 0; k < 3; k++) D[g * 3 + k] = mean[k];
  }

  // Протягиваем поправку внутрь: каждая клетка тянется к среднему
  // соседей, пока поверхность не станет гладкой
  const ITER = 260;
  const OMEGA = 1.85;
  for (let it = 0; it < ITER; it++) {
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const g = gy * gw + gx;
        if (fixed[g]) continue;
        let s0 = 0;
        let s1 = 0;
        let s2 = 0;
        let m = 0;
        const add = (q: number) => {
          s0 += D[q * 3];
          s1 += D[q * 3 + 1];
          s2 += D[q * 3 + 2];
          m++;
        };
        if (gx > 0) add(g - 1);
        if (gx < gw - 1) add(g + 1);
        if (gy > 0) add(g - gw);
        if (gy < gh - 1) add(g + gw);
        if (!m) continue;
        D[g * 3] += OMEGA * (s0 / m - D[g * 3]);
        D[g * 3 + 1] += OMEGA * (s1 / m - D[g * 3 + 1]);
        D[g * 3 + 2] += OMEGA * (s2 / m - D[g * 3 + 2]);
      }
    }
  }

  // Плавная поправка на каждую точку, рисунок — из источника
  const res = octx.createImageData(w, h);
  const R = res.data;
  for (let y = 0; y < h; y++) {
    let fy = (y + 0.5) / cell - 0.5;
    fy = Math.min(gh - 1, Math.max(0, fy));
    const y0g = Math.floor(fy);
    const y1g = Math.min(gh - 1, y0g + 1);
    const ty = fy - y0g;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = M[i + 3];
      if (!a) continue;
      let fx = (x + 0.5) / cell - 0.5;
      fx = Math.min(gw - 1, Math.max(0, fx));
      const x0g = Math.floor(fx);
      const x1g = Math.min(gw - 1, x0g + 1);
      const tx = fx - x0g;
      const a00 = (y0g * gw + x0g) * 3;
      const a10 = (y0g * gw + x1g) * 3;
      const a01 = (y1g * gw + x0g) * 3;
      const a11 = (y1g * gw + x1g) * 3;
      for (let k = 0; k < 3; k++) {
        const top = D[a00 + k] + (D[a10 + k] - D[a00 + k]) * tx;
        const bot = D[a01 + k] + (D[a11 + k] - D[a01 + k]) * tx;
        const v = C[i + k] + top + (bot - top) * ty;
        R[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      R[i + 3] = a;
    }
  }
  octx.putImageData(res, 0, 0);
  return out;
};
