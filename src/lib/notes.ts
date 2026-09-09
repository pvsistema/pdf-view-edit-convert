// Заметки к документу: замечания, которые оставляют при вычитке.
// Живут отдельно от пометок на странице — их можно перечитать,
// ответить, отметить решённым и убрать

export type Note = {
  id: string;
  // Страница, к которой относится заметка, считая с нуля
  page: number;
  // Место на странице в долях: по нему рисуется значок
  x: number;
  y: number;
  text: string;
  author: string;
  at: number;
  // Замечание отработано — значок гаснет, но запись остаётся
  done?: boolean;
  // Цитата из документа, если заметку оставили по выделенному тексту
  quote?: string;
};

const KEY = 'pvs-notes';
const WHO = 'pvs-author';

type Store = Record<string, Note[]>;

const readAll = (): Store => {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Store) : {};
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
};

export const readNotes = (doc: string): Note[] => {
  if (!doc) return [];
  const list = readAll()[doc];
  if (!Array.isArray(list)) return [];
  // Сортируем по странице, а затем сверху вниз — как человек читает
  return [...list].sort((a, b) => a.page - b.page || a.y - b.y);
};

export const saveNotes = (doc: string, list: Note[]) => {
  if (!doc) return;
  try {
    const all = readAll();
    if (list.length) all[doc] = list;
    else delete all[doc];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* хранилище недоступно — заметки не переживут перезапуск */
  }
};

// Имя рецензента: спрашиваем один раз и запоминаем
export const readAuthor = () => {
  try {
    return localStorage.getItem(WHO) || '';
  } catch {
    return '';
  }
};

export const saveAuthor = (name: string) => {
  try {
    localStorage.setItem(WHO, name.trim());
  } catch {
    /* не страшно */
  }
};

let seq = 0;

export const makeNote = (page: number, x: number, y: number, author: string): Note => ({
  id: `n${Date.now()}${++seq}`,
  page,
  x,
  y,
  text: '',
  author: author || 'Без имени',
  at: Date.now(),
});

// «сегодня в 14:30», «вчера», «4 сентября» — как в проводнике
export const noteWhen = (at: number) => {
  const d = new Date(at);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `сегодня в ${d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`;
  }
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'вчера';
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'long' });
};
