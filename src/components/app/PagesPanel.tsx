import { useRef } from 'react';
import Icon from '@/components/ui/icon';
import PageRow from '@/components/app/PageRow';
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
          <PageRow
            key={p.uid}
            page={p}
            index={i}
            activeRow={i === active}
            last={pages.length === 1}
            onSelect={setActive}
            onRotate={rotate}
            onRemove={remove}
            onMove={move}
          />
        ))}
      </div>
    </aside>
  );
};

export default PagesPanel;