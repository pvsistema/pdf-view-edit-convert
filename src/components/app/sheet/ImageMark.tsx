import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import type { Annot } from '@/context/DocContext';

type Box = { x: number; y: number; w: number; h: number };
type Corner = 'nw' | 'ne' | 'sw' | 'se';

const MIN = 0.01;

const CORNERS: { id: Corner; cls: string; cursor: string }[] = [
  { id: 'nw', cls: '-left-1.5 -top-1.5', cursor: 'nwse-resize' },
  { id: 'ne', cls: '-right-1.5 -top-1.5', cursor: 'nesw-resize' },
  { id: 'sw', cls: '-bottom-1.5 -left-1.5', cursor: 'nesw-resize' },
  { id: 'se', cls: '-bottom-1.5 -right-1.5', cursor: 'nwse-resize' },
];

// Вставленная картинка (подпись, печать): тянется мышью, углы меняют
// размер. По умолчанию пропорции сохраняются, с Shift — свободно.
// Пока тянут, меняется только вид на экране; в документ (и в историю
// Ctrl+Z) попадает одно итоговое положение
const ImageMark = ({
  mark,
  width,
  height,
  zoom,
  selected,
  locked,
  onSelect,
  onChange,
  onRemove,
  onClearBg,
}: {
  mark: Annot;
  width: number;
  height: number;
  // Масштаб: точек экрана на пункт листа — для подписи размера в мм
  zoom: number;
  selected: boolean;
  locked?: boolean;
  onSelect: (id: string | null) => void;
  onChange: (id: string, box: Box) => void;
  onRemove: (id: string) => void;
  // Сделать белый фон прозрачным — для подписи, снятой на бумаге
  onClearBg?: (id: string) => void;
}) => {
  const [live, setLive] = useState<Box | null>(null);
  const drag = useRef<{ mode: 'move' | Corner; sx: number; sy: number; start: Box; ratio: number } | null>(null);

  const box: Box = live ?? { x: mark.x, y: mark.y, w: mark.w ?? 0.2, h: mark.h ?? 0.08 };

  const begin = (e: React.PointerEvent, mode: 'move' | Corner) => {
    if (locked || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(mark.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      mode,
      sx: e.clientX,
      sy: e.clientY,
      start: box,
      // Пропорции в пикселях листа, а не в долях: иначе на неквадратном
      // листе подпись сплющивалась бы
      ratio: (box.w * width) / Math.max(1e-6, box.h * height),
    };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / width;
    const dy = (e.clientY - d.sy) / height;
    const s = d.start;
    if (d.mode === 'move') {
      setLive({
        ...s,
        x: Math.min(1 - s.w, Math.max(0, s.x + dx)),
        y: Math.min(1 - s.h, Math.max(0, s.y + dy)),
      });
      return;
    }
    const west = d.mode === 'nw' || d.mode === 'sw';
    const north = d.mode === 'nw' || d.mode === 'ne';
    let w = Math.max(MIN, s.w + (west ? -dx : dx));
    let h = Math.max(MIN, s.h + (north ? -dy : dy));
    if (!e.shiftKey) {
      // Пропорционально: ведёт та сторона, которую тянут сильнее
      const byW = (w * width) / d.ratio / height;
      const byH = (h * height * d.ratio) / width;
      if (Math.abs(w - s.w) * width >= Math.abs(h - s.h) * height) h = byW;
      else w = byH;
    }
    // Не даём уйти за край листа
    const right = s.x + s.w;
    const bottom = s.y + s.h;
    const maxW = west ? right : 1 - s.x;
    const maxH = north ? bottom : 1 - s.y;
    if (w > maxW || h > maxH) {
      const k = Math.min(maxW / w, maxH / h);
      w *= k;
      h *= k;
    }
    setLive({ x: west ? right - w : s.x, y: north ? bottom - h : s.y, w, h });
  };

  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !live) {
      setLive(null);
      return;
    }
    const s = d.start;
    const changed =
      Math.abs(live.x - s.x) > 1e-4 || Math.abs(live.y - s.y) > 1e-4 || Math.abs(live.w - s.w) > 1e-4 || Math.abs(live.h - s.h) > 1e-4;
    if (changed) onChange(mark.id, live);
    setLive(null);
  };

  // Delete — убрать выбранную картинку, стрелки — сдвинуть на точку
  // (с Shift — на десять)
  useEffect(() => {
    if (!selected) return;
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        onRemove(mark.id);
        onSelect(null);
        return;
      }
      if (e.key === 'Escape') {
        onSelect(null);
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const map: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const v = map[e.key];
      if (!v) return;
      e.preventDefault();
      e.stopPropagation();
      const w = mark.w ?? 0.2;
      const h = mark.h ?? 0.08;
      onChange(mark.id, {
        x: Math.min(1 - w, Math.max(0, mark.x + v[0] / width)),
        y: Math.min(1 - h, Math.max(0, mark.y + v[1] / height)),
        w,
        h,
      });
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [selected, mark, width, height, onChange, onRemove, onSelect]);

  return (
    <div
      className={`group absolute z-[15] ${locked ? 'pointer-events-none' : 'cursor-move'}`}
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * width}px`,
        height: `${box.h * height}px`,
        touchAction: 'none',
      }}
      onPointerDown={(e) => begin(e, 'move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <img src={mark.img} alt="" draggable={false} className="block h-full w-full select-none" />

      <div
        className={`pointer-events-none absolute inset-0 outline-dashed outline-1 outline-primary ${
          selected || live ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
        }`}
      />

      {selected && !locked && (
        <>
          {CORNERS.map((c) => (
            <div
              key={c.id}
              className={`absolute h-3 w-3 border border-primary bg-background ${c.cls}`}
              style={{ cursor: c.cursor, touchAction: 'none' }}
              onPointerDown={(e) => begin(e, c.id)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
          ))}
          <div className="absolute -top-8 right-0 flex gap-1" onPointerDown={(e) => e.stopPropagation()}>
            {onClearBg && mark.text !== 'clear' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClearBg(mark.id);
                }}
                className="flex items-center gap-1 whitespace-nowrap border border-border bg-background px-1.5 py-1 text-[0.7rem] shadow-sm hover:border-foreground"
                title="Сделать белый фон прозрачным: под подписью будет виден текст документа"
              >
                <Icon name="Eraser" size={12} />
                Убрать белый фон
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(mark.id);
                onSelect(null);
              }}
              className="bg-destructive p-1 text-destructive-foreground"
              title="Удалить картинку (Delete)"
            >
              <Icon name="Trash2" size={13} />
            </button>
          </div>
          {live && (
            <span className="pointer-events-none absolute -bottom-6 left-0 whitespace-nowrap bg-foreground px-1.5 py-0.5 font-head text-[0.66rem] text-background">
              {Math.round(((live.w * width) / zoom) * (25.4 / 72))} ×{' '}
              {Math.round(((live.h * height) / zoom) * (25.4 / 72))} мм
            </span>
          )}
        </>
      )}
    </div>
  );
};

export default ImageMark;
