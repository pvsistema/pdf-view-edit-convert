import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import TopLayer from '@/components/app/TopLayer';

export type ThumbMenuItem = {
  icon: string;
  label: string;
  on?: boolean;
  sep?: boolean;
  danger?: boolean;
  fn: () => void;
};

type Props = {
  x: number;
  y: number;
  title: string;
  items: ThumbMenuItem[];
  onClose: () => void;
};

// Меню по правой кнопке мыши на миниатюре страницы в левой панели
const ThumbMenu = ({ x, y, title, items, onClose }: Props) => {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Не даём меню выйти за край окна
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const shut = () => onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', shut);
    window.addEventListener('resize', shut);
    window.addEventListener('keydown', key);
    window.addEventListener('wheel', shut, { passive: true });
    return () => {
      window.removeEventListener('mousedown', shut);
      window.removeEventListener('resize', shut);
      window.removeEventListener('keydown', key);
      window.removeEventListener('wheel', shut);
    };
  }, [onClose]);

  return (
    <TopLayer>
      <div
        ref={box}
        className="animate-fade-in fixed z-[115] min-w-[min(250px,calc(100vw-1rem))] border border-foreground bg-background py-1 shadow-[0_8px_28px_rgba(20,24,28,0.22)]"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="px-4 pb-1.5 pt-1 font-head text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </div>
        {items.map((it) => (
          <div key={it.label}>
            {it.sep && <div className="my-1 border-t border-border" />}
            <button
              disabled={it.on === false}
              onClick={() => {
                onClose();
                it.fn();
              }}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[0.86rem] transition-colors hover:bg-card disabled:opacity-35 disabled:hover:bg-transparent ${
                it.danger ? 'hover:text-destructive' : ''
              }`}
            >
              <Icon name={it.icon} size={15} className="shrink-0 text-muted-foreground" />
              <span className="flex-1">{it.label}</span>
            </button>
          </div>
        ))}
      </div>
    </TopLayer>
  );
};

export default ThumbMenu;
