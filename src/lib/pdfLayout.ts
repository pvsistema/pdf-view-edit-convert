// Разбор страницы, в которой текст уже записан.
//
// Документы бывают двух видов. Сканированные — это фотографии листов,
// их приходится разбирать движком распознавания, и ошибки там неизбежны.
// Но большинство файлов — обычные: текст в них хранится как текст.
// Разбирать такую страницу картинкой бессмысленно: мы своими руками
// портим то, что уже записано без единой ошибки.
//
// Здесь текст берётся напрямую, а его облик — колонки, заголовки,
// выравнивание, абзацы — восстанавливается по расположению кусочков.

import type { OcrPart } from '@/lib/ocrLayout';
import type { TextPiece } from '@/lib/pdf';
import { buildRows as cellRows, findTables, type FoundTable } from '@/lib/tables';

type Row = { y: number; h: number; x0: number; x1: number; parts: TextPiece[] };

// Участок листа, который читается сверху вниз как единое целое:
// колонка статьи, шапка, аннотация. left/right — его границы,
// по ним определяется выравнивание строк внутри
type Region = { pieces: TextPiece[]; left: number; right: number };

// Самый узкий просвет между колонками — доля ширины листа.
// Пробел между словами куда уже, поэтому с ним не спутать
const COL_GAP = 0.012;
// Колонка статьи не бывает уже пятой части листа. Узкие «колонки» —
// это столбцы таблиц, их резать на части нельзя
const MIN_SIDE = 0.22;

const buildRows = (pieces: TextPiece[]): Row[] => {
  const rows: Row[] = [];
  const sorted = [...pieces].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const p of sorted) {
    const near = rows[rows.length - 1];
    // Тот же ряд: сдвиг по высоте меньше половины буквы
    if (near && Math.abs(p.y - near.y) < Math.max(p.h, near.h) * 0.6) {
      near.parts.push(p);
      near.x0 = Math.min(near.x0, p.x);
      near.x1 = Math.max(near.x1, p.x + p.w);
      near.h = Math.max(near.h, p.h);
    } else {
      rows.push({ y: p.y, h: p.h, x0: p.x, x1: p.x + p.w, parts: [p] });
    }
  }

  return rows;
};

// Текст строки. Кусочки идут слева направо; если между ними заметный
// разрыв, ставим пробел — так не слипаются колонки таблиц и подписи
const rowText = (r: Row) => {
  const parts = [...r.parts].sort((a, b) => a.x - b.x);
  let out = '';
  let prevEnd: number | null = null;

  for (const p of parts) {
    if (prevEnd !== null) {
      const gap = p.x - prevEnd;
      if (gap > r.h * 0.25 && !/\s$/.test(out) && !/^\s/.test(p.str)) out += ' ';
    }
    out += p.str;
    prevEnd = p.x + p.w;
  }
  // Пробел перед запятой или точкой появляется, когда между словом и
  // знаком стоял значок (например, конверт у фамилии автора)
  return out.replace(/\s+/g, ' ').replace(/ ([,.;:])/g, '$1').trim();
};

// Самая обычная высота букв на листе — это основной текст.
// Всё, что заметно крупнее, — заголовки
const bodyHeight = (rows: Row[]) => {
  const count = new Map<number, number>();
  for (const r of rows) {
    const key = Math.round(r.h * 1000);
    count.set(key, (count.get(key) || 0) + 1);
  }
  let best = 0;
  let most = 0;
  for (const [h, n] of count)
    if (n > most) {
      most = n;
      best = h;
    }
  return best / 1000;
};

const alignOf = (r: Row, left: number, right: number): OcrPart['align'] => {
  const width = right - left;
  if (width <= 0) return 'left';

  const padLeft = (r.x0 - left) / width;
  const padRight = (right - r.x1) / width;

  if (padLeft > 0.12 && padRight > 0.12 && Math.abs(padLeft - padRight) < 0.12) return 'center';
  if (padLeft > 0.3 && padRight < 0.08) return 'right';
  return 'left';
};

const extentOf = (ps: TextPiece[]) => {
  let l = Infinity;
  let r = -Infinity;
  for (const p of ps) {
    l = Math.min(l, p.x);
    r = Math.max(r, p.x + p.w);
  }
  return { l, r };
};

// Вертикальные полосы листа, где нет ни одного кусочка текста
const freeGaps = (ps: TextPiece[]) => {
  const iv = ps.map((p) => [p.x, p.x + p.w] as const).sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  if (!iv.length) return gaps;
  let end = iv[0][1];
  for (let i = 1; i < iv.length; i++) {
    const [s, e] = iv[i];
    if (s - end >= COL_GAP) gaps.push([end, s]);
    end = Math.max(end, e);
  }
  return gaps;
};

// Похожа ли часть листа на колонку сплошного текста: несколько строк,
// и строки длинные. Столбец таблицы — короткие обрывки, его не режем
const proseLike = (ps: TextPiece[]) => {
  const rows = buildRows(ps);
  if (rows.length < 3) return false;
  const lens = rows.map((r) => rowText(r).length).sort((a, b) => a - b);
  return lens[Math.floor(lens.length / 2)] >= 16;
};

// Место, где лист делится на колонки, — или пусто, если колонок нет
const columnCut = (ps: TextPiece[]): number | null => {
  if (ps.length < 6) return null;
  const { l, r } = extentOf(ps);

  // Внутри колонки тоже бывают две колонки поменьше — например,
  // русская и английская подписи к рисунку рядом. Поэтому мерка
  // зависит от ширины куска, а не только от ширины листа
  const side = Math.min(MIN_SIDE, (r - l) * 0.3);

  let best: number | null = null;
  let bestWidth = 0;
  for (const [a, b] of freeGaps(ps)) {
    const mid = (a + b) / 2;
    if (mid - l < side || r - mid < side) continue;
    if (b - a <= bestWidth) continue;

    const left = ps.filter((p) => p.x + p.w / 2 < mid);
    const right = ps.filter((p) => p.x + p.w / 2 >= mid);
    if (!proseLike(left) || !proseLike(right)) continue;

    best = mid;
    bestWidth = b - a;
  }
  return best;
};

// Может ли кусок листа делиться на колонки (без проверки на сплошной
// текст). Нужна, чтобы склеить обратно полосы одной колонки
const hasColumnGap = (ps: TextPiece[]) => {
  const { l, r } = extentOf(ps);
  return freeGaps(ps).some(([a, b]) => {
    const mid = (a + b) / 2;
    return mid - l >= MIN_SIDE && r - mid >= MIN_SIDE;
  });
};

// Деление на горизонтальные полосы по заметным пустым промежуткам:
// шапка, заголовок, аннотация, основной текст
const splitBands = (ps: TextPiece[], minGap: number) => {
  const sorted = [...ps].sort((a, b) => a.y - b.y);
  const bands: TextPiece[][] = [];
  let cur: TextPiece[] = [];
  let bottom = -Infinity;

  for (const p of sorted) {
    if (cur.length && p.y - bottom >= minGap) {
      bands.push(cur);
      cur = [];
    }
    cur.push(p);
    bottom = Math.max(bottom, p.y + p.h);
  }
  if (cur.length) bands.push(cur);

  // Соседние полосы одной и той же пары колонок склеиваем обратно:
  // иначе порядок чтения прыгал бы между колонками
  const merged: TextPiece[][] = [];
  for (const b of bands) {
    const last = merged[merged.length - 1];
    if (last && hasColumnGap([...last, ...b])) merged[merged.length - 1] = [...last, ...b];
    else merged.push(b);
  }
  return merged;
};

// Раскладка листа на участки в порядке чтения — так, как читает
// человек: сверху вниз, а при двух колонках — сначала левую до конца,
// потом правую
const readingOrder = (
  ps: TextPiece[],
  left: number,
  right: number,
  minGap: number,
  depth = 0,
): Region[] => {
  if (depth > 8 || ps.length < 2) return [{ pieces: ps, left, right }];

  const cut = columnCut(ps);
  if (cut !== null) {
    const a = ps.filter((p) => p.x + p.w / 2 < cut);
    const b = ps.filter((p) => p.x + p.w / 2 >= cut);
    const ea = extentOf(a);
    const eb = extentOf(b);
    return [
      ...readingOrder(a, ea.l, ea.r, minGap, depth + 1),
      ...readingOrder(b, eb.l, eb.r, minGap, depth + 1),
    ];
  }

  const bands = splitBands(ps, minGap);
  if (bands.length < 2) return [{ pieces: ps, left, right }];

  return bands.flatMap((b) => readingOrder(b, left, right, minGap, depth + 1));
};

// Кончается ли строка так, что предложение явно продолжается дальше
const continues = (prev: string, next: string) => {
  if (/[-\u2010\u2011]$/.test(prev)) return true;
  return !/[.!?:;»")\]]$/.test(prev) && /^[a-zа-яё]/.test(next);
};

// Сборка страницы: участки в порядке чтения, в них строки
// объединяются в абзацы, у каждого — свой облик
export const layoutFromPieces = (all: TextPiece[]): OcrPart[] => {
  const pieces = all.filter((p) => p.str.trim());
  if (!pieces.length) return [];

  // Повёрнутый текст (надписи вдоль поля) читаем отдельно, в конце:
  // он не участвует в делении на колонки
  const flat = pieces.filter((p) => Math.abs(p.angle) < 0.2);
  const turned = pieces.filter((p) => Math.abs(p.angle) >= 0.2);

  const hs = flat.map((p) => p.h).sort((a, b) => a - b);
  const medianH = hs[Math.floor(hs.length / 2)] || 0.01;

  const page = extentOf(flat.length ? flat : pieces);
  const regions = flat.length ? readingOrder(flat, page.l, page.r, medianH * 0.9) : [];
  if (turned.length) {
    const e = extentOf(turned);
    regions.push({ pieces: turned, left: e.l, right: e.r });
  }

  // Строки каждого участка и таблицы в них
  const perRegion = regions.map((reg) => {
    const rows = buildRows(reg.pieces);
    // Нумерованный список («1.  Ушаков К.З. …») похож на таблицу
    // из двух столбцов, но таблицей не является
    const tables = findTables(cellRows(reg.pieces)).filter(
      (t) => !t.rows.every((row) => /^(\d{1,3}[.)]|[•–—-])$/.test((row[0] || '').trim())),
    );
    const owner = new Map<number, FoundTable>();
    for (const t of tables) for (let k = t.from; k <= t.to; k++) owner.set(k, t);
    // Обычное начало строки участка — самое частое, а не самое левое:
    // от него считаются красная строка и выступ номера в списке
    const starts = new Map<number, number>();
    for (const r of rows) {
      const k = Math.round(r.x0 * 400);
      starts.set(k, (starts.get(k) || 0) + 1);
    }
    let home = reg.left;
    let most = 0;
    // При равенстве берём левое начало: в коротком куске красных
    // строк может оказаться столько же, сколько обычных
    for (const [k, n] of starts)
      if (n > most || (n === most && k / 400 < home)) {
        most = n;
        home = k / 400;
      }
    return { reg, rows, owner, home };
  });

  const body = bodyHeight(perRegion.flatMap((x) => x.rows));

  const parts: OcrPart[] = [];
  let current: { rows: Row[]; align: OcrPart['align']; heading: boolean } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.rows
      .map(rowText)
      .filter(Boolean)
      .reduce((acc, line) => {
        if (!acc) return line;
        // Слово, разорванное переносом, собираем обратно
        if (/[-\u2010\u2011]$/.test(acc) && /^[a-zа-яё]/i.test(line))
          return acc.replace(/[-\u2010\u2011]$/, '') + line;
        // Число, разорванное переносом (номер в ссылке doi), склеиваем
        // обратно без пробела, дефис оставляем
        if (/\d[-\u2010\u2011]$/.test(acc) && /^\d/.test(line)) return acc + line;
        return acc + ' ' + line;
      }, '');

    if (text.trim())
      parts.push({
        text: text.trim(),
        heading: current.heading,
        bold: false,
        italic: false,
        align: current.align,
      });
    current = null;
  };

  for (const { reg, rows, owner, home } of perRegion) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const prev = rows[i - 1];

      const t = owner.get(i);
      if (t) {
        if (t.from === i) {
          flush();
          parts.push({
            text: t.rows.map((row) => row.join('\t')).join('\n'),
            heading: false,
            bold: false,
            italic: false,
            align: 'left',
            table: t.rows,
          });
        }
        continue;
      }

      const heading = body > 0 && r.h >= body * 1.15;
      const align = alignOf(r, reg.left, reg.right);
      const text = rowText(r);

      // Первая строка нового участка (например, верх правой колонки)
      // может продолжать абзац с конца предыдущего
      if (!prev) {
        const last = current?.rows[current.rows.length - 1];
        // Подпись к рисунку набирают другим, обычно более мелким или
        // жирным шрифтом — продолжением текста она не бывает
        const sameSize = last ? Math.abs(last.h - r.h) < Math.max(last.h, r.h) * 0.08 : false;
        if (
          current &&
          last &&
          sameSize &&
          current.heading === heading &&
          continues(rowText(last), text)
        ) {
          current.rows.push(r);
        } else {
          flush();
          current = { rows: [r], align, heading };
        }
        continue;
      }

      // Новый абзац: заметный просвет, другой облик строки, красная
      // строка или короткая предыдущая строка с точкой в конце
      const gap = r.y - (prev.y + prev.h);
      const farApart = gap > Math.max(r.h, prev.h) * 0.8;
      // Красная строка: начало заметно правее обычного. Выступ влево —
      // номер следующего пункта списка
      const indent = align === 'left' && r.x0 - home > r.h * 0.8 && r.x0 - home < r.h * 5;
      const outdent = align === 'left' && home - r.x0 > r.h * 0.8;
      // В тексте по ширине листа короткой бывает только последняя
      // строка абзаца
      // Но строку, оборванную переносом или запятой, продолжаем, и новый
      // абзац начинается с заглавной буквы, цифры или кавычки
      const prevText = rowText(prev);
      const prevShort =
        reg.right - prev.x1 > prev.h * 3 &&
        !/[-\u2010\u2011,]$/.test(prevText) &&
        /^[А-ЯЁA-Z0-9«"([]/.test(text);

      const otherLook =
        !current || current.align !== align || current.heading !== heading || farApart;

      if (otherLook || (align === 'left' && (indent || outdent || prevShort))) {
        flush();
        current = { rows: [r], align, heading };
      } else {
        current!.rows.push(r);
      }
    }
  }
  flush();

  return parts;
};
