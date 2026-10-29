// Поля документа: где начинается и кончается содержимое страницы.
// Нужны для двусторонней печати — у документов по ГОСТу левое поле
// шире правого, и без поправки текст оборота «съезжает» относительно
// текста лицевой стороны.
//
// У обычного PDF поля берём по тексту. У скана текста нет — тогда
// смотрим на саму картинку: где на листе есть «чернила»
import { pageTextLayout, renderPageOnce } from '@/lib/pdf';

export type DocMargins = {
  // В долях ширины и высоты страницы
  left: number;
  right: number;
  top: number;
  bottom: number;
  // По скольким страницам посчитано
  pages: number;
  // Как измерено: по тексту или по изображению скана
  by: 'text' | 'image';
};

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Box = { l: number; r: number; t: number; b: number };

const byText = async (doc: any, src: number, rotation: number): Promise<Box | null> => {
  const pieces = await pageTextLayout(doc, src, rotation).catch(() => []);
  // Только ровные строки с буквами: повёрнутые подписи и пробелы мешают
  const flat = pieces.filter((p) => Math.abs(p.angle) < 0.02 && p.str.trim() && p.w > 0);
  if (flat.length < 5) return null;
  return {
    l: Math.min(...flat.map((p) => p.x)),
    r: 1 - Math.max(...flat.map((p) => p.x + p.w)),
    t: Math.min(...flat.map((p) => p.y)),
    b: 1 - Math.max(...flat.map((p) => p.y + p.h)),
  };
};

// Поля скана по изображению. Край листа у сканера часто даёт тень или
// серую полосу — крайние 2% не смотрим. Одиночные точки пыли тоже не
// в счёт: строка или столбец считаются заполненными, только если в них
// заметная доля тёмных точек
const byImage = async (doc: any, src: number, rotation: number): Promise<Box | null> => {
  const canvas = await renderPageOnce(doc, src, 0.5, rotation).catch(() => null);
  if (!canvas) return null;
  const W = canvas.width;
  const H = canvas.height;
  if (W < 20 || H < 20) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const data = ctx.getImageData(0, 0, W, H).data;

  const cols = new Uint32Array(W);
  const rows = new Uint32Array(H);
  const ex = Math.round(W * 0.02);
  const ey = Math.round(H * 0.02);
  for (let y = ey; y < H - ey; y++) {
    for (let x = ex; x < W - ex; x++) {
      const i = (y * W + x) * 4;
      const lum = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      if (lum < 170) {
        cols[x]++;
        rows[y]++;
      }
    }
  }
  const colMin = Math.max(2, H * 0.004);
  const rowMin = Math.max(2, W * 0.004);
  let l = -1;
  let r = -1;
  let t = -1;
  let b = -1;
  for (let x = 0; x < W; x++) if (cols[x] >= colMin) { l = x; break; }
  for (let x = W - 1; x >= 0; x--) if (cols[x] >= colMin) { r = x; break; }
  for (let y = 0; y < H; y++) if (rows[y] >= rowMin) { t = y; break; }
  for (let y = H - 1; y >= 0; y--) if (rows[y] >= rowMin) { b = y; break; }
  if (l < 0 || t < 0 || r <= l || b <= t) return null;
  return { l: l / W, r: 1 - (r + 1) / W, t: t / H, b: 1 - (b + 1) / H };
};

// Смотрим несколько страниц из начала и середины документа. Медиана
// отсекает случайности: титул, широкую таблицу, печать на поле
export const measureMargins = async (
  items: { doc: any; src: number; rotation: number }[],
): Promise<DocMargins | null> => {
  if (!items.length) return null;
  const pick = new Set<number>();
  for (let i = 1; i < Math.min(items.length, 9); i++) pick.add(i);
  const mid = items.length >> 1;
  for (let i = mid; i < Math.min(items.length, mid + 4); i++) pick.add(i);
  if (!pick.size || items.length <= 2) pick.add(0);

  const found: { box: Box; by: 'text' | 'image' }[] = [];
  let images = 0;
  for (const i of pick) {
    const it = items[i];
    if (!it?.doc) continue;
    let box = await byText(it.doc, it.src, it.rotation);
    let by: 'text' | 'image' = 'text';
    // Рисовать страницу дорого — сканов смотрим не больше шести
    if (!box && images < 6) {
      images++;
      box = await byImage(it.doc, it.src, it.rotation);
      by = 'image';
    }
    if (!box) continue;
    if ([box.l, box.r, box.t, box.b].some((v) => v < 0 || v > 0.6)) continue;
    found.push({ box, by });
  }
  if (!found.length) return null;
  const textCount = found.filter((f) => f.by === 'text').length;
  return {
    left: median(found.map((f) => f.box.l)),
    right: median(found.map((f) => f.box.r)),
    top: median(found.map((f) => f.box.t)),
    bottom: median(found.map((f) => f.box.b)),
    pages: found.length,
    by: textCount >= found.length / 2 ? 'text' : 'image',
  };
};
