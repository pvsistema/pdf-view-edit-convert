// Сборка документа Word из PDF, сохранённого из Word.
//
// Раньше из такого PDF бралась только лента текста, и в Word получался
// «просто текст»: один шрифт, без жирного, без таблиц, без картинок,
// без отступов. Здесь страница собирается заново по тому, что в PDF
// записано точно:
// - у каждого кусочка текста — шрифт, размер, жирность, курсив;
// - у таблицы — нарисованные линии: по ним восстанавливаются строки,
//   столбцы, объединённые ячейки и заливка;
// - у картинки — место на листе: она встаёт туда же;
// - линия под словом — это подчёркивание, длинная линия — черта;
// - по расположению строк — абзацы, выравнивание, красная строка,
//   отступы, списки, табуляции и межстрочный интервал;
// - по краям текста — поля листа.
//
// Все размеры здесь — в пунктах, от левого верхнего угла листа.

import type { Decor, HLine, PdfFont, VLine } from '@/lib/pdfDecor';
import type { RichPiece } from '@/lib/pdf';

export type RRun =
  | { t: string; b?: boolean; i?: boolean; u?: boolean; font?: string; size?: number; raise?: number }
  | { tab: true; font?: string; size?: number; u?: boolean };
export type RTab = { pos: number; kind: 'left' | 'right' };
// Картинка на своём месте листа — поверх текста, как в исходнике
export type RAnchor = { png: Uint8Array; x: number; y: number; w: number; h: number };
export type RPara = {
  runs: RRun[];
  align: 'left' | 'center' | 'right' | 'both';
  left: number;
  firstLine: number;
  before: number;
  line: number;
  tabs: RTab[];
  border?: number;
  pageBreak?: boolean;
  anchors?: RAnchor[];
};
export type RCell = {
  paras: RPara[];
  span: number;
  vmerge?: 'restart' | 'cont';
  fill?: string;
  valign: 'top' | 'center' | 'bottom';
  borders: { t: number; l: number; b: number; r: number };
};
export type RTable = { cols: number[]; indent: number; rows: { h: number; cells: RCell[] }[] };
export type RBlock = { p: RPara } | { table: RTable };
export type RichPage = {
  W: number;
  H: number;
  margins: { t: number; r: number; b: number; l: number };
  blocks: RBlock[];
  // Самый частый шрифт и размер — основа документа
  font: string;
  size: number;
};

type P = RichPiece & { f: PdfFont; u?: boolean; base: number };
type Row = { ps: P[]; base: number; size: number; x0: number; x1: number; top: number };

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const blank = (s: string) => !s.replace(/[\s\u00a0\u200b]/g, '');
const LIST = /^(\d{1,2}(\.\d{1,2})*[.)]|[а-яa-z]\)|[•·▪◦–—-])$/i;

// Склейка отрезков одной линии: Word рисует рамку таблицы кусками —
// по отрезку на каждую ячейку
const mergeH = (ls: HLine[]) => {
  const s = [...ls].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const out: HLine[] = [];
  for (const l of s) {
    const q = out.find((o) => Math.abs(o.y - l.y) <= 1 && l.x0 <= o.x1 + 1.5 && l.x1 >= o.x0 - 1.5);
    if (q) {
      q.x0 = Math.min(q.x0, l.x0);
      q.x1 = Math.max(q.x1, l.x1);
      q.t = Math.max(q.t, l.t);
    } else out.push({ ...l });
  }
  return out;
};
const mergeV = (ls: VLine[]) => {
  const s = [...ls].sort((a, b) => a.x - b.x || a.y0 - b.y0);
  const out: VLine[] = [];
  for (const l of s) {
    const q = out.find((o) => Math.abs(o.x - l.x) <= 1 && l.y0 <= o.y1 + 1.5 && l.y1 >= o.y0 - 1.5);
    if (q) {
      q.y0 = Math.min(q.y0, l.y0);
      q.y1 = Math.max(q.y1, l.y1);
      q.t = Math.max(q.t, l.t);
    } else out.push({ ...l });
  }
  return out;
};

// Значения, отличающиеся меньше чем на tol, считаем одним
const cluster = (vals: number[], tol: number) => {
  const s = [...vals].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
  return out;
};

type Grid = { xs: number[]; ys: number[]; h: HLine[]; v: VLine[] };

// Таблицы — по сетке линий. Горизонтальные и вертикальные линии,
// которые пересекаются, образуют одну таблицу
const findGrids = (hs: HLine[], vs: VLine[]): Grid[] => {
  const n = hs.length + vs.length;
  const par = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < hs.length; i++)
    for (let j = 0; j < vs.length; j++) {
      const h = hs[i];
      const v = vs[j];
      if (v.x >= h.x0 - 2 && v.x <= h.x1 + 2 && h.y >= v.y0 - 2 && h.y <= v.y1 + 2)
        par[find(i)] = find(hs.length + j);
    }
  const groups = new Map<number, { h: HLine[]; v: VLine[] }>();
  for (let i = 0; i < n; i++) {
    const g = groups.get(find(i)) || { h: [], v: [] };
    if (i < hs.length) g.h.push(hs[i]);
    else g.v.push(vs[i - hs.length]);
    groups.set(find(i), g);
  }
  const out: Grid[] = [];
  for (const g of groups.values()) {
    const ys = cluster(
      g.h.map((l) => l.y),
      1.5,
    );
    const xs = cluster(
      g.v.map((l) => l.x),
      1.5,
    );
    if (ys.length < 2 || xs.length < 2) continue;
    // Совсем крошечная «таблица» — рамка вокруг значка, не таблица
    if (xs[xs.length - 1] - xs[0] < 20 || ys[ys.length - 1] - ys[0] < 8) continue;
    out.push({ xs, ys, h: g.h, v: g.v });
  }
  return out;
};

// Ряды текста: кусочки на одной линии письма. Верхний и нижний индекс
// стоят чуть выше или ниже — их относим к ряду по перекрытию по высоте
const buildRows = (ps: P[]): Row[] => {
  const s = [...ps].sort((a, b) => a.base - b.base || a.x - b.x);
  const rows: Row[] = [];
  for (const p of s) {
    const r = rows.find((q) => {
      const tol = Math.max(q.size, p.size) * 0.35;
      if (Math.abs(q.base - p.base) < tol) return true;
      // Индекс: меньше и заходит в высоту ряда
      const small = p.size < q.size * 0.85;
      return small && p.base > q.top && p.y < q.base && p.x >= q.x0 - q.size && p.x <= q.x1 + q.size * 2;
    });
    if (r) {
      r.ps.push(p);
      r.x0 = Math.min(r.x0, p.x);
      r.x1 = Math.max(r.x1, p.x + p.w);
    } else rows.push({ ps: [p], base: p.base, size: p.size, x0: p.x, x1: p.x + p.w, top: p.y });
  }
  for (const r of rows) {
    r.ps.sort((a, b) => a.x - b.x);
    const solid = r.ps.filter((p) => !blank(p.str));
    // Основа ряда — кусочки, занимающие больше всего места
    const bySize = new Map<number, number>();
    for (const p of solid) bySize.set(Math.round(p.size * 2), (bySize.get(Math.round(p.size * 2)) || 0) + p.w);
    let best = 0;
    let most = -1;
    for (const [k, w] of bySize)
      if (w > most) {
        most = w;
        best = k / 2;
      }
    r.size = best || r.ps[0].size;
    const main = solid.filter((p) => Math.abs(p.size - r.size) < 0.6);
    r.base = median((main.length ? main : r.ps).map((p) => p.base));
    r.top = r.base - r.size;
    r.x0 = solid.length ? Math.min(...solid.map((p) => p.x)) : r.x0;
    r.x1 = solid.length ? Math.max(...solid.map((p) => p.x + p.w)) : r.x1;
  }
  return rows.sort((a, b) => a.base - b.base);
};

// Просветы между словами ряда (пробелы-кусочки не считаются словами)
const gapsOf = (r: Row) => {
  const solid = r.ps.filter((p) => !blank(p.str));
  const out: { at: number; gap: number; next: P; prev: P }[] = [];
  for (let k = 1; k < solid.length; k++) {
    const prev = solid[k - 1];
    const next = solid[k];
    out.push({ at: k, gap: next.x - (prev.x + prev.w), next, prev });
  }
  return out;
};

// Широкий просвет — табуляция. Обычный пробел, даже растянутый
// выравниванием по ширине, заметно уже
const tabGaps = (r: Row) => {
  const gs = gapsOf(r);
  // Обычный пробел строки — по просветам не шире полутора букв. Если
  // таких нет (два куска: «Начальник филиала» и «А.В. Смирнов»), мерка —
  // четверть размера шрифта
  const normal = median(gs.map((g) => g.gap).filter((g) => g > 0.3 && g < r.size * 1.5)) || r.size * 0.25;
  return gs.filter((g, k) => {
    // После номера пункта («1.», «а)») хватает и меньшего просвета
    if (k === 0 && LIST.test(g.prev.str.trim()) && g.gap > r.size * 0.6) return true;
    return g.gap > Math.max(r.size * 1.8, normal * 3.5);
  });
};

const startsList = (r: Row) => {
  const t = tabGaps(r);
  const solid = r.ps.filter((p) => !blank(p.str));
  return !!solid.length && LIST.test(solid[0].str.trim()) && t.length > 0 && t[0].at === 1;
};

// Ширина первого слова ряда — чтобы понять, поместилось бы оно
// в конце прошлой строки
const firstWordW = (r: Row) => {
  const solid = r.ps.filter((p) => !blank(p.str));
  if (!solid.length) return 0;
  const p = solid[0];
  const word = p.str.trimStart().split(/\s/)[0];
  return p.w * (word.length / Math.max(1, p.str.trim().length));
};

type Box = { l: number; r: number };

const sameLook = (a: P, b: P) =>
  a.f.bold === b.f.bold &&
  a.f.italic === b.f.italic &&
  a.f.family === b.f.family &&
  Math.abs(a.size - b.size) < 0.3 &&
  !!a.u === !!b.u;

// Ряды одного участка (весь лист или ячейка) — в абзацы
const toParas = (rows: Row[], box: Box): Row[][] => {
  const out: Row[][] = [];
  let cur: Row[] = [];
  const width = box.r - box.l;
  const centered = (r: Row) => {
    const pl = r.x0 - box.l;
    const pr = box.r - r.x1;
    return pl > 3 && pr > 3 && Math.abs(pl - pr) < Math.max(2, width * 0.02);
  };
  for (const r of rows) {
    const prev = cur[cur.length - 1];
    let join = !!prev;
    if (prev) {
      const pitch = r.base - prev.base;
      const known = cur.length > 1 ? cur[cur.length - 1].base - cur[cur.length - 2].base : 0;
      if (startsList(r)) join = false;
      else if (Math.abs(r.size - prev.size) > 0.6) join = false;
      else if (pitch <= 0 || pitch > (known ? known * 1.25 : prev.size * 1.75)) join = false;
      else if (tabGaps(prev).some((g) => !(g.at === 1 && startsList(prev))) || tabGaps(r).length) join = false;
      else if (centered(prev) && prev.x1 - prev.x0 < width * 0.85) join = false;
      else {
        // Строка оборвалась сама (перенос) или по Enter? Если первое
        // слово следующей строки поместилось бы в конце этой — значит Enter
        const room = box.r - prev.x1;
        if (room > firstWordW(r) + prev.size * 0.5 + 1) join = false;
        // Строки абзаца после первой начинаются с одного места
        else if (cur.length >= 2 && Math.abs(r.x0 - prev.x0) > 1.5) join = false;
        else if (cur.length === 1 && r.x0 > prev.x0 + 1.5) {
          // Выступ списка: текст второй строки встаёт под текст первой
          const t = tabGaps(prev)[0];
          if (!(startsList(prev) && t && Math.abs(r.x0 - t.next.x) < 1.5)) join = false;
        }
      }
    }
    if (join) cur.push(r);
    else {
      if (cur.length) out.push(cur);
      cur = [r];
    }
  }
  if (cur.length) out.push(cur);
  return out;
};

// Абзац из рядов: текст по кускам одного вида, выравнивание, отступы,
// табуляции. margin — левое поле, от него считаются отступы и табуляции
const makePara = (rows: Row[], box: Box, margin: number, base: { font: string; size: number }): RPara => {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const width = box.r - box.l;
  const isList = startsList(first);

  let align: RPara['align'] = 'left';
  const cen = (r: Row) => {
    const pl = r.x0 - box.l;
    const pr = box.r - r.x1;
    return pl > 3 && pr > 3 && Math.abs(pl - pr) < Math.max(2, width * 0.02);
  };
  const tabs = tabGaps(first);
  if (!isList && !tabs.length && rows.every(cen)) align = 'center';
  else if (!tabs.length && rows.every((r) => r.x1 >= box.r - 1.5) && first.x0 > box.l + width * 0.25)
    align = 'right';
  else if (rows.length > 1 && rows.slice(0, -1).every((r) => r.x1 >= box.r - 2)) align = 'both';

  let left = 0;
  let firstLine = 0;
  const stops: RTab[] = [];
  if (align === 'left' || align === 'both') {
    const restX = rows.length > 1 ? Math.min(...rows.slice(1).map((r) => r.x0)) : null;
    if (isList) {
      const textX = tabs[0].next.x;
      left = (restX ?? textX) - box.l;
      firstLine = first.x0 - box.l - left;
      stops.push({ pos: textX - margin, kind: 'left' });
    } else {
      left = (restX ?? first.x0) - box.l;
      firstLine = first.x0 - box.l - left;
    }
  }
  // Табуляции внутри строки. Последний кусок, прижатый к правому краю, —
  // правая табуляция: так «А.В. Смирнов» остаётся у края при любой длине
  for (const g of tabs) {
    if (isList && g === tabs[0]) continue;
    const solid = first.ps.filter((p) => !blank(p.str));
    const lastPiece = g.at === solid.length - 1 || solid.slice(g.at).every((p) => p.x + p.w <= first.x1 + 0.5);
    const tail = solid.slice(g.at);
    const tailEnd = Math.max(...tail.map((p) => p.x + p.w));
    const toRight = lastPiece && tailEnd >= box.r - 3 && tabs[tabs.length - 1] === g;
    stops.push(toRight ? { pos: tailEnd - margin, kind: 'right' } : { pos: g.next.x - margin, kind: 'left' });
  }

  // Текст по кускам одного вида
  const runs: RRun[] = [];
  const push = (p: P, t: string, raise: number) => {
    const prev = runs[runs.length - 1];
    const look = {
      b: p.f.bold || undefined,
      i: p.f.italic || undefined,
      u: p.u || undefined,
      font: p.f.family !== base.font ? p.f.family : undefined,
      size: Math.abs(p.size - base.size) >= 0.25 ? Math.round(p.size * 2) / 2 : undefined,
      raise: Math.abs(raise) >= 0.5 ? Math.round(raise * 2) / 2 : undefined,
    };
    if (
      prev &&
      't' in prev &&
      prev.b === look.b &&
      prev.i === look.i &&
      prev.u === look.u &&
      prev.font === look.font &&
      prev.size === look.size &&
      prev.raise === look.raise
    )
      prev.t += t;
    else runs.push({ t, ...look });
  };
  const addSpace = (like: P) => {
    const prev = runs[runs.length - 1];
    if (!prev || !('t' in prev) || /\s$/.test(prev.t)) return;
    // Пробел берёт вид соседа слева — иначе подчёркивание рвалось бы
    if (sameLook(like, like)) prev.t += ' ';
  };

  rows.forEach((r, ri) => {
    const tg = new Set(tabGaps(r).map((g) => g.next));
    const solid = r.ps.filter((p) => !blank(p.str));
    if (ri > 0) {
      // Перенос по слогам в конце строки — склеиваем слово
      const prev = runs[runs.length - 1];
      const hyph = prev && 't' in prev && /[а-яёa-z][-\u00ad]$/i.test(prev.t) && /^[а-яёa-z]/.test(solid[0]?.str.trim() || '');
      if (hyph && prev && 't' in prev) prev.t = prev.t.slice(0, -1);
      else if (solid[0]) addSpace(solid[0]);
    }
    let prevP: P | null = null;
    for (const p of solid) {
      if (prevP) {
        if (tg.has(p)) runs.push({ tab: true, size: base.size !== p.size ? p.size : undefined });
        else {
          const gap = p.x - (prevP.x + prevP.w);
          const spaced = r.ps.some((q) => blank(q.str) && q.x >= prevP!.x + prevP!.w - 0.5 && q.x <= p.x);
          if (spaced || gap > p.size * 0.12) {
            // Пробел между подчёркнутыми словами тоже подчёркнут
            if (prevP.u && p.u) push(p, ' ', 0);
            else push({ ...prevP, u: false }, ' ', 0);
          }
        }
      }
      push(p, p.str.replace(/\s+/g, ' '), r.base - p.base);
      prevP = p;
    }
  });
  // Пробелы по краям абзаца не нужны
  const f0 = runs[0];
  if (f0 && 't' in f0) f0.t = f0.t.replace(/^\s+/, '');
  const fl = runs[runs.length - 1];
  if (fl && 't' in fl) fl.t = fl.t.replace(/\s+$/, '');

  // Межстрочный интервал — точно как в PDF: шаг от строки к строке.
  // У одиночной строки — обычный для её размера
  const pitches: number[] = [];
  for (let k = 1; k < rows.length; k++) pitches.push(rows[k].base - rows[k - 1].base);
  const line = pitches.length ? median(pitches) : first.size * 1.15;

  return {
    runs: runs.filter((r) => !('t' in r) || r.t),
    align,
    left: Math.max(0, left),
    firstLine: Math.max(-left, firstLine),
    before: 0,
    line,
    tabs: stops.filter((s) => s.pos > 0),
    // Для расчёта просветов: верх первой строки и низ последней
    _top: first.base - line * 0.8,
    _bottom: last.base + line * 0.2,
  } as RPara & { _top: number; _bottom: number };
};

export const buildRichPage = (pieces: RichPiece[], decor: Decor): RichPage => {
  const { W, H } = decor;
  const fontOfPiece = (p: RichPiece): PdfFont => decor.fonts[p.font] || { family: 'Times New Roman', bold: false, italic: false };
  const all: P[] = pieces
    .filter((p) => Math.abs(p.angle) < 0.05)
    .map((p) => ({ ...p, f: fontOfPiece(p), base: p.y + p.h }));

  // Основной шрифт и размер — те, которыми набрано больше всего текста
  const byFont = new Map<string, number>();
  const bySize = new Map<number, number>();
  for (const p of all) {
    if (blank(p.str)) continue;
    byFont.set(p.f.family, (byFont.get(p.f.family) || 0) + p.str.length);
    const k = Math.round(p.size * 2) / 2;
    bySize.set(k, (bySize.get(k) || 0) + p.str.length);
  }
  const top = <K>(m: Map<K, number>, d: K) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? d;
  const base = { font: top(byFont, 'Times New Roman'), size: top(bySize, 12) };

  // Линии: сетки — это таблицы, остальное — подчёркивания и черты
  const hs = mergeH(decor.hlines);
  const vs = mergeV(decor.vlines);
  const grids = findGrids(hs, vs);
  const inGrid = (x: number, y: number) =>
    grids.find((g) => x > g.xs[0] - 0.5 && x < g.xs[g.xs.length - 1] + 0.5 && y > g.ys[0] - 0.5 && y < g.ys[g.ys.length - 1] + 0.5);
  const gridLines = new Set<HLine>(grids.flatMap((g) => g.h));
  const freeH = hs.filter((l) => !gridLines.has(l) && !inGrid((l.x0 + l.x1) / 2, l.y));

  // Подчёркивание — линия сразу под словом
  const usedLine = new Set<HLine>();
  for (const p of all) {
    if (blank(p.str)) continue;
    const l = freeH.find(
      (q) =>
        q.y >= p.base - 0.5 &&
        q.y <= p.base + p.size * 0.35 &&
        Math.min(q.x1, p.x + p.w) - Math.max(q.x0, p.x) > p.w * 0.6 &&
        q.t <= Math.max(1.6, p.size * 0.12),
    );
    if (l) {
      p.u = true;
      usedLine.add(l);
    }
  }

  // Текст таблиц и текст листа — отдельно
  const flow = all.filter((p) => !inGrid(p.x + p.w / 2, p.base - p.size * 0.35));

  // Края текста — это поля листа
  const flowRows = buildRows(flow);
  const xsL = [
    ...flowRows.map((r) => r.x0),
    ...grids.map((g) => g.xs[0]),
    ...decor.images.map((i) => i.x0),
  ];
  const xsR = [
    ...flowRows.map((r) => r.x1),
    ...grids.map((g) => g.xs[g.xs.length - 1]),
    ...freeH.filter((l) => !usedLine.has(l)).map((l) => l.x1),
  ];
  const tops = [...flowRows.map((r) => r.top), ...grids.map((g) => g.ys[0]), ...decor.images.map((i) => i.y0)];
  const bottoms = [
    ...flowRows.map((r) => r.base + r.size * 0.25),
    ...grids.map((g) => g.ys[g.ys.length - 1]),
    ...decor.images.map((i) => i.y1),
  ];
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const mL = clamp(xsL.length ? Math.min(...xsL) : 72, 14, W / 3);
  const mR = clamp(xsR.length ? W - Math.max(...xsR) : 42, 14, W / 3);
  const mT = clamp(tops.length ? Math.min(...tops) - 2 : 56, 14, H / 3);
  const mB = clamp(bottoms.length ? H - Math.max(...bottoms) - 2 : 56, 14, 72);
  const box: Box = { l: mL, r: W - mR };

  // Всё содержимое листа по порядку сверху вниз
  type Item =
    | { kind: 'para'; top: number; rows: Row[] }
    | { kind: 'table'; top: number; g: Grid }
    | { kind: 'rule'; top: number; l: HLine };
  const items: Item[] = [];
  for (const rows of toParas(flowRows, box)) items.push({ kind: 'para', top: rows[0].top, rows });
  for (const g of grids) items.push({ kind: 'table', top: g.ys[0], g });
  for (const l of freeH)
    if (!usedLine.has(l) && l.x1 - l.x0 >= (box.r - box.l) * 0.25) items.push({ kind: 'rule', top: l.y, l });
  items.sort((a, b) => a.top - b.top);

  const blocks: RBlock[] = [];
  let cursor = mT;
  let lastPara: (RPara & { _bottom?: number }) | null = null;

  const spacer = (gap: number): RPara => ({
    runs: [],
    align: 'left',
    left: 0,
    firstLine: 0,
    before: 0,
    line: Math.max(1, gap),
    tabs: [],
  });

  for (const it of items) {
    if (it.kind === 'rule') {
      // Черта сразу под абзацем — его нижняя граница, как в Word
      if (lastPara && it.l.y - cursor < base.size * 1.2 && !lastPara.border) {
        lastPara.border = it.l.t;
        cursor = it.l.y + it.l.t;
        continue;
      }
      const p = spacer(Math.max(1, it.l.y - cursor));
      p.border = it.l.t;
      blocks.push({ p });
      lastPara = p;
      cursor = it.l.y + it.l.t;
      continue;
    }
    if (it.kind === 'para') {
      const p = makePara(it.rows, box, mL, base) as RPara & { _top: number; _bottom: number };
      p.before = Math.max(0, p._top - cursor);
      cursor = p._bottom;
      blocks.push({ p });
      lastPara = p;
      continue;
    }
    // Таблица
    const g = it.g;
    const gap = g.ys[0] - cursor;
    // Перед таблицей Word всегда ставит абзац; просвет над таблицей —
    // его высотой
    if (gap > 1 || !blocks.length || 'table' in blocks[blocks.length - 1]) blocks.push({ p: spacer(Math.max(1, gap)) });
    blocks.push({ table: buildTable(g, all, base, decor.fills) });
    cursor = g.ys[g.ys.length - 1];
    lastPara = null;
  }
  if (!blocks.length || 'table' in blocks[blocks.length - 1]) blocks.push({ p: spacer(1) });

  // Картинки — на свои места листа, привязанные к ближайшему абзацу
  // этой страницы
  const paras = blocks.filter((b): b is { p: RPara } => 'p' in b).map((b) => b.p as RPara & { _top?: number });
  for (const im of decor.images) {
    if (!im.png || !paras.length) continue;
    const host = paras.find((p) => (p._top ?? Infinity) >= im.y0 - 2) || paras[paras.length - 1];
    (host.anchors ||= []).push({ png: im.png, x: im.x0, y: im.y0, w: im.x1 - im.x0, h: im.y1 - im.y0 });
  }

  return { W, H, margins: { t: mT, r: mR, b: mB, l: mL }, blocks, font: base.font, size: base.size };
};

// Таблица по сетке линий: строки, столбцы, объединённые ячейки,
// заливка, толщина рамок и текст в ячейках
const buildTable = (
  g: Grid,
  all: P[],
  base: { font: string; size: number },
  fills: Decor['fills'],
): RTable => {
  const { xs, ys } = g;
  const nr = ys.length - 1;
  const nc = xs.length - 1;
  const vAt = (x: number, y: number) => g.v.find((l) => Math.abs(l.x - x) <= 1.5 && y >= l.y0 - 1 && y <= l.y1 + 1);
  const hAt = (y: number, x: number) => g.h.find((l) => Math.abs(l.y - y) <= 1.5 && x >= l.x0 - 1 && x <= l.x1 + 1);

  const rows: RTable['rows'] = [];
  // Где начинается и кончается каждая ячейка в строке — для объединения
  // по вертикали
  const spans: { c0: number; c1: number; cell: RCell }[][] = [];
  for (let r = 0; r < nr; r++) {
    const ym = (ys[r] + ys[r + 1]) / 2;
    const line: { c0: number; c1: number; cell: RCell }[] = [];
    let c = 0;
    while (c < nc) {
      let c1 = c;
      while (c1 + 1 < nc && !vAt(xs[c1 + 1], ym)) c1++;
      const x0 = xs[c];
      const x1 = xs[c1 + 1];
      const xm = (x0 + x1) / 2;
      const top = hAt(ys[r], xm);
      const bot = hAt(ys[r + 1], xm);
      const lft = vAt(x0, ym);
      const rgt = vAt(x1, ym);
      const cell: RCell = {
        paras: [],
        span: c1 - c + 1,
        valign: 'top',
        borders: { t: top?.t ?? 0, l: lft?.t ?? 0, b: bot?.t ?? 0, r: rgt?.t ?? 0 },
      };
      // Заливка ячейки — залитый прямоугольник, накрывающий её середину
      const ym2 = (ys[r] + ys[r + 1]) / 2;
      // (заливка может быть одна на всю строку — берём её для каждой ячейки)
      const f = fills.find((q) => xm > q.x0 && xm < q.x1 && ym2 > q.y0 && ym2 < q.y1);
      if (f) cell.fill = f.color;
      // Объединение с ячейкой сверху: между ними нет линии
      const above = spans[r - 1]?.find((s) => s.c0 === c && s.c1 === c1);
      if (above && !top) {
        cell.vmerge = 'cont';
        above.cell.vmerge ||= 'restart';
      }
      line.push({ c0: c, c1, cell });
      c = c1 + 1;
    }
    spans.push(line);
    rows.push({ h: ys[r + 1] - ys[r], cells: line.map((s) => s.cell) });
  }

  // Текст ячеек. У объединённой по вертикали ячейки текст — в первой
  for (let r = 0; r < nr; r++)
    for (const s of spans[r]) {
      if (s.cell.vmerge === 'cont') continue;
      let r1 = r;
      while (r1 + 1 < nr && spans[r1 + 1].find((q) => q.c0 === s.c0 && q.c1 === s.c1)?.cell.vmerge === 'cont') r1++;
      const x0 = xs[s.c0];
      const x1 = xs[s.c1 + 1];
      const y0 = ys[r];
      const y1 = ys[r1 + 1];
      const inside = all.filter((p) => {
        const cx = p.x + p.w / 2;
        const cy = p.base - p.size * 0.35;
        return cx > x0 && cx < x1 && cy > y0 && cy < y1;
      });
      // Пустые кусочки (пробел в конце ячейки) строкой не считаем: иначе
      // лишняя «строка» из одного пробела сбивала выравнивание по высоте
      const cellRows = buildRows(inside).filter((q) => q.ps.some((p) => !blank(p.str)));
      if (!cellRows.length) continue;
      // Поля ячейки: Word по умолчанию отступает 5,4 пункта от рамки
      const pad = 5.4;
      const cbox: Box = { l: x0 + pad, r: x1 - pad };
      let cur = y0 + 1;
      for (const pr of toParas(cellRows, cbox)) {
        const p = makePara(pr, cbox, x0 + pad, base) as RPara & { _top: number; _bottom: number };
        p.before = Math.max(0, p._top - cur);
        // Табуляции в ячейке считаются от её левого поля
        cur = p._bottom;
        s.cell.paras.push(p);
      }
      // Выравнивание по высоте: текст посередине ячейки или у низа
      // Текст меряем по заглавной букве: от линии письма вверх на 0,7
      // размера шрифта. Верх строки с межстрочным запасом давал
      // перекос, и текст посередине объединённой ячейки считался «внизу»
      const first = cellRows[0];
      const lastR = cellRows[cellRows.length - 1];
      const tTop = first.base - first.size * 0.7;
      const tBot = lastR.base;
      const above = tTop - y0;
      const below = y1 - tBot;
      if (Math.abs(above - below) < Math.max(2.5, (y1 - y0) * 0.12) && above > 2) {
        s.cell.valign = 'center';
        s.cell.paras[0].before = 0;
      } else if (below < above - 4) {
        s.cell.valign = 'bottom';
        s.cell.paras[0].before = 0;
      }
    }

  return { cols: xs.slice(1).map((x, k) => x - xs[k]), indent: xs[0], rows };
};
