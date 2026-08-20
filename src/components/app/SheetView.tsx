import { memo, useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { renderPage, pageSize, screenDensity, findOnPage, PRIORITY, type TextHit } from '@/lib/pdf';
import type { Annot, PageMeta } from '@/context/DocContext';
import type { Tool } from '@/components/app/Viewer';

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
  onRemoveMark: (id: string) => void;
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
  onRemoveMark,
}: Props) => {
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [spots, setSpots] = useState<TextHit[]>([]);

  // Следим, близко ли лист к экрану
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setNear(entries[0]?.isIntersecting ?? false), {
      root: null,
      rootMargin: '900px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Точный размер узнаём только у листов рядом с экраном. Иначе документ
  // на тысячу страниц пришлось бы прочитать целиком ради одних размеров
  useEffect(() => {
    let off = false;
    if (!doc || !near) return;
    pageSize(doc, page.src, page.rotation)
      .then((s) => !off && setSize(s))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [doc, page.src, page.rotation, near]);

  useEffect(() => {
    let off = false;
    if (!near) {
      // Лист далеко — освобождаем картинку, память не копится
      if (host.current) host.current.innerHTML = '';
      setDrawn(false);
      return;
    }
    if (!doc) return;
    renderPage(doc, page.src, zoom, page.rotation, screenDensity(), PRIORITY.view)
      .then((canvas) => {
        if (off || !host.current) return;
        host.current.innerHTML = '';
        canvas.className = 'block';
        host.current.appendChild(canvas);
        setDrawn(true);
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [near, doc, page.src, page.rotation, zoom]);

  // Подсветка найденного
  useEffect(() => {
    let off = false;
    if (!found || !near || !doc) {
      setSpots([]);
      return;
    }
    findOnPage(doc, page.src, found, page.rotation)
      .then((list) => !off && setSpots(list))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [found, near, doc, page.src, page.rotation]);

  // Пока точный размер неизвестен, берём размер первой страницы:
  // в обычном документе листы одинаковые, и лента не дёргается
  const guess = size ?? hint;
  const width = guess ? guess.w * zoom : 700;
  const height = guess ? guess.h * zoom : 990;

  const click = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool === 'hand') return;
    const rect = e.currentTarget.getBoundingClientRect();
    onPlace(page, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  };

  return (
    <div ref={box} data-sheet={index} className="mb-6 flex flex-col items-center">
      <div
        className={`relative bg-white shadow-[0_2px_14px_rgba(20,24,28,0.16)] ${
          tool === 'hand' ? '' : 'cursor-crosshair'
        }`}
        style={{ width: `${width}px`, height: `${height}px` }}
        onClick={click}
      >
        <div ref={host} />

        {!drawn && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon name="LoaderCircle" size={20} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {spots.map((s, i) => (
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
        ))}

        {marks.map((m) => (
          <div
            key={m.id}
            className="group absolute"
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
          >
            {m.kind === 'block' ? (
              <div
                style={{ background: m.color, width: `${m.size * 8}px`, height: `${m.size * 1.5}px` }}
              />
            ) : (
              <span style={{ color: m.color, fontSize: `${m.size}px`, whiteSpace: 'nowrap' }}>
                {m.text}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveMark(m.id);
              }}
              className="absolute -right-5 -top-2 hidden bg-destructive p-0.5 text-destructive-foreground group-hover:block"
              title="Удалить"
            >
              <Icon name="X" size={12} />
            </button>
          </div>
        ))}
      </div>

      <span className="mt-2 font-head text-[0.72rem] font-bold text-muted-foreground">
        Стр. {index + 1}
      </span>
    </div>
  );
};

export default memo(SheetView);