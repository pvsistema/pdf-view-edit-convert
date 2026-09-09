// Закладки документа: быстрый переход к нужному месту.
// Храним по имени документа, чтобы при повторном открытии
// того же файла отметки остались на месте

export type Bookmark = {
  id: string;
  // Номер страницы в документе, считая с нуля
  page: number;
  title: string;
  at: number;
};

const KEY = 'pvs-bookmarks';

type Store = Record<string, Bookmark[]>;

const readAll = (): Store => {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Store) : {};
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
};

const writeAll = (s: Store) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* хранилище недоступно — закладки не сохранятся до перезапуска */
  }
};

export const readBookmarks = (doc: string): Bookmark[] => {
  if (!doc) return [];
  const list = readAll()[doc];
  return Array.isArray(list) ? [...list].sort((a, b) => a.page - b.page) : [];
};

export const saveBookmarks = (doc: string, list: Bookmark[]) => {
  if (!doc) return;
  const all = readAll();
  if (list.length) all[doc] = list;
  else delete all[doc];
  writeAll(all);
};

let seq = 0;

export const makeBookmark = (page: number, title: string): Bookmark => ({
  id: `b${Date.now()}${++seq}`,
  page,
  title: title.trim() || `Страница ${page + 1}`,
  at: Date.now(),
});
