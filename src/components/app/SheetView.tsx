import { memo, useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import Shape from '@/components/app/Shape';
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

// Светлый ли цвет: на белом листе такую заливку почти не видно
const isPale = (hex: string) => {
  const v = hex.replace('#', '');
  if (v.length < 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 190;
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
    const rect = e.currentTarget.getBoundingClientRect();

    // Пипетка: берём цвет ровно той точки листа, куда попал курсор
    if (picking) {
      const canvas = host.current?.querySelector('canvas') as HTMLCanvasElement | null;
      if (!canvas) return;
      const px = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
      const py = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const data = ctx?.getImageData(px, py, 1, 1).data;
      if (!data) return;
      const hex = `#${[data[0], data[1], data[2]]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')}`.toUpperCase();
      onPick?.(hex);
      return;
    }

    // Заметка встаёт там, куда щёлкнули: значок остаётся на листе,
    // а сам текст живёт в панели замечаний
    if (tool === 'note') {
      onNote?.(
        page,
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      );
      return;
    }

    // Надпись ставится щелчком, а закраска — протяжкой,
    // поэтому по щелчку её не создаём
    if (tool !== 'text') return;
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

  // Протяжкой мыши рисуются и закраска, и фигуры
  const DRAWN = ['block', 'arrow', 'line', 'rect', 'oval'];

  const dragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    // Пока включена пипетка, рамку не тянем: щелчок берёт цвет
    if (!DRAWN.includes(tool) || e.button !== 0 || picking) return;
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

    // Фигуры: стрелка и линия могут быть почти вертикальными или
    // горизонтальными, поэтому им хватает длины хотя бы по одной стороне
    if (tool !== 'block') {
      const thin = tool === 'arrow' || tool === 'line';
      if (thin ? w < 0.01 && h < 0.01 : w < 0.01 || h < 0.01) return;
      onShape?.(page, x, y, w, h, tool as 'arrow' | 'line' | 'rect' | 'oval', {
        flipX: frame.x2 < frame.x1,
        flipY: frame.y2 < frame.y1,
      });
      return;
    }

    // Случайный щелчок без протяжки не должен оставлять точку на листе
    if (w < 0.004 || h < 0.004) return;
    onCover(page, x, y, w, h);
  };

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

        {/* Подсказка под курсором: видно, что получится, ещё до того
            как отпустили кнопку */}
        {frame && (
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

        {marks.map((m) => (
          <div
            key={m.id}
            className="group absolute"
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
          >
            {m.kind === 'arrow' || m.kind === 'line' || m.kind === 'rect' || m.kind === 'oval' ? (
              // Фигуры рисуем вектором: они остаются чёткими на любом
              // масштабе и не съедают память под большие картинки
              <Shape
                kind={m.kind}
                color={m.color}
                w={(m.w ?? 0.1) * width}
                h={(m.h ?? 0.05) * height}
                flipX={m.flipX}
                flipY={m.flipY}
              />
            ) : m.kind === 'mark' ? (
              // Маркер: полупрозрачная полоса поверх строки.
              // Умножение цветов оставляет буквы читаемыми — как настоящий
              // текстовыделитель по бумаге
              <div
                className="mix-blend-multiply"
                style={{
                  background: m.color,
                  width: m.w ? `${m.w * width}px` : `${m.size * 8}px`,
                  height: m.h ? `${m.h * height}px` : `${m.size * 1.5}px`,
                }}
              />
            ) : m.kind === 'under' || m.kind === 'strike' ? (
              // Линия под текстом или поперёк него: толщину берём от высоты
              // строки, чтобы на любом масштабе выглядела одинаково
              <div
                style={{
                  width: m.w ? `${m.w * width}px` : `${m.size * 8}px`,
                  height: m.h ? `${m.h * height}px` : `${m.size * 1.5}px`,
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    height: `${Math.max(1.2, (m.h ? m.h * height : m.size * 1.5) * 0.07)}px`,
                    background: m.color,
                    // Подчёркивание ведём по самому низу строки, иначе
                    // линия липнет к буквам и читается как зачёркивание
                    top: m.kind === 'under' ? undefined : '50%',
                    bottom: m.kind === 'under' ? '-6%' : undefined,
                    transform: m.kind === 'strike' ? 'translateY(-50%)' : undefined,
                  }}
                />
              </div>
            ) : m.kind === 'block' ? (
              <div
                style={{
                  background: m.color,
                  // Пометка по выделенному тексту закрывает ровно его,
                  // поэтому размеры считаем от страницы, а не от шрифта
                  width: m.w ? `${m.w * width}px` : `${m.size * 8}px`,
                  height: m.h ? `${m.h * height}px` : `${m.size * 1.5}px`,
                  // Светлую заливку на белом листе не видно — обводим её
                  // еле заметной рамкой, чтобы пометку можно было найти
                  // и убрать. В сохранённый файл рамка не попадает
                  outline: isPale(m.color) ? '1px dashed rgba(20,24,28,.28)' : undefined,
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