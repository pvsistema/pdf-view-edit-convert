const EVENT = 'pvspdf:print';

export const requestPrint = () => window.dispatchEvent(new CustomEvent(EVENT));

export const onPrintRequest = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};
