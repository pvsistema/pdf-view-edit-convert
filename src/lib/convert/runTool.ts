// Выполнение выбранного инструмента: файлы на входе — готовый результат
// на выходе. Здесь же живут настройки, которые спрашиваются в окне

import { downloadBlob } from '@/lib/files';
import { isDesktop, nativeSaveMany } from '@/lib/desktop';
import { imagesToPdf } from '@/lib/convert/imagePdf';
import { textToPdf } from '@/lib/convert/textPdf';
import {
  compressPdf,
  dropPages,
  enhanceScan,
  insertBlank,
  keepPages,
  mergePdfs,
  parseOrder,
  parseRange,
  reorderPages,
  type CompressLevel,
} from '@/lib/convert/pdfOps';
import {
  pagesToImages,
  readAllText,
  toExcelHtml,
  toHtmlPage,
  toPlainText,
  toWordHtml,
} from '@/lib/convert/fromPdf';

export type ToolSettings = {
  level: CompressLevel;
  range: string;
  paper: 'a4' | 'fit';
  gray: boolean;
  at: number;
  count: number;
};

export const DEFAULT_SETTINGS: ToolSettings = {
  level: 'medium',
  range: '',
  paper: 'fit',
  gray: false,
  at: 1,
  count: 1,
};

export type RunResult = { message: string; note?: string };

const base = (f: File) => f.name.replace(/\.[^.]+$/, '') || 'документ';

const savePdf = (bytes: Uint8Array, name: string) => {
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), name);
};

const saveText = (text: string, name: string, type: string) => {
  downloadBlob(new Blob(['\ufeff', text], { type }), name);
};

export const runTool = async (
  id: string,
  files: File[],
  set: ToolSettings,
  onStep: (done: number, total: number) => void,
): Promise<RunResult> => {
  const first = files[0];
  if (!first) throw new Error('Не выбран файл');

  switch (id) {
    case 'merge': {
      if (files.length < 2) throw new Error('Выберите хотя бы два файла PDF');
      const bytes = await mergePdfs(files, onStep);
      savePdf(bytes, `объединённый-${base(first)}.pdf`);
      return { message: 'Файлы объединены', note: `${files.length} документа в одном файле` };
    }

    case 'compress': {
      const bytes = await compressPdf(first, set.level, onStep);
      const was = first.size;
      const now = bytes.byteLength;
      savePdf(bytes, `${base(first)}-сжатый.pdf`);
      const win = was > now ? Math.round((1 - now / was) * 100) : 0;
      return {
        message: 'Документ сжат',
        note: win > 0 ? `Файл стал меньше на ${win}%` : 'Документ уже был хорошо сжат',
      };
    }

    case 'remove-pages': {
      const list = parseRange(set.range, 100000);
      if (!list.length) throw new Error('Укажите номера страниц, например 2, 5-7');
      const bytes = await dropPages(first, list);
      savePdf(bytes, `${base(first)}-без-лишних.pdf`);
      return { message: 'Страницы удалены', note: `Убрано листов: ${list.length}` };
    }

    case 'extract-pages': {
      const list = parseRange(set.range, 100000);
      if (!list.length) throw new Error('Укажите номера страниц, например 1-3');
      const bytes = await keepPages(first, list);
      savePdf(bytes, `${base(first)}-выбранные.pdf`);
      return { message: 'Страницы извлечены', note: `Сохранено листов: ${list.length}` };
    }

    case 'reorder': {
      // Порядок берём как написано, не сортируя: в этом весь смысл
      const order = parseOrder(set.range, 100000);
      if (!order.length) throw new Error('Укажите порядок страниц, например 3, 1, 2');
      const bytes = await reorderPages(first, order);
      savePdf(bytes, `${base(first)}-новый-порядок.pdf`);
      return { message: 'Порядок изменён', note: `Страниц в документе: ${order.length}` };
    }

    case 'blank': {
      const bytes = await insertBlank(first, Math.max(1, set.at), Math.max(1, set.count));
      savePdf(bytes, `${base(first)}-с-листами.pdf`);
      return { message: 'Чистые листы добавлены', note: `Вставлено: ${set.count}` };
    }

    case 'enhance': {
      const bytes = await enhanceScan(first, { gray: set.gray, onStep });
      savePdf(bytes, `${base(first)}-улучшенный.pdf`);
      return { message: 'Скан улучшен', note: 'Фон осветлён, текст стал чётче' };
    }

    case 'to-word': {
      const pages = await readAllText(first, onStep);
      saveText(toWordHtml(pages, base(first)), `${base(first)}.doc`, 'application/msword');
      return { message: 'Готов файл Word', note: 'Открывается в Word и других редакторах' };
    }

    case 'to-excel': {
      const pages = await readAllText(first, onStep);
      saveText(toExcelHtml(pages), `${base(first)}.xls`, 'application/vnd.ms-excel');
      return { message: 'Готова таблица', note: 'Файл открывается в Excel' };
    }

    case 'to-text': {
      const pages = await readAllText(first, onStep);
      saveText(toPlainText(pages), `${base(first)}.txt`, 'text/plain;charset=utf-8');
      return { message: 'Готов текстовый файл' };
    }

    case 'to-html': {
      const pages = await readAllText(first, onStep);
      saveText(toHtmlPage(pages, base(first)), `${base(first)}.html`, 'text/html;charset=utf-8');
      return { message: 'Готова веб-страница', note: 'Откроется в любом браузере' };
    }

    case 'to-jpg':
    case 'to-png': {
      const format = id === 'to-png' ? 'png' : 'jpeg';
      const items = await pagesToImages(first, format, 2, onStep);

      // В программе папку выбираем один раз, а не окно на каждый лист
      if (isDesktop()) {
        await nativeSaveMany(items);
      } else {
        for (const it of items) {
          downloadBlob(it.blob, it.name);
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      return {
        message: 'Страницы сохранены',
        note: `${items.length} изображений ${format === 'png' ? 'PNG' : 'JPG'}`,
      };
    }

    case 'from-jpg':
    case 'from-heic':
    case 'from-tiff':
    case 'from-scan': {
      // Снимок документа кладём на лист A4 с полями, обычные
      // картинки — страницей точно по размеру
      const paper = id === 'from-scan' ? 'a4' : set.paper;
      const bytes = await imagesToPdf(files, { paper, onStep });
      savePdf(bytes, `${base(first)}.pdf`);
      return { message: 'Документ PDF готов', note: `Изображений: ${files.length}` };
    }

    case 'from-text': {
      const text = await first.text();
      if (!text.trim()) throw new Error('Файл пустой');
      const bytes = await textToPdf([{ text }], { title: base(first) });
      onStep(1, 1);
      savePdf(bytes, `${base(first)}.pdf`);
      return { message: 'Документ PDF готов', note: 'Текст можно выделять и искать' };
    }

    default:
      throw new Error('Инструмент пока недоступен');
  }
};