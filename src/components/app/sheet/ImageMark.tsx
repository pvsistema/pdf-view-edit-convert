import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import type { Annot } from '@/context/DocContext';

type Box = { x: number; y: number; w: number; h: number; angle?: number };
type Corner = 'nw' | 'ne' | 'sw' | 'se';

const MIN = 0.01;

// Угол в пределах -180…180: так подпись «−15°» не превращается в «345°»
const norm = (a: number) => {
  let v = ((a % 360) + 360) % 360;
  if (v > 180) v -= 360;
  return Math.round(v * 10) / 10;
};

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
  onSave,
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
  // Запомнить картинку в «Мои подписи»
  onSave?: (id: string) => void;
}) => {
  const [live, setLive] = useState<Box | null>(null);
  const drag = useRef<{
    mode: 'move' | Corner | 'rotate';
    sx: number;
    sy: number;
    start: Box;
    ratio: number;
    // Для поворота: середина картинки на экране и начальный угол мыши
    cx?: number;
    cy?: number;
    a0?: number;
  } | null>(null);
  const self = useRef<HTMLDivElement>(null);

  const box: Box = live ?? { x: mark.x, y: mark.y, w: mark.w ?? 0.2, h: mark.h ?? 0.08, angle: mark.angle ?? 0 };
  const angle = box.angle ?? 0;

  const begin = (e: React.PointerEvent, mode: 'move' | Corner | 'rotate') => {
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
    if (mode === 'rotate') {
      // Середину считаем по самой рамке на экране: так поворот верен
      // при любой прокрутке и масштабе
      const r = self.current!.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      drag.current.cx = cx;
      drag.current.cy = cy;
      drag.current.a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    }
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const s = d.start;
    if (d.mode === 'rotate') {
      const a = Math.atan2(e.clientY - d.cy!, e.clientX - d.cx!);
      let deg = (s.angle ?? 0) + ((a - d.a0!) * 180) / Math.PI;
      // Shift — шагами по 15°; без него — мягкое прилипание к 0/90/180/270
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      else {
        const near = Math.round(deg / 90) * 90;
        if (Math.abs(deg - near) < 3) deg = near;
      }
      setLive({ ...s, angle: norm(deg) });
      return;
    }
    // Тянут за угол повёрнутой картинки — сдвиг мыши переводим в оси
    // самой картинки, иначе угол «убегал» бы в сторону
    const rx = e.clientX - d.sx;
    const ry = e.clientY - d.sy;
    const t = ((s.angle ?? 0) * Math.PI) / 180;
    const dx = (d.mode === 'move' ? rx : rx * Math.cos(t) + ry * Math.sin(t)) / width;
    const dy = (d.mode === 'move' ? ry : -rx * Math.sin(t) + ry * Math.cos(t)) / height;
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
    // Противоположный угол стоит на месте. У повёрнутой картинки он
    // считается с учётом поворота — рамка не прыгает при растяжке
    const W = width;
    const H = height;
    const sx = west ? 1 : -1;
    const sy = north ? 1 : -1;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    // Неподвижный угол на листе, в точках экрана
    const ax = (sx * s.w * W) / 2;
    const ay = (sy * s.h * H) / 2;
    const fx = (s.x + s.w / 2) * W + ax * cos - ay * sin;
    const fy = (s.y + s.h / 2) * H + ax * sin + ay * cos;
    let nx: number;
    let ny: number;
    if (t) {
      const bx = (sx * w * W) / 2;
      const by = (sy * h * H) / 2;
      nx = (fx - (bx * cos - by * sin)) / W - w / 2;
      ny = (fy - (bx * sin + by * cos)) / H - h / 2;
    } else {
      // Без поворота — ещё и не даём уйти за край листа
      const right = s.x + s.w;
      const bottom = s.y + s.h;
      const maxW = west ? right : 1 - s.x;
      const maxH = north ? bottom : 1 - s.y;
      if (w > maxW || h > maxH) {
        const k = Math.min(maxW / w, maxH / h);
        w *= k;
        h *= k;
      }
      nx = west ? right - w : s.x;
      ny = north ? bottom - h : s.y;
    }
    setLive({ x: nx, y: ny, w, h, angle: s.angle });
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
      Math.abs(live.x - s.x) > 1e-4 ||
      Math.abs(live.y - s.y) > 1e-4 ||
      Math.abs(live.w - s.w) > 1e-4 ||
      Math.abs(live.h - s.h) > 1e-4 ||
      Math.abs((live.angle ?? 0) - (s.angle ?? 0)) > 0.05;
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
      // R — повернуть на 90° по часовой, Shift+R — против
      if ((e.key === 'r' || e.key === 'R' || e.code === 'KeyR') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        onChange(mark.id, {
          x: mark.x,
          y: mark.y,
          w: mark.w ?? 0.2,
          h: mark.h ?? 0.08,
          angle: norm((mark.angle ?? 0) + (e.shiftKey ? -90 : 90)),
        });
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
        angle: mark.angle,
      });
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [selected, mark, width, height, onChange, onRemove, onSelect]);

  return (
    <div
      ref={self}
      className={`group absolute z-[15] ${locked ? 'pointer-events-none' : 'cursor-move'}`}
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * width}px`,
        height: `${box.h * height}px`,
        transform: angle ? `rotate(${angle}deg)` : undefined,
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

          {/* Ручка поворота над серединой верхней стороны */}
          <div className="pointer-events-none absolute -top-6 left-1/2 h-6 w-px -translate-x-1/2 bg-primary" />
          <div
            className="absolute -top-9 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-primary bg-background text-primary shadow-sm"
            style={{ cursor: 'grab', touchAction: 'none' }}
            title="Повернуть: тяните мышью. С Shift — шагами по 15°, клавиша R — на 90°"
            onPointerDown={(e) => begin(e, 'rotate')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <Icon name="RotateCw" size={11} />
          </div>

          {/* Кнопки держим ровно, даже когда картинка повёрнута */}
          <div
            className="absolute right-0 top-full mt-2 flex gap-1"
            style={{ transform: angle ? `rotate(${-angle}deg)` : undefined, transformOrigin: 'top right' }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onChange(mark.id, { x: mark.x, y: mark.y, w: mark.w ?? 0.2, h: mark.h ?? 0.08, angle: norm(angle - 90) });
              }}
              className="border border-border bg-background p-1 shadow-sm hover:border-foreground"
              title="Повернуть на 90° против часовой (Shift+R)"
            >
              <Icon name="RotateCcw" size={13} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onChange(mark.id, { x: mark.x, y: mark.y, w: mark.w ?? 0.2, h: mark.h ?? 0.08, angle: norm(angle + 90) });
              }}
              className="border border-border bg-background p-1 shadow-sm hover:border-foreground"
              title="Повернуть на 90° по часовой (R)"
            >
              <Icon name="RotateCw" size={13} />
            </button>
            {angle !== 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(mark.id, { x: mark.x, y: mark.y, w: mark.w ?? 0.2, h: mark.h ?? 0.08, angle: 0 });
                }}
                className="whitespace-nowrap border border-border bg-background px-1.5 py-1 text-[0.7rem] shadow-sm hover:border-foreground"
                title="Вернуть картинку ровно"
              >
                {Math.round(angle)}° → 0°
              </button>
            )}
            {onSave && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSave(mark.id);
                }}
                className="flex items-center gap-1 whitespace-nowrap border border-border bg-background px-1.5 py-1 text-[0.7rem] shadow-sm hover:border-foreground"
                title="Запомнить в «Мои подписи», чтобы ставить одним щелчком"
              >
                <Icon name="BookmarkPlus" size={12} />
                В мои подписи
              </button>
            )}
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
            <span
              className="pointer-events-none absolute left-0 top-0 whitespace-nowrap bg-foreground px-1.5 py-0.5 font-head text-[0.66rem] text-background"
              style={{ transform: `translateY(-130%) ${angle ? `rotate(${-angle}deg)` : ''}`, transformOrigin: 'bottom left' }}
            >
              {drag.current?.mode === 'rotate'
                ? `${Math.round(angle)}°`
                : `${Math.round(((live.w * width) / zoom) * (25.4 / 72))} × ${Math.round(((live.h * height) / zoom) * (25.4 / 72))} мм`}
            </span>
          )}
        </>
      )}
    </div>
  );
};

export default ImageMark;
