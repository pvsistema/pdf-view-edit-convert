import { memo } from 'react';
import Icon from '@/components/ui/icon';
import PageThumb from '@/components/app/PageThumb';
import type { PageMeta } from '@/context/DocContext';

type Props = {
  page: PageMeta;
  index: number;
  activeRow: boolean;
  // Отмечена для действий с несколькими страницами (Ctrl / Shift)
  picked: boolean;
  last: boolean;
  // Первая и последняя в списке: двигать дальше некуда
  first: boolean;
  lastRow: boolean;
  dragging: boolean;
  markAbove: boolean;
  markBelow: boolean;
  onSelect: (i: number, e: React.MouseEvent) => void;
  onRotate: (uid: string, dir: number) => void;
  onRemove: (uid: string) => void;
  onMove: (uid: string, dir: number) => void;
  onDragStart: (e: React.DragEvent, page: PageMeta) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onMenu: (e: React.MouseEvent, page: PageMeta, index: number) => void;
};

// Отдельная строка списка страниц. Перерисовывается только та,
// которая действительно изменилась, а не весь список целиком
const PageRow = ({
  page,
  index,
  activeRow,
  picked,
  last,
  first,
  lastRow,
  dragging,
  markAbove,
  markBelow,
  onSelect,
  onRotate,
  onRemove,
  onMove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onMenu,
}: Props) => (
  <div className="relative">
    {/* Полоска показывает, куда встанет страница */}
    {markAbove && <div className="absolute -top-1.5 left-0 right-0 h-[3px] bg-primary" />}
    {markBelow && <div className="absolute -bottom-1.5 left-0 right-0 h-[3px] bg-primary" />}

    <div
      draggable
      onDragStart={(e) => onDragStart(e, page)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      onContextMenu={(e) => onMenu(e, page, index)}
      className={`group mb-3 cursor-grab border p-2 transition-colors active:cursor-grabbing ${
        dragging ? 'opacity-40' : ''
      } ${
        picked
          ? 'border-primary bg-primary/10 ring-2 ring-primary'
          : activeRow
            ? 'border-primary bg-background'
            : 'border-border bg-background/60 hover:border-foreground'
      }`}
    >
      <button className="relative block w-full" onClick={(e) => onSelect(index, e)}>
        {picked && (
          <span className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center bg-primary text-primary-foreground">
            <Icon name="Check" size={13} />
          </span>
        )}
        <PageThumb page={page} />
      </button>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-head text-[0.72rem] font-bold text-muted-foreground">
          Стр. {index + 1}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            className="p-1 hover:text-primary disabled:opacity-30 disabled:hover:text-current"
            title="Вверх"
            onClick={() => onMove(page.uid, -1)}
            disabled={first}
          >
            <Icon name="ArrowUp" size={13} />
          </button>
          <button
            className="p-1 hover:text-primary disabled:opacity-30 disabled:hover:text-current"
            title="Вниз"
            onClick={() => onMove(page.uid, 1)}
            disabled={lastRow}
          >
            <Icon name="ArrowDown" size={13} />
          </button>
          <button
            className="p-1 hover:text-primary disabled:opacity-30 disabled:hover:text-current"
            title="Повернуть"
            onClick={() => onRotate(page.uid, 90)}
          >
            <Icon name="RotateCw" size={13} />
          </button>
          <button
            className="p-1 hover:text-destructive disabled:opacity-30 disabled:hover:text-current"
            title="Удалить страницу"
            onClick={() => onRemove(page.uid)}
            disabled={last}
          >
            <Icon name="Trash2" size={13} />
          </button>
        </div>
      </div>
    </div>
  </div>
);

export default memo(PageRow);
