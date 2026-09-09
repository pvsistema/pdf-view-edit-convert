import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useDoc } from '@/context/DocContext';
import { toast } from '@/hooks/use-toast';
import {
  readBookmarks,
  saveBookmarks,
  makeBookmark,
  type Bookmark,
} from '@/lib/bookmarks';
import { onBookmarkRequest } from '@/lib/markBus';

// Панель закладок: отмечает нужные места документа и переносит к ним
// одним щелчком. Полезно в договорах и выписках на сотни страниц
const BookmarksPanel = () => {
  const { pages, active, setActive, name } = useDoc();
  const [list, setList] = useState<Bookmark[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // Закладки принадлежат документу: при смене файла подтягиваем его отметки
  useEffect(() => {
    setList(readBookmarks(name));
  }, [name]);

  const keep = (next: Bookmark[]) => {
    const sorted = [...next].sort((a, b) => a.page - b.page);
    setList(sorted);
    saveBookmarks(name, sorted);
  };

  const add = () => {
    if (list.some((b) => b.page === active)) {
      toast({ title: 'Закладка уже есть', description: `Страница ${active + 1} отмечена` });
      return;
    }
    const mark = makeBookmark(active, `Страница ${active + 1}`);
    keep([...list, mark]);
    // Сразу даём переименовать: своё название понятнее номера
    setEditing(mark.id);
    setDraft(mark.title);
  };

  const rename = (id: string) => {
    const title = draft.trim();
    keep(list.map((b) => (b.id === id ? { ...b, title: title || b.title } : b)));
    setEditing(null);
  };

  const drop = (id: string) => keep(list.filter((b) => b.id !== id));

  const goTo = (b: Bookmark) => {
    // Страницу могли удалить — ведём к ближайшей существующей
    setActive(Math.min(b.page, pages.length - 1));
  };

  const marked = list.some((b) => b.page === active);

  // Отклик на Ctrl+B. Список закладок нужен свежий, поэтому
  // подписку обновляем вместе с ним
  useEffect(() => onBookmarkRequest(add));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="label-caps">Закладки</span>
        <button
          className={marked ? 'text-muted-foreground' : 'text-primary hover:opacity-70'}
          title={
            marked
              ? `Страница ${active + 1} уже в закладках`
              : `Добавить закладку на страницу ${active + 1}`
          }
          onClick={add}
        >
          <Icon name={marked ? 'BookmarkCheck' : 'BookmarkPlus'} size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {list.length === 0 ? (
          <div className="px-1 py-8 text-center">
            <Icon name="Bookmark" size={22} className="text-muted-foreground" />
            <p className="mt-3 text-[0.78rem] leading-relaxed text-muted-foreground">
              Отметьте важные страницы — и возвращайтесь к ним одним щелчком
            </p>
          </div>
        ) : (
          list.map((b) => (
            <div
              key={b.id}
              className={`group mb-1 flex items-center gap-2 border px-2 py-2 transition-colors ${
                b.page === active
                  ? 'border-primary bg-background'
                  : 'border-transparent hover:border-border hover:bg-background'
              }`}
            >
              {editing === b.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => rename(b.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') rename(b.id);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  className="w-full border border-primary bg-background px-2 py-1 text-[0.82rem] outline-none"
                />
              ) : (
                <>
                  <button
                    onClick={() => goTo(b)}
                    onDoubleClick={() => {
                      setEditing(b.id);
                      setDraft(b.title);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title="Перейти к закладке. Двойной щелчок — переименовать"
                  >
                    <Icon name="Bookmark" size={14} className="shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block truncate text-[0.84rem]">{b.title}</span>
                      <span className="text-[0.72rem] text-muted-foreground">
                        стр. {b.page + 1}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => drop(b.id)}
                    title="Удалить закладку"
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Icon name="X" size={14} />
                  </button>
                </>
              )}
            </div>
          ))
        )}

        {list.length > 0 && (
          <p className="px-1 pb-2 pt-2 text-[0.7rem] leading-relaxed text-muted-foreground">
            Двойной щелчок по закладке — переименовать. Сочетание Ctrl+B добавляет
            закладку на текущую страницу.
          </p>
        )}
      </div>
    </div>
  );
};

export default BookmarksPanel;