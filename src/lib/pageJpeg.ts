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

export const jpegName = (docName: string, pageNo: number) =>
  `${(docName || 'document').replace(/\.pdf$/i, '')}-стр-${pageNo}.jpg`;
