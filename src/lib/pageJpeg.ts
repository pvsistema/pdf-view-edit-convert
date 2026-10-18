import { loadDocFromBytes, renderPageOnce, closeDoc } from '@/lib/pdf';

// Одна страница документа картинкой JPEG — такой, какой она выглядит
// в документе: с поворотом, надписями и пометками.
// 200 точек на дюйм — чётко и для печати, и для отправки
export const pageToJpeg = async (pdfBytes: Uint8Array, dpi = 200): Promise<Blob> => {
  let doc: any = null;
  try {
    doc = await loadDocFromBytes(pdfBytes.slice().buffer as ArrayBuffer);
    const canvas = await renderPageOnce(doc, 0, dpi / 72);
    return await new Promise<Blob>((res, rej) =>
      canvas.toBlob(
        (b) => (b ? res(b) : rej(new Error('Страница не собралась'))),
        'image/jpeg',
        0.92,
      ),
    );
  } finally {
    closeDoc(doc);
  }
};

// Несколько страниц разом: документ из выбранных страниц открываем
// один раз и сохраняем каждую страницу отдельной картинкой
export const pagesToJpegs = async (
  pdfBytes: Uint8Array,
  names: string[],
  onStep?: (done: number, total: number) => void,
  dpi = 200,
) => {
  let doc: any = null;
  const out: { blob: Blob; name: string }[] = [];
  try {
    doc = await loadDocFromBytes(pdfBytes.slice().buffer as ArrayBuffer);
    for (let i = 0; i < doc.numPages; i++) {
      const canvas = await renderPageOnce(doc, i, dpi / 72);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error('Страница не собралась'))),
          'image/jpeg',
          0.92,
        ),
      );
      canvas.width = 0;
      canvas.height = 0;
      out.push({ blob, name: names[i] || `стр-${i + 1}.jpg` });
      onStep?.(i + 1, doc.numPages);
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    closeDoc(doc);
  }
  return out;
};

export const jpegName = (docName: string, pageNo: number) =>
  `${(docName || 'document').replace(/\.pdf$/i, '')}-стр-${pageNo}.jpg`;
