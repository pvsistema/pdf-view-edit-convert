import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useDoc } from '@/context/DocContext';
import { readNotes, saveNotes, noteWhen, type Note } from '@/lib/notes';
import { onNotesChanged, notesChanged } from '@/lib/noteBus';

// Панель замечаний: все заметки документа списком, с автором и датой.
// Щелчок ведёт к нужному месту, как в программах для вычитки
const NotesPanel = () => {
  const { pages, active, setActive, name } = useDoc();
  const [list, setList] = useState<Note[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showDone, setShowDone] = useState(true);

  useEffect(() => setList(readNotes(name)), [name]);

  // Заметку могли создать щелчком по странице — подхватываем список
  useEffect(
    () =>
      onNotesChanged((openId) => {
        setList(readNotes(name));
        if (openId) {
          setEditing(openId);
          setDraft('');
        }
      }),
    [name],
  );

  const keep = (next: Note[]) => {
    const sorted = [...next].sort((a, b) => a.page - b.page || a.y - b.y);
    setList(sorted);
    saveNotes(name, sorted);
    notesChanged();
  };

  const save = (id: string) => {
    const text = draft.trim();
    // Пустая заметка не нужна — такую просто убираем
    if (!text) {
      const cur = list.find((n) => n.id === id);
      if (cur && !cur.text) {
        keep(list.filter((n) => n.id !== id));
        setEditing(null);
        return;
      }
    }
    keep(list.map((n) => (n.id === id ? { ...n, text: text || n.text } : n)));
    setEditing(null);
  };

  const toggle = (id: string) =>
    keep(list.map((n) => (n.id === id ? { ...n, done: !n.done } : n)));

  const drop = (id: string) => keep(list.filter((n) => n.id !== id));

  const goTo = (n: Note) => setActive(Math.min(n.page, pages.length - 1));

  const shown = showDone ? list : list.filter((n) => !n.done);
  const open = list.filter((n) => !n.done).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="label-caps">
          Замечания{open > 0 ? ` · ${open}` : ''}
        </span>
        {list.length > 0 && (
          <button
            onClick={() => setShowDone((v) => !v)}
            title={showDone ? 'Скрыть отработанные' : 'Показать все'}
            className="text-muted-foreground hover:text-foreground"
          >
            <Icon name={showDone ? 'Eye' : 'EyeOff'} size={15} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {shown.length === 0 ? (
          <div className="px-1 py-8 text-center">
            <Icon name="MessageSquare" size={22} className="text-muted-foreground" />
            <p className="mt-3 text-[0.78rem] leading-relaxed text-muted-foreground">
              {list.length
                ? 'Все замечания отработаны'
                : 'Выберите инструмент «Заметка» и щёлкните по странице, чтобы оставить замечание'}
            </p>
          </div>
        ) : (
          shown.map((n) => (
            <div
              key={n.id}
              className={`group mb-2 border px-3 py-2 transition-colors ${
                n.page === active ? 'border-primary bg-background' : 'border-border bg-background'
              } ${n.done ? 'opacity-55' : ''}`}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggle(n.id)}
                  title={n.done ? 'Вернуть в работу' : 'Отметить отработанным'}
                  className={n.done ? 'text-primary' : 'text-muted-foreground hover:text-primary'}
                >
                  <Icon name={n.done ? 'CircleCheck' : 'Circle'} size={15} />
                </button>
                <button onClick={() => goTo(n)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[0.8rem] font-medium">{n.author}</span>
                  <span className="text-[0.72rem] text-muted-foreground">
                    {noteWhen(n.at)} · стр. {n.page + 1}
                  </span>
                </button>
                <button
                  onClick={() => drop(n.id)}
                  title="Удалить замечание"
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Icon name="X" size={14} />
                </button>
              </div>

              {n.quote && (
                <p className="mt-2 border-l-2 border-border pl-2 text-[0.74rem] italic text-muted-foreground">
                  {n.quote}
                </p>
              )}

              {editing === n.id ? (
                <textarea
                  autoFocus
                  rows={3}
                  value={draft}
                  placeholder="Текст замечания"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => save(n.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(n.id);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  className="mt-2 w-full resize-none border border-primary bg-background px-2 py-1 text-[0.8rem] outline-none"
                />
              ) : (
                <p
                  onDoubleClick={() => {
                    setEditing(n.id);
                    setDraft(n.text);
                  }}
                  className={`mt-1.5 whitespace-pre-wrap text-[0.82rem] leading-snug ${
                    n.done ? 'line-through' : ''
                  }`}
                  title="Двойной щелчок — изменить"
                >
                  {n.text || <span className="text-muted-foreground">Замечание не заполнено</span>}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default NotesPanel;