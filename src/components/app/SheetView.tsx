import { memo } from 'react';
import Icon from '@/components/ui/icon';
import type { Annot, PageMeta } from '@/context/DocContext';
import type { Tool } from '@/components/app/Viewer';
import TextLayer from '@/components/app/TextLayer';
import PageMenu, { type MenuActions } from '@/components/app/PageMenu';
import useSheetPage from '@/components/app/sheet/useSheetPage';
import useSheetInput from '@/components/app/sheet/useSheetInput';
import { SheetDragPreview, SheetHits } from '@/components/app/sheet/SheetLayers';
import SheetMarks from '@/components/app/sheet/SheetMarks';

type Props = {
  page: PageMeta;
  index: number;
  zoom: number;
  doc: any;
  tool: Tool;
  marks: Annot[];
  found: string;
  // Ожидаемый размер листа: пока страница далеко, лента строится по нему
  // и не заставляет читать весь файл ради размеров
  hint?: { w: number; h: number } | null;
  onPlace: (page: PageMeta, x: number, y: number) => void;
  // Закраска области, обведённой мышью
  onCover: (page: PageMeta, x: number, y: number, w: number, h: number) => void;
  // Включена пипетка: следующий щелчок берёт цвет из точки на листе
  picking?: boolean;
  onPick?: (color: string) => void;
  // Выбранный цвет заливки — им же красится рамка при обводке
  fill?: string;
  // Новая заметка в точке щелчка
  onNote?: (page: PageMeta, x: number, y: number) => void;
  // Нарисованная фигура: стрелка, линия, рамка или овал
  onShape?: (
    page: PageMeta,
    x: number,
    y: number,
    w: number,
    h: number,
    kind: 'arrow' | 'line' | 'rect' | 'oval',
    dir: { flipX: boolean; flipY: boolean },
  ) => void;
  // Заметки этой страницы: рисуем их значки поверх листа
  notes?: { id: string; x: number; y: number; done?: boolean; author: string }[];
  onOpenNote?: (id: string) => void;
  onRemoveMark: (id: string) => void;
  // Действия меню по правой кнопке: их выполняет окно просмотра,
  // потому что они касаются всего документа, а не одного листа
  menuActions: Omit<MenuActions, 'onCopyPage'>;
};

// Один лист в непрерывной ленте. Рисуется, только когда подходит
// к видимой части окна, и освобождается, когда уходит далеко
const SheetView = ({
  page,
  index,
  zoom,
  doc,
  tool,
  marks,
  found,
  hint,
  onPlace,
  onCover,
  picking,
  onPick,
  fill = '#14181C',
  onNote,
  onShape,
  notes,
  onOpenNote,
  onRemoveMark,
  menuActions,
}: Props) => {
  const { box, host, near, drawn, size, spots } = useSheetPage({ page, zoom, doc, found });

  // Пока точный размер неизвестен, берём размер первой страницы:
  // в обычном документе листы одинаковые, и лента не дёргается
  const guess = size ?? hint;
  const width = guess ? guess.w * zoom : 700;
  const height = guess ? guess.h * zoom : 990;

  const { menu, setMenu, rightClick, copyPageText, click, frame, dragStart, dragMove, dragEnd } =
    useSheetInput({
      page,
      doc,
      tool,
      picking,
      host,
      onPlace,
      onCover,
      onPick,
      onNote,
      onShape,
    });

  return (
    <div ref={box} data-sheet={index} className="mb-6 flex flex-col items-center">
      <div
        className={`relative bg-white shadow-[0_2px_14px_rgba(20,24,28,0.16)] ${
          picking ? 'cursor-copy' : tool === 'hand' ? '' : 'cursor-crosshair'
        }`}
        style={{ width: `${width}px`, height: `${height}px` }}
        onClick={click}
        onContextMenu={rightClick}
        onMouseDown={dragStart}
        onMouseMove={dragMove}
        onMouseUp={dragEnd}
        onMouseLeave={dragEnd}
      >
        <div ref={host} />

        {frame && (
          <SheetDragPreview frame={frame} tool={tool} fill={fill} width={width} height={height} />
        )}

        {/* Настоящий текст поверх картинки: доступен для выделения,
            пока не выбран инструмент расстановки пометок */}
        {drawn && tool === 'hand' && (
          <TextLayer
            doc={doc}
            pageIndex={page.src}
            rotation={page.rotation}
            width={width}
            height={height}
            active={near}
          />
        )}

        {!drawn && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon name="LoaderCircle" size={20} className="animate-spin text-muted-foreground" />
          </div>
        )}

        <SheetHits spots={spots} notes={notes} onOpenNote={onOpenNote} />

        <SheetMarks marks={marks} width={width} height={height} onRemoveMark={onRemoveMark} />
      </div>

      <span className="mt-2 font-head text-[0.72rem] font-bold text-muted-foreground">
        Стр. {index + 1}
      </span>

      {menu && (
        <PageMenu
          at={menu}
          onClose={() => setMenu(null)}
          onCopyPage={() => void copyPageText()}
          {...menuActions}
        />
      )}
    </div>
  );
};

export default memo(SheetView);
