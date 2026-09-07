import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { toast } from '@/hooks/use-toast';
import { requestSearch } from '@/lib/searchBus';

export type MenuPoint = {
  x: number;
  y: number;
  text: string;
  // Границы выделенного текста в долях страницы: по ним замазывание
  // и удаление ложатся ровно на слова, а не «примерно туда»
  spans?: { x: number; y: number; w: number; h: number }[];
};

export type MenuActions = {
  onCopyPage: () => void;
  onHideText: (spans: NonNullable<MenuPoint['spans']>) => void;
  onEraseText: (spans: NonNullable<MenuPoint['spans']>) => void;
  onSelectText: () => void;
  onPaste: () => void;
  onDeletePage: () => void;
  onRotate: (dir: number) => void;
  onEditDoc: () => void;
  onPrint: () => void;
  onExport: () => void;
  onSavePdf: () => void;
  onPageSetup: () => void;
};

type Props = { at: MenuPoint; onClose: () => void } & MenuActions;

type Item = {
  icon: string;
  label: string;
  hint?: string;
  on: boolean;
  sep?: boolean;
  fn: () => void;
};

// Меню по правой кнопке мыши на странице документа: работа с выделенным
// текстом, действия со страницей и вывод документа — как в привычных
// программах для Windows
const PageMenu = ({ at, onClose, ...act }: Props) => {
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

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const copy = () => {
    onClose();
    void navigator.clipboard
      .writeText(at.text)
      .then(() => toast({ title: 'Текст скопирован' }))
      .catch(() =>
        toast({ title: 'Не удалось скопировать', description: 'Попробуйте сочетание Ctrl+C' }),
      );
  };

  const has = at.text.trim().length > 0;
  const spans = at.spans ?? [];
  const marked = has && spans.length > 0;

  const items: Item[] = [
    {
      icon: 'TextCursorInput',
      label: 'Выделить текст',
      on: true,
      fn: run(act.onSelectText),
    },
    {
      icon: 'Square',
      label: 'Замазать текст',
      on: marked,
      fn: run(() => act.onHideText(spans)),
    },
    {
      icon: 'Eraser',
      label: 'Удалить текст',
      on: marked,
      fn: run(() => act.onEraseText(spans)),
    },
    {
      icon: 'Copy',
      label: 'Копировать',
      hint: 'Ctrl+C',
      on: has,
      sep: true,
      fn: copy,
    },
    {
      icon: 'ClipboardPaste',
      label: 'Вставить',
      hint: 'Ctrl+V',
      on: true,
      fn: run(act.onPaste),
    },
    {
      icon: 'Search',
      // Ищем ровно то, что выделено: длинные куски обрезаем,
      // иначе поиск заведомо ничего не найдёт
      label: 'Найти выделенное в документе',
      on: has,
      fn: run(() => requestSearch(at.text.trim().slice(0, 120))),
    },
    {
      icon: 'ScanText',
      label: 'Копировать весь текст страницы',
      on: true,
      fn: run(act.onCopyPage),
    },
    {
      icon: 'Trash2',
      label: 'Удалить страницу',
      hint: 'Shift+Ctrl+D',
      on: true,
      sep: true,
      fn: run(act.onDeletePage),
    },
    {
      icon: 'RotateCw',
      label: 'Повернуть вправо на 90°',
      on: true,
      fn: run(() => act.onRotate(90)),
    },
    {
      icon: 'RotateCcw',
      label: 'Повернуть влево на 90°',
      on: true,
      fn: run(() => act.onRotate(-90)),
    },
    {
      icon: 'PenLine',
      label: 'Редактировать документ',
      on: true,
      sep: true,
      fn: run(act.onEditDoc),
    },
    {
      icon: 'Printer',
      label: 'Печать страницы',
      on: true,
      sep: true,
      fn: run(act.onPrint),
    },
    {
      icon: 'FileOutput',
      label: 'Экспорт страницы',
      on: true,
      fn: run(act.onExport),
    },
    {
      icon: 'FileDown',
      label: 'Сохранить в PDF',
      on: true,
      fn: run(act.onSavePdf),
    },
    {
      icon: 'Settings2',
      label: 'Параметры страницы',
      on: true,
      sep: true,
      fn: run(act.onPageSetup),
    },
  ];

  return (
    <div
      ref={box}
      className="animate-fade-in fixed z-[70] min-w-[262px] border border-foreground bg-background py-1 shadow-[0_8px_28px_rgba(20,24,28,0.22)]"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <div key={it.label}>
          {it.sep && <div className="my-1 border-t border-border" />}
          <button
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
        </div>
      ))}
    </div>
  );
};

export default PageMenu;