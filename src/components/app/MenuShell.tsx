import { useEffect, useRef } from 'react';
import Icon from '@/components/ui/icon';

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

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div className="relative" ref={box}>
      <button
        onClick={onToggle}
        className={`flex h-9 items-center gap-1.5 px-3 font-head text-[0.78rem] font-bold uppercase tracking-[0.08em] transition-colors ${
          open ? 'bg-foreground text-background' : 'hover:bg-card'
        }`}
      >
        {title}
        <Icon name="ChevronDown" size={13} />
      </button>

      {open && (
        <div className="animate-fade-in absolute left-0 top-full z-50 mt-px w-[290px] border border-foreground bg-background shadow-[6px_6px_0_hsl(var(--rule)/0.25)]">
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
      )}
    </div>
  );
};

export default MenuShell;
