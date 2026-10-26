import { useEffect, useRef } from 'react';
import Icon from '@/components/ui/icon';
import Shape from '@/components/app/Shape';
import type { TextHit } from '@/lib/pdf';
import type { Tool } from '@/components/app/Viewer';

type Frame = { x1: number; y1: number; x2: number; y2: number };

// Подсказка под курсором: видно, что получится, ещё до того
// как отпустили кнопку
export const SheetDragPreview = ({
  frame,
  tool,
  fill,
  width,
  height,
}: {
  frame: Frame;
  tool: Tool;
  fill: string;
  width: number;
  height: number;
}) => (
  <div
    className="pointer-events-none absolute"
    style={{
      left: `${Math.min(frame.x1, frame.x2) * 100}%`,
      top: `${Math.min(frame.y1, frame.y2) * 100}%`,
      width: `${Math.abs(frame.x2 - frame.x1) * 100}%`,
      height: `${Math.abs(frame.y2 - frame.y1) * 100}%`,
      opacity: 0.65,
    }}
  >
    {tool === 'block' ? (
      // Полупрозрачная заливка выбранным цветом: сразу видно,
      // каким он ляжет на лист
      <div
        className="h-full w-full border-2 border-dashed border-foreground"
        style={{ background: fill }}
      />
    ) : (
      <Shape
        kind={tool as 'arrow' | 'line' | 'rect' | 'oval'}
        color={fill}
        w={Math.abs(frame.x2 - frame.x1) * width}
        h={Math.abs(frame.y2 - frame.y1) * height}
        flipX={frame.x2 < frame.x1}
        flipY={frame.y2 < frame.y1}
      />
    )}
  </div>
);

// Найденные слова и значки замечаний — то, что лежит поверх листа,
// но пометками не является
// Текущее совпадение: при каждом переходе (seq меняется) подводим его
// в поле зрения. Только при переходе — если человек сам листает дальше,
// лента не прыгает обратно
const CurrentHit = ({ s, seq }: { s: TextHit; seq: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const box = el.closest('[data-scroller]')?.getBoundingClientRect();
    const top = box ? box.top : 0;
    const bottom = box ? box.bottom : window.innerHeight;
    const left = box ? box.left : 0;
    const right = box ? box.right : window.innerWidth;
    if (r.top < top + 40 || r.bottom > bottom - 40 || r.left < left || r.right > right)
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [seq]);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 bg-orange-400/70 outline outline-2 outline-orange-600 mix-blend-multiply"
      style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` }}
    />
  );
};

// Подсветка найденного. Текущее совпадение (к которому перешли по F3
// или стрелкам) — ярче и в рамке, остальные — бледно-жёлтые
export const SheetHits = ({
  spots,
  current,
  notes,
  onOpenNote,
}: {
  spots: TextHit[];
  // Какое по счёту совпадение на этой странице текущее, сколько их
  // на странице по тексту, и номер перехода. Если места на листе
  // не сходятся с текстом (фраза разбита на куски), особо не выделяем
  current?: { k: number; n: number; seq: number } | null;
  notes?: { id: string; x: number; y: number; done?: boolean; author: string }[];
  onOpenNote?: (id: string) => void;
}) => {
  const whole = spots.filter((s) => s.whole);
  const cur = current && whole.length === current.n ? whole[current.k] : undefined;
  return (
  <>
    {spots.map((s, i) =>
      s === cur ? (
        <CurrentHit key={`hit-${i}`} s={s} seq={current!.seq} />
      ) : (
        <div
          key={`hit-${i}`}
          className="pointer-events-none absolute bg-yellow-300/50 mix-blend-multiply"
          style={{
            left: `${s.x * 100}%`,
            top: `${s.y * 100}%`,
            width: `${s.w * 100}%`,
            height: `${s.h * 100}%`,
          }}
        />
      ),
    )}

    {/* Значки заметок: сам текст замечания живёт в боковой панели,
        на листе остаётся только метка места */}
    {(notes ?? []).map((n) => (
      <button
        key={n.id}
        onClick={(e) => {
          e.stopPropagation();
          onOpenNote?.(n.id);
        }}
        title={`Замечание — ${n.author}`}
        style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
        className={`absolute z-20 -translate-x-1/2 -translate-y-full p-1 shadow-md transition-transform hover:scale-110 ${
          n.done ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'
        }`}
      >
        <Icon name="MessageSquare" size={13} />
      </button>
    ))}
  </>
  );
};

export default SheetHits;
