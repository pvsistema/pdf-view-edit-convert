// Связь стартового окна с меню программы: задачи на стартовом экране
// открывают те же окна сканирования и конвертации, что и пункты меню,
// поэтому просто просим меню их показать

const SCAN = 'pvspdf:start-scan';
const CONVERT = 'pvspdf:start-convert';

export const requestScan = (batch: boolean) =>
  window.dispatchEvent(new CustomEvent<boolean>(SCAN, { detail: batch }));

export const onScanRequest = (fn: (batch: boolean) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<boolean>).detail ?? false);
  window.addEventListener(SCAN, h);
  return () => window.removeEventListener(SCAN, h);
};

export const requestConvert = (kind: string) =>
  window.dispatchEvent(new CustomEvent<string>(CONVERT, { detail: kind }));

export const onConvertRequest = (fn: (kind: string) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail ?? '');
  window.addEventListener(CONVERT, h);
  return () => window.removeEventListener(CONVERT, h);
};
