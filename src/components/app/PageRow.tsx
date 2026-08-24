import { memo } from 'react';
import Icon from '@/components/ui/icon';
import PageThumb from '@/components/app/PageThumb';
import type { PageMeta } from '@/context/DocContext';

type Props = {
  page: PageMeta;
  index: number;
  activeRow: boolean;
  last: boolean;
  dragging: boolean;
  markAbove: boolean;
  markBelow: boolean;
  onSelect: (i: number) => void;
  onRotate: (uid: string, dir: number) => void;
  onRemove: (uid: string) => void;
  onMove: (uid: string, dir: number) => void;
  onDragStart: (e: React.DragEvent, page: PageMeta) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
};

// Отдельная строка списка страниц. Перерисовывается только та,
// которая действительно изменилась, а не весь список целиком
const PageRow = ({
  page,
  index,
  activeRow,
  last,
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
      className={`group mb-3 cursor-grab border p-2 transition-colors active:cursor-grabbing ${
        dragging ? 'opacity-40' : ''
      } ${
        activeRow
          ? 'border-primary bg-background'
          : 'border-border bg-background/60 hover:border-foreground'
      }`}
    >
      <button className="block w-full" onClick={() => onSelect(index)}>
        <PageThumb page={page} />
      </button>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-head text-[0.72rem] font-bold text-muted-foreground">
          Стр. {index + 1}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            className="p-1 hover:text-primary"
            title="Вверх"
            onClick={() => onMove(page.uid, -1)}
          >
            <Icon name="ArrowUp" size={13} />
          </button>
          <button
            className="p-1 hover:text-primary"
            title="Вниз"
            onClick={() => onMove(page.uid, 1)}
          >
            <Icon name="ArrowDown" size={13} />
          </button>
          <button
            className="p-1 hover:text-primary"
            title="Повернуть"
            onClick={() => onRotate(page.uid, 90)}
          >
            <Icon name="RotateCw" size={13} />
          </button>
          <button
            className="p-1 hover:text-destructive"
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
