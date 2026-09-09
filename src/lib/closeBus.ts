// Просьба закрыть вкладку. Идёт через общий канал, чтобы вопрос
// о несохранённых правках задавался в одном месте — на полосе вкладок

const ASK = 'pvspdf:close-tab';

export const requestCloseTab = (id: string) =>
  window.dispatchEvent(new CustomEvent<string>(ASK, { detail: id }));

export const onCloseTabRequest = (fn: (id: string) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail);
  window.addEventListener(ASK, h);
  return () => window.removeEventListener(ASK, h);
};
