// Связь страницы и панели замечаний: заметку ставят щелчком по листу,
// а показывает и правит её боковая панель

const CHANGED = 'pvspdf:notes-changed';
const OPEN = 'pvspdf:notes-open';

// Список изменился. Если передан openId — эту заметку надо сразу
// открыть на правку: её только что создали
export const notesChanged = (openId?: string) =>
  window.dispatchEvent(new CustomEvent<string | undefined>(CHANGED, { detail: openId }));

export const onNotesChanged = (fn: (openId?: string) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<string | undefined>).detail);
  window.addEventListener(CHANGED, h);
  return () => window.removeEventListener(CHANGED, h);
};

// Показать панель замечаний
export const openNotes = () => window.dispatchEvent(new CustomEvent(OPEN));

export const onOpenNotes = (fn: () => void) => {
  const h = () => fn();
  window.addEventListener(OPEN, h);
  return () => window.removeEventListener(OPEN, h);
};
