import { memo } from 'react';
import Icon from '@/components/ui/icon';
import PageThumb from '@/components/app/PageThumb';
import type { PageMeta } from '@/context/DocContext';

type Props = {
  page: PageMeta;
  index: number;
  activeRow: boolean;
  last: boolean;
  onSelect: (i: number) => void;
  onRotate: (uid: string, dir: number) => void;
  onRemove: (uid: string) => void;
  onMove: (uid: string, dir: number) => void;
};

// Отдельная строка списка страниц. Перерисовывается только та,
// которая действительно изменилась, а не весь список целиком
const PageRow = ({
  page,
  index,
  activeRow,
  last,
  onSelect,
  onRotate,
  onRemove,
  onMove,
}: Props) => (
  <div
    className={`group mb-3 border p-2 transition-colors ${
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
        <button className="p-1 hover:text-primary" title="Вверх" onClick={() => onMove(page.uid, -1)}>
          <Icon name="ArrowUp" size={13} />
        </button>
        <button className="p-1 hover:text-primary" title="Вниз" onClick={() => onMove(page.uid, 1)}>
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
);

export default memo(PageRow);
