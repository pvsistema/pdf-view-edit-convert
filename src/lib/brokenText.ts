// Починка «битого» текста в обычных документах.
//
// Текст в PDF хранится кодами шрифта, а какой букве соответствует код,
// подсказывает служебная таблица внутри файла. Некоторые издательства
// её не кладут — чаще всего у шрифтов формул, индексов и заголовков.
// Тогда из файла вместо «Rм ≤ 0,1·Rтр» читается «RȠƸRȦȤ», а вместо
// «Анализ влияния» — «ƙǆƹǄǁǀ ƻǄǁǘǆǁǘ». Сам лист при этом напечатан
// верно: на картинке буквы правильные, испорчена только запись.
//
// Поэтому такие места мы находим и читаем заново — с картинки,
// движком распознавания. Весь остальной текст берём из файла как есть:
// он точный, и портить его распознаванием незачем.

import type { TextPiece } from "@/lib/pdf";
import { STD_GLYPHS } from "@/lib/stdGlyphs";

// Знак, которого не бывает в нормальном русском или английском тексте:
// служебные коды, редкие латинские буквы, в которые превращается
// кириллица без таблицы перевода, и пустые места шрифта
const isJunk = (c: string) => {
  const u = c.codePointAt(0) || 0;
  return (
    (u < 0x20 && u !== 0x09 && u !== 0x0a && u !== 0x0d) ||
    (u >= 0x7f && u <= 0x9f) ||
    (u >= 0x180 && u <= 0x2af) ||
    (u >= 0xe000 && u <= 0xf8ff) ||
    u === 0xfffd
  );
};

const hasControl = (s: string) =>
  [...s].some((c) => {
    const u = c.codePointAt(0) || 0;
    return (
      (u < 0x20 && u !== 0x09 && u !== 0x0a && u !== 0x0d) ||
      (u >= 0x7f && u <= 0x9f)
    );
  });

const junkCount = (s: string) => [...s].filter(isJunk).length;
const inkCount = (s: string) => s.replace(/\s/g, "").length;

// Шрифты, которые на этой странице читаются мусором. Судим по доле
// странных знаков: у исправного шрифта их нет вовсе, у битого — почти
// всё. Одна редкая буква в нормальном тексте шрифт не опорочит
const brokenFonts = (pieces: TextPiece[]) => {
  const stat = new Map<string, { junk: number; ink: number }>();
  for (const p of pieces) {
    if (!p.font) continue;
    const s = stat.get(p.font) || { junk: 0, ink: 0 };
    s.junk += junkCount(p.str);
    s.ink += inkCount(p.str);
    stat.set(p.font, s);
  }

  const out = new Set<string>();
  for (const [font, s] of stat)
    if (s.junk > 0 && s.junk >= s.ink * 0.2) out.add(font);
  return out;
};

// Кусок, записи которого верить нельзя
const isBroken = (p: TextPiece, fonts: Set<string>) => {
  if (!inkCount(p.str)) return false;
  if (hasControl(p.str)) return true;
  return !!p.font && fonts.has(p.font);
};

// Место на листе, которое нужно прочитать с картинки, и кусочки,
// которые будут заменены прочитанным
export type BrokenRun = {
  box: { x: number; y: number; w: number; h: number };
  indices: number[];
};

// Поиск мест для починки.
//
// Формула набирается вперемешку: «R» — исправным курсивом, индекс «м» —
// битым шрифтом, «≤ 0,1·» — снова битым. Читать с картинки один индекс
// ненадёжно: одинокую маленькую букву движок угадывает плохо. Поэтому
// к битому куску присоединяем соседние короткие кусочки той же строки —
// и читаем формулу целиком, как её видит человек
export const findBrokenRuns = (pieces: TextPiece[]): BrokenRun[] => {
  const fonts = brokenFonts(pieces);
  const broken = pieces.map((p) => isBroken(p, fonts));
  if (!broken.some(Boolean)) return [];

  // Раскладываем по строкам
  const order = pieces
    .map((_, i) => i)
    .filter(
      (i) => inkCount(pieces[i].str) > 0 && Math.abs(pieces[i].angle) < 0.2,
    )
    .sort((a, b) => pieces[a].y - pieces[b].y || pieces[a].x - pieces[b].x);

  const rows: { y: number; h: number; items: number[] }[] = [];
  for (const i of order) {
    const p = pieces[i];
    const near = rows[rows.length - 1];
    // Индекс сидит ниже строки, поэтому допуск по высоте щедрый
    if (
      near &&
      Math.abs(p.y + p.h - (near.y + near.h)) < Math.max(p.h, near.h) * 0.7
    ) {
      near.items.push(i);
      near.h = Math.max(near.h, p.h);
    } else {
      rows.push({ y: p.y, h: p.h, items: [i] });
    }
  }

  const runs: BrokenRun[] = [];

  for (const row of rows) {
    const items = row.items.sort((a, b) => pieces[a].x - pieces[b].x);
    if (!items.some((i) => broken[i])) continue;

    // Кусочек можно взять в компанию к битому, если он короткий
    // (буква формулы, скобка, запятая) и стоит вплотную
    const small = (i: number) => inkCount(pieces[i].str) <= 3;
    const touches = (a: number, b: number) => {
      const pa = pieces[a];
      const pb = pieces[b];
      return pb.x - (pa.x + pa.w) < Math.max(pa.h, pb.h) * 0.6;
    };

    let k = 0;
    while (k < items.length) {
      if (!broken[items[k]]) {
        k++;
        continue;
      }

      let from = k;
      let to = k;
      // Расширяем влево и вправо: битые куски и короткие соседи
      while (
        from > 0 &&
        (broken[items[from - 1]] || small(items[from - 1])) &&
        touches(items[from - 1], items[from])
      )
        from--;
      while (
        to < items.length - 1 &&
        (broken[items[to + 1]] || small(items[to + 1])) &&
        touches(items[to], items[to + 1])
      )
        to++;

      const idx = items.slice(from, to + 1);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const i of idx) {
        const p = pieces[i];
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x + p.w);
        y1 = Math.max(y1, p.y + p.h);
      }
      runs.push({
        box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
        indices: idx,
      });
      k = to + 1;
    }
  }

  return runs;
};

// Чем закончить, если прочитать не удалось: хотя бы убрать мусор,
// чтобы в документ не попали служебные коды и «кракозябры»
const stripJunk = (p: TextPiece, fonts: Set<string>) => {
  if (!isBroken(p, fonts)) return p.str;
  return [...p.str].filter((c) => !isJunk(c)).join("");
};

// Шрифты страницы, которые читаются мусором — их буквы нужно опознать
export const brokenFontsOf = (pieces: TextPiece[]) => brokenFonts(pieces);

// Расшифровка кусочка знак за знаком: первые 258 кодов — по
// стандартному порядку, остальные — по опознанным рисункам букв.
// Если хоть один знак не опознан, возвращаем пусто: такой кусок
// прочитаем с картинки целиком
// Буквы-двойники: рисуются одинаково, а значат разное. Если в русском
// слове опознана латинская «K» или греческая «κ», это русская «К» и «к»
const TO_CYR: Record<string, string> = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  Y: "У",
  a: "а",
  c: "с",
  e: "е",
  o: "о",
  p: "р",
  x: "х",
  y: "у",
  κ: "к",
  ο: "о",
  ρ: "р",
  τ: "т",
  Κ: "К",
  Ο: "О",
  Ρ: "Р",
  Τ: "Т",
  Χ: "Х",
  Β: "В",
  Α: "А",
  Ε: "Е",
  Η: "Н",
  Μ: "М",
};
const TO_LAT: Record<string, string> = Object.fromEntries(
  Object.entries(TO_CYR)
    .filter(([k]) => /[a-z]/i.test(k))
    .map(([k, v]) => [v, k]),
);

const scriptOf = (ch: string) =>
  /[а-яё]/i.test(ch)
    ? "cyr"
    : /[a-z]/i.test(ch)
      ? "lat"
      : /[α-ωΑ-Ω]/.test(ch)
        ? "grk"
        : "";

const decodePiece = (s: string, glyphs?: Map<string, string[]>) => {
  const chars = [...s];
  // Для каждого знака — подходящие буквы
  const options: string[][] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "\n" || c === "\t") {
      options.push([c]);
      continue;
    }
    // Обычный пробел в битом шрифте двулик. Настоящий пробел такого
    // шрифта записан кодом 3, а код 32 — это знак «=». Но просмотрщик
    // и сам вставляет пробелы между кусками текста. Отличаем так:
    // «=» в формулах набирают с пробелами по обе стороны
    if (c === " ") {
      options.push([
        chars[i - 1] === "\u0003" && chars[i + 1] === "\u0003" ? "=" : " ",
      ]);
      continue;
    }
    const u = c.codePointAt(0) || 0;
    const std = u < STD_GLYPHS.length ? STD_GLYPHS[u] : "";
    const got = std && std !== "\u0000" ? [std] : glyphs?.get(c);
    if (!got?.length) return null;
    options.push(got);
  }

  // Похожие буквы разных алфавитов выбираем по слову: в русском слове —
  // русскую. Алфавит слова решают буквы, опознанные без сомнений
  let out = "";
  let start = 0;

  // Алфавит всего кусочка — для коротких слов вроде инициалов «В.»,
  // где своих надёжных букв нет
  const pieceVotes = new Map<string, number>();
  for (const opt of options) {
    const sc = opt.length === 1 ? scriptOf(opt[0]) : "";
    if (sc) pieceVotes.set(sc, (pieceVotes.get(sc) || 0) + 1);
  }
  let pieceMain = "";
  let pieceMost = 0;
  for (const [sc, n] of pieceVotes)
    if (n > pieceMost) [pieceMain, pieceMost] = [sc, n];

  const flushWord = (end: number) => {
    const votes = new Map<string, number>();
    for (let k = start; k < end; k++) {
      if (options[k].length !== 1) continue;
      const sc = scriptOf(options[k][0]);
      if (sc) votes.set(sc, (votes.get(sc) || 0) + 1);
    }
    let main = "";
    let most = 0;
    for (const [sc, n] of votes) if (n > most) [main, most] = [sc, n];
    if (!main) main = pieceMain;
    // Слово целиком из двойников («В.К.» по рисунку — латинские B и K):
    // верим алфавиту всего кусочка, а не случайному выбору по рисунку
    if (main !== pieceMain && pieceMain && most <= 2) {
      let alsoFits = true;
      for (let k = start; k < end; k++) {
        const opt = options[k];
        const sc = scriptOf(opt[0]);
        if (
          sc &&
          sc !== pieceMain &&
          !opt.some((x) => scriptOf(x) === pieceMain) &&
          !(pieceMain === "cyr" ? TO_CYR[opt[0]] : TO_LAT[opt[0]])
        )
          alsoFits = false;
      }
      if (alsoFits) main = pieceMain;
    }
    for (let k = start; k < end; k++) {
      const opt = options[k];
      let ch = (main && opt.find((x) => scriptOf(x) === main)) || opt[0];
      if (main === "cyr" && TO_CYR[ch]) ch = TO_CYR[ch];
      else if (main === "lat" && TO_LAT[ch]) ch = TO_LAT[ch];
      out += ch;
    }
  };
  for (let k = 0; k < options.length; k++) {
    if (/\s/.test(options[k][0])) {
      flushWord(k);
      out += options[k][0];
      start = k + 1;
    }
  }
  flushWord(options.length);
  return out;
};

export const repairPieces = async (
  source: TextPiece[],
  read: (box: BrokenRun["box"]) => Promise<string>,
  glyphs?: Map<string, Map<string, string[]>>,
): Promise<TextPiece[]> => {
  // Сначала расшифровываем всё, что можно расшифровать точно, без
  // распознавания картинки. Такие кусочки дальше считаются исправными
  const fontsBefore = brokenFonts(source);
  const pieces = source.map((p) => {
    if (!isBroken(p, fontsBefore)) return p;
    const text = decodePiece(p.str, p.font ? glyphs?.get(p.font) : undefined);
    return text === null
      ? p
      : { ...p, str: text, font: `${p.font || ""}#fixed` };
  });

  const runs = findBrokenRuns(pieces);
  const fonts = brokenFonts(pieces);

  const replaced = new Set<number>();
  const fresh: TextPiece[] = [];

  for (const run of runs) {
    const text = (await read(run.box).catch(() => ""))
      .replace(/\s+/g, " ")
      .replace(/[|]/g, "")
      .trim();
    if (!text) continue;

    for (const i of run.indices) replaced.add(i);

    // Высоту и строку берём у самого крупного куска: индексы сидят ниже,
    // а строка должна остаться на своём месте
    const main = run.indices.reduce((a, b) =>
      pieces[b].h > pieces[a].h ? b : a,
    );
    fresh.push({
      str: text,
      x: run.box.x,
      y: pieces[main].y,
      w: run.box.w,
      h: pieces[main].h,
      angle: 0,
      font: "ocr",
    });
  }

  const out: TextPiece[] = [];
  pieces.forEach((p, i) => {
    if (replaced.has(i)) return;
    const str = stripJunk(p, fonts);
    if (str.trim() || !inkCount(p.str))
      out.push(str === p.str ? p : { ...p, str });
  });
  return [...out, ...fresh];
};

// Вырезка места со страницы для чтения. Вокруг добавляем белые поля:
// движок распознавания плохо читает текст, прижатый к самому краю
export const cropBox = (page: HTMLCanvasElement, box: BrokenRun["box"]) => {
  const W = page.width;
  const H = page.height;
  const hPx = box.h * H;

  // Снизу запас на хвосты букв и индексы, сбоку — совсем чуть-чуть,
  // чтобы не зацепить соседнюю букву
  const x0 = Math.max(0, Math.floor(box.x * W - hPx * 0.08));
  const x1 = Math.min(W, Math.ceil((box.x + box.w) * W + hPx * 0.08));
  const y0 = Math.max(0, Math.floor(box.y * H - hPx * 0.12));
  const y1 = Math.min(H, Math.ceil((box.y + box.h) * H + hPx * 0.3));

  const pad = Math.max(12, Math.round(hPx * 0.6));
  const out = document.createElement("canvas");
  out.width = x1 - x0 + pad * 2;
  out.height = y1 - y0 + pad * 2;

  const ctx = out.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(page, x0, y0, x1 - x0, y1 - y0, pad, pad, x1 - x0, y1 - y0);
  return out;
};
