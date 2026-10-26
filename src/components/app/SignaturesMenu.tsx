import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import {
  deleteSignature,
  listSignatures,
  onSignaturesChange,
  renameSignature,
  type Signature,
} from '@/lib/signatures';

// Выпадающий список «Мои подписи»: щелчок по подписи ставит её на
// текущую страницу, тем же размером и поворотом, с какими её сохранили
const SignaturesMenu = ({
  onPick,
  onAddFile,
}: {
  onPick: (s: Signature) => void;
  // Добавить новую подпись из файла — сразу в список и на страницу
  onAddFile: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Signature[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () =>
      listSignatures()
        .then(setList)
        .catch(() => setList([]));
    void load();
    return onSignaturesChange(() => void load());
  }, []);

  // Щелчок мимо или Esc закрывают список
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const saveName = (id: string) => {
    const v = draft.trim();
    setEditing(null);
    if (v) void renameSignature(id, v);
  };

  return (
    <div ref={box} className="relative">
      <button
        className={`flex items-center gap-1.5 px-3 py-2 text-[0.8rem] transition-colors ${
          open ? 'bg-primary text-primary-foreground' : 'hover:bg-card'
        }`}
        onClick={() => setOpen((v) => !v)}
        title="Мои подписи: сохранённые подписи и печати — ставятся одним щелчком"
      >
        <Icon name="Signature" fallback="PenLine" size={16} />
        <span className="hidden lg:inline">Мои подписи</span>
        {list.length > 0 && (
          <span
            className={`font-head text-[0.68rem] font-bold ${open ? 'text-primary-foreground' : 'text-muted-foreground'}`}
          >
            {list.length}
          </span>
        )}
        <Icon name="ChevronDown" size={12} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[320px] border border-border bg-background shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <div className="label-caps">Мои подписи</div>
            <p className="mt-0.5 text-[0.72rem] leading-snug text-muted-foreground">
              Щелчок — поставить на текущую страницу. Хранятся только на этом компьютере
            </p>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {list.length === 0 ? (
              <div className="px-4 py-6 text-center text-[0.8rem] text-muted-foreground">
                Пока пусто. Вставьте картинку, настройте размер и нажмите над ней «В мои подписи» — или
                добавьте файл кнопкой ниже
              </div>
            ) : (
              list.map((s) => (
                <div key={s.id} className="group flex items-center gap-2 border-b border-border px-2 py-2 last:border-b-0 hover:bg-card">
                  <button
                    className="flex h-12 w-24 shrink-0 items-center justify-center border border-border bg-white p-1"
                    onClick={() => {
                      onPick(s);
                      setOpen(false);
                    }}
                    title="Поставить на страницу"
                  >
                    <img
                      src={s.img}
                      alt=""
                      className="max-h-full max-w-full object-contain"
                      style={{ transform: s.rotation ? `rotate(${s.rotation}deg)` : undefined }}
                      draggable={false}
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    {editing === s.id ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => saveName(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveName(s.id);
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            setEditing(null);
                          }
                        }}
                        className="w-full border border-primary bg-background px-1.5 py-0.5 text-[0.82rem] outline-none"
                      />
                    ) : (
                      <button
                        className="block w-full truncate text-left text-[0.84rem]"
                        onClick={() => {
                          onPick(s);
                          setOpen(false);
                        }}
                      >
                        {s.name}
                      </button>
                    )}
                    <div className="text-[0.7rem] text-muted-foreground">
                      {Math.round(s.wMm)} × {Math.round(s.hMm)} мм
                      {s.rotation ? ` · ${Math.round(s.rotation)}°` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100">
                    <button
                      className="p-1 hover:text-primary"
                      onClick={() => {
                        setEditing(s.id);
                        setDraft(s.name);
                      }}
                      title="Переименовать"
                    >
                      <Icon name="Pencil" size={13} />
                    </button>
                    <button
                      className="p-1 hover:text-destructive"
                      onClick={() => {
                        if (window.confirm(`Удалить «${s.name}» из моих подписей?`)) void deleteSignature(s.id);
                      }}
                      title="Удалить из списка"
                    >
                      <Icon name="Trash2" size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            className="flex w-full items-center justify-center gap-1.5 border-t border-border px-3 py-2.5 text-[0.8rem] text-primary hover:bg-card"
            onClick={() => {
              onAddFile();
              setOpen(false);
            }}
          >
            <Icon name="Plus" size={14} />
            Добавить из файла PNG или JPEG
          </button>
        </div>
      )}
    </div>
  );
};

export default SignaturesMenu;
