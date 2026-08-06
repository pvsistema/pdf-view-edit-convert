import { useRef } from 'react';
import Icon from '@/components/ui/icon';
import PageThumb from '@/components/app/PageThumb';
import { useDoc } from '@/context/DocContext';
import { toast } from '@/hooks/use-toast';

const PagesPanel = () => {
  const { pages, active, setActive, rotate, remove, move, append } = useDoc();
  const input = useRef<HTMLInputElement>(null);

  return (
    <aside className="flex h-full w-[236px] shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="label-caps">Страницы</span>
        <button
          className="text-primary hover:opacity-70"
          title="Добавить файл к документу"
          onClick={() => input.current?.click()}
        >
          <Icon name="Plus" size={16} />
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            await append(f);
            toast({ title: 'Файл добавлен', description: `${f.name} присоединён к документу` });
            e.target.value = '';
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {pages.map((p, i) => (
          <div
            key={p.uid}
            className={`group mb-3 border p-2 transition-colors ${
              i === active ? 'border-primary bg-background' : 'border-border bg-background/60 hover:border-foreground'
            }`}
          >
            <button className="block w-full" onClick={() => setActive(i)}>
              <PageThumb page={p} />
            </button>
            <div className="mt-2 flex items-center justify-between">
              <span className="font-head text-[0.72rem] font-bold text-muted-foreground">
                Стр. {i + 1}
              </span>
              <div className="flex items-center gap-0.5">
                <button className="p-1 hover:text-primary" title="Вверх" onClick={() => move(p.uid, -1)}>
                  <Icon name="ArrowUp" size={13} />
                </button>
                <button className="p-1 hover:text-primary" title="Вниз" onClick={() => move(p.uid, 1)}>
                  <Icon name="ArrowDown" size={13} />
                </button>
                <button className="p-1 hover:text-primary" title="Повернуть" onClick={() => rotate(p.uid, 90)}>
                  <Icon name="RotateCw" size={13} />
                </button>
                <button
                  className="p-1 hover:text-destructive"
                  title="Удалить страницу"
                  onClick={() => remove(p.uid)}
                  disabled={pages.length === 1}
                >
                  <Icon name="Trash2" size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};

export default PagesPanel;
