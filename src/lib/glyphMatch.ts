// Опознание «битых» букв по их рисунку.
//
// У битого шрифта в файле нет подсказки, какой букве соответствует код,
// но сам рисунок буквы в файле есть — иначе её не было бы видно на листе.
// Мы рисуем каждую такую букву отдельно и сравниваем с эталонными
// буквами того же вида шрифта (Times New Roman для шрифта с засечками,
// Arial — без засечек). Шрифт совпадает по рисунку, поэтому буква
// опознаётся точно — без ошибок, свойственных распознаванию картинки.

// Буквы, среди которых ищем. Кириллица стоит первой: при одинаковом
// рисунке («а» и латинская «a», «о» и «o») в русском документе
// вернее кириллическая буква
const CANDIDATES =
  'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя' +
  'αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ' +
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' +
  '·×≤≥°±√∑∞∂∆−–—…«»„“”‘’‰№§%()[]{}/\\|+=<>.,:;!?*&@#$^_~\'"';

const SIZE = 64;
const GRID = 20;

type Shape = {
  empty: boolean;
  top: number;
  bottom: number;
  width: number;
  grid: Float32Array;
};

let board: HTMLCanvasElement | null = null;

// Рисунок знака: где он стоит относительно строки и как выглядит
const shapeOf = (ch: string, family: string, look = ''): Shape => {
  if (!board) {
    board = document.createElement('canvas');
    board.width = SIZE * 3;
    board.height = SIZE * 2;
  }
  const ctx = board.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, board.width, board.height);
  // Наклон и жирность пишутся ДО размера — иначе браузер отбрасывает
  // всю строку и рисует прежним шрифтом
  ctx.font = `${look ? look + ' ' : ''}${SIZE}px ${family}`;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  const base = Math.round(SIZE * 1.4);
  ctx.fillText(ch, SIZE * 0.5, base);

  const { width: W, height: H } = board;
  const px = ctx.getImageData(0, 0, W, H).data;

  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (px[(y * W + x) * 4 + 3] > 90) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }

  const grid = new Float32Array(GRID * GRID);
  if (x1 < 0) return { empty: true, top: 0, bottom: 0, width: 0, grid };

  // Рисунок сводим к сетке 20×20 внутри своих границ: так сравниваются
  // формы, а не случайные сдвиги на точку-другую
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  for (let gy = 0; gy < GRID; gy++)
    for (let gx = 0; gx < GRID; gx++) {
      const sx0 = x0 + Math.floor((gx * bw) / GRID);
      const sx1 = x0 + Math.max(Math.floor(((gx + 1) * bw) / GRID), Math.floor((gx * bw) / GRID) + 1);
      const sy0 = y0 + Math.floor((gy * bh) / GRID);
      const sy1 = y0 + Math.max(Math.floor(((gy + 1) * bh) / GRID), Math.floor((gy * bh) / GRID) + 1);
      let sum = 0;
      let n = 0;
      for (let y = sy0; y < sy1; y++)
        for (let x = sx0; x < sx1; x++) {
          sum += px[(y * W + x) * 4 + 3];
          n++;
        }
      grid[gy * GRID + gx] = n ? sum / n / 255 : 0;
    }

  return {
    empty: false,
    top: (base - y0) / SIZE,
    bottom: (y1 - base) / SIZE,
    width: bw / SIZE,
    grid,
  };
};

// Непохожесть двух рисунков: разница форм плюс разница положения
// относительно строки — так различаются «о» и «О», «р» и «п»
const distance = (a: Shape, b: Shape) => {
  let d = 0;
  for (let i = 0; i < a.grid.length; i++) d += Math.abs(a.grid[i] - b.grid[i]);
  d /= a.grid.length;
  return d + 1.2 * (Math.abs(a.top - b.top) + Math.abs(a.bottom - b.bottom)) + 0.6 * Math.abs(a.width - b.width);
};

// Эталонные рисунки считаем один раз на вид шрифта
const refCache = new Map<string, { ch: string; shape: Shape }[]>();

const referenceFor = ({ family, look }: { family: string; look: string }) => {
  const key = `${look}|${family}`;
  let ref = refCache.get(key);
  if (!ref) {
    ref = [...CANDIDATES]
      .map((ch) => ({ ch, shape: shapeOf(ch, family, look) }))
      .filter((r) => !r.shape.empty);
    refCache.set(key, ref);
  }
  return ref;
};

// Какой эталонный шрифт подходит к шрифту документа
const referenceFont = (name: string, bold: boolean, italic: boolean) => {
  const sans = /helvetica|arial|sans|proxima|pragmatica|myriad|verdana|tahoma/i.test(name);
  const family = sans
    ? '"Arial", "Liberation Sans", "Helvetica", sans-serif'
    : '"Times New Roman", "Liberation Serif", "Times", serif';
  const b = bold || /bold|black|heavy/i.test(name);
  const i = italic || /italic|oblique/i.test(name);
  return { family, look: `${i ? 'italic ' : ''}${b ? 'bold' : ''}`.trim() };
};

// Порог, выше которого совпадение считаем сомнительным и букву
// оставляем на распознавание картинки
const TRUST = 0.2;

// Опознанные буквы: шрифт документа → (знак из файла → подходящие буквы).
// Первая — самая похожая, дальше — почти столь же похожие из других
// алфавитов: «к» и греческая «κ», «К» и латинская «K». Какую взять,
// решается по соседним буквам слова
export type GlyphMap = Map<string, Map<string, string[]>>;

type Glyph = { unicode?: string; fontChar?: string; isSpace?: boolean };
type FontObj = { loadedName?: string; name?: string; bold?: boolean; italic?: boolean; black?: boolean };

export const matchBrokenGlyphs = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  pageIndex: number,
  fonts: Set<string>,
): Promise<GlyphMap> => {
  const out: GlyphMap = new Map();
  if (!fonts.size || typeof document === 'undefined') return out;

  const page = await doc.getPage(pageIndex + 1);
  const { OPS } = await import('pdfjs-dist');
  const list = await page.getOperatorList();

  // Какие знаки каждого битого шрифта встречаются на странице
  const wanted = new Map<string, Map<string, string>>();
  let current = '';
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    if (fn === OPS.setFont) current = String(args[0]);
    else if (fn === OPS.showText && fonts.has(current)) {
      const seen = wanted.get(current) || new Map<string, string>();
      for (const g of args[0] as (Glyph | number | null)[]) {
        if (!g || typeof g !== 'object' || !g.unicode || !g.fontChar) continue;
        if (!seen.has(g.unicode)) seen.set(g.unicode, g.fontChar);
      }
      wanted.set(current, seen);
    }
  }

  for (const [id, chars] of wanted) {
    const font = await new Promise<FontObj | null>((resolve) => {
      try {
        page.commonObjs.get(id, (f: FontObj) => resolve(f));
      } catch {
        resolve(null);
      }
      setTimeout(() => resolve(null), 3000);
    });
    if (!font?.loadedName) continue;

    await document.fonts.load(`${SIZE}px "${font.loadedName}"`).catch(() => undefined);

    const ref = referenceFor(referenceFont(font.name || '', !!(font.bold || font.black), !!font.italic));
    await document.fonts.ready;

    const map = new Map<string, string[]>();
    for (const [code, fontChar] of chars) {
      const shape = shapeOf(fontChar, `"${font.loadedName}"`);
      if (shape.empty) {
        map.set(code, [' ']);
        continue;
      }
      const scored = ref
        .map((r) => ({ ch: r.ch, d: distance(shape, r.shape) }))
        .sort((x, y) => x.d - y.d);
      const best = scored[0];
      // Ближайший знак другого рисунка. Одинаковые по виду буквы
      // (русская «о» и латинская «o») соперниками не считаются
      const rival = scored.find((x) => x.d - best.d > 0.005);
      const margin = rival ? rival.d - best.d : 1;
      // Верим совпадению, если оно очень близкое — или просто близкое,
      // но заметно лучше любого другого знака (так узнаётся курсивная ξ,
      // рисунок которой у разных шрифтов немного разный)
      // «ξ» и «ζ» почти одинаковы по рисунку и путаются, когда эталонный
      // курсив отличается от курсива документа. В технических текстах
      // коэффициент сопротивления обозначают «ξ», поэтому при близком
      // споре этих двух выбираем её
      if (best && (best.ch === 'ζ' || best.ch === 'ξ')) {
        const xi = scored.find((x) => x.ch === 'ξ');
        const zeta = scored.find((x) => x.ch === 'ζ');
        if (xi && zeta && Math.abs(xi.d - zeta.d) < 0.03 && xi.d < 0.32) {
          map.set(code, ['ξ']);
          continue;
        }
      }
      if (best && (best.d < TRUST || (best.d < 0.32 && margin > 0.035))) {
        const near = scored.filter((x) => x.d - best.d < 0.09).map((x) => x.ch);
        map.set(code, [...new Set(near)]);
      }
    }
    out.set(id, map);
  }

  try {
    page.cleanup();
  } catch {
    /* страница уже освобождена */
  }
  return out;
};
