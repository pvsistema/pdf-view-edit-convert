// Оформление страницы PDF, сохранённой из Word: шрифты, линии, таблицы,
// заливки, картинки.
//
// Раньше из такого файла брался только текст — и в Word получалась
// сплошная лента строк: без жирного, без размеров, без таблиц, без
// картинок. А ведь в PDF, сохранённом из Word, всё это записано точно:
// у каждого кусочка текста есть шрифт, у таблицы — нарисованные линии,
// у картинки — место на листе. Здесь всё это снимается со страницы.
//
// Все размеры — в пунктах, от левого верхнего угла листа.

export type PdfFont = { family: string; bold: boolean; italic: boolean };

export type HLine = { x0: number; x1: number; y: number; t: number };
export type VLine = { y0: number; y1: number; x: number; t: number };
export type Fill = { x0: number; y0: number; x1: number; y1: number; color: string };
export type PdfImage = { x0: number; y0: number; x1: number; y1: number; png: Uint8Array | null };

export type Decor = {
  W: number;
  H: number;
  fonts: Record<string, PdfFont>;
  hlines: HLine[];
  vlines: VLine[];
  fills: Fill[];
  images: PdfImage[];
};

type Mat = number[];

const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m: Mat, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// Имя шрифта в PDF — «ABCDEF+TimesNewRomanPS-BoldItalicMT». Приводим к
// названию, которое знает Word: «Times New Roman», жирный, курсив
export const fontOf = (raw: string): PdfFont => {
  const name = (raw || '').replace(/^[A-Z]{6}\+/, '');
  const bold = /bold|black|heavy|semibold|demibold|,bold/i.test(name);
  const italic = /italic|oblique|,italic/i.test(name);
  let fam = name
    .replace(/[-,](bold|italic|oblique|regular|roman|book|medium|light|semibold|black|heavy|demi)+.*$/i, '')
    .replace(/(PSMT|PS|MT)$/, '')
    .replace(/[-_]/g, ' ');
  // «TimesNewRoman» → «Times New Roman»
  if (!/\s/.test(fam)) fam = fam.replace(/([a-z])([A-Z])/g, '$1 $2');
  const known: Record<string, string> = {
    'times new roman': 'Times New Roman',
    times: 'Times New Roman',
    arial: 'Arial',
    helvetica: 'Arial',
    calibri: 'Calibri',
    cambria: 'Cambria',
    'courier new': 'Courier New',
    courier: 'Courier New',
    verdana: 'Verdana',
    tahoma: 'Tahoma',
    georgia: 'Georgia',
    'book antiqua': 'Book Antiqua',
    garamond: 'Garamond',
    'segoe ui': 'Segoe UI',
    'pt sans': 'PT Sans',
    'pt serif': 'PT Serif',
    'noto serif': 'Noto Serif',
    'noto sans': 'Noto Sans',
    'liberation serif': 'Times New Roman',
    'liberation sans': 'Arial',
  };
  const key = fam.trim().toLowerCase();
  return { family: known[key] || fam.trim() || 'Times New Roman', bold, italic };
};

const hex = (r: number, g: number, b: number) =>
  [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();

// Коды операций рисования. Берём из самого движка, чтобы не зависеть
// от его версии
type Lib = { OPS: Record<string, number> };

// Снимает оформление со страницы. page — страница движка PDF, vt —
// преобразование листа (поворот и переворот оси), crop — вырезка куска
// отрисованного листа в картинку (для рисунков)
export const readDecor = async (
  page: any,
  vt: Mat,
  W: number,
  H: number,
  lib: Lib,
  crop?: (b: { x0: number; y0: number; x1: number; y1: number }) => Promise<Uint8Array | null>,
): Promise<Decor> => {
  const O = lib.OPS;
  const list = await page.getOperatorList();

  // Шрифты: в PDF у каждого шрифта есть настоящее имя — по нему видно,
  // жирный он или курсив, и как он называется в Word
  const fonts: Record<string, PdfFont> = {};
  const seen = new Set<string>();
  for (let i = 0; i < list.fnArray.length; i++)
    if (list.fnArray[i] === O.setFont) seen.add(list.argsArray[i][0]);
  for (const id of seen) {
    try {
      const f = page.commonObjs.has(id) ? page.commonObjs.get(id) : null;
      if (f) fonts[id] = fontOf(f.name || f.loadedName || '');
    } catch {
      /* шрифт ещё не загружен — останется обычным */
    }
  }

  const hlines: HLine[] = [];
  const vlines: VLine[] = [];
  const fills: Fill[] = [];
  const imgBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];

  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  let lw = 1;
  let fill = 'FFFFFF';
  const stack: { ctm: Mat; lw: number; fill: string }[] = [];
  type Sub = { pts: number[][]; closed: boolean; rect: boolean; curve: boolean };
  let path: Sub[] = [];

  // Точка в координатах листа (в пунктах, ось вниз)
  const toPage = (x: number, y: number) => apply(mul(vt, ctm), x, y);
  const scaleOf = () => {
    const m = mul(vt, ctm);
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  };

  const addPath = (ops: number[], coords: number[]) => {
    let k = 0;
    let cur: Sub | null = null;
    for (const op of ops) {
      if (op === O.moveTo) {
        cur = { pts: [toPage(coords[k], coords[k + 1])], closed: false, rect: false, curve: false };
        path.push(cur);
        k += 2;
      } else if (op === O.lineTo) {
        if (!cur) {
          cur = { pts: [], closed: false, rect: false, curve: false };
          path.push(cur);
        }
        cur.pts.push(toPage(coords[k], coords[k + 1]));
        k += 2;
      } else if (op === O.curveTo) {
        if (cur) {
          cur.curve = true;
          cur.pts.push(toPage(coords[k + 4], coords[k + 5]));
        }
        k += 6;
      } else if (op === O.curveTo2 || op === O.curveTo3) {
        if (cur) {
          cur.curve = true;
          cur.pts.push(toPage(coords[k + 2], coords[k + 3]));
        }
        k += 4;
      } else if (op === O.closePath) {
        if (cur) cur.closed = true;
      } else if (op === O.rectangle) {
        const [x, y, w, h] = coords.slice(k, k + 4);
        path.push({
          pts: [toPage(x, y), toPage(x + w, y), toPage(x + w, y + h), toPage(x, y + h)],
          closed: true,
          rect: true,
          curve: false,
        });
        k += 4;
      }
    }
  };

  // Прямоугольник, выровненный по осям листа
  const boxOf = (s: Sub) => {
    const xs = s.pts.map((p) => p[0]);
    const ys = s.pts.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  const axisBox = (s: Sub) => {
    if (s.curve || s.pts.length < 4 || s.pts.length > 5) return false;
    return s.pts.every((p, i) => {
      const q = s.pts[(i + 1) % 4];
      return Math.abs(p[0] - q[0]) < 0.5 || Math.abs(p[1] - q[1]) < 0.5;
    });
  };

  const paint = (stroke: boolean, doFill: boolean) => {
    const t = Math.max(0.25, lw * scaleOf());
    for (const s of path) {
      if (s.curve) continue;
      if (doFill && (s.rect || axisBox(s))) {
        const b = boxOf(s);
        const bw = b.x1 - b.x0;
        const bh = b.y1 - b.y0;
        // Тонкий залитый прямоугольник — это линия. Так Word рисует
        // границы таблиц и подчёркивания
        if (bh <= 2.5 && bw > 2) hlines.push({ x0: b.x0, x1: b.x1, y: (b.y0 + b.y1) / 2, t: Math.max(0.25, bh) });
        else if (bw <= 2.5 && bh > 2) vlines.push({ y0: b.y0, y1: b.y1, x: (b.x0 + b.x1) / 2, t: Math.max(0.25, bw) });
        else if (bw > 2 && bh > 2 && fill !== 'FFFFFF') fills.push({ ...b, color: fill });
      }
      if (stroke) {
        const pts = s.closed ? [...s.pts, s.pts[0]] : s.pts;
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1];
          const [bx, by] = pts[i];
          if (Math.abs(ay - by) < 0.6 && Math.abs(ax - bx) > 2)
            hlines.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y: (ay + by) / 2, t });
          else if (Math.abs(ax - bx) < 0.6 && Math.abs(ay - by) > 2)
            vlines.push({ y0: Math.min(ay, by), y1: Math.max(ay, by), x: (ax + bx) / 2, t });
        }
      }
    }
    path = [];
  };

  const unitBox = () => {
    const pts = [toPage(0, 0), toPage(1, 0), toPage(1, 1), toPage(0, 1)];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const a = list.argsArray[i];
    if (fn === O.save) stack.push({ ctm, lw, fill });
    else if (fn === O.restore) {
      const s = stack.pop();
      if (s) ({ ctm, lw, fill } = s);
    } else if (fn === O.transform) ctm = mul(ctm, a);
    else if (fn === O.paintFormXObjectBegin) {
      stack.push({ ctm, lw, fill });
      if (Array.isArray(a?.[0]) && a[0].length === 6) ctm = mul(ctm, a[0]);
    } else if (fn === O.paintFormXObjectEnd) {
      const s = stack.pop();
      if (s) ({ ctm, lw, fill } = s);
    } else if (fn === O.setLineWidth) lw = a[0];
    else if (fn === O.setFillRGBColor) fill = hex(a[0], a[1], a[2]);
    else if (fn === O.setFillGray) fill = hex(a[0] * 255, a[0] * 255, a[0] * 255);
    else if (fn === O.constructPath) addPath(a[0], a[1]);
    else if (fn === O.stroke || fn === O.closeStroke) paint(true, false);
    else if (fn === O.fill || fn === O.eoFill) paint(false, true);
    else if (
      fn === O.fillStroke ||
      fn === O.eoFillStroke ||
      fn === O.closeFillStroke ||
      fn === O.closeEOFillStroke
    )
      paint(true, true);
    else if (fn === O.endPath) path = [];
    else if (
      fn === O.paintImageXObject ||
      fn === O.paintInlineImageXObject ||
      fn === O.paintImageMaskXObject ||
      fn === O.paintImageXObjectRepeat
    )
      imgBoxes.push(unitBox());
  }

  // Картинки. Совсем мелкие — точки и значки — пропускаем. Картинка на
  // весь лист — это скан с текстовым слоем: её не вырезаем, текст важнее
  const images: PdfImage[] = [];
  for (const b of imgBoxes) {
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    if (w < 6 || h < 6) continue;
    if (w * h > W * H * 0.6) continue;
    const x0 = Math.max(0, b.x0);
    const y0 = Math.max(0, b.y0);
    const x1 = Math.min(W, b.x1);
    const y1 = Math.min(H, b.y1);
    if (x1 - x0 < 4 || y1 - y0 < 4) continue;
    // Одна и та же картинка, нарисованная дважды, — одна
    if (images.some((q) => Math.abs(q.x0 - x0) < 1 && Math.abs(q.y0 - y0) < 1 && Math.abs(q.x1 - x1) < 1)) continue;
    images.push({ x0, y0, x1, y1, png: null });
  }
  if (crop) for (const im of images) im.png = await crop(im).catch(() => null);

  return { W, H, fonts, hlines, vlines, fills, images };
};
