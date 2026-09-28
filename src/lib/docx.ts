// Сборка настоящего документа Word (.docx).
//
// Раньше «файл Word» был обычной веб-страницей с подменённым расширением.
// Word такие файлы открывает с предупреждением о повреждении, а иногда
// отказывается вовсе — отсюда жалобы, что распознанное не открывается.
// Здесь собирается честный .docx, который Word считает своим.
//
// Внутри .docx — это архив ZIP с несколькими служебными файлами.
// Архив собираем сами, без сторонних библиотек: файлы кладём без сжатия,
// так формат остаётся простым и надёжным.

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

type Entry = { name: string; data: Uint8Array };

// Упаковка файлов в архив ZIP без сжатия
const zip = (entries: Entry[]) => {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255];

  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const sum = crc32(e.data);

    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(sum),
      ...u32(e.data.length),
      ...u32(e.data.length),
      ...u16(name.length),
      ...u16(0),
      ...name,
    ]);

    chunks.push(local, e.data);

    central.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(sum),
        ...u32(e.data.length),
        ...u32(e.data.length),
        ...u16(name.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...name,
      ]),
    );

    offset += local.length + e.data.length;
  }

  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(dirSize),
    ...u32(offset),
    ...u16(0),
  ]);

  const all = [...chunks, ...central, end];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};

const enc = (s: string) => new TextEncoder().encode(s);

const esc = (t: string) =>
  t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

// Абзац текста. Пустая строка тоже становится абзацем —
// так сохраняются отступы между частями документа
const para = (line: string) =>
  `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`;

// Абзац распознанного документа — с сохранением облика исходника.
// Заголовок остаётся заголовком, текст по центру — по центру,
// жирное — жирным. Так распознанное в Word похоже на бумагу,
// а не на сплошную ленту строк
const richPara = (p: DocxPart) => {
  const look: string[] = [];
  if (p.align !== 'left') look.push(`<w:jc w:val="${p.align}"/>`);
  // Заголовку даём воздух сверху, чтобы он не липнул к тексту выше
  look.push(`<w:spacing w:before="${p.heading ? 240 : 0}" w:after="${p.heading ? 120 : 120}"/>`);

  const font: string[] = [];
  if (p.bold || p.heading) font.push('<w:b/>');
  if (p.italic) font.push('<w:i/>');
  // Заголовок крупнее основного текста: 14 пунктов против 12
  if (p.heading) font.push('<w:sz w:val="28"/>');

  const rPr = font.length ? `<w:rPr>${font.join('')}</w:rPr>` : '';

  return `<w:p><w:pPr>${look.join('')}</w:pPr><w:r>${rPr}<w:t xml:space="preserve">${esc(
    p.text,
  )}</w:t></w:r></w:p>`;
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
  align: 'left' | 'center' | 'right';
  // Таблица: строки, в каждой — ячейки. Если поле заполнено,
  // кусок ложится в Word настоящей таблицей, а не текстом
  table?: string[][];
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
  const grid = `<w:tblGrid>${Array.from(
    { length: cols },
    () => `<w:gridCol w:w="${width}"/>`,
  ).join('')}</w:tblGrid>`;

  return `<w:tbl><w:tblPr><w:tblW w:w="${TABLE_WIDTH}" w:type="dxa"/>${borders}</w:tblPr>${grid}${body}</w:tbl><w:p/>`;
};

export type DocxPage = { no: number; text: string; parts?: DocxPart[] };

// Сборка документа. Каждая страница исходника ложится на отдельный лист
export const buildDocx = (pages: DocxPage[], withMarks: boolean) => {
  const body: string[] = [];

  pages.forEach((p, idx) => {
    // Если разметка страницы известна, собираем документ по ней: с
    // заголовками, выравниванием и абзацами, как в исходнике. Если нет
    // (текст правили руками) — раскладываем построчно, как раньше
    if (p.parts && p.parts.length) {
      for (const part of p.parts) {
        // Таблицу собираем таблицей, всё остальное — абзацем
        body.push(part.table?.length ? table(part.table) : richPara(part));
      }
    } else {
      for (const line of p.text.split('\n')) body.push(para(line));
    }
    if (withMarks) body.push(pageMark(p.no));
    if (idx < pages.length - 1) body.push(pageBreak());
  });

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join(
    '',
  )}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  // Шрифт документа: привычный для деловых бумаг Times New Roman, 12 пунктов
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;

  return zip([
    { name: '[Content_Types].xml', data: enc(contentTypes) },
    { name: '_rels/.rels', data: enc(rels) },
    { name: 'word/_rels/document.xml.rels', data: enc(docRels) },
    { name: 'word/document.xml', data: enc(document) },
    { name: 'word/styles.xml', data: enc(styles) },
  ]);
};

export const DOCX_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';