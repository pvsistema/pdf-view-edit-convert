// Книга Excel из PDF, сохранённого из Word, — с обликом исходника.
//
// Раньше в Excel уходили просто строки текста: таблица из документа
// превращалась в столбец строк, объединённые ячейки разваливались,
// заливка и рамки пропадали. Здесь каждая страница становится листом
// книги, а таблицы собираются по точной разметке страницы:
// - столбцы — те же, что в документе, той же ширины. Если на листе
//   несколько таблиц с разными столбцами, сетка листа общая для всех,
//   а ячейки таблиц объединяются по ней;
// - объединённые ячейки — объединены и в Excel, по горизонтали и вертикали;
// - заливка, рамки нужной толщины, выравнивание, высота строк;
// - шрифт, размер, жирный, курсив, подчёркивание — у каждого куска текста;
// - числа — числами, чтобы по ним сразу считались суммы;
// - текст между таблицами — строкой во всю ширину листа;
// - поля и ориентация листа для печати — как в документе.

import { zipFiles } from '@/lib/zip';
import type { RichPage, RPara, RRun, RTable } from '@/lib/pdfToDocx';

const esc = (t: string) =>
  t
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const colName = (n: number) => {
  let out = '';
  let i = n;
  do {
    out = String.fromCharCode(65 + (i % 26)) + out;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return out;
};

// Число — только то, что в русском документе однозначно число: цифры,
// пробелы между разрядами и запятая перед дробной частью. «30.09»,
// «01.10.2026», «007», «1.» остаются текстом: это даты, коды и номера,
// Excel бы их исказил
const numberOf = (s: string) => {
  const t = s.trim();
  if (!/^-?\d{1,3}([ \u00a0]\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(t)) return null;
  const plain = t.replace(/[ \u00a0]/g, '');
  if (/^-?0\d/.test(plain)) return null;
  const v = Number(plain.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

// Формат числа по его записи: «1 250 000,50» → разряды и два знака.
// Excel в русской версии сам покажет пробел и запятую
const fmtOf = (s: string) => {
  const t = s.trim();
  const dec = (t.split(',')[1] || '').length;
  const grouped = /\d[ \u00a0]\d{3}/.test(t);
  if (!grouped && !dec) return undefined;
  return (grouped ? '#,##0' : '0') + (dec ? '.' + '0'.repeat(dec) : '');
};

// Шрифт куска текста
type Look = { font: string; size: number; b: boolean; i: boolean; u: boolean };
// Вид ячейки — всё, что Excel хранит в стиле
type Style = {
  look: Look;
  fill?: string;
  bd: { l: number; r: number; t: number; b: number };
  h: 'left' | 'center' | 'right' | 'justify';
  v: 'top' | 'center' | 'bottom';
  // Вид числа: как записано в документе — с пробелами между разрядами
  // и нужным числом знаков после запятой
  fmt?: string;
};

// Толщина линии в пунктах → вид рамки Excel
const edge = (pt: number) => (!pt ? '' : pt <= 0.8 ? 'thin' : pt <= 1.8 ? 'medium' : 'thick');

// Реестр стилей книги: одинаковые виды ячеек хранятся один раз
class Styles {
  fonts: string[] = ['<font><sz val="11"/><name val="Calibri"/></font>'];
  fills: string[] = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ];
  borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  fmts: string[] = [];
  private idx = new Map<string, number>();

  // Свои форматы чисел в Excel нумеруются со 164
  fmt(code: string) {
    let k = this.fmts.indexOf(code);
    if (k < 0) k = this.fmts.push(code) - 1;
    return 164 + k;
  }

  private put(list: string[], xml: string) {
    const k = `${list === this.fonts ? 'f' : list === this.fills ? 'l' : list === this.borders ? 'b' : 'x'}${xml}`;
    const got = this.idx.get(k);
    if (got !== undefined) return got;
    list.push(xml);
    this.idx.set(k, list.length - 1);
    return list.length - 1;
  }

  font(l: Look) {
    return this.put(
      this.fonts,
      `<font>${l.b ? '<b/>' : ''}${l.i ? '<i/>' : ''}${l.u ? '<u/>' : ''}<sz val="${l.size}"/><name val="${esc(l.font)}"/></font>`,
    );
  }

  xf(s: Style) {
    const fontId = this.font(s.look);
    const fillId = s.fill
      ? this.put(
          this.fills,
          `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`,
        )
      : 0;
    const side = (tag: string, pt: number) =>
      edge(pt) ? `<${tag} style="${edge(pt)}"><color rgb="FF000000"/></${tag}>` : `<${tag}/>`;
    const borderId = this.put(
      this.borders,
      `<border>${side('left', s.bd.l)}${side('right', s.bd.r)}${side('top', s.bd.t)}${side('bottom', s.bd.b)}<diagonal/></border>`,
    );
    return this.put(
      this.xfs,
      `<xf numFmtId="${s.fmt ? this.fmt(s.fmt) : 0}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${s.h}" vertical="${s.v}" wrapText="1"/></xf>`,
    );
  }

  xml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${
      this.fmts.length
        ? `<numFmts count="${this.fmts.length}">${this.fmts.map((f, k) => `<numFmt numFmtId="${164 + k}" formatCode="${esc(f)}"/>`).join('')}</numFmts>`
        : ''
    }<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join('')}</fills><borders count="${this.borders.length}">${this.borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

// Текст ячейки по кускам одного вида. Табуляция в ячейке Excel не
// показывается — ставим пробел; абзацы ячейки — с новой строки
type Piece = { t: string; look: Look };
const piecesOf = (paras: RPara[], pg: RichPage): Piece[] => {
  const out: Piece[] = [];
  paras.forEach((p, k) => {
    if (k && out.length) out[out.length - 1].t += '\n';
    for (const r of p.runs as RRun[]) {
      const look: Look = {
        font: r.font || pg.font,
        size: Math.round((r.size || pg.size) * 2) / 2,
        b: 't' in r && !!r.b,
        i: 't' in r && !!r.i,
        u: !!r.u,
      };
      const t = 't' in r ? r.t : ' ';
      const last = out[out.length - 1];
      if (last && JSON.stringify(last.look) === JSON.stringify(look)) last.t += t;
      else out.push({ t, look });
    }
  });
  // Пустой абзац в конце ячейки давал лишний перенос строки
  const last = out[out.length - 1];
  if (last) last.t = last.t.replace(/\s+$/, '');
  return out.filter((q) => q.t);
};

type Put = { r: number; c: number; xf: number; body: string; num?: number };

// Высота абзаца в пунктах: просвет перед ним и его строки. Excel
// набирает текст чуть шире, чем Word, поэтому даём небольшой запас,
// чтобы последняя строка не обрезалась
const paraHeight = (p: RPara) => {
  const q = p as RPara & { _top?: number; _bottom?: number };
  const lines = q._top !== undefined && q._bottom !== undefined ? q._bottom - q._top : p.line;
  return Math.max(3, p.before + lines * 1.12);
};

const sheetOf = (pg: RichPage, st: Styles) => {
  const tables = pg.blocks.filter((b): b is { table: RTable } => 'table' in b).map((b) => b.table);

  // Общая сетка столбцов листа: края текста и границы столбцов всех
  // таблиц. Близкие границы (разница меньше трёх пунктов) — одна
  const left = pg.margins.l;
  const right = pg.W - pg.margins.r;
  const edges: number[] = [left, right];
  for (const t of tables) {
    let x = t.indent;
    edges.push(x);
    for (const w of t.cols) edges.push((x += w));
  }
  edges.sort((a, b) => a - b);
  const xs: number[] = [];
  for (const e of edges) if (!xs.length || e - xs[xs.length - 1] > 3) xs.push(e);
  const at = (x: number) => {
    let best = 0;
    for (let k = 1; k < xs.length; k++) if (Math.abs(xs[k] - x) < Math.abs(xs[best] - x)) best = k;
    return best;
  };
  const lastCol = Math.max(0, xs.length - 2);

  const puts: Put[] = [];
  const merges: string[] = [];
  const heights = new Map<number, number>();
  let row = 0;

  const baseLook: Look = { font: pg.font, size: pg.size, b: false, i: false, u: false };

  // Ячейка (или объединённый участок) с текстом и видом. У объединённого
  // участка рамка рисуется по его краям, заливка — по всему участку
  const place = (
    r0: number,
    c0: number,
    r1: number,
    c1: number,
    ps: Piece[],
    s: Omit<Style, 'look' | 'bd'>,
    bd: Style['bd'],
  ) => {
    const look = ps[0]?.look || baseLook;
    const whole0 = ps.map((q) => q.t).join('');
    const fmt = ps.length === 1 && numberOf(whole0) !== null ? fmtOf(whole0) : undefined;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const xf = st.xf({
          ...s,
          fmt,
          look,
          bd: { l: c === c0 ? bd.l : 0, r: c === c1 ? bd.r : 0, t: r === r0 ? bd.t : 0, b: r === r1 ? bd.b : 0 },
        });
        if (r !== r0 || c !== c0) {
          puts.push({ r, c, xf, body: '' });
          continue;
        }
        const whole = ps.map((q) => q.t).join('');
        const num = ps.length === 1 ? numberOf(whole) : null;
        if (num !== null) puts.push({ r, c, xf, body: '', num });
        else if (!whole.trim()) puts.push({ r, c, xf, body: '' });
        else {
          // Текст с разными шрифтами внутри — «богатая» строка Excel
          const rich = ps
            .map(
              (q) =>
                `<r><rPr>${q.look.b ? '<b/>' : ''}${q.look.i ? '<i/>' : ''}${q.look.u ? '<u/>' : ''}<sz val="${q.look.size}"/><rFont val="${esc(q.look.font)}"/></rPr><t xml:space="preserve">${esc(q.t)}</t></r>`,
            )
            .join('');
          puts.push({ r, c, xf, body: rich });
        }
      }
    if (r1 > r0 || c1 > c0) merges.push(`${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`);
  };

  for (const b of pg.blocks) {
    if ('p' in b) {
      const p = b.p;
      const ps = piecesOf([p], pg);
      // Абзац между таблицами — во всю ширину листа. Пустой абзац-просвет
      // становится пустой строкой той же высоты
      const h = p.align === 'both' ? 'justify' : p.align;
      const bd = { l: 0, r: 0, t: 0, b: p.border || 0 };
      if (ps.length || p.border) place(row, 0, row, lastCol, ps, { h, v: 'bottom' }, bd);
      heights.set(row, ps.length ? paraHeight(p) : Math.max(2, p.line));
      row++;
      continue;
    }

    // Таблица: ячейки по своим столбцам, объединения по горизонтали —
    // по числу столбцов, по вертикали — по продолжениям снизу
    const t = b.table;
    const start = row;
    const bounds: number[] = [t.indent];
    for (const w of t.cols) bounds.push(bounds[bounds.length - 1] + w);
    // Где в каждой строке стоит ячейка: номер столбца таблицы → ячейка
    const grid = t.rows.map((r) => {
      const m = new Map<number, (typeof r.cells)[number]>();
      let ci = 0;
      for (const c of r.cells) {
        m.set(ci, c);
        ci += c.span;
      }
      return m;
    });
    t.rows.forEach((r, ri) => {
      heights.set(start + ri, Math.max(3, r.h));
      let ci = 0;
      for (const c of r.cells) {
        const c0 = at(bounds[ci]);
        const c1 = Math.max(c0, at(bounds[ci + c.span]) - 1);
        const col = ci;
        ci += c.span;
        if (c.vmerge === 'cont') continue;
        // Сколько строк ниже продолжают эту ячейку
        let r1 = ri;
        while (r1 + 1 < t.rows.length && grid[r1 + 1].get(col)?.vmerge === 'cont' && grid[r1 + 1].get(col)?.span === c.span)
          r1++;
        const lastPart = grid[r1].get(col) || c;
        const ps = piecesOf(c.paras, pg);
        // Выравнивание по горизонтали — как у первого абзаца ячейки
        const al = c.paras[0]?.align || 'left';
        place(
          start + ri,
          c0,
          start + r1,
          c1,
          ps,
          { h: al === 'both' ? 'justify' : al, v: c.valign, fill: c.fill },
          { l: c.borders.l, r: c.borders.r, t: c.borders.t, b: lastPart.borders.b },
        );
      }
    });
    row += t.rows.length;
  }

  // Ширина столбцов: пункты → единицы Excel. Excel меряет ширину числом
  // цифр шрифта книги (Calibri 11: цифра 7 точек, плюс 5 точек полей)
  const widths = xs.slice(1).map((x, k) => {
    const px = ((x - xs[k]) * 96) / 72;
    return Math.max(0.5, Math.round(((px - 5) / 7) * 100) / 100);
  });
  const cols = widths.length
    ? `<cols>${widths.map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';

  const byRow = new Map<number, Put[]>();
  for (const p of puts) (byRow.get(p.r) || byRow.set(p.r, []).get(p.r)!).push(p);
  const rowsXml: string[] = [];
  for (let r = 0; r < row; r++) {
    const cells = (byRow.get(r) || [])
      .sort((a, b) => a.c - b.c)
      .map((p) => {
        const ref = `${colName(p.c)}${r + 1}`;
        if (p.num !== undefined) return `<c r="${ref}" s="${p.xf}"><v>${p.num}</v></c>`;
        if (p.body) return `<c r="${ref}" s="${p.xf}" t="inlineStr"><is>${p.body}</is></c>`;
        return `<c r="${ref}" s="${p.xf}"/>`;
      })
      .join('');
    const h = heights.get(r);
    rowsXml.push(`<row r="${r + 1}"${h ? ` ht="${Math.round(h * 100) / 100}" customHeight="1"` : ''}>${cells}</row>`);
  }

  // Поля и ориентация листа при печати — как у страницы документа
  const inch = (pt: number) => Math.round((pt / 72) * 1000) / 1000;
  const a4 = Math.abs(Math.min(pg.W, pg.H) - 595) < 8 && Math.abs(Math.max(pg.W, pg.H) - 842) < 8;
  const page = `<pageMargins left="${inch(pg.margins.l)}" right="${inch(pg.margins.r)}" top="${inch(pg.margins.t)}" bottom="${inch(pg.margins.b)}" header="0" footer="0"/><pageSetup${a4 ? ' paperSize="9"' : ''} orientation="${pg.W > pg.H ? 'landscape' : 'portrait'}"/>`;

  // Сетку Excel прячем: лист выглядит как страница документа, а рамки
  // таблиц нарисованы свои
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowsXml.join('')}</sheetData>${
    merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''
  }${page}</worksheet>`;
};

export const buildRichXlsx = (pages: RichPage[]) => {
  const st = new Styles();
  const list = pages.length ? pages : [];
  const sheets = list.map((pg) => sheetOf(pg, st));
  const names = list.map((_, i) => `Стр. ${i + 1}`);

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
    .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join(
      '',
    )}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')}</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  return zipFiles([
    { name: '[Content_Types].xml', text: contentTypes },
    { name: '_rels/.rels', text: rels },
    { name: 'xl/workbook.xml', text: workbook },
    { name: 'xl/_rels/workbook.xml.rels', text: wbRels },
    { name: 'xl/styles.xml', text: st.xml() },
    ...sheets.map((text, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text })),
  ]);
};
