// Сборка настоящего документа Word (.docx).
//
// Раньше «файл Word» был обычной веб-страницей с подменённым расширением.
// Word такие файлы открывает с предупреждением о повреждении, а иногда
// отказывается вовсе — отсюда жалобы, что распознанное не открывается.
// Здесь собирается честный .docx, который Word считает своим.
//
// Внутри .docx — это архив ZIP с несколькими служебными файлами.
// Сборка архива общая с книгой Excel — она лежит отдельно.

import { zip } from '@/lib/zip';
import type { FloatImage, PartImage, Seg } from '@/lib/ocrLayout';
import type { RAnchor, RichPage, RPara, RRun, RTable } from '@/lib/pdfToDocx';

const enc = (s: string) => new TextEncoder().encode(s);

// Подготовка текста к записи в документ.
//
// Распознавание сканов порой возвращает служебные невидимые знаки — остатки
// разбора картинки. На бумаге им ничего не соответствует, но Word такой
// файл открыть не может и объявляет его повреждённым. Поэтому сначала
// убираем эти знаки, и только потом экранируем обычные символы
const esc = (t: string) =>
  t
    // Служебные знаки, недопустимые в документе. Перевод строки,
    // возврат каретки и табуляцию оставляем — они осмысленные
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

// Абзац текста. Пустая строка тоже становится абзацем —
// так сохраняются отступы между частями документа
const para = (line: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`;

// Картинки документа копятся здесь при сборке и потом кладутся в архив
type Media = { name: string; png: Uint8Array; id: string };

// Картинка в строке: герб, рукописная дата, подпись, печать. Размер —
// как на бумаге, в EMU (так Word меряет рисунки: 12700 на пункт)
const drawing = (img: PartImage, media: Media[]) => {
  const n = media.length + 1;
  const id = `rIdImg${n}`;
  media.push({ name: `image${n}.png`, png: img.png, id });
  const cx = Math.max(1, Math.round(img.w * 12700));
  const cy = Math.max(1, Math.round(img.h * 12700));
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Рисунок ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
};

// Печать или подпись поверх текста. Картинка «плавает»: не сдвигает
// строки и лежит над ними на том же месте, что на бумаге. По горизонтали
// место считается от левого поля, по вертикали — от строки абзаца,
// к которому она привязана. Фон у картинки прозрачный, поэтому текст
// под печатью виден, как на настоящем документе
const floating = (img: FloatImage, media: Media[]) => {
  const n = media.length + 1;
  const id = `rIdImg${n}`;
  media.push({ name: `image${n}.png`, png: img.png, id });
  const emu = (pt: number) => Math.round(pt * 12700);
  const cx = Math.max(1, emu(img.w));
  const cy = Math.max(1, emu(img.h));
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251658240 + n}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:posOffset>${emu(img.dx)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="line"><wp:posOffset>${emu(img.dy)}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${n}" name="Печать ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
};

// Черта под абзацем — граница абзаца снизу, как её рисует сам Word
const BOTTOM_RULE = '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="000000"/></w:pBdr>';

// Абзац распознанного документа — с сохранением облика исходника.
// Заголовок остаётся заголовком, текст по центру — по центру,
// жирное — жирным. Так распознанное в Word похоже на бумагу,
// а не на сплошную ленту строк
const richPara = (p: DocxPart, media: Media[]) => {
  const look: string[] = [];

  // Самостоятельная черта-разделитель — пустой абзац с границей снизу
  if (p.rule) {
    const before = p.before ?? 0;
    return `<w:p><w:pPr>${BOTTOM_RULE}<w:spacing w:before="${before}" w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>`;
  }

  // Позиции табуляции: так строка бланка «Фамилия …… 00294» ложится
  // в Word на те же места, что и на бумаге. У пункта списка — одна
  // табуляция, от номера к тексту
  const tabs = p.listTab
    ? [{ pos: p.listTab }]
    : p.tabs || [];
  if (tabs.length)
    look.push(
      `<w:tabs>${tabs.map((t) => `<w:tab w:val="${'right' in t && t.right ? 'right' : 'left'}" w:pos="${t.pos}"/>`).join('')}</w:tabs>`,
    );
  if (p.ruleAfter) look.push(BOTTOM_RULE);

  // Разметка, снятая с листа, несёт точный просвет перед строкой.
  // У старой разметки его нет — тогда прежние отступы
  const exact = p.before !== undefined || p.size !== undefined;
  const before = p.before ?? (p.heading ? 240 : 0);
  const after = exact ? 0 : 120;
  look.push(
    `<w:spacing w:before="${before}" w:after="${after}"${exact ? ' w:line="240" w:lineRule="auto"' : ''}/>`,
  );
  // Отступ слева и красная строка. Отрицательная красная строка —
  // выступ: номер пункта левее текста под ним
  const fl = p.firstLine ?? 0;
  if (p.indent || fl) {
    const firstAttr = fl > 0 ? ` w:firstLine="${fl}"` : fl < 0 ? ` w:hanging="${-fl}"` : '';
    // Выступ не может быть больше отступа слева — Word уводит строку
    // за поле. Недостающее добавляем к отступу
    const leftTw = Math.max(p.indent || 0, fl < 0 ? -fl : 0);
    look.push(`<w:ind w:left="${leftTw}"${firstAttr}/>`);
  }
  if (p.align !== 'left') look.push(`<w:jc w:val="${p.align}"/>`);

  const font: string[] = [];
  if (p.bold || (p.heading && !exact)) font.push('<w:b/>');
  if (p.italic) font.push('<w:i/>');
  // Разрядка: буквы раздвинуты на пробел, как «п р и к а з ы в а ю»
  if (p.spaced) font.push('<w:spacing w:val="60"/>');
  // Размер шрифта: как на бумаге, если он известен; иначе заголовок —
  // 14 пунктов против 12
  const half = p.size ? Math.round(p.size * 2) : p.heading ? 28 : 0;
  if (half) font.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`);

  const rPrOf = (u?: boolean) => {
    const f = u ? [...font, '<w:u w:val="single"/>'] : font;
    return f.length ? `<w:rPr>${f.join('')}</w:rPr>` : '';
  };

  // Знак табуляции в тексте — настоящая табуляция Word
  const textRuns = (t: string, u?: boolean) => {
    const rPr = rPrOf(u);
    return t
      .split('\t')
      .map(
        (piece, i) =>
          `${i ? `<w:r>${rPrOf()}<w:tab/></w:r>` : ''}${piece ? `<w:r>${rPr}<w:t xml:space="preserve">${esc(piece)}</w:t></w:r>` : ''}`,
      )
      .join('');
  };

  let runs: string;
  if (p.image) {
    // Отдельный рисунок: отступ слева — как на бумаге
    if (p.align === 'left' && p.image.x > 60) look.push(`<w:ind w:left="${p.image.x}"/>`);
    runs = drawing(p.image, media);
  } else if (p.segs?.length) {
    runs = p.segs.map((sg) => ('img' in sg ? drawing(sg.img, media) : textRuns(sg.t, sg.u))).join('');
  } else runs = textRuns(p.text);

  // Печати и подписи этого абзаца — в начале, поверх текста
  const floats = (p.floats || []).map((f) => floating(f, media)).join('');

  return `<w:p><w:pPr>${look.join('')}</w:pPr>${floats}${runs}</w:p>`;
};

// Подпись с номером листа: помельче и серым, как колонтитул
const pageMark = (no: number) =>
  `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="808080"/></w:rPr><w:t>Стр. ${no}</w:t></w:r></w:p>`;

const pageBreak = () => `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

export type DocxPart = {
  text: string;
  heading: boolean;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right' | 'both';
  firstLine?: number;
  listTab?: number;
  segs?: Seg[];
  ruleAfter?: boolean;
  rule?: boolean;
  spaced?: boolean;
  image?: PartImage;
  floats?: FloatImage[];
  // Таблица: строки, в каждой — ячейки. Если поле заполнено,
  // кусок ложится в Word настоящей таблицей, а не текстом
  table?: string[][];
  size?: number;
  indent?: number;
  tabs?: { pos: number; right?: boolean }[];
  before?: number;
};

// Ширина листа за вычетом полей — в тех единицах, которыми меряет Word.
// По ней столбцы таблицы растягиваются на всю ширину текста
const TABLE_WIDTH = 9355;

// Ячейка таблицы. Первая строка идёт заголовком: жирная и с заливкой,
// как в деловых бумагах
const cell = (text: string, width: number, head: boolean) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${
    head ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''
  }<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r>${
    head ? '<w:rPr><w:b/></w:rPr>' : ''
  }<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:tc>`;

// Таблица целиком: с видимыми границами, как её рисуют в документах
const table = (rows: string[][]) => {
  const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  if (!cols) return '';

  const width = Math.floor(TABLE_WIDTH / cols);

  const line = 'w:val="single" w:sz="4" w:space="0" w:color="999999"';
  const borders = `<w:tblBorders><w:top ${line}/><w:left ${line}/><w:bottom ${line}/><w:right ${line}/><w:insideH ${line}/><w:insideV ${line}/></w:tblBorders>`;

  const body = rows
    .map((r, i) => {
      // Недостающие ячейки дополняем пустыми: в Word все строки
      // таблицы должны быть одной длины, иначе файл считается битым
      const cells = Array.from({ length: cols }, (_, c) => cell(r[c] ?? '', width, i === 0));
      return `<w:tr>${cells.join('')}</w:tr>`;
    })
    .join('');

  // Опись столбцов обязательна: без неё Word считает таблицу
  // повреждённой и отказывается её показывать
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join(
    '',
  )}</w:tblGrid>`;

  return `<w:tbl><w:tblPr><w:tblW w:w="${TABLE_WIDTH}" w:type="dxa"/>${borders}</w:tblPr>${grid}${body}</w:tbl><w:p/>`;
};

export type DocxPage = { no: number; text: string; parts?: DocxPart[] };

// Сборка документа. Каждая страница исходника ложится на отдельный лист
export const buildDocx = (pages: DocxPage[], withMarks: boolean) => {
  const body: string[] = [];
  const media: Media[] = [];

  pages.forEach((p, idx) => {
    // Если разметка страницы известна, собираем документ по ней: с
    // заголовками, выравниванием и абзацами, как в исходнике. Если нет
    // (текст правили руками) — раскладываем построчно, как раньше
    if (p.parts && p.parts.length) {
      for (const part of p.parts) {
        // Таблицу собираем таблицей, всё остальное — абзацем
        body.push(part.table?.length ? table(part.table) : richPara(part, media));
      }
    } else {
      for (const line of p.text.split('\n')) body.push(para(line));
    }
    if (withMarks) body.push(pageMark(p.no));
    if (idx < pages.length - 1) body.push(pageBreak());
  });

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join(
    '',
  )}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${media
    .map(
      (m) =>
        `<Relationship Id="${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`,
    )
    .join('')}</Relationships>`;

  // Шрифт документа: привычный для деловых бумаг Times New Roman, 12 пунктов
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;

  return zip([
    { name: '[Content_Types].xml', data: enc(contentTypes) },
    { name: '_rels/.rels', data: enc(rels) },
    { name: 'word/_rels/document.xml.rels', data: enc(docRels) },
    { name: 'word/document.xml', data: enc(document) },
    { name: 'word/styles.xml', data: enc(styles) },
    ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.png })),
  ]);
};

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ————— Документ Word из PDF, сохранённого из Word —————
//
// Здесь всё берётся из точной разметки страницы: поля и размер листа,
// шрифт, размер и начертание каждого куска текста, межстрочный интервал,
// отступы, табуляции, таблицы с объединёнными ячейками и заливкой,
// картинки на своих местах. Поэтому документ получается похожим на
// исходный, а не лентой текста

const tw = (pt: number) => Math.round(pt * 20);
const emuOf = (pt: number) => Math.max(1, Math.round(pt * 12700));
const eighths = (pt: number) => Math.max(2, Math.min(96, Math.round(pt * 8)));

const richRun = (r: RRun, base: RichPage) => {
  const rp: string[] = [];
  if (r.font) rp.push(`<w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}" w:cs="${esc(r.font)}"/>`);
  if ('t' in r) {
    if (r.b) rp.push('<w:b/><w:bCs/>');
    if (r.i) rp.push('<w:i/><w:iCs/>');
  }
  if (r.u) rp.push('<w:u w:val="single"/>');
  if (r.size && Math.abs(r.size - base.size) >= 0.25) {
    const h = Math.round(r.size * 2);
    rp.push(`<w:sz w:val="${h}"/><w:szCs w:val="${h}"/>`);
  }
  // Сдвиг вверх или вниз — верхние и нижние индексы («м³», «H₂O»)
  if ('t' in r && r.raise) rp.push(`<w:position w:val="${Math.round(r.raise * 2)}"/>`);
  const props = rp.length ? `<w:rPr>${rp.join('')}</w:rPr>` : '';
  if ('tab' in r) return `<w:r>${props}<w:tab/></w:r>`;
  return `<w:r>${props}<w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`;
};

const anchorImg = (a: RAnchor, media: Media[]) => {
  const n = media.length + 1;
  const id = `rIdImg${n}`;
  media.push({ name: `image${n}.png`, png: a.png, id });
  const cx = emuOf(a.w);
  const cy = emuOf(a.h);
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251658240 + n}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${Math.round(a.x * 12700)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${Math.round(a.y * 12700)}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${n}" name="Рисунок ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
};

const richPara2 = (p: RPara, media: Media[], page: RichPage, tabBase = 0) => {
  const pp: string[] = [];
  if (p.pageBreak) pp.push('<w:pageBreakBefore/>');
  if (p.border) pp.push(`<w:pBdr><w:bottom w:val="single" w:sz="${eighths(p.border)}" w:space="0" w:color="000000"/></w:pBdr>`);
  const tabs = p.tabs.filter((t) => t.pos - tabBase > 1);
  if (tabs.length)
    pp.push(`<w:tabs>${tabs.map((t) => `<w:tab w:val="${t.kind}" w:pos="${tw(t.pos - tabBase)}"/>`).join('')}</w:tabs>`);
  // Межстрочный интервал — точный, как в PDF: иначе строки у Word
  // расходятся со строками исходника, и страница «уплывает»
  const empty = !p.runs.length;
  pp.push(
    `<w:spacing w:before="${tw(p.before)}" w:after="0" w:line="${tw(p.line)}" w:lineRule="exact"/>`,
  );
  if (p.left || p.firstLine) {
    const fl = p.firstLine > 0 ? ` w:firstLine="${tw(p.firstLine)}"` : p.firstLine < 0 ? ` w:hanging="${tw(-p.firstLine)}"` : '';
    pp.push(`<w:ind w:left="${tw(p.left)}"${fl}/>`);
  }
  if (p.align !== 'left') pp.push(`<w:jc w:val="${p.align}"/>`);
  // У пустого абзаца-просвета шрифт крошечный: иначе Word растянет его
  // по высоте шрифта, а не по заданному интервалу
  if (empty) pp.push('<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>');
  const anchors = (p.anchors || []).map((a) => anchorImg(a, media)).join('');
  const runs = p.runs.map((r) => richRun(r, page)).join('');
  return `<w:p><w:pPr>${pp.join('')}</w:pPr>${anchors}${runs}</w:p>`;
};

const richTable = (t: RTable, media: Media[], page: RichPage) => {
  const grid = `<w:tblGrid>${t.cols.map((c) => `<w:gridCol w:w="${tw(c)}"/>`).join('')}</w:tblGrid>`;
  const side = (tag: string, pt: number) =>
    pt ? `<w:${tag} w:val="single" w:sz="${eighths(pt)}" w:space="0" w:color="000000"/>` : `<w:${tag} w:val="nil"/>`;
  const rows = t.rows
    .map((r) => {
      let col = 0;
      const cells = r.cells
        .map((c) => {
          const width = t.cols.slice(col, col + c.span).reduce((a, b) => a + b, 0);
          col += c.span;
          const pr: string[] = [`<w:tcW w:w="${tw(width)}" w:type="dxa"/>`];
          if (c.span > 1) pr.push(`<w:gridSpan w:val="${c.span}"/>`);
          if (c.vmerge) pr.push(c.vmerge === 'restart' ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>');
          pr.push(
            `<w:tcBorders>${side('top', c.borders.t)}${side('left', c.borders.l)}${side('bottom', c.borders.b)}${side('right', c.borders.r)}</w:tcBorders>`,
          );
          if (c.fill) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${c.fill}"/>`);
          if (c.valign !== 'top') pr.push(`<w:vAlign w:val="${c.valign}"/>`);
          // Отступы и табуляции абзацев ячейки считаются от её поля
          // Табуляции и отступы в разметке уже отсчитаны от поля ячейки
          const inner = c.paras.length
            ? c.paras.map((p) => richPara2(p, media, page)).join('')
            : '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>';
          return `<w:tc><w:tcPr>${pr.join('')}</w:tcPr>${inner}</w:tc>`;
        })
        .join('');
      // Высота строки — не меньше, чем в исходнике
      return `<w:tr><w:trPr><w:trHeight w:val="${tw(r.h)}" w:hRule="atLeast"/></w:trPr>${cells}</w:tr>`;
    })
    .join('');
  // Отступ таблицы от поля — чтобы она стояла там же, где в исходнике.
  // Word считает его от края текста до края ячейки, с учётом поля ячейки
  return `<w:tbl><w:tblPr><w:tblW w:w="${tw(t.cols.reduce((a, b) => a + b, 0))}" w:type="dxa"/><w:tblInd w:w="${tw(t.indent - page.margins.l)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>${grid}${rows}</w:tbl>`;
};

// Документ из страниц PDF. У каждой страницы — свой раздел со своими
// полями и размером листа: альбомная страница остаётся альбомной
export const buildRichDocx = (pages: RichPage[]) => {
  const media: Media[] = [];
  const main = pages[0];
  const body: string[] = [];
  const sect = (p: RichPage) =>
    `<w:sectPr><w:pgSz w:w="${tw(p.W)}" w:h="${tw(p.H)}"${p.W > p.H ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(p.margins.t)}" w:right="${tw(p.margins.r)}" w:bottom="${tw(p.margins.b)}" w:left="${tw(p.margins.l)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;

  pages.forEach((pg, k) => {
    const parts = pg.blocks.map((b) => ('table' in b ? richTable(b.table, media, pg) : richPara2(b.p, media, pg)));
    if (k < pages.length - 1) {
      // Раздел кончается последним абзацем страницы: в него кладём
      // описание листа, и следующая страница начинается с нового листа
      const last = parts.length - 1;
      const isPara = !('table' in pg.blocks[last]);
      const brk = sect(pg).replace('<w:sectPr>', '<w:sectPr><w:type w:val="nextPage"/>');
      if (isPara) parts[last] = parts[last].replace('<w:pPr>', `<w:pPr>${brk}`);
      else parts.push(`<w:p><w:pPr>${brk}</w:pPr></w:p>`);
    }
    body.push(...parts);
  });
  const last = pages[pages.length - 1];

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join('')}${sect(last).replace('<w:sectPr>', '<w:sectPr><w:type w:val="nextPage"/>')}</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${media
    .map(
      (m) =>
        `<Relationship Id="${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`,
    )
    .join('')}</Relationships>`;
  // Основной шрифт и размер документа — самые частые в исходнике
  const f = esc(main.font);
  const half = Math.round(main.size * 2);
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/></w:style><w:style w:type="table" w:default="1" w:styleId="t"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;

  return zip([
    { name: '[Content_Types].xml', data: enc(contentTypes) },
    { name: '_rels/.rels', data: enc(rels) },
    { name: 'word/_rels/document.xml.rels', data: enc(docRels) },
    { name: 'word/document.xml', data: enc(document) },
    { name: 'word/styles.xml', data: enc(styles) },
    ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.png })),
  ]);
};
