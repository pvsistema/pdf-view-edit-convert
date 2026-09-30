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
import type { PartImage, Seg } from '@/lib/ocrLayout';

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

  return `<w:p><w:pPr>${look.join('')}</w:pPr>${runs}</w:p>`;
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
