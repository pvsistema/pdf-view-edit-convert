// Поля документа по самому тексту: где начинается и кончается набор
// на странице. Нужны для двусторонней печати — у документов по ГОСТу
// левое поле шире правого, и без поправки текст оборота «съезжает»
// относительно текста лицевой стороны
import { pageTextLayout } from '@/lib/pdf';

export type DocMargins = {
  // В долях ширины и высоты страницы
  left: number;
  right: number;
  top: number;
  bottom: number;
  // По скольким страницам посчитано
  pages: number;
};

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Смотрим несколько страниц из начала и середины документа. Титул и
// страницы без текста (сканы) пропускаем. Медиана отсекает случайности:
// широкую таблицу, вынесенную на поле печать, номер страницы сбоку
export const measureMargins = async (
  items: { doc: any; src: number; rotation: number }[],
): Promise<DocMargins | null> => {
  if (!items.length) return null;
  const pick = new Set<number>();
  for (let i = 1; i < Math.min(items.length, 9); i++) pick.add(i);
  const mid = items.length >> 1;
  for (let i = mid; i < Math.min(items.length, mid + 4); i++) pick.add(i);
  if (!pick.size) pick.add(0);

  const L: number[] = [];
  const R: number[] = [];
  const T: number[] = [];
  const B: number[] = [];
  for (const i of pick) {
    const it = items[i];
    if (!it?.doc) continue;
    const pieces = await pageTextLayout(it.doc, it.src, it.rotation).catch(() => []);
    // Только ровные строки с буквами: повёрнутые подписи и пробелы мешают
    const flat = pieces.filter((p) => Math.abs(p.angle) < 0.02 && p.str.trim() && p.w > 0);
    if (flat.length < 5) continue;
    const l = Math.min(...flat.map((p) => p.x));
    const r = 1 - Math.max(...flat.map((p) => p.x + p.w));
    const t = Math.min(...flat.map((p) => p.y));
    const b = 1 - Math.max(...flat.map((p) => p.y + p.h));
    if ([l, r, t, b].some((v) => v < 0 || v > 0.45)) continue;
    L.push(l);
    R.push(r);
    T.push(t);
    B.push(b);
  }
  if (!L.length) return null;
  return { left: median(L), right: median(R), top: median(T), bottom: median(B), pages: L.length };
};
