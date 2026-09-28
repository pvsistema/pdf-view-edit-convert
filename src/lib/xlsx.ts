// Сборка настоящей книги Excel (.xlsx).
//
// Раньше «таблица» была веб-страницей с подменённым расширением: Excel
// открывал её с предупреждением, а новые версии ругаются на несовпадение
// формата. Здесь собирается честный .xlsx, который Excel считает своим.
//
// Внутри .xlsx — архив ZIP со служебными файлами, как и у Word.

import { zipFiles } from '@/lib/zip';

const esc = (t: string) =>
  t
    // Служебные невидимые знаки Excel не принимает так же, как Word
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

// Имя столбца по его номеру: 0 → A, 25 → Z, 26 → AA
const colName = (n: number) => {
  let out = '';
  let i = n;
  do {
    out = String.fromCharCode(65 + (i % 26)) + out;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return out;
};

// Число записываем числом, чтобы в Excel по нему сразу считались суммы.
// Всё остальное — текстом. Пробелы внутри числа («233 500») убираем:
// так его пишут в документах, но Excel такого не понимает
const asNumber = (s: string) => {
  const t = s.replace(/\s+/g, '').replace(',', '.');
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

const cellXml = (value: string, ref: string) => {
  const num = asNumber(value);
  if (num !== null) return `<c r="${ref}"><v>${num}</v></c>`;
  if (!value) return '';
  // Текст пишем прямо в ячейку — так файл проще и надёжнее
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
};

export type SheetData = { name: string; rows: string[][] };

const sheetXml = (rows: string[][]) => {
  const body = rows
    .map((row, r) => {
      const cells = row.map((v, c) => cellXml(v, `${colName(c)}${r + 1}`)).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
};

// Имя листа: Excel запрещает некоторые знаки и длину больше 31
const safeName = (s: string, fallback: string) => {
  const out = s.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
  return out || fallback;
};

export const buildXlsx = (sheets: SheetData[]) => {
  const list = sheets.length ? sheets : [{ name: 'Лист 1', rows: [[]] }];

  const names = list.map((s, i) => safeName(s.name, `Лист ${i + 1}`));

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
    .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
          i + 1
        }.xml"/>`,
    )
    .join('')}</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${list
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${
          i + 1
        }.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')}</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  return zipFiles([
    { name: '[Content_Types].xml', text: contentTypes },
    { name: '_rels/.rels', text: rels },
    { name: 'xl/workbook.xml', text: workbook },
    { name: 'xl/_rels/workbook.xml.rels', text: wbRels },
    ...list.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      text: sheetXml(s.rows),
    })),
  ]);
};

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';