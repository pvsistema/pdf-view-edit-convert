import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { isDesktop, nativeSave } from '@/lib/desktop';

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

// Плотность точек экрана: на мониторах с масштабом Windows 125-150%
// рисуем страницу крупнее, иначе текст выглядит мыльным
export const screenDensity = () => {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(3, Math.max(1, dpr));
};

export const renderPage = async (
  doc: any,
  pageIndex: number,
  scale: number,
  extraRotation = 0,
  sharpen = 1,
): Promise<HTMLCanvasElement> => {
  const page = await doc.getPage(pageIndex + 1);
  const rotation = (page.rotate + extraRotation) % 360;

  // Размер на экране остаётся прежним, а точек внутри становится больше
  const view = page.getViewport({ scale, rotation });
  const viewport = page.getViewport({ scale: scale * sharpen, rotation });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(view.width)}px`;
  canvas.style.height = `${Math.floor(view.height)}px`;

  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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
  // В десктопной версии открываем системное окно "Сохранить как" с выбором папки
  if (isDesktop()) {
    void nativeSave(blob, name);
    return;
  }
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

let printFrame: HTMLIFrameElement | null = null;

export const printBlob = (blob: Blob, name = 'document.pdf') => {
  // Убираем предыдущий скрытый лист, иначе диалог печати открывается дважды
  if (printFrame) {
    printFrame.remove();
    printFrame = null;
  }

  const url = URL.createObjectURL(blob);
  const release = () => setTimeout(() => URL.revokeObjectURL(url), 60000);

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
  printFrame = frame;

  // settled = документ загрузился; сторожевой таймер после этого не срабатывает,
  // иначе он открывал второе окно, пока пользователь стоял в диалоге печати.
  let settled = false;

  const openExternally = () => {
    if (settled) return;
    settled = true;
    frame.remove();
    if (printFrame === frame) printFrame = null;
    const win = window.open(url, '_blank');
    if (!win) downloadBlob(blob, name);
    release();
  };

  frame.onload = () => {
    if (settled) return;
    settled = true;
    setTimeout(() => {
      try {
        const w = frame.contentWindow;
        if (!w) throw new Error('no window');
        w.focus();
        w.print();
      } catch {
        frame.remove();
        if (printFrame === frame) printFrame = null;
        const win = window.open(url, '_blank');
        if (!win) downloadBlob(blob, name);
      }
      release();
    }, 350);
  };

  frame.onerror = openExternally;

  document.body.appendChild(frame);
  frame.src = url;

  // Сторожевой таймер только на случай, если лист вообще не загрузился
  setTimeout(openExternally, 6000);
};

export const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
};