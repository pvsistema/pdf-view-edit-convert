const EVENT = 'pvspdf:search';

// Запрос «найти это в документе»: меню по правой кнопке отправляет
// выделенное слово, а окно просмотра подхватывает и ищет
export const requestSearch = (text: string) =>
  window.dispatchEvent(new CustomEvent(EVENT, { detail: text }));

export const onSearchRequest = (fn: (text: string) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
};
