// Сборка PDF из обычного текста. Шрифт с кириллицей встраивается в файл,
// поэтому текст в готовом документе можно выделять, копировать и искать —
// в отличие от снимка страницы картинкой

import { PAPERS } from '@/context/DocContext';

const FONT_URL = '/fonts/pv-sans.ttf';
const BOLD_URL = '/fonts/pv-sans-bold.ttf';

let regular: Promise<ArrayBuffer> | null = null;
let bold: Promise<ArrayBuffer> | null = null;

// Шрифт читается один раз за запуск и дальше берётся готовым
const fontBytes = (weight: 'regular' | 'bold' = 'regular') => {
  if (weight === 'bold') {
    if (!bold) bold = fetch(BOLD_URL).then((r) => r.arrayBuffer());
    return bold;
  }
  if (!regular) regular = fetch(FONT_URL).then((r) => r.arrayBuffer());
  return regular;
};

export type TextBlock = {
  text: string;
  // Заголовки печатаем крупнее и жирным
  head?: boolean;
  // Разрыв страницы перед блоком
  breakBefore?: boolean;
};

export type TextPdfOptions = {
  size?: number;
  margin?: number;
  lineGap?: number;
  title?: string;
};

// Готовим документ с встроенным шрифтом: пригодно и для текста,
// и для таблиц, и для книг
export const makeTextDoc = async () => {
  const [{ PDFDocument }, fontkitMod] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
  ]);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkitMod.default ?? fontkitMod);
  const [reg, bd] = await Promise.all([fontBytes('regular'), fontBytes('bold')]);
  const font = await doc.embedFont(reg.slice(0));
  const fontBold = await doc.embedFont(bd.slice(0));
  return { doc, font, fontBold };
};

// Разбиваем строку по ширине листа, не разрывая слова
export const wrapLine = (
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
) => {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (const w of words) {
      const probe = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(probe, size) <= maxWidth) {
        line = probe;
        continue;
      }
      if (line) out.push(line);

      // Слово длиннее строки — режем по буквам, иначе оно уйдёт за поле
      if (font.widthOfTextAtSize(w, size) > maxWidth) {
        let part = '';
        for (const ch of w) {
          if (font.widthOfTextAtSize(part + ch, size) > maxWidth) {
            out.push(part);
            part = ch;
          } else part += ch;
        }
        line = part;
      } else line = w;
    }
    out.push(line);
  }
  return out;
};

// Текст в PDF: страницы A4, поля, перенос строк, разрывы между разделами
export const textToPdf = async (blocks: TextBlock[], opts: TextPdfOptions = {}) => {
  const { doc, font, fontBold } = await makeTextDoc();
  const [W, H] = PAPERS.a4;
  const size = opts.size ?? 11;
  const margin = opts.margin ?? 56;
  const gap = opts.lineGap ?? 1.45;

  let page = doc.addPage([W, H]);
  let y = H - margin;
  const maxWidth = W - margin * 2;

  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - margin;
  };

  for (const block of blocks) {
    if (block.breakBefore && y < H - margin) newPage();

    const fs = block.head ? size * 1.3 : size;
    const use = block.head ? fontBold : font;
    const step = fs * gap;

    for (const line of wrapLine(block.text, use, fs, maxWidth)) {
      if (y - step < margin) newPage();
      if (line) {
        page.drawText(line, { x: margin, y: y - fs, size: fs, font: use });
      }
      y -= step;
    }
    y -= step * 0.4;
  }

  if (opts.title) doc.setTitle(opts.title);
  return doc.save();
};
