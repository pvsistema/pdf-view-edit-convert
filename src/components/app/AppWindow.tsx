import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { LOGO_URL, APP_NAME } from '@/lib/brand';
import { isDesktop } from '@/lib/desktop';

type Rect = { x: number; y: number; w: number; h: number };
type Mode = 'normal' | 'max' | 'min';
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_W = 720;
const MIN_H = 480;
const BAR = 40;

const clampRect = (r: Rect): Rect => {
  const maxW = window.innerWidth;
  const maxH = window.innerHeight;
  const w = Math.max(MIN_W, Math.min(r.w, maxW));
  const h = Math.max(MIN_H, Math.min(r.h, maxH));
  return {
    w,
    h,
    x: Math.max(0, Math.min(r.x, maxW - w)),
    y: Math.max(0, Math.min(r.y, maxH - h)),
  };
};

const initial = (): Rect => {
  const w = Math.min(1280, Math.round(window.innerWidth * 0.9));
  const h = Math.min(860, Math.round(window.innerHeight * 0.9));
  return { w, h, x: Math.round((window.innerWidth - w) / 2), y: Math.round((window.innerHeight - h) / 2) };
};

const AppWindow = ({ children, title }: { children: React.ReactNode; title?: string }) => {
  const [rect, setRect] = useState<Rect>(initial);
  const [mode, setMode] = useState<Mode>('normal');
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ kind: 'move' | Edge; sx: number; sy: number; base: Rect } | null>(null);

  const small =
    isDesktop() || (typeof window !== 'undefined' && window.innerWidth < MIN_W + 40);

  useEffect(() => {
    const onResize = () => setRect((r) => clampRect(r));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startDrag = useCallback(
    (kind: 'move' | Edge) => (e: React.PointerEvent) => {
      if (mode === 'max' && kind !== 'move') return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      drag.current = { kind, sx: e.clientX, sy: e.clientY, base: rect };
      setBusy(true);
    },
    [rect, mode],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      const b = d.base;

      if (d.kind === 'move') {
        if (mode === 'max') {
          setMode('normal');
          const w = b.w;
          const nx = Math.max(0, e.clientX - w / 2);
          drag.current = { ...d, base: { ...b, x: nx, y: 0 }, sx: e.clientX, sy: e.clientY };
          setRect(clampRect({ ...b, x: nx, y: 0 }));
          return;
        }
        setRect(clampRect({ ...b, x: b.x + dx, y: b.y + dy }));
        return;
      }

      let { x, y, w, h } = b;
      const k = d.kind;
      if (k.includes('e')) w = b.w + dx;
      if (k.includes('s')) h = b.h + dy;
      if (k.includes('w')) {
        w = b.w - dx;
        x = b.x + dx;
        if (w < MIN_W) x = b.x + (b.w - MIN_W);
      }
      if (k.includes('n')) {
        h = b.h - dy;
        y = b.y + dy;
        if (h < MIN_H) y = b.y + (b.h - MIN_H);
      }
      setRect(clampRect({ x, y, w, h }));
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
  }, [mode]);

  const toggleMax = () => setMode((m) => (m === 'max' ? 'normal' : 'max'));

  if (small) return <div className="h-screen overflow-hidden">{children}</div>;

  if (closed) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-muted px-6 text-center">
        <img src={LOGO_URL} alt={APP_NAME} className="h-20 w-auto" />
        <div>
          <div className="font-head text-[1.4rem] font-black uppercase tracking-[-0.02em]">
            Программа закрыта
          </div>
          <p className="mt-2 text-[0.9rem] text-muted-foreground">
            Все несохранённые изменения удалены
          </p>
        </div>
        <button
          className="btn-block"
          onClick={() => {
            setClosed(false);
            setMode('normal');
            setRect(initial());
          }}
        >
          <Icon name="Play" size={16} />
          Запустить снова
        </button>
      </div>
    );
  }

  const style =
    mode === 'max'
      ? { left: 0, top: 0, width: '100vw', height: '100vh' }
      : mode === 'min'
        ? { left: 24, top: window.innerHeight - BAR - 24, width: 340, height: BAR }
        : { left: rect.x, top: rect.y, width: rect.w, height: rect.h };

  const grips: { k: Edge; cls: string }[] = [
    { k: 'n', cls: 'left-3 right-3 top-0 h-1.5 cursor-ns-resize' },
    { k: 's', cls: 'left-3 right-3 bottom-0 h-1.5 cursor-ns-resize' },
    { k: 'w', cls: 'top-3 bottom-3 left-0 w-1.5 cursor-ew-resize' },
    { k: 'e', cls: 'top-3 bottom-3 right-0 w-1.5 cursor-ew-resize' },
    { k: 'nw', cls: 'left-0 top-0 h-3 w-3 cursor-nwse-resize' },
    { k: 'ne', cls: 'right-0 top-0 h-3 w-3 cursor-nesw-resize' },
    { k: 'sw', cls: 'left-0 bottom-0 h-3 w-3 cursor-nesw-resize' },
    { k: 'se', cls: 'right-0 bottom-0 h-3 w-3 cursor-nwse-resize' },
  ];

  return (
    <div className="fixed inset-0 overflow-hidden bg-muted">
      <div
        className="absolute flex flex-col overflow-hidden border border-foreground bg-background shadow-[0_24px_60px_rgba(20,24,28,0.28)]"
        style={{ ...style, transition: busy ? 'none' : 'all 160ms ease' }}
      >
        <div
          onPointerDown={startDrag('move')}
          onDoubleClick={toggleMax}
          className={`flex h-10 shrink-0 select-none items-center gap-2 border-b border-foreground bg-foreground px-3 text-background ${
            mode === 'min' ? '' : 'cursor-move'
          }`}
        >
          <img src={LOGO_URL} alt="" className="h-5 w-auto" />
          <span className="truncate font-head text-[0.74rem] font-bold uppercase tracking-[0.1em]">
            {title || APP_NAME}
          </span>

          <div className="ml-auto flex items-center" onPointerDown={(e) => e.stopPropagation()}>
            <button
              onClick={() => setMode(mode === 'min' ? 'normal' : 'min')}
              title="Свернуть"
              className="flex h-10 w-11 items-center justify-center transition-colors hover:bg-background/20"
            >
              <Icon name="Minus" size={15} />
            </button>
            <button
              onClick={toggleMax}
              title={mode === 'max' ? 'Восстановить' : 'Развернуть'}
              className="flex h-10 w-11 items-center justify-center transition-colors hover:bg-background/20"
            >
              <Icon name={mode === 'max' ? 'Copy' : 'Square'} size={13} />
            </button>
            <button
              onClick={() => setClosed(true)}
              title="Закрыть"
              className="flex h-10 w-11 items-center justify-center transition-colors hover:bg-destructive"
            >
              <Icon name="X" size={16} />
            </button>
          </div>
        </div>

        {mode !== 'min' && <div className="min-h-0 flex-1 overflow-hidden">{children}</div>}

        {mode === 'normal' &&
          grips.map((g) => (
            <div
              key={g.k}
              onPointerDown={startDrag(g.k)}
              className={`absolute z-50 ${g.cls}`}
            />
          ))}

        {mode === 'normal' && (
          <div className="pointer-events-none absolute bottom-0.5 right-0.5 text-muted-foreground">
            <Icon name="GripVertical" size={12} className="rotate-45" />
          </div>
        )}
      </div>
    </div>
  );
};

export default AppWindow;