import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import TopLayer from '@/components/app/TopLayer';

export type MenuItem = {
  icon: string;
  label: string;
  hint?: string;
  fn: () => void;
  on: boolean;
  sep?: boolean;
  // Подпись над группой пунктов: «Страница», «Текст» — помогает
  // быстрее найти нужное в длинном списке
  group?: string;
  // Пояснение мелко под названием
  note?: string;
};

type Props = {
  title: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  items: MenuItem[];
};

const MenuShell = ({ title, open, onToggle, onClose, items }: Props) => {
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || list.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Список раскрывается поверх всей программы, поэтому его место
  // на экране считаем сами — от кнопки меню
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const b = box.current?.getBoundingClientRect();
      if (!b) return;

      const width = Math.min(320, window.innerWidth - 16);
      // У правого края списку не хватало места и он уезжал за экран
      const x = Math.max(8, Math.min(b.left, window.innerWidth - width - 8));
      setAt({ x, y: b.bottom + 1 });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button
        onClick={onToggle}
        className={`flex h-9 shrink-0 items-center gap-1 whitespace-nowrap px-2.5 font-head text-[0.84rem] font-semibold transition-colors md:gap-1.5 md:px-3 md:text-[0.9rem] ${
          open ? 'bg-foreground text-background' : 'hover:bg-card'
        }`}
      >
        {title}
        <Icon name="ChevronDown" size={13} />
      </button>

      {/* Список выносим наверх страницы: внутри прилипающей панели меню
          он обрезался полосой прокрутки и прятался под документом */}
      {open && (
        <TopLayer>
          <div
            ref={list}
            style={{
              left: at.x,
              top: at.y,
              width: Math.min(320, window.innerWidth - 16),
              maxHeight: `calc(100vh - ${at.y + 8}px)`,
            }}
            className="animate-fade-in fixed z-[120] overflow-y-auto border border-foreground bg-background shadow-[6px_6px_0_hsl(var(--rule)/0.25)]"
          >
            {items.map((it) => (
              <div key={it.label}>
                {it.group && (
                  <div
                    className={`px-4 pb-1 pt-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground ${
                      it.sep ? 'border-t border-border' : ''
                    }`}
                  >
                    {it.group}
                  </div>
                )}
              <button
                onClick={it.fn}
                disabled={!it.on}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors disabled:opacity-35 enabled:hover:bg-card ${
                  it.sep && !it.group ? 'border-t border-border' : ''
                }`}
              >
                <Icon name={it.icon} size={16} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.88rem]">{it.label}</span>
                  {it.note && (
                    <span className="block truncate text-[0.74rem] text-muted-foreground">{it.note}</span>
                  )}
                </span>
                {it.hint && (
                  <span className="shrink-0 font-head text-[0.7rem] tracking-[0.06em] text-muted-foreground">
                    {it.hint}
                  </span>
                )}
              </button>
              </div>
            ))}
          </div>
        </TopLayer>
      )}
    </div>
  );
};

export default MenuShell;
