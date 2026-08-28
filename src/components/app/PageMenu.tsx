import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { toast } from '@/hooks/use-toast';
import { requestSearch } from '@/lib/searchBus';

export type MenuPoint = { x: number; y: number; text: string };

type Props = {
  at: MenuPoint;
  onClose: () => void;
  onCopyPage: () => void;
};

// Меню по правой кнопке мыши: копирование выделенного текста
// и всего текста страницы — как в привычных программах
const PageMenu = ({ at, onClose, onCopyPage }: Props) => {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: at.x, y: at.y });

  // Держим меню в пределах окна: у нижнего края оно раскроется вверх
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.min(at.x, window.innerWidth - width - 8),
      y: Math.min(at.y, window.innerHeight - height - 8),
    });
  }, [at.x, at.y]);

  useEffect(() => {
    const shut = () => onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', shut);
    window.addEventListener('resize', shut);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', shut);
      window.removeEventListener('resize', shut);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const copy = (text: string, title: string) => {
    onClose();
    void navigator.clipboard
      .writeText(text)
      .then(() => toast({ title }))
      .catch(() =>
        toast({ title: 'Не удалось скопировать', description: 'Попробуйте сочетание Ctrl+C' }),
      );
  };

  const has = at.text.trim().length > 0;

  const items = [
    {
      icon: 'Copy',
      label: 'Копировать',
      hint: 'Ctrl+C',
      on: has,
      fn: () => copy(at.text, 'Текст скопирован'),
    },
    {
      icon: 'Search',
      // Ищем ровно то, что выделено: длинные куски обрезаем,
      // иначе поиск заведомо ничего не найдёт
      label: 'Найти выделенное в документе',
      on: has,
      fn: () => {
        onClose();
        requestSearch(at.text.trim().slice(0, 120));
      },
    },
    {
      icon: 'ScanText',
      label: 'Копировать весь текст страницы',
      on: true,
      fn: () => {
        onClose();
        onCopyPage();
      },
    },
  ];

  return (
    <div
      ref={box}
      className="animate-fade-in fixed z-[70] min-w-[240px] border border-foreground bg-background py-1 shadow-[0_8px_28px_rgba(20,24,28,0.22)]"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          disabled={!it.on}
          onClick={it.fn}
          className="flex w-full items-center gap-3 px-4 py-2 text-left text-[0.86rem] transition-colors hover:bg-card disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <Icon name={it.icon} size={15} className="shrink-0 text-muted-foreground" />
          <span className="flex-1">{it.label}</span>
          {it.hint && (
            <span className="shrink-0 text-[0.72rem] text-muted-foreground">{it.hint}</span>
          )}
        </button>
      ))}
    </div>
  );
};

export default PageMenu;