const EVENT = 'pvspdf:print';

// С чем открыть окно печати: обычно с настройками по умолчанию,
// но из меню по правой кнопке — сразу на текущей странице
// или на вкладке с параметрами листа
export type PrintStart = { scope?: 'current'; tab?: 'paper' };

export const requestPrint = (start?: PrintStart) =>
  window.dispatchEvent(new CustomEvent<PrintStart>(EVENT, { detail: start ?? {} }));

export const onPrintRequest = (fn: (start: PrintStart) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<PrintStart>).detail ?? {});
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
};
