import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';

type Rect = { x: number; y: number; w: number; h: number };
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type Props = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
};

const DraggableDialog = ({
  title,
  onClose,
  children,
  footer,
  width = 880,
  height = 560,
  minWidth = 520,
  minHeight = 380,
}: Props) => {
  const clamp = useCallback(
    (r: Rect): Rect => {
      const maxW = window.innerWidth;
      const maxH = window.innerHeight;
      const w = Math.max(minWidth, Math.min(r.w, maxW - 8));
      const h = Math.max(minHeight, Math.min(r.h, maxH - 8));
      return {
        w,
        h,
        x: Math.max(4, Math.min(r.x, maxW - w - 4)),
        y: Math.max(4, Math.min(r.y, maxH - h - 4)),
      };
    },
    [minWidth, minHeight],
  );

  const [rect, setRect] = useState<Rect>(() => {
    const w = Math.min(width, window.innerWidth - 32);
    const h = Math.min(height, window.innerHeight - 32);
    return {
      w,
      h,
      x: Math.max(4, Math.round((window.innerWidth - w) / 2)),
      y: Math.max(4, Math.round((window.innerHeight - h) / 2)),
    };
  });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ kind: 'move' | Edge; sx: number; sy: number; base: Rect } | null>(null);

  useEffect(() => {
    const onResize = () => setRect((r) => clamp(r));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const start = (kind: 'move' | Edge) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind, sx: e.clientX, sy: e.clientY, base: rect };
    setBusy(true);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      const b = d.base;

      if (d.kind === 'move') {
        setRect(clamp({ ...b, x: b.x + dx, y: b.y + dy }));
        return;
      }
      let { x, y, w, h } = b;
      const k = d.kind;
      if (k.includes('e')) w = b.w + dx;
      if (k.includes('s')) h = b.h + dy;
      if (k.includes('w')) {
        w = b.w - dx;
        x = b.x + dx;
        if (w < minWidth) x = b.x + (b.w - minWidth);
      }
      if (k.includes('n')) {
        h = b.h - dy;
        y = b.y + dy;
        if (h < minHeight) y = b.y + (b.h - minHeight);
      }
      setRect(clamp({ x, y, w, h }));
    };
    const onUp = () => {
      drag.current = null;
      setBusy(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [clamp, minWidth, minHeight]);

  const grips: { k: Edge; cls: string }[] = [
    { k: 'n', cls: 'left-3 right-3 top-0 h-1.5 cursor-ns-resize' },
    { k: 's', cls: 'left-3 right-3 bottom-0 h-1.5 cursor-ns-resize' },
    { k: 'w', cls: 'top-3 bottom-3 left-0 w-1.5 cursor-ew-resize' },
    { k: 'e', cls: 'top-3 bottom-3 right-0 w-1.5 cursor-ew-resize' },
    { k: 'nw', cls: 'left-0 top-0 h-3 w-3 cursor-nwse-resize' },
    { k: 'ne', cls: 'right-0 top-0 h-3 w-3 cursor-nesw-resize' },
    { k: 'sw', cls: 'left-0 bottom-0 h-3 w-3 cursor-nesw-resize' },
    { k: 'se', cls: 'right-0 bottom-0 h-4 w-4 cursor-nwse-resize' },
  ];

  return (
    <div className="fixed inset-0 z-[70] bg-foreground/40">
      <div
        className="absolute flex flex-col overflow-hidden border border-foreground bg-background shadow-[0_20px_50px_rgba(20,24,28,0.3)]"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          transition: busy ? 'none' : 'box-shadow 150ms ease',
        }}
      >
        <div
          onPointerDown={start('move')}
          className="flex h-11 shrink-0 cursor-move select-none items-center justify-between border-b border-foreground bg-foreground px-4 text-background"
        >
          <span className="truncate font-head text-[0.74rem] font-bold uppercase tracking-[0.12em]">
            {title}
          </span>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
            className="flex h-11 w-10 items-center justify-center transition-colors hover:bg-destructive"
            title="Закрыть"
          >
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

        {footer && <div className="shrink-0 border-t border-border">{footer}</div>}

        {grips.map((g) => (
          <div key={g.k} onPointerDown={start(g.k)} className={`absolute z-30 ${g.cls}`} />
        ))}

        <div className="pointer-events-none absolute bottom-0.5 right-0.5 text-muted-foreground">
          <Icon name="GripVertical" size={12} className="rotate-45" />
        </div>
      </div>
    </div>
  );
};

export default DraggableDialog;
