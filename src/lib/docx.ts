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

// Подпись с номером листа: помельче и серым, как колонтитул
const pageMark = (no: number) =>
  `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="808080"/></w:rPr><w:t>Стр. ${no}</w:t></w:r></w:p>`;

const pageBreak = () => `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

export type DocxPage = { no: number; text: string };

// Сборка документа. Каждая страница исходника ложится на отдельный лист
export const buildDocx = (pages: DocxPage[], withMarks: boolean) => {
  const body: string[] = [];

  pages.forEach((p, idx) => {
    for (const line of p.text.split('\n')) body.push(para(line));
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
