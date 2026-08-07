declare global {
  interface Window {
    PVSPDF_DESKTOP?: boolean;
    PVSPDF_VERSION?: string;
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

export const onDesktopFile = (cb: (file: File) => void) => {
  const handler = (e: MessageEvent) => {
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (!data || data.type !== 'openFile') return;
      const bin = atob(data.data as string);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      cb(new File([bytes], data.name || 'document.pdf', { type: 'application/pdf' }));
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