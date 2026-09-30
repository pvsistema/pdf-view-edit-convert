// Разбор разметки распознанного листа — по образцу FineReader.
//
// Движок возвращает каждое слово с его местом на листе и уверенностью.
// Из этого восстанавливается облик документа:
// - строки бланка остаются отдельными строками, а сплошной текст
//   собирается в абзацы (строка, доходящая до правого края, продолжается);
// - у каждой строки свой размер шрифта — мелкие подписи под полями
//   бланка («наименование организации») остаются мелкими;
// - сохраняются отступ слева и расстановка по строке: «Шарипов … 00294»
//   ложится с табуляцией, как на бумаге;
// - жирное определяется по толщине штриха на самой картинке;
// - сохраняются просветы между частями документа;
// - оттиски печатей и подписи, из которых движок вычитывает мусор,
//   отбрасываются по низкой уверенности распознавания.

import { buildRows, findTables, type Cell, type TableRow } from '@/lib/tables';

// Кусок документа: абзац со своим видом
export type OcrPart = {
  text: string;
  heading: boolean;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  // Заполнено, если кусок оказался таблицей
  table?: string[][];
  // Размер шрифта в пунктах, как на бумаге
  size?: number;
  // Отступ слева от края текста, в двадцатых долях пункта (как в Word)
  indent?: number;
  // Позиции табуляции для строк вида «Фамилия …… 00294»
  tabs?: { pos: number; right?: boolean }[];
  // Просвет перед абзацем, в двадцатых долях пункта
  before?: number;
};

type Bbox = { x0: number; y0: number; x1: number; y1: number };
type Word = {
  text?: string;
  confidence?: number;
  is_bold?: boolean;
  is_italic?: boolean;
  bbox?: Bbox;
};
type Line = { text?: string; words?: Word[]; bbox?: Bbox };
type Para = { text?: string; lines?: Line[]; bbox?: Bbox };
type Block = { paragraphs?: Para[]; bbox?: Bbox };
type PageData = { text?: string; blocks?: Block[] | null };

// Размер разобранной картинки и её разрешение. Разрешение нужно, чтобы
// перевести точки картинки в пункты: так размеры шрифта и отступы
// в Word совпадают с бумажными
export type PageSize = {
  width: number;
  height: number;
  dpi?: number;
  image?: ImageData;
};

// Слово с местом на листе (в долях страницы) и приметами
type W = Cell & { conf: number; stroke: number; px: Bbox };

// Ширина текста в Word (лист А4 за вычетом полей), в двадцатых долях пункта
const TEXT_WIDTH = 9355;

// Толщина штриха в слове: самые частые длины тёмных отрезков по строкам.
// У жирного шрифта штрих толще при той же высоте букв
const strokeOf = (img: ImageData | undefined, b: Bbox) => {
  if (!img) return 0;
  const { width, height, data } = img;
  const x0 = Math.max(0, b.x0);
  const x1 = Math.min(width - 1, b.x1);
  const y0 = Math.max(0, b.y0);
  const y1 = Math.min(height - 1, b.y1);
  const runs: number[] = [];
  for (let y = y0; y <= y1; y += 2) {
    let run = 0;
    for (let x = x0; x <= x1; x++) {
      const dark = data[(y * width + x) * 4] < 128;
      if (dark) run++;
      else if (run) {
        runs.push(run);
        run = 0;
      }
    }
    if (run) runs.push(run);
  }
  if (!runs.length) return 0;
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length / 2)];
};

// Мусор от печати, подписи или линий бланка: движок сам сообщает, что
// почти не уверен в слове
const junkWord = (w: W, rowConf: number) => {
  const letters = w.str.replace(/[^0-9a-zа-яё]/gi, '').length;
  if (!letters) return w.conf < 60;
  if (rowConf < 60) return w.conf < 60;
  if (w.conf < 40) return true;
  return w.conf < 60 && letters <= 2;
};

// Края рамок бланка движок принимает за скобки и черты: «[24», «00294|».
// Непарную скобку или черту на краю слова убираем
const trimFrame = (t: string) => {
  let s = t;
  const pairs: Record<string, string> = { '[': ']', '(': ')', '{': '}' };
  for (;;) {
    const f = s[0];
    if (f === '|' || ((f === '[' || f === '{') && !s.includes(pairs[f]))) s = s.slice(1);
    else break;
  }
  for (;;) {
    const l = s[s.length - 1];
    if (l === '|' || ((l === ']' || l === '}') && !s.includes(l === ']' ? '[' : '{')))
      s = s.slice(0, -1);
    else break;
  }
  return s.trim();
};

const wordsOf = (blocks: Block[], width: number, height: number, img?: ImageData): W[] => {
  const out: W[] = [];
  for (const b of blocks)
    for (const p of b.paragraphs || [])
      for (const l of p.lines || [])
        for (const w of l.words || []) {
          const bb = w.bbox;
          const str = trimFrame((w.text || '').trim());
          if (!bb || !str) continue;
          out.push({
            str,
            x: bb.x0 / width,
            y: bb.y0 / height,
            w: (bb.x1 - bb.x0) / width,
            h: (bb.y1 - bb.y0) / height,
            conf: w.confidence ?? 100,
            stroke: strokeOf(img, bb),
            px: bb,
          });
        }
  return out;
};

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// Раскладка по колонкам — как в газете или статье.
//
// Раньше строки собирались по высоте на листе: левая и правая колонки
// склеивались в одну строку через табуляцию, и текст шёл вперемешку —
// «начало левой … начало правой». Здесь ищется просвет между колонками:
// несколько строк подряд, и в каждой на одном и том же месте по ширине
// широкий разрыв. Такой участок делится на колонки, и они читаются по
// очереди, сверху вниз. Заголовок во всю ширину и примечание под
// колонками остаются на своих местах.
//
// Бланк с «Фамилия …… 00294» колонками не считается: в колонке статьи
// в строке много слов, а в столбце бланка одно-два
const MIN_COL_ROWS = 6;

const splitColumns = (words: W[], depth = 0): W[][] => {
  if (depth > 2 || words.length < 30) return [words];
  const rows = buildRows(words) as unknown as { y: number; h: number; cells: W[] }[];
  if (rows.length < MIN_COL_ROWS) return [words];

  // Места возможного раздела — середины широких просветов в строках
  const cuts: number[] = [];
  for (const r of rows)
    for (let k = 1; k < r.cells.length; k++) {
      const a = r.cells[k - 1];
      const b = r.cells[k];
      if (b.x - (a.x + a.w) > r.h * 1.5) cuts.push((a.x + a.w + b.x) / 2);
    }
  if (!cuts.length) return [words];

  // Строка не мешает разделу, если ни одно её слово не перекрывает
  // линию раздела. Строка только с одной стороны (конец абзаца в одной
  // колонке, пропуск между абзацами) участок не рвёт
  const clear = (r: (typeof rows)[number], x: number) => !r.cells.some((c) => c.x < x && c.x + c.w > x);

  let best: { from: number; to: number; cut: number } | null = null;
  const tried = new Set<number>();
  for (const x0 of cuts) {
    const key = Math.round(x0 * 200);
    if (tried.has(key)) continue;
    tried.add(key);
    let i = 0;
    while (i < rows.length) {
      if (!clear(rows[i], x0)) {
        i++;
        continue;
      }
      let j = i;
      let both = 0;
      // Большой пустой просвет по высоте — конец колонок: ниже уже
      // другой кусок листа (примечание, подпись, таблица)
      const lh = median(rows.map((r) => r.h));
      while (
        j < rows.length &&
        clear(rows[j], x0) &&
        (j === i || rows[j].y - (rows[j - 1].y + rows[j - 1].h) < lh * 4)
      ) {
        const r = rows[j];
        if (r.cells.some((c) => c.x + c.w <= x0) && r.cells.some((c) => c.x >= x0)) both++;
        j++;
      }
      if (both >= MIN_COL_ROWS && (!best || j - i > best.to - best.from)) best = { from: i, to: j, cut: x0 };
      i = j;
    }
  }
  if (!best) return [words];

  const cut = best.cut;
  const band = rows.slice(best.from, best.to);
  const leftW = band.flatMap((r) => r.cells.filter((c) => c.x + c.w / 2 < cut));
  const rightW = band.flatMap((r) => r.cells.filter((c) => c.x + c.w / 2 >= cut));

  // Колонки статьи — строки со многими словами по обе стороны.
  // Столбцы бланка и таблицы здесь не трогаем: ими занят поиск таблиц
  const perRow = (ws: W[]) => ws.length / band.length;
  if (perRow(leftW) < 2.5 || perRow(rightW) < 2.5) return [words];

  const above = rows.slice(0, best.from).flatMap((r) => r.cells);
  const below = rows.slice(best.to).flatMap((r) => r.cells);

  return [
    ...(above.length ? splitColumns(above, depth + 1) : []),
    ...splitColumns(leftW, depth + 1),
    ...splitColumns(rightW, depth + 1),
    ...(below.length ? splitColumns(below, depth + 1) : []),
  ];
};

// Строка листа, готовая к сборке: ячейки разнесены по местам
type Row = {
  // Края колонки, в которой стоит строка. Отступы, выравнивание и
  // перенос строк в абзац считаются от краёв своей колонки
  L: number;
  R: number;
  y: number;
  h: number;
  x0: number;
  x1: number;
  cells: { text: string; x: number }[];
  words: W[];
};

// Ячейки строки: слова рядом — одна ячейка, широкий просвет — следующая.
// Так «Шарипов Эдуард Амурович» и «00294» остаются на своих местах
const cellsOf = (r: TableRow) => {
  const out: { text: string; x: number }[] = [];
  let text = '';
  let x = 0;
  let prevEnd: number | null = null;
  for (const c of r.cells) {
    const gap = prevEnd === null ? 0 : c.x - prevEnd;
    if (prevEnd !== null && gap > r.h * 2) {
      out.push({ text: text.trim(), x });
      text = '';
    }
    if (!text) x = c.x;
    else text += ' ';
    text += c.str;
    prevEnd = c.x + c.w;
  }
  if (text.trim()) out.push({ text: text.trim(), x });
  return out;
};

export const readLayout = (data: PageData, size?: PageSize): OcrPart[] => {
  const blocks = data.blocks;
  const width = size?.width || 0;
  const height = size?.height || 0;

  if (!blocks || !blocks.length || !width || !height) {
    return (data.text || '')
      .split(/\n\s*\n/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({
        text,
        heading: false,
        bold: false,
        italic: false,
        align: 'left' as const,
      }));
  }

  const dpi = size?.dpi || 300;
  // Пунктов в одной доле ширины и высоты листа
  const ptW = (width * 72) / dpi;
  const ptH = (height * 72) / dpi;

  // Строки листа и уборка мусора
  const all = wordsOf(blocks, width, height, size?.image);
  type WRow = { y: number; h: number; cells: W[]; L: number; R: number };
  // Строки собираем внутри каждой колонки, колонки идут по очереди
  const rawRows: WRow[] = [];
  for (const col of splitColumns(all)) {
    const L = Math.min(...col.map((c) => c.x));
    const R = Math.max(...col.map((c) => c.x + c.w));
    for (const r of buildRows(col) as unknown as WRow[]) rawRows.push({ ...r, L, R });
  }
  const cleanRows: WRow[] = [];
  for (const r of rawRows) {
    const rowConf = median(r.cells.map((c) => c.conf));
    const kept = r.cells.filter((c) => !junkWord(c, rowConf));
    // Строка из одних обрывков (оттиск печати) — целиком мусор
    const letters = kept
      .map((c) => c.str)
      .join('')
      .replace(/[^0-9a-zа-яё]/gi, '').length;
    // Строка с низкой уверенностью и парой букв — обрывки герба или печати
    const keptConf = median(kept.map((c) => c.conf));
    if (!kept.length || letters < 2 || (keptConf < 70 && letters < 5)) continue;
    cleanRows.push({
      y: Math.min(...kept.map((c) => c.y)),
      h: Math.max(...kept.map((c) => c.h)),
      cells: kept,
      L: r.L,
      R: r.R,
    });
  }
  if (!cleanRows.length) return [];

  // Высоту строки считаем по середине слов: одна высокая скобка
  // не должна делать строку крупнее
  const rows: Row[] = cleanRows.map((r) => ({
    L: r.L,
    R: r.R,
    y: r.y,
    h: median(r.cells.map((c) => c.h)),
    x0: Math.min(...r.cells.map((c) => c.x)),
    x1: Math.max(...r.cells.map((c) => c.x + c.w)),
    cells: cellsOf(r),
    words: r.cells,
  }));

  // Края текста на листе
  const left = Math.min(...rows.map((r) => r.x0));
  const right = Math.max(...rows.map((r) => r.x1));
  const span = right - left || 1;

  // Если текст на бумаге шире, чем поле листа Word, всё сжимаем в меру
  const spanPt = span * ptW;
  const fit = Math.min(1, TEXT_WIDTH / 20 / spanPt);
  const toTw = (frac: number) => Math.round(frac * ptW * 20 * fit);

  // Размер шрифта по высоте букв. Высота рамки слова зависит от букв:
  // у «унитарное» только строчные (≈0.46 кегля), у «Федеральное» есть
  // заглавная и хвостик «д» (≈0.9). Учитываем это для каждого слова
  const emOf = (w: W) => {
    const t = w.str;
    const up = /[A-ZА-ЯЁ0-9бdfhiklt()«»"'[\]{}/|!?№%йё]/.test(t);
    const down = /[руфдзцщgjpqy(),;[\]{}/|]/.test(t);
    const factor = (up ? 0.69 : 0.47) + (down ? 0.22 : 0);
    return (w.h * ptH) / factor;
  };
  // Кегли на бумаге — из привычного ряда: 8, 9, 10, 11, 12, 14…
  const SIZES = [7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24];
  const snap = (pt: number) =>
    SIZES.reduce((a, b) => (Math.abs(b - pt) < Math.abs(a - pt) ? b : a));
  // Слова из одних строчных букв без хвостиков («составления») дают
  // самую неточную оценку — если в строке есть другие слова, их не берём
  const sizeOfRow = (r: Row) => {
    // Слово, вписанное в рамку, движок меряет вместе с рамкой — его высота
    // завышена. Берём слова обычной для строки высоты
    const hs = median(r.words.map((w) => w.h));
    const normal = r.words.filter((w) => w.h <= hs * 1.35);
    const rich = normal.filter((w) => /[A-ZА-ЯЁ0-9бдруфзцщ()«»"]/.test(w.str));
    const pick = rich.length ? rich : normal.length ? normal : r.words;
    return snap(Math.min(...[median(pick.map(emOf)), 36]) * fit);
  };

  const bodyRaw = median(rows.map(sizeOfRow));
  const lineH = median(rows.map((r) => r.h));
  // Обычный шаг строк внутри колонки
  const pitch =
    median(
      rows
        .slice(1)
        .map((r, k) => (r.R === rows[k].R ? r.y - rows[k].y : 0))
        .filter((d) => d > 0 && d < lineH * 3),
    ) || lineH * 1.5;
  const bodyPt = bodyRaw;

  // Толщина штриха относительно кегля. У обычного Times она около
  // 0.08 кегля, у жирного — 0.13 и больше. Мерка не зависит от того,
  // сколько на листе жирного: в бланках его бывает больше половины
  const strokeShare = (w: W) => {
    const em = (emOf(w) / ptH) * height;
    return em > 0 && w.stroke > 0 ? w.stroke / em : 0;
  };

  // Ширина колонки строки. Узкая колонка по сравнению со всем листом —
  // её строки не выравниваем по центру и вправо: короткая строка
  // в колонке статьи — это конец абзаца, а не заголовок
  const colSpan = (r: Row) => r.R - r.L || span;
  const inColumn = (r: Row) => colSpan(r) < span * 0.8;

  const alignOfRow = (r: Row): OcrPart['align'] => {
    if (inColumn(r)) return 'left';
    const pl = (r.x0 - left) / span;
    const pr = (right - r.x1) / span;
    if (r.cells.length > 1) return 'left';
    if (pl > 0.08 && pr > 0.08 && Math.abs(pl - pr) < 0.08) return 'center';
    if (pl > 0.35 && pr < 0.05) return 'right';
    return 'left';
  };

  const boldRow = (r: Row) => {
    const shares = r.words
      .filter((w) => w.str.length >= 3)
      .map(strokeShare)
      .filter((v) => v > 0);
    return shares.length > 0 && median(shares) > 0.108;
  };

  // Таблицы — по тем же строкам
  const tableRows: TableRow[] = cleanRows;
  // На бланке рядом стоящие рамки («Дата» слева, «Номер» справа) похожи
  // на таблицу, но ею не являются. Настоящая таблица в скане — ровная
  // сетка: от трёх строк и одинаковое число ячеек в каждой
  const tables = findTables(tableRows).filter(
    (t) => t.rows.length >= 3 && t.rows.every((row) => row.length === t.rows[0].length),
  );
  const owner = new Map<number, (typeof tables)[number]>();
  for (const t of tables) for (let k = t.from; k <= t.to; k++) owner.set(k, t);

  const parts: OcrPart[] = [];
  let cur: { rows: Row[]; part: OcrPart } | null = null;
  let lastBottom: number | null = null;

  const flush = () => {
    if (!cur) return;
    const text = cur.rows
      .map((r) => r.cells.map((c) => c.text).join('\t'))
      .reduce((acc, line) => {
        if (!acc) return line;
        if (/[-\u2010\u2011]$/.test(acc) && /^[a-zа-яё]/.test(line))
          return acc.replace(/[-\u2010\u2011]$/, '') + line;
        return acc + ' ' + line;
      }, '');
    cur.part.text = text.trim();
    if (cur.part.text) parts.push(cur.part);
    cur = null;
  };

  // Просвет перед строкой — в двадцатых долях пункта. Обычный межстрочный
  // интервал вычитаем, чтобы не раздувать документ
  const gapBefore = (r: Row, pt: number) => {
    if (lastBottom === null || r.y < lastBottom) return 0;
    const gapPt = (r.y - lastBottom) * ptH;
    return Math.max(0, Math.min(1440, Math.round((gapPt - pt * 0.35) * 20)));
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
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
          before: gapBefore(r, bodyPt),
        });
      }
      lastBottom = r.y + r.h;
      continue;
    }

    // Кегль, близкий к основному, — это и есть основной: оценка по высоте
    // букв на скане гуляет на пункт-другой, а на бумаге шрифт один
    const est = sizeOfRow(r);
    const pt = Math.abs(est - bodyPt) <= bodyPt * 0.15 ? bodyPt : est;
    const align = alignOfRow(r);
    const bold = boldRow(r);

    // Продолжение абзаца: обычный текст, прошлая строка дошла до правого
    // края, просвет маленький, тот же размер и вид. Иначе — новая строка,
    // как в бланке
    const prev = cur?.rows[cur.rows.length - 1];
    const joins =
      cur &&
      prev &&
      align === 'left' &&
      cur.part.align === 'left' &&
      r.cells.length === 1 &&
      prev.cells.length === 1 &&
      prev.R === r.R &&
      // Строка дошла до края. В колонке статьи правый край обычно
      // неровный — там хватает трёх четвертей ширины
      prev.x1 > prev.R - colSpan(prev) * (inColumn(prev) ? 0.4 : 0.06) &&
      // Следующая строка ниже прошлой: при переходе к новой колонке
      // строка снова оказывается наверху листа — это уже новый абзац
      r.y > prev.y &&
      // В колонке просвет меряем шагом строк: высота строки из одних
      // строчных букв гуляет, а шаг от строки к строке в абзаце ровный.
      // Пропуск между абзацами заметно больше этого шага
      (inColumn(prev)
        ? r.y - prev.y < pitch * 1.3
        : r.y - (prev.y + prev.h) < Math.max(r.h, prev.h) * 0.9) &&
      // В колонке строки из одних строчных букв меряются неточно —
      // там допускаем разброс чуть больше
      Math.abs(pt - (cur.part.size || pt)) <= (inColumn(r) ? 2 : 1) &&
      bold === cur.part.bold;

    if (joins) {
      cur!.rows.push(r);
    } else {
      flush();
      const heading = pt >= bodyPt * 1.25 && r.cells.length === 1;
      const indent = align === 'left' ? toTw(r.x0 - (inColumn(r) ? r.L : left)) : 0;
      // Позиции табуляции считаются от левого поля листа (так их меряет
      // Word). Ячейка, прижатая к правому краю, ставится правой
      // табуляцией: тогда длинное «222-км» не переносится на новую строку
      const tabs =
        r.cells.length > 1
          ? r.cells.slice(1).map((c, k) => {
              const cellEnd = k === r.cells.length - 2 ? r.x1 : r.cells[k + 2].x - span * 0.01;
              const atRight = right - r.x1 < span * 0.04 && k === r.cells.length - 2;
              return atRight
                ? {
                    pos: Math.min(TEXT_WIDTH, toTw(cellEnd - left)),
                    right: true,
                  }
                : { pos: Math.min(TEXT_WIDTH - 200, toTw(c.x - left)) };
            })
          : undefined;
      cur = {
        rows: [r],
        part: {
          text: '',
          heading,
          bold,
          italic: false,
          align,
          size: pt,
          indent: indent > 60 ? indent : undefined,
          tabs,
          before: gapBefore(r, pt),
        },
      };
    }
    lastBottom = r.y + r.h;
  }
  flush();

  return parts;
};