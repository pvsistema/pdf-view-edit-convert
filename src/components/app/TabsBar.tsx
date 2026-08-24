import { useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useTabs } from '@/context/TabsContext';
import { toast } from '@/hooks/use-toast';
import { heldPage, dropInto } from '@/lib/pageSwap';

// Полоса вкладок: каждый открытый документ занимает свою вкладку,
// переключение между ними мгновенное
const TabsBar = () => {
  const tabsApi = useTabs();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState<string | null>(null);
  const hold = useRef<number>(0);

  if (!tabsApi || tabsApi.tabs.length < 1) return null;
  const { tabs, activeId, selectTab, closeTab, openTab } = tabsApi;

  const pick = (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast({ title: 'Нужен файл PDF', description: 'Выберите документ с расширением .pdf' });
      return;
    }
    openTab(file);
    toast({ title: 'Документ открыт', description: file.name });
  };

  return (
    <div className="flex shrink-0 items-stretch border-b border-border bg-card">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {tabs.map((t) => {
          const on = t.id === activeId;
          const target = over === t.id;

          // Страницу можно бросить прямо на вкладку — она встанет в конец
          // того документа. Если задержать курсор, вкладка откроется сама
          const dragOver = (e: React.DragEvent) => {
            const cargo = heldPage();
            if (!cargo || cargo.tabId === t.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move';
            if (over !== t.id) {
              setOver(t.id);
              window.clearTimeout(hold.current);
              hold.current = window.setTimeout(() => selectTab(t.id), 700);
            }
          };

          const leave = () => {
            window.clearTimeout(hold.current);
            setOver((cur) => (cur === t.id ? null : cur));
          };

          const drop = (e: React.DragEvent) => {
            const cargo = heldPage();
            window.clearTimeout(hold.current);
            setOver(null);
            if (!cargo || cargo.tabId === t.id) return;
            e.preventDefault();

            const copy = e.ctrlKey || e.metaKey;
            if (dropInto(t.id, Number.MAX_SAFE_INTEGER, copy)) {
              selectTab(t.id);
              toast({
                title: copy ? 'Страница скопирована' : 'Страница перенесена',
                description: `В документ «${t.title}»`,
              });
            }
          };

          return (
            <div
              key={t.id}
              onDragOver={dragOver}
              onDragLeave={leave}
              onDrop={drop}
              className={`group flex min-w-[130px] max-w-[240px] shrink-0 items-center gap-2 border-r px-3 py-2 transition-colors ${
                target
                  ? 'border-primary bg-primary/10 ring-2 ring-inset ring-primary'
                  : on
                    ? 'border-border bg-background'
                    : 'border-border bg-card hover:bg-background/60'
              }`}
            >
              <button
                onClick={() => selectTab(t.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={t.title}
              >
                <Icon
                  name="FileText"
                  size={14}
                  className={on ? 'shrink-0 text-primary' : 'shrink-0 text-muted-foreground'}
                />
                <span
                  className={`truncate text-[0.82rem] ${on ? 'font-head font-bold' : 'text-muted-foreground'}`}
                >
                  {t.title}
                </span>
              </button>
              <button
                onClick={() => closeTab(t.id)}
                title="Закрыть документ"
                className="shrink-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <Icon name="X" size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => input.current?.click()}
        title="Открыть ещё документ"
        className="flex w-10 shrink-0 items-center justify-center border-l border-border transition-colors hover:bg-background"
      >
        <Icon name="Plus" size={16} />
      </button>

      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
};

export default TabsBar;
