// Разбор страницы, в которой текст уже записан.
//
// Документы бывают двух видов. Сканированные — это фотографии листов,
// их приходится разбирать движком распознавания, и ошибки там неизбежны.
// Но большинство файлов — обычные: текст в них хранится как текст.
// Разбирать такую страницу картинкой бессмысленно: мы своими руками
// портим то, что уже записано без единой ошибки.
//
// Здесь текст берётся напрямую, а его облик — заголовки, выравнивание,
// абзацы — восстанавливается по расположению кусочков на листе.

import type { OcrPart } from '@/lib/ocrLayout';
import type { TextPiece } from '@/lib/pdf';
import { buildRows as rowsOf, findTables } from '@/lib/tables';

// Кусочки, попавшие на одну строку, собираем вместе. Опорой служит
// высота букв: строки ближе этого расстояния считаем одной
type Row = { y: number; h: number; x0: number; x1: number; parts: TextPiece[] };

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
      // Разрыв шире трети буквы — это пробел
      if (gap > r.h * 0.25 && !/\s$/.test(out) && !/^\s/.test(p.str)) out += ' ';
    }
    out += p.str;
    prevEnd = p.x + p.w;
  }
  return out.replace(/\s+/g, ' ').trim();
};

// Самая обычная высота букв на листе — это основной текст.
// Всё, что заметно крупнее, — заголовки
const bodyHeight = (rows: Row[]) => {
  const count = new Map<number, number>();
  for (const r of rows) {
    // Округляем до сотых доли страницы: мелкие расхождения не важны
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

// Сборка страницы: строки объединяются в абзацы, у каждого — свой облик
export const layoutFromPieces = (pieces: TextPiece[]): OcrPart[] => {
  const rows = buildRows(pieces.filter((p) => p.str.trim()));
  if (!rows.length) return [];

  const body = bodyHeight(rows);

  let left = Infinity;
  let right = -Infinity;
  for (const r of rows) {
    left = Math.min(left, r.x0);
    right = Math.max(right, r.x1);
  }

  // Сначала ищем таблицы: их строки не должны попасть в обычные абзацы,
  // иначе столбцы слипнутся в сплошную строку
  const tables = findTables(rowsOf(pieces.filter((p) => p.str.trim())));
  const inTable = new Map<number, (typeof tables)[number]>();
  for (const t of tables) for (let k = t.from; k <= t.to; k++) inTable.set(k, t);

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

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const prev = rows[i - 1];

    // Строки таблицы обходим стороной: таблица кладётся целиком,
    // когда доходим до её первой строки
    const t = inTable.get(i);
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
    const align = alignOf(r, left, right);

    // Новый абзац начинается там, где между строками появился заметный
    // просвет, сменилось выравнивание или размер букв
    const gap = prev ? r.y - (prev.y + prev.h) : 0;
    const farApart = prev ? gap > Math.max(r.h, prev.h) * 0.8 : true;
    const otherLook =
      !current || current.align !== align || current.heading !== heading || farApart;

    if (otherLook || !current) {
      flush();
      current = { rows: [r], align, heading };
    } else {
      current.rows.push(r);
    }
  }
  flush();

  return parts;
};