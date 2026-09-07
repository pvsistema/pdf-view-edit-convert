import { memo, useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { renderPage, pageSize, screenDensity, findOnPage, pageText, PRIORITY, type TextHit } from '@/lib/pdf';
import type { Annot, PageMeta } from '@/context/DocContext';
import type { Tool } from '@/components/app/Viewer';
import TextLayer from '@/components/app/TextLayer';
import PageMenu, { type MenuPoint, type MenuActions } from '@/components/app/PageMenu';
import { toast } from '@/hooks/use-toast';

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
  onRemoveMark,
  menuActions,
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

  const [menu, setMenu] = useState<MenuPoint | null>(null);

  // Правая кнопка открывает меню с копированием.
  // Если пользователь ничего не выделил, но щёлкнул по слову —
  // подхватываем это слово, чтобы копировать было что
  const rightClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== 'hand') return;
    e.preventDefault();

    const sel = window.getSelection();
    let text = sel?.toString() ?? '';
    const sheet = e.currentTarget.getBoundingClientRect();
    let spans: { x: number; y: number; w: number; h: number }[] = [];

    // Запоминаем, где именно лежит выделенное: замазывание и удаление
    // должны накрыть ровно эти слова
    const toSpan = (r: DOMRect) => ({
      x: (r.left - sheet.left) / sheet.width,
      y: (r.top - sheet.top) / sheet.height,
      w: r.width / sheet.width,
      h: r.height / sheet.height,
    });

    if (text.trim() && sel && sel.rangeCount > 0) {
      const rects = Array.from(sel.getRangeAt(0).getClientRects());
      spans = rects
        // Строки за пределами этого листа не наши: выделение могло
        // растянуться на соседние страницы ленты
        .filter((r) => r.width > 0 && r.bottom > sheet.top && r.top < sheet.bottom)
        .map(toSpan);
    }

    if (!text.trim()) {
      const target = e.target as HTMLElement | null;
      const word = target?.closest('.pvs-text-layer span');
      text = (word?.textContent ?? '').trim();
      if (word) spans = [toSpan(word.getBoundingClientRect())];
    }

    setMenu({ x: e.clientX, y: e.clientY, text, spans });
  };

  // Весь текст листа — на случай, когда выделять вручную неудобно
  const copyPageText = async () => {
    if (!doc) return;
    const text = await pageText(doc, page.src);
    if (!text.trim()) {
      toast({
        title: 'На странице нет текста',
        description: 'Похоже, это скан. Распознайте его в инструментах',
      });
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => toast({ title: 'Текст страницы скопирован' }))
      .catch(() => toast({ title: 'Не удалось скопировать' }));
  };

  const click = (e: React.MouseEvent<HTMLDivElement>) => {
    // Надпись ставится щелчком, а закраска — протяжкой,
    // поэтому по щелчку её не создаём
    if (tool !== 'text') return;
    const rect = e.currentTarget.getBoundingClientRect();
    onPlace(page, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  };

  // Рамка, которую человек тянет мышью, чтобы закрасить область целиком
  const [frame, setFrame] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null,
  );
  const dragging = useRef(false);

  const spot = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const dragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== 'block' || e.button !== 0) return;
    e.preventDefault();
    const p = spot(e);
    dragging.current = true;
    setFrame({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  };

  const dragMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const p = spot(e);
    setFrame((f) => (f ? { ...f, x2: p.x, y2: p.y } : f));
  };

  const dragEnd = () => {
    if (!dragging.current || !frame) return;
    dragging.current = false;
    const x = Math.min(frame.x1, frame.x2);
    const y = Math.min(frame.y1, frame.y2);
    const w = Math.abs(frame.x2 - frame.x1);
    const h = Math.abs(frame.y2 - frame.y1);
    setFrame(null);
    // Случайный щелчок без протяжки не должен оставлять точку на листе
    if (w < 0.004 || h < 0.004) return;
    onCover(page, x, y, w, h);
  };

  return (
    <div ref={box} data-sheet={index} className="mb-6 flex flex-col items-center">
      <div
        className={`relative bg-white shadow-[0_2px_14px_rgba(20,24,28,0.16)] ${
          tool === 'hand' ? '' : 'cursor-crosshair'
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

        {/* Рамка под курсором: показывает, что именно будет закрашено */}
        {frame && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-foreground bg-foreground/25"
            style={{
              left: `${Math.min(frame.x1, frame.x2) * 100}%`,
              top: `${Math.min(frame.y1, frame.y2) * 100}%`,
              width: `${Math.abs(frame.x2 - frame.x1) * 100}%`,
              height: `${Math.abs(frame.y2 - frame.y1) * 100}%`,
            }}
          />
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
                style={{
                  background: m.color,
                  // Пометка по выделенному тексту закрывает ровно его,
                  // поэтому размеры считаем от страницы, а не от шрифта
                  width: m.w ? `${m.w * width}px` : `${m.size * 8}px`,
                  height: m.h ? `${m.h * height}px` : `${m.size * 1.5}px`,
                }}
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