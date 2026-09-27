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

      const width = Math.min(290, window.innerWidth - 16);
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
        className={`flex h-9 shrink-0 items-center gap-1 whitespace-nowrap px-2 font-head text-[0.7rem] font-bold uppercase tracking-[0.04em] transition-colors md:gap-1.5 md:px-3 md:text-[0.78rem] md:tracking-[0.08em] ${
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
              width: Math.min(290, window.innerWidth - 16),
              maxHeight: `calc(100vh - ${at.y + 8}px)`,
            }}
            className="animate-fade-in fixed z-[120] overflow-y-auto border border-foreground bg-background shadow-[6px_6px_0_hsl(var(--rule)/0.25)]"
          >
            {items.map((it) => (
              <button
                key={it.label}
                onClick={it.fn}
                disabled={!it.on}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:opacity-35 enabled:hover:bg-card ${
                  it.sep ? 'border-t border-border' : ''
                }`}
              >
                <Icon name={it.icon} size={16} className="shrink-0 text-primary" />
                <span className="flex-1 truncate text-[0.88rem]">{it.label}</span>
                {it.hint && (
                  <span className="shrink-0 font-head text-[0.7rem] tracking-[0.06em] text-muted-foreground">
                    {it.hint}
                  </span>
                )}
              </button>
            ))}
          </div>
        </TopLayer>
      )}
    </div>
  );
};

export default MenuShell;
