// Разбор разметки распознанного листа.
//
// Движок возвращает не только текст, но и то, как он расположен: где
// абзац, где строка, каким размером набрано слово, жирное ли оно.
// Раньше всё это выбрасывалось и в Word уходила сплошная лента строк.
// Здесь из этих данных восстанавливается облик документа: заголовки
// остаются заголовками, выравнивание по центру сохраняется,
// а абзац не рассыпается на отдельные строки.

import { buildRows, findTables, type Cell, type TableRow } from '@/lib/tables';

// Кусок документа: абзац со своим видом
export type OcrPart = {
  text: string;
  // Заголовок набран крупнее основного текста
  heading: boolean;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  // Заполнено, если кусок оказался таблицей: строки и ячейки.
  // В Word такой кусок ложится настоящей таблицей с границами
  table?: string[][];
};

type Word = {
  text?: string;
  font_size?: number;
  is_bold?: boolean;
  is_italic?: boolean;
  confidence?: number;
  bbox?: Bbox;
};

type Line = { text?: string; words?: Word[]; bbox?: Bbox };
type Bbox = { x0: number; y0: number; x1: number; y1: number };
type Para = { text?: string; lines?: Line[]; bbox?: Bbox };
type Block = { paragraphs?: Para[]; bbox?: Bbox };

type PageData = {
  text?: string;
  blocks?: Block[] | null;
};

// Размер разобранного листа в точках. Нужен, чтобы перевести место
// каждого слова в доли страницы. Раньше размер брался по краю текста —
// но текст не доходит до краёв, и доли получались завышены в разы:
// строки «росли», а разрывы между столбцами переставали распознаваться
export type PageSize = { width: number; height: number };

// Самый обычный размер шрифта на листе. Считаем по числу слов каждого
// размера, а не средним: среднее задирают редкие крупные заголовки
const bodySize = (paras: Para[]) => {
  const count = new Map<number, number>();

  for (const p of paras)
    for (const l of p.lines || [])
      for (const w of l.words || []) {
        const s = Math.round(w.font_size || 0);
        if (s > 0) count.set(s, (count.get(s) || 0) + 1);
      }

  let best = 0;
  let most = 0;
  for (const [size, n] of count)
    if (n > most) {
      most = n;
      best = size;
    }
  return best;
};

// Какая часть слов абзаца набрана с этим признаком — жирным или наклонным
const shareOf = (p: Para, pick: (w: Word) => boolean) => {
  let all = 0;
  let hit = 0;
  for (const l of p.lines || [])
    for (const w of l.words || []) {
      if (!(w.text || '').trim()) continue;
      all++;
      if (pick(w)) hit++;
    }
  return all ? hit / all : 0;
};

// Средний размер шрифта абзаца
const sizeOf = (p: Para) => {
  let sum = 0;
  let n = 0;
  for (const l of p.lines || [])
    for (const w of l.words || []) {
      const s = w.font_size || 0;
      if (s > 0) {
        sum += s;
        n++;
      }
    }
  return n ? sum / n : 0;
};

// Как абзац стоит на листе. Смотрим на поля слева и справа: у текста по
// центру они примерно равны и оба заметные, у прижатого вправо — левое
// поле большое. Так восстанавливаются шапки документов и подписи
const alignOf = (p: Para, left: number, right: number): OcrPart['align'] => {
  const b = p.bbox;
  if (!b || right <= left) return 'left';

  const width = right - left;
  const padLeft = (b.x0 - left) / width;
  const padRight = (right - b.x1) / width;

  // Узкий абзац с равными полями — по центру
  if (padLeft > 0.12 && padRight > 0.12 && Math.abs(padLeft - padRight) < 0.12) return 'center';
  // Прижат вправо
  if (padLeft > 0.3 && padRight < 0.08) return 'right';
  return 'left';
};

// Склейка строк абзаца в единый текст. Слово, разорванное переносом,
// собирается обратно — иначе в Word остаются «раз-» и «рыв»
const joinLines = (p: Para) => {
  const lines = (p.lines || []).map((l) => (l.text || '').replace(/\s+$/g, '')).filter(Boolean);
  if (!lines.length) return (p.text || '').trim();

  let out = '';
  for (const line of lines) {
    if (!out) {
      out = line;
      continue;
    }
    // Перенос: строка кончается дефисом, а следующая начинается с буквы
    if (/[-\u2010\u2011]$/.test(out) && /^[a-zа-яё]/i.test(line)) {
      out = out.replace(/[-\u2010\u2011]$/, '') + line;
    } else {
      out += ' ' + line;
    }
  }
  return out.trim();
};

// Слова с их местом на листе — в долях от размера страницы.
// В таком виде поиск таблиц одинаково работает и со сканом, и с обычным
// документом, где числа изначально в долях
const wordCells = (paras: Para[], width: number, height: number): Cell[] => {
  const out: Cell[] = [];

  for (const p of paras)
    for (const l of p.lines || [])
      for (const w of l.words || []) {
        const b = w.bbox;
        const str = (w.text || '').trim();
        if (!b || !str) continue;

        out.push({
          str,
          x: b.x0 / width,
          y: b.y0 / height,
          w: (b.x1 - b.x0) / width,
          h: (b.y1 - b.y0) / height,
        });
      }

  return out;
};

// Сборка документа по строкам листа.
//
// Нужна там, где на листе нашлись таблицы: движок часто отдаёт весь лист
// одним абзацем, и разделить таблицу с текстом по абзацам не выходит.
// Строки же всегда на месте, и по ним документ собирается верно.
const byRows = (
  rows: TableRow[],
  tables: ReturnType<typeof findTables>,
  left: number,
  right: number,
  width: number,
): OcrPart[] => {
  // Какие строки заняты таблицами
  const owner = new Map<number, (typeof tables)[number]>();
  for (const t of tables) for (let k = t.from; k <= t.to; k++) owner.set(k, t);

  // Обычный размер букв на листе — по нему узнаём заголовки
  const heights = rows.map((r) => r.h).sort((a, b) => a - b);
  const body = heights[Math.floor(heights.length / 2)] || 0;

  // Границы текста в долях листа: по ним определяется выравнивание
  const l = left / width;
  const r = right / width;

  const parts: OcrPart[] = [];
  let group: TableRow[] = [];

  const flush = () => {
    if (!group.length) return;

    const text = group
      .map((row) => row.cells.map((c) => c.str).join(' '))
      .reduce((acc, line) => {
        if (!acc) return line;
        if (/[-\u2010\u2011]$/.test(acc) && /^[a-zа-яё]/i.test(line))
          return acc.replace(/[-\u2010\u2011]$/, '') + line;
        return acc + ' ' + line;
      }, '');

    if (text.trim()) {
      const first = group[0];
      const x0 = Math.min(...group.map((g) => Math.min(...g.cells.map((c) => c.x))));
      const x1 = Math.max(...group.map((g) => Math.max(...g.cells.map((c) => c.x + c.w))));

      const width2 = r - l;
      const padLeft = width2 > 0 ? (x0 - l) / width2 : 0;
      const padRight = width2 > 0 ? (r - x1) / width2 : 0;

      const align: OcrPart['align'] =
        padLeft > 0.12 && padRight > 0.12 && Math.abs(padLeft - padRight) < 0.12
          ? 'center'
          : padLeft > 0.3 && padRight < 0.08
            ? 'right'
            : 'left';

      parts.push({
        text: text.trim(),
        heading: body > 0 && first.h >= body * 1.15 && text.length <= 120,
        bold: false,
        italic: false,
        align,
      });
    }
    group = [];
  };

  for (let i = 0; i < rows.length; i++) {
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

    // Просвет между строками больше полутора высот — новый абзац
    const prev = rows[i - 1];
    if (prev && group.length) {
      const gap = rows[i].y - (prev.y + prev.h);
      if (gap > Math.max(rows[i].h, prev.h) * 1.5) flush();
    }

    group.push(rows[i]);
  }
  flush();

  return parts;
};

// Разбор листа на части с сохранением облика.
// size — настоящий размер разобранной картинки в точках
export const readLayout = (data: PageData, size?: PageSize): OcrPart[] => {
  const blocks = data.blocks;
  if (!blocks || !blocks.length) {
    // Разметки нет — отдаём текст как есть, по абзацам
    return (data.text || '')
      .split(/\n\s*\n/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({ text, heading: false, bold: false, italic: false, align: 'left' as const }));
  }

  const paras: Para[] = [];
  for (const b of blocks) for (const p of b.paragraphs || []) paras.push(p);
  if (!paras.length) return [];

  // Ищем таблицы по расположению слов на листе. Движок отдаёт место
  // каждого слова в точках картинки — приводим к долям листа, чтобы
  // разбор не зависел от разрешения
  const width = size?.width || 0;
  const height = size?.height || 0;

  const rows = width && height ? buildRows(wordCells(paras, width, height)) : [];
  const tables = rows.length ? findTables(rows) : [];

  const body = bodySize(paras);

  // Границы текста на листе — по самим абзацам, а не по краю картинки:
  // поля у скана бывают разные, и от края считать нельзя
  let left = Infinity;
  let right = -Infinity;
  for (const p of paras) {
    if (!p.bbox) continue;
    left = Math.min(left, p.bbox.x0);
    right = Math.max(right, p.bbox.x1);
  }

  const parts: OcrPart[] = [];

  // Если на листе есть таблицы, собираем документ по строкам, а не по
  // абзацам: движок нередко сваливает весь лист в один абзац, и тогда
  // таблицу внутри него не отделить
  if (tables.length) return byRows(rows, tables, left, right, width);

  for (const p of paras) {
    const text = joinLines(p);
    if (!text) continue;

    const size = sizeOf(p);
    const bold = shareOf(p, (w) => !!w.is_bold) > 0.6;
    const italic = shareOf(p, (w) => !!w.is_italic) > 0.6;

    // Заголовок: набран заметно крупнее основного текста и короткий.
    // Длинный кусок крупным шрифтом — это просто крупный текст
    const bigger = body > 0 && size >= body * 1.15;
    const short = text.length <= 120;
    const heading = bigger && short;

    parts.push({
      text,
      heading,
      bold,
      italic,
      align: alignOf(p, left, right),
    });
  }

  return parts;
};