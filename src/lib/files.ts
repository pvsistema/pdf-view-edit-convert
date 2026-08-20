import { isDesktop, nativeSave } from '@/lib/desktop';

// Сохранение и печать файлов. Модуль намеренно отделён от просмотрщика:
// стартовому экрану тяжёлый движок PDF не нужен, и окно открывается быстрее

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
