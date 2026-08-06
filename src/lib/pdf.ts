import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export { pdfjsLib };

export type PageMeta = {
  id: string;
  srcIndex: number;
  rotation: number;
  label: number;
};

export const loadDoc = async (data: ArrayBuffer) => {
  const task = pdfjsLib.getDocument({ data: data.slice(0) });
  return task.promise;
};

export const renderPage = async (
  doc: any,
  pageIndex: number,
  scale: number,
  extraRotation = 0,
): Promise<HTMLCanvasElement> => {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({
    scale,
    rotation: (page.rotate + extraRotation) % 360,
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
};

export const pageText = async (doc: any, pageIndex: number) => {
  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  let out = '';
  let lastY: number | null = null;
  for (const item of content.items as any[]) {
    const y = item.transform?.[5];
    if (lastY !== null && Math.abs(y - lastY) > 4) out += '\n';
    out += item.str;
    lastY = y;
  }
  return out.trim();
};

export const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality = 0.92) =>
  new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, quality));

export const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
};
