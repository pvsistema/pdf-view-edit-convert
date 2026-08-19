declare global {
  interface Window {
    PVSPDF_DESKTOP?: boolean;
    PVSPDF_VERSION?: string;
    PVSPDF_PRINTER?: string;
    PVSPDF_PRINTERS?: string[];
    chrome?: {
      webview?: {
        postMessage: (m: unknown) => void;
        addEventListener?: (t: string, cb: EventListener) => void;
        removeEventListener?: (t: string, cb: EventListener) => void;
      };
    };
  }
}

export const isDesktop = () => !!window.PVSPDF_DESKTOP;

export const desktopVersion = () => window.PVSPDF_VERSION || '';

const send = (msg: Record<string, unknown>) => {
  window.chrome?.webview?.postMessage(msg);
};

export const setNativeTitle = (title: string) => send({ type: 'setTitle', title });
export const nativeClose = () => send({ type: 'close' });
export const nativeMinimize = () => send({ type: 'minimize' });
export const nativeToggleMax = () => send({ type: 'toggleMax' });

const toBase64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
};

// Принтер, выбранный в прошлый раз
export const savedPrinter = () => window.PVSPDF_PRINTER || '';

// Принтеры, установленные в системе
export const printerList = () => window.PVSPDF_PRINTERS || [];

// Окно свойств принтера Windows: качество, лотки, двусторонняя печать
export const openPrinterSetup = (printer = '') => send({ type: 'printerSetup', printer });

// Печать на выбранный принтер: документ уходит сразу,
// без дополнительных окон Windows
export const nativePrint = async (blob: Blob, name = 'document.pdf', printer = '') => {
  const data = toBase64(await blob.arrayBuffer());
  send({ type: 'print', name, data, printer });
};

// Сохранение через системное окно "Сохранить как"
export const nativeSave = async (blob: Blob, name = 'document.pdf') => {
  const data = toBase64(await blob.arrayBuffer());
  send({ type: 'saveFile', name, data });
};

// Пакетное сохранение: папку пользователь выбирает один раз
export const nativeSaveMany = async (items: { blob: Blob; name: string }[]) => {
  const files = await Promise.all(
    items.map(async (i) => ({ name: i.name, data: toBase64(await i.blob.arrayBuffer()) })),
  );
  send({ type: 'saveFiles', files });
};

type PrintResult = { ok: boolean; cancelled?: boolean; printer?: string; error?: string };

export const onPrintDone = (cb: (r: PrintResult) => void) => {
  const handler = (e: MessageEvent) => {
    try {
      const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (d?.type !== 'printDone') return;
      if (d.printer) window.PVSPDF_PRINTER = d.printer as string;
      cb(d as PrintResult);
    } catch {
      /* игнорируем чужие сообщения */
    }
  };
  window.chrome?.webview?.addEventListener?.('message', handler as EventListener);
  window.addEventListener('message', handler);
  return () => {
    window.chrome?.webview?.removeEventListener?.('message', handler as EventListener);
    window.removeEventListener('message', handler);
  };
};

type SaveResult = {
  ok: boolean;
  cancelled?: boolean;
  path?: string;
  count?: number;
  error?: string;
};

export const onSaveDone = (cb: (r: SaveResult) => void) => {
  const handler = (e: MessageEvent) => {
    try {
      const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (d?.type === 'saveDone') cb(d as SaveResult);
    } catch {
      /* игнорируем чужие сообщения */
    }
  };
  window.chrome?.webview?.addEventListener?.('message', handler as EventListener);
  window.addEventListener('message', handler);
  return () => {
    window.chrome?.webview?.removeEventListener?.('message', handler as EventListener);
    window.removeEventListener('message', handler);
  };
};

export const onDesktopFile = (cb: (file: File) => void) => {
  const handler = (e: MessageEvent) => {
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (!data || data.type !== 'openFile') return;
      const name = data.name || 'document.pdf';

      // Программа сообщает адрес документа — читаем файл напрямую.
      // Это быстрее и не требует лишней памяти на больших файлах
      if (data.url) {
        void fetch(data.url as string)
          .then((r) => r.blob())
          .then((b) => cb(new File([b], name, { type: 'application/pdf' })))
          .catch(() => undefined);
        return;
      }

      // Запасной путь для прежнего способа передачи
      const bin = atob(data.data as string);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      cb(new File([bytes], name, { type: 'application/pdf' }));
    } catch {
      /* игнорируем чужие сообщения */
    }
  };
  window.chrome?.webview?.addEventListener?.('message', handler as EventListener);
  window.addEventListener('message', handler);
  return () => {
    window.chrome?.webview?.removeEventListener?.('message', handler as EventListener);
    window.removeEventListener('message', handler);
  };
};

export {};