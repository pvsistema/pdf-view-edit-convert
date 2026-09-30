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
import { analyzeInk, cropPng } from '@/lib/ocrInk';

// Картинка из скана: размер в пунктах, как на бумаге; x — отступ слева
export type PartImage = { png: Uint8Array; w: number; h: number; x: number };
// Кусок строки: текст (\t внутри — табуляция) или картинка
export type Seg = { t: string; u?: boolean } | { img: PartImage };

// Кусок документа: абзац со своим видом
export type OcrPart = {
  text: string;
  heading: boolean;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right' | 'both';
  // Отступ первой строки абзаца (красная строка), в двадцатых долях пункта.
  // Отрицательный — выступ: номер пункта «1)» левее текста под ним
  firstLine?: number;
  // Номер пункта списка «1.», «2)» отделён от текста табуляцией:
  // позиция, где начинается текст пункта
  listTab?: number;
  // Строка по кускам: текст (с подчёркиванием или без) и картинки прямо
  // в строке, на своих местах. Заполнено, когда в абзаце есть
  // подчёркнутые слова или вписанное от руки
  segs?: Seg[];
  // Черта во всю ширину под абзацем (разделитель шапки бланка)
  ruleAfter?: boolean;
  // Самостоятельная черта-разделитель без текста
  rule?: boolean;
  // Слово набрано вразрядку («п р и к а з ы в а ю») — в тексте оно
  // целое, а в Word буквы раздвигаются, как на бумаге
  spaced?: boolean;
  // Картинка из скана: герб, рукопись, подпись, печать
  image?: PartImage;
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
type W = Cell & { conf: number; stroke: number; px: Bbox; u?: boolean };

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
  // Последнее слово строки движок порой помечает нулевой уверенностью,
  // прочитав его верно: «ЧАСТЬ»» в шапке бланка пропадало. Настоящее
  // слово из букв в уверенно прочитанной строке оставляем
  if (rowConf >= 85 && /^[«"(]?([А-ЯЁ]{3,}|[А-ЯЁа-яё][а-яё]{2,})[»")]?[.,:;]?$/.test(w.str)) return false;
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

// Настоящая высота краски в рамке слова. Рамка у движка иногда
// захватывает кусок соседней строки — тогда слово кажется выше. Считаем
// строки рамки, где есть краска, и берём самый плотный сплошной кусок
const inkHeight = (img: ImageData | undefined, b: Bbox) => {
  if (!img) return b.y1 - b.y0;
  const { width, height, data } = img;
  const x0 = Math.max(0, b.x0);
  const x1 = Math.min(width - 1, b.x1);
  const y0 = Math.max(0, b.y0);
  const y1 = Math.min(height - 1, b.y1);
  const rows: number[] = [];
  for (let y = y0; y <= y1; y++) {
    let d = 0;
    for (let x = x0; x <= x1; x += 2) if (data[(y * width + x) * 4] < 128) d++;
    rows.push(d);
  }
  const peak = Math.max(...rows, 0);
  if (!peak) return b.y1 - b.y0;
  // Строки с заметной краской — основа букв; ищем самый длинный отрезок
  const on = rows.map((d) => d > peak * 0.08);
  let best = 0;
  let run = 0;
  for (const v of on) {
    run = v ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best || b.y1 - b.y0;
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
          // Заглавные слова меряем по краске: у «ВОЕНИЗИРОВАННАЯ» рамка
          // захватила кусок строки ниже, и шрифт выходил 18 вместо 13
          const caps = /^[«"(]?[А-ЯЁA-Z]{3,}[»")]?[.,:;]?$/.test(str) && !/[ДЦЩЙЁФ]/.test(str);
          const hPx = caps ? Math.min(bb.y1 - bb.y0, inkHeight(img, bb)) : bb.y1 - bb.y0;
          out.push({
            str,
            x: bb.x0 / width,
            y: bb.y0 / height,
            w: (bb.x1 - bb.x0) / width,
            h: hPx / height,
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
  cells: { text: string; x: number; words: W[] }[];
  words: W[];
};

// Ячейки строки: слова рядом — одна ячейка, широкий просвет — следующая.
// Так «Шарипов Эдуард Амурович» и «00294» остаются на своих местах.
//
// Строка, растянутая по ширине, выглядит так же: между словами широкие
// просветы. Раньше такие строки рвались табуляциями, и в Word слова
// разъезжались по листу. Теперь просветы сравниваются между собой:
// у растянутой строки они примерно одинаковы, у бланка — один-два
// заметно шире остальных
const cellsOf = (r: TableRow) => {
  const cells = r.cells as W[];
  const gaps: number[] = [];
  for (let k = 1; k < cells.length; k++) gaps.push(cells[k].x - (cells[k - 1].x + cells[k - 1].w));

  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  // Разрыв считается границей ячейки, если он широкий сам по себе
  // и заметно шире обычного просвета в этой строке
  const splitAt = (g: number) => g > r.h * 2 && g > mid * 2.5 + r.h * 0.5;

  const out: { text: string; x: number; words: W[] }[] = [];
  let cur: { text: string; x: number; words: W[] } | null = null;
  cells.forEach((c, k) => {
    if (!cur || (k > 0 && splitAt(gaps[k - 1]))) {
      if (cur) out.push(cur);
      cur = { text: c.str, x: c.x, words: [c] };
    } else {
      cur.text += ' ' + c.str;
      cur.words.push(c);
    }
  });
  if (cur) out.push(cur);
  return out;
};

// Номер пункта в начале строки: «1.», «2)», «а)», «1.2.», «•»
const LIST_MARK = /^(\d{1,2}(\.\d{1,2})*[.)]|[а-яa-z]\)|[•·–—-])$/i;

// Строка «п р и к а з ы в а ю:» — буквы вразрядку. Движок читает её
// отдельными буквами; собираем обратно в слово
const joinSpaced = (t: string) =>
  t.replace(/(^|\s)((?:[А-ЯЁа-яё]\s){3,}[А-ЯЁа-яё][:.,]?)(?=\s|$)/g, (_, pre, w) => pre + w.replace(/\s/g, ''));

// Рамки слов, приведённые к точкам картинки
const pxOf = (w: W) => w.px;

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

  // Линии, подчёркивания и рисунки — по самой картинке листа
  const typicalH = median(all.map((w) => w.px.y1 - w.px.y0)) || 40;
  // Текстом считаем только уверенно прочитанные слова обычного размера.
  // Герб движок иногда принимает за огромную букву «О» — такое «слово»
  // не должно прятать рисунок
  // Короткий «текст» с сомнением («(AS» поверх рукописной даты) — это
  // движок пытался прочитать почерк. Такое место считаем рисунком
  const solid = all.filter((w) => {
    const letters = w.str.replace(/[^0-9a-zа-яё]/gi, '').length;
    // Настоящее слово из букв («ЧАСТЬ»») движок иногда помечает почти
    // нулевой уверенностью — по виду слова оставляем его текстом
    const wordLike = /^[«"(]?([А-ЯЁ]{4,}|[А-ЯЁа-яё][а-яё]{3,})[»")]?[.,:;]?$/.test(w.str);
    return (
      w.px.y1 - w.px.y0 < typicalH * 2.2 &&
      (w.conf >= 80 || (letters >= 3 && w.conf >= 60) || /^\d{1,4}$/.test(w.str) || wordLike)
    );
  });
  const ink = size?.image ? analyzeInk(size.image, solid.map(pxOf), typicalH) : null;
  const idx = new Map(solid.map((w, k) => [k, w] as const));
  if (ink) {
    // Слова, попавшие на рисунок, — обрывки, вычитанные из почерка,
    // подписи или печати. Рисунок встанет в документ сам, а их убираем
    const pics = ink.figures.filter((f) => !f.blank);
    const onPic = (w: W) => {
      const cx = (w.px.x0 + w.px.x1) / 2;
      const cy = (w.px.y0 + w.px.y1) / 2;
      return pics.some((f) => cx > f.x0 && cx < f.x1 && cy > f.y0 && cy < f.y1);
    };
    const keep = new Set(solid);
    for (let k = all.length - 1; k >= 0; k--) if (!keep.has(all[k]) && onPic(all[k])) all.splice(k, 1);
    idx.forEach((w, i) => {
      if (ink.under.has(i)) w.u = true;
      // Рамка слова захватила подчёркивание — срезаем по линию, иначе
      // слово кажется выше и шрифт в Word выходит огромным
      const cut = ink.cut.get(i);
      if (cut !== undefined && cut > w.px.y0) w.h = (cut - w.px.y0) / height;
    });
  }

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

  // Края текста на листе. Если текста нет, но есть рисунки — края листа
  const left = rows.length ? Math.min(...rows.map((r) => r.x0)) : 0.1;
  const right = rows.length ? Math.max(...rows.map((r) => r.x1)) : 0.9;
  const span = right - left || 1;

  // Если текст на бумаге шире, чем поле листа Word, всё сжимаем в меру
  const spanPt = span * ptW;
  const fit = Math.min(1, TEXT_WIDTH / 20 / spanPt);
  const toTw = (frac: number) => Math.round(frac * ptW * 20 * fit);

  // Размер шрифта по высоте букв. Высота рамки слова зависит от букв:
  // у «унитарное» только строчные (≈0.46 кегля), у «Федеральное» есть
  // заглавная и хвостик «д» (≈0.9). Учитываем это для каждого слова.
  // Кавычки «» выше заглавных не бывают, а вот «Д», «Щ», «Ц» — с
  // хвостиком вниз, поэтому у заглавных их учитываем отдельно
  const emOf = (w: W) => {
    const t = w.str;
    const up = /[A-ZА-ЯЁ0-9бdfhiklt()«»"'[\]{}/|!?№%йё]/.test(t);
    const down = /[руфдзцщgjpqy(),;[\]{}/|ДЦЩ]/.test(t);
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
    // Подчёркнутые и вписанные слова (дата и номер в бланке) меряются
    // вместе с линией и почерком — если есть обычные слова, берём их
    const plain = r.words.filter((w) => !w.u && w.conf >= 80);
    const base = plain.length ? plain : r.words;
    const hs = median(base.map((w) => w.h));
    const normal = base.filter((w) => w.h <= hs * 1.35);
    // Строка заглавными: у «ГОРНОСПАСАТЕЛЬНАЯ» высота рамки — это ровно
    // высота заглавной, а слова с хвостиками «Д», «Щ» дают завышение
    const caps = normal.filter((w) => /^[«"(]?[А-ЯЁA-Z]{3,}[»")]?[.,:;]?$/.test(w.str));
    // «Д», «Ц», «Щ» — с хвостиком вниз, «Й» и «Ё» — со значком сверху:
    // их рамка выше заглавной, в оценке шрифта их не берём
    const plainCaps = caps.filter((w) => !/[ДЦЩЙЁФ(),]/.test(w.str) && w.conf >= 50);
    // Рамка заглавного слова бывает только выше букв (захватила соседнюю
    // строку или линию), но не ниже — берём самое низкое слово
    if (plainCaps.length)
      return snap(Math.min(Math.min(...plainCaps.map((w) => (w.h * ptH) / 0.69)), 36) * fit);
    const rich = normal.filter((w) => /[A-ZА-ЯЁ0-9бдруфзцщ()«»"]/.test(w.str));
    const pick = rich.length ? rich : normal.length ? normal : r.words;
    return snap(Math.min(...[median(pick.map(emOf)), 36]) * fit);
  };

  const bodyPt = rows.length ? median(rows.map(sizeOfRow)) : 12;
  // Обычная ширина строчной буквы в точках картинки
  const letterW =
    median(
      all
        .filter((w) => /^[а-яё]{5,}[.,:;]?$/.test(w.str))
        .map((w) => (w.px.x1 - w.px.x0) / w.str.replace(/[^а-яё]/g, '').length),
    ) || 1e9;
  const lineH = rows.length ? median(rows.map((r) => r.h)) : 0.01;
  // Обычный шаг строк внутри колонки
  const pitch =
    median(
      rows
        .slice(1)
        .map((r, k) => (r.R === rows[k].R ? r.y - rows[k].y : 0))
        .filter((d) => d > 0 && d < lineH * 3),
    ) || lineH * 1.5;

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

  // Строка во всю ширину: дошла почти до обоих краёв текста
  const fullWidth = (r: Row) =>
    r.x1 > (inColumn(r) ? r.R : right) - colSpan(r) * 0.03 &&
    r.x0 < (inColumn(r) ? r.L : left) + colSpan(r) * 0.12;

  const alignOfRow = (r: Row): OcrPart['align'] => {
    if (inColumn(r)) return 'left';
    const pl = (r.x0 - left) / span;
    const pr = (right - r.x1) / span;
    if (r.cells.length > 1) return 'left';
    // Короткая строка точно посередине — по центру. Строка во всю
    // ширину тоже «посередине», но это обычный текст
    if (pl > 0.04 && pr > 0.04 && Math.abs(pl - pr) < Math.max(0.03, (pl + pr) * 0.12))
      return 'center';
    if (pl > 0.35 && pr < 0.05) return 'right';
    return 'left';
  };

  // Жирность строки: большинство слов с толстым штрихом. Толщину
  // меряем у слов, чей размер надёжен (без хвостиков и значков сверху)
  const boldRow = (r: Row) => {
    const shares = r.words
      .filter((w) => w.str.length >= 3 && !/[ДЦЩЙЁ]/.test(w.str))
      .map(strokeShare)
      .filter((v) => v > 0);
    const pick = shares.length ? shares : r.words.filter((w) => w.str.length >= 3).map(strokeShare).filter((v) => v > 0);
    return pick.length > 0 && median(pick) > 0.108;
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

  // Черты и рисунки — по высоте на листе, чтобы вставить их между
  // абзацами на своё место
  type Extra = { y: number; y1: number; part: OcrPart };
  const extras: Extra[] = [];
  if (ink && size?.image) {
    for (const l of ink.rules) {
      extras.push({
        y: l.y0 / height,
        y1: l.y1 / height,
        part: { text: '', heading: false, bold: false, italic: false, align: 'left', rule: true },
      });
    }
    for (const f of ink.figures) {
      if (f.blank) continue;
      const png = cropPng(size.image, f, typicalH * 0.15);
      if (!png) continue;
      const fx0 = f.x0 / width;
      const fx1 = f.x1 / width;
      // Размер в пунктах, как на бумаге
      const wPt = ((f.x1 - f.x0) * 72 * fit) / dpi;
      const hPt = ((f.y1 - f.y0) * 72 * fit) / dpi;
      const mid = (fx0 + fx1) / 2;
      const align: OcrPart['align'] =
        Math.abs(mid - (left + right) / 2) < span * 0.08 ? 'center' : fx0 - left > span * 0.5 ? 'right' : 'left';
      extras.push({
        y: f.y0 / height,
        y1: f.y1 / height,
        part: {
          text: '',
          heading: false,
          bold: false,
          italic: false,
          align,
          image: { png, w: wPt, h: hPt, x: toTw(Math.max(0, fx0 - left)) },
        },
      });
    }
  }

  // Рисунок, стоящий в одной строке с текстом («25 сентября» от руки
  // рядом с печатным «2026 г.»), вставляем в эту строку, на своё место
  type RowPic = Extra & { x: number; x1: number };
  const inRow = new Map<number, RowPic[]>();
  for (const e of extras as RowPic[]) {
    if (!e.part.image) continue;
    const k = rows.findIndex((r) => {
      const top = Math.max(r.y, e.y);
      const bot = Math.min(r.y + r.h, e.y1);
      return bot - top > Math.min(r.h, e.y1 - e.y) * 0.4;
    });
    if (k >= 0 && !owner.has(k)) {
      const img = e.part.image!;
      e.x = left + (img.x ? img.x / (ptW * 20 * fit) : 0);
      e.x1 = e.x + img.w / (ptW * fit);
      (inRow.get(k) || inRow.set(k, []).get(k)!).push(e);
      e.y = -1;
    }
  }
  const floating = extras.filter((e) => e.y >= 0).sort((a, b) => a.y - b.y);
  const picsOf = new Map<Row, RowPic[]>();
  inRow.forEach((v, k) => picsOf.set(rows[k], v));

  const parts: OcrPart[] = [];
  let cur: { rows: Row[]; part: OcrPart } | null = null;
  let lastBottom: number | null = null;

  const flush = () => {
    if (!cur) return;
    const c = cur;
    // Текст и подчёркнутые куски собираем вместе — по словам. Рисунки,
    // стоящие в первой строке, встают между словами по своему месту
    type Item = { t: string; u: boolean; img?: PartImage };
    const first0 = c.rows[0];
    const words: Item[] = [];
    const pics = picsOf.get(c.rows[0]) || [];
    c.rows.forEach((r, ri) => {
      type Piece = { x: number; x1: number; w?: W; img?: PartImage };
      const line: Piece[] = r.words.map((w) => ({ x: w.x, x1: w.x + w.w, w }));
      if (ri === 0) for (const e of pics) line.push({ x: e.x, x1: e.x1, img: e.part.image });
      line.sort((a, b) => a.x - b.x);
      let prevEnd: number | null = null;
      for (const p of line) {
        const gap = prevEnd === null ? 0 : p.x - prevEnd;
        const sep =
          prevEnd === null
            ? ri === 0
              ? ''
              : ' '
            : gap > r.h * 2 && (p.img || line.some((q) => q.img) || r.cells.length > 1)
              ? '\t'
              : ' ';
        if (p.img) {
          if (sep) words.push({ t: sep, u: false });
          words.push({ t: '', u: false, img: p.img });
        } else words.push({ t: sep + p.w!.str, u: !!p.w!.u });
        prevEnd = p.x1;
      }
    });
    // Перенос со знаком «-» в конце строки склеиваем обратно
    const merged: Item[] = [];
    for (const w of words) {
      const prev = merged[merged.length - 1];
      if (prev && !prev.img && /[-\u2010\u2011]$/.test(prev.t) && /^ [a-zа-яё]/.test(w.t)) {
        prev.t = prev.t.replace(/[-\u2010\u2011]$/, '') + w.t.slice(1);
        continue;
      }
      merged.push({ ...w });
    }
    let text = merged.map((w) => w.t).join('');
    const joined = joinSpaced(text);
    // Разрядка: либо движок прочитал буквы по отдельности, либо слово
    // одно, но на бумаге заметно шире обычного — буквы раздвинуты
    // Сравниваем со средней шириной строчной буквы на листе. Заглавные
    // и жирные шире сами по себе — их не проверяем
    const wide = (w: W) => {
      const letters = w.str.replace(/[^а-яёa-z]/g, '').length;
      return letters >= 5 && !/[А-ЯЁA-Z]/.test(w.str) && (w.px.x1 - w.px.x0) / letters > letterW * 1.3;
    };
    const spaced = joined !== text || (c.rows.length === 1 && first0.words.length <= 2 && first0.words.some(wide));
    text = joined;

    // Номер пункта в начале абзаца отделяем табуляцией, как в Word-списке
    const first = first0;
    const markW = first.words[0];
    const markGap = first.words.length > 1 ? first.words[1].x - (markW.x + markW.w) : 0;
    const isList =
      !spaced &&
      first.words.length > 1 &&
      // Строка бланка с несколькими полями («25 сентября … Копейск … № 336»)
      // — не пункт списка, даже если начинается с числа
      first.cells.length <= 2 &&
      ((LIST_MARK.test(markW.str) && markGap > first.h * 0.4) ||
        // «3» без точки — точку движок потерял, но номер отделён от
        // текста широким просветом, как в списке
        (/^\d{1,2}$/.test(markW.str) && markGap > first.h * 1.2));
    if (isList) {
      text = text.replace(/^(\S+)[ \t]+/, '$1\t');
      c.part.tabs = undefined;
      const home = c.rows.length > 1 ? Math.min(...c.rows.slice(1).map((r) => r.x0)) : (inColumn(first) ? first.L : left);
      const base = inColumn(first) ? first.L : left;
      c.part.listTab = toTw(first.words[1].x - base);
      // Строки после первой начинаются от края — выступ номера задаём
      // отрицательной красной строкой относительно этого края
      const leftTw = Math.max(0, toTw(home - base));
      c.part.indent = leftTw > 60 ? leftTw : undefined;
      c.part.firstLine = toTw(markW.x - base) - leftTw;
    }

    // Выравнивание по ширине: две и больше строк, все кроме последней
    // доходят до правого края
    const body = c.rows.slice(0, -1);
    if (c.part.align === 'left' && c.rows.length > 1 && body.every((r) => fullWidth(r)) && !c.part.tabs)
      c.part.align = 'both';

    // Красная строка: первая строка абзаца с отступом, остальные от края
    if (!isList && c.rows.length > 1 && (c.part.align === 'left' || c.part.align === 'both')) {
      const base = inColumn(first) ? first.L : left;
      const rest = Math.min(...c.rows.slice(1).map((r) => r.x0));
      const leftTw = Math.max(0, toTw(rest - base));
      const firstTw = toTw(first.x0 - base);
      if (Math.abs(firstTw - leftTw) > 100) {
        c.part.indent = leftTw > 60 ? leftTw : undefined;
        c.part.firstLine = firstTw - leftTw;
      }
    }

    // Строка шапки бланка во всю ширину («ФИЛИАЛ «КОПЕЙСКИЙ … ОТРЯД»»)
    // по краям не отличить от обычного текста. Одиночная жирная строка
    // с равными полями — это центрированная строка шапки
    if (c.rows.length === 1 && c.part.align === 'left' && c.part.bold && !c.part.tabs && !isList) {
      const pl = first.x0 - left;
      const pr = right - first.x1;
      if (Math.abs(pl - pr) < span * 0.04) {
        c.part.align = 'center';
        c.part.indent = undefined;
      }
    }

    if (spaced) c.part.spaced = true;
    c.part.text = text.replace(/\t+/g, '\t').trim();

    // Строка с рисунками или подчёркиванием — собираем по кускам
    if (!spaced && merged.some((w) => w.u || w.img)) {
      const segs: Seg[] = [];
      for (const w of merged) {
        if (w.img) {
          segs.push({ img: w.img });
          continue;
        }
        const last = segs[segs.length - 1];
        // Пробел между двумя подчёркнутыми словами тоже подчёркнут
        const t = w.t;
        if (last && 't' in last && !!last.u === w.u) last.t += t;
        else if (w.u && /^\s/.test(t)) {
          if (last && 't' in last) last.t += t[0];
          else segs.push({ t: t[0] });
          segs.push({ t: t.slice(1), u: true });
        } else segs.push({ t, u: w.u });
      }
      if (isList) {
        const f = segs[0];
        if (f && 't' in f) f.t = f.t.replace(/^(\S+)[ \t]+/, '$1\t');
      }
      c.part.segs = segs;
      // Табуляции строки с рисунками — по местам кусков
      if (pics.length) {
        const r0 = c.rows[0];
        type P = { x: number; x1: number };
        const line: P[] = [
          ...r0.words.map((w) => ({ x: w.x, x1: w.x + w.w })),
          ...pics.map((e) => ({ x: e.x, x1: e.x1 })),
        ].sort((a, b) => a.x - b.x);
        const tabs: { pos: number; right?: boolean }[] = [];
        for (let k = 1; k < line.length; k++)
          if (line[k].x - line[k - 1].x1 > r0.h * 2) tabs.push({ pos: Math.min(TEXT_WIDTH - 200, toTw(line[k].x - left)) });
        c.part.tabs = tabs.length ? tabs : undefined;
        const lx = line[0].x;
        c.part.indent = toTw(lx - left) > 60 ? toTw(lx - left) : undefined;
        c.part.align = 'left';
      }
    }
    if (c.part.text) parts.push(c.part);
    cur = null;
  };

  // Просвет перед строкой — в двадцатых долях пункта. Обычный межстрочный
  // интервал вычитаем, чтобы не раздувать документ
  const gapBefore = (y: number, pt: number) => {
    if (lastBottom === null || y < lastBottom) return 0;
    const gapPt = (y - lastBottom) * ptH;
    return Math.max(0, Math.min(1440, Math.round((gapPt - pt * 0.35) * 20)));
  };

  // Черты и рисунки, стоящие выше строки, — вставляем перед ней
  let fi = 0;
  const putExtras = (upTo: number) => {
    while (fi < floating.length && floating[fi].y < upTo) {
      const e = floating[fi++];
      // Черта сразу под абзацем — рисуем её границей абзаца, а не
      // отдельной строкой: так она ложится вплотную, как на бланке
      if (e.part.rule && !cur && parts.length && lastBottom !== null && e.y - lastBottom < lineH * 3) {
        const last = parts[parts.length - 1];
        if (!last.table && !last.image && !last.rule) {
          last.ruleAfter = true;
          lastBottom = e.y1;
          continue;
        }
      }
      flush();
      e.part.before = gapBefore(e.y, bodyPt);
      parts.push(e.part);
      lastBottom = e.y1;
    }
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    putExtras(r.y);
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
          before: gapBefore(r.y, bodyPt),
        });
      }
      lastBottom = r.y + r.h;
      continue;
    }

    // Строка с рисунками («25 сентября» от руки) — всегда свой абзац
    const pics = inRow.get(i);

    // Кегль, близкий к основному, — это и есть основной: оценка по высоте
    // букв на скане гуляет на пункт-другой, а на бумаге шрифт один
    const est = sizeOfRow(r);
    const pt = Math.abs(est - bodyPt) <= Math.max(1, bodyPt * 0.15) ? bodyPt : est;
    const align = alignOfRow(r);
    const bold = boldRow(r);

    // Строка — начало пункта списка: номер, просвет, текст
    const itemRow = (q: Row) =>
      q.words.length > 1 &&
      (LIST_MARK.test(q.words[0].str) || /^\d{1,2}$/.test(q.words[0].str)) &&
      q.cells[0].words.length === 1;

    // Новый пункт списка всегда начинает новый абзац
    const startsItem =
      r.words.length > 1 &&
      r.cells.length <= 2 &&
      (LIST_MARK.test(r.words[0].str) ||
        (/^\d{1,2}$/.test(r.words[0].str) && r.words[1].x - (r.words[0].x + r.words[0].w) > r.h * 1.2));

    // Продолжение абзаца: обычный текст, прошлая строка дошла до правого
    // края, просвет маленький, тот же размер и вид. Иначе — новая строка,
    // как в бланке
    const prev = cur?.rows[cur.rows.length - 1];
    const joins =
      cur &&
      prev &&
      !pics &&
      !picsOf.has(cur.rows[0]) &&
      !startsItem &&
      align === 'left' &&
      (cur.part.align === 'left' || cur.part.align === 'both') &&
      r.cells.length === 1 &&
      // Первая строка пункта списка — номер и текст через широкий
      // просвет, это две «ячейки». Продолжение к ней всё равно клеится
      (prev.cells.length === 1 || (prev === cur.rows[0] && cur.rows[0].cells.length === 2 && itemRow(prev))) &&
      prev.R === r.R &&
      // Строка дошла до края. В колонке статьи правый край обычно
      // неровный — там хватает трёх пятых ширины
      prev.x1 > prev.R - colSpan(prev) * (inColumn(prev) ? 0.4 : 0.06) &&
      // Следующая строка ниже прошлой: при переходе к новой колонке
      // строка снова оказывается наверху листа — это уже новый абзац
      r.y > prev.y &&
      // Просвет меряем шагом строк: высота строки из одних строчных букв
      // гуляет, а шаг от строки к строке в абзаце ровный
      (inColumn(prev)
        ? r.y - prev.y < pitch * 1.3
        : r.y - prev.y < Math.max(pitch * 1.35, prev.h * 1.9)) &&
      // Размер шрифта в строке оценивается с разбросом в пункт-два
      Math.abs(pt - (cur.part.size || pt)) <= 2 &&
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
          // Рисунок в строке выше текста («сентября» от руки) — просвет
          // считаем от его верха
          before: gapBefore(Math.min(r.y, ...(pics || []).map((e) => e.y1 - (e.part.image!.h / ptH))), pt),
        },
      };
    }
    lastBottom = r.y + r.h;
  }
  flush();
  putExtras(2);

  return parts;
};
