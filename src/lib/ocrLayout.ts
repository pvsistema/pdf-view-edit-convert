// Разбор разметки распознанного листа.
//
// Движок возвращает не только текст, но и то, как он расположен: где
// абзац, где строка, каким размером набрано слово, жирное ли оно.
// Раньше всё это выбрасывалось и в Word уходила сплошная лента строк.
// Здесь из этих данных восстанавливается облик документа: заголовки
// остаются заголовками, выравнивание по центру сохраняется,
// а абзац не рассыпается на отдельные строки.

import { buildRows, findTables, type Cell } from '@/lib/tables';

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

// Размер листа берём по самому дальнему краю текста: движок не сообщает
// размер картинки прямо, но границы блоков его показывают
const pageWidth = (blocks: Block[]) => {
  let max = 0;
  for (const b of blocks) if (b.bbox) max = Math.max(max, b.bbox.x1);
  return max;
};

const pageHeight = (blocks: Block[]) => {
  let max = 0;
  for (const b of blocks) if (b.bbox) max = Math.max(max, b.bbox.y1);
  return max;
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

// Разбор листа на части с сохранением облика
export const readLayout = (data: PageData): OcrPart[] => {
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
  const width = pageWidth(blocks);
  const height = pageHeight(blocks);

  const rows = width && height ? buildRows(wordCells(paras, width, height)) : [];
  const tables = rows.length ? findTables(rows) : [];

  // Запоминаем, какую полосу листа занимает каждая таблица: по ней
  // отсеиваем абзацы, попавшие внутрь неё. Иначе строки таблицы попали бы
  // в документ дважды — и таблицей, и сплошным текстом
  const bands = tables.map((t) => ({
    top: rows[t.from].y,
    bottom: rows[t.to].y + rows[t.to].h,
    rows: t.rows,
    used: false,
  }));

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

  for (const p of paras) {
    // Абзац лежит внутри таблицы — вместо него в документ идёт сама
    // таблица, и только один раз
    const band = p.bbox
      ? bands.find(
          (b) => p.bbox!.y0 / height >= b.top - 0.005 && p.bbox!.y1 / height <= b.bottom + 0.005,
        )
      : undefined;

    if (band) {
      if (!band.used) {
        band.used = true;
        parts.push({
          text: band.rows.map((r) => r.join('\t')).join('\n'),
          heading: false,
          bold: false,
          italic: false,
          align: 'left',
          table: band.rows,
        });
      }
      continue;
    }

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