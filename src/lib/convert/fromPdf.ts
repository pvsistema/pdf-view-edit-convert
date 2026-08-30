// Извлечение содержимого PDF в другие форматы

import { loadDocFromBytes, pageText, renderPageOnce, closeDoc } from '@/lib/pdf';

export type StepFn = (done: number, total: number) => void;

const escape = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

// Текст всего документа постранично. Страницы читаем небольшими группами:
// ожидания накладываются друг на друга и документ обрабатывается быстрее
export const readAllText = async (file: File, onStep?: StepFn) => {
  const doc = await loadDocFromBytes(await file.arrayBuffer());
  const out: string[] = [];
  const STEP = 8;
  try {
    for (let i = 0; i < doc.numPages; i += STEP) {
      const part = Array.from(
        { length: Math.min(STEP, doc.numPages - i) },
        (_, k) => i + k,
      );
      const got = await Promise.all(part.map((n) => pageText(doc, n)));
      out.push(...got);
      onStep?.(Math.min(i + STEP, doc.numPages), doc.numPages);
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    closeDoc(doc);
  }
  return out;
};

export const toPlainText = (pages: string[]) =>
  pages.map((t, i) => `--- Страница ${i + 1} ---\n${t}`).join('\n\n');

// Файл для Word: размеченный текст, который Word открывает как документ
export const toWordHtml = (pages: string[], title = 'Документ') => {
  const body = pages
    .map(
      (t, i) =>
        `<div style="page-break-after:always">${t
          .split('\n')
          .map((l) => `<p>${escape(l) || '&nbsp;'}</p>`)
          .join('')}<p style="color:#888;font-size:9pt">Страница ${i + 1}</p></div>`,
    )
    .join('');
  return `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${escape(
    title,
  )}</title></head><body style="font-family:Times New Roman,serif;font-size:12pt">${body}</body></html>`;
};

// Таблица для Excel: строки страницы разбиваются на ячейки
// по двойным пробелам и табуляции — так набраны колонки в PDF
export const toExcelHtml = (pages: string[]) => {
  const rows = pages
    .flatMap((t, i) =>
      t
        .split('\n')
        .filter((l) => l.trim())
        .map((line) => {
          const cells = line.split(/\s{2,}|\t/).filter(Boolean);
          return `<tr><td>${i + 1}</td>${cells.map((c) => `<td>${escape(c)}</td>`).join('')}</tr>`;
        }),
    )
    .join('');
  return `<html><head><meta charset="utf-8"></head><body><table border="1"><tr><th>Стр.</th><th>Содержимое</th></tr>${rows}</table></body></html>`;
};

// Обычная веб-страница с текстом документа — открывается любым браузером
export const toHtmlPage = (pages: string[], title = 'Документ') => {
  const body = pages
    .map(
      (t, i) =>
        `<section><h2>Страница ${i + 1}</h2>${t
          .split('\n')
          .map((l) => (l.trim() ? `<p>${escape(l)}</p>` : ''))
          .join('')}</section>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>body{max-width:800px;margin:40px auto;padding:0 20px;font:16px/1.6 Georgia,serif;color:#14181C}
h2{font:600 13px/1 system-ui;text-transform:uppercase;letter-spacing:.08em;color:#8a8a8a;margin:36px 0 12px}
section{border-top:1px solid #e6e6e6;padding-top:8px}</style>
</head><body><h1>${escape(title)}</h1>${body}</body></html>`;
};

export type ImageFormat = 'jpeg' | 'png';

// Страницы документа отдельными картинками
export const pagesToImages = async (
  file: File,
  format: ImageFormat = 'jpeg',
  scale = 2,
  onStep?: StepFn,
) => {
  const doc = await loadDocFromBytes(await file.arrayBuffer());
  const out: { blob: Blob; name: string }[] = [];
  const base = file.name.replace(/\.pdf$/i, '') || 'страница';
  const ext = format === 'png' ? 'png' : 'jpg';

  try {
    for (let i = 0; i < doc.numPages; i++) {
      const canvas = await renderPageOnce(doc, i, scale);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error('Страница не собралась'))),
          format === 'png' ? 'image/png' : 'image/jpeg',
          0.92,
        ),
      );
      out.push({ blob, name: `${base}-${String(i + 1).padStart(3, '0')}.${ext}` });
      onStep?.(i + 1, doc.numPages);
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    closeDoc(doc);
  }
  return out;
};
