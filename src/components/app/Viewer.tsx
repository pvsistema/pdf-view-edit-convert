import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { renderPage, pageText, screenDensity, prefetchPage, PRIORITY } from '@/lib/pdf';
import { useDoc } from '@/context/DocContext';

export type Tool = 'hand' | 'text' | 'block';

type Props = { tool: Tool; setTool: (t: Tool) => void };

const Viewer = ({ tool, setTool }: Props) => {
  const { pages, active, setActive, docOf, rotate, version, annots, addAnnot, removeAnnot } = useDoc();
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const flipAt = useRef(0);
  const [zoom, setZoom] = useState(1.2);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<number[] | null>(null);

  const page = pages[active];

  useEffect(() => {
    let cancelled = false;
    if (!page || !host.current) return;
    const doc = docOf(page);
    if (!doc) return;
    const density = screenDensity();
    // Готовую страницу показываем сразу, надпись "Обработка"
    // появляется только если отрисовка действительно затянулась
    const slow = setTimeout(() => !cancelled && setBusy(true), 180);
    renderPage(doc, page.src, zoom, page.rotation, density, PRIORITY.view).then((canvas) => {
      clearTimeout(slow);
      if (cancelled || !host.current) return;
      host.current.innerHTML = '';
      canvas.className = 'block';
      host.current.appendChild(canvas);
      setBusy(false);

      // Готовим соседние страницы заранее — переход к ним будет мгновенным
      for (const step of [1, -1, 2, -2]) {
        const near = pages[active + step];
        if (!near) continue;
        const nearDoc = docOf(near);
        if (nearDoc) prefetchPage(nearDoc, near.src, zoom, near.rotation, density);
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(slow);
    };
  }, [page, zoom, docOf, version, active, pages]);

  const go = useCallback(
    (step: number) => {
      setActive((i: number) => Math.min(pages.length - 1, Math.max(0, i + step)));
    },
    [pages.length, setActive],
  );

  // Управление с клавиатуры: стрелки и PageUp/PageDown листают страницы,
  // Ctrl и + / - меняют масштаб, Home и End — первая и последняя страница
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;

      // Пока открыто окно печати или другое диалоговое окно, клавиши не трогаем
      if (document.querySelector('.fixed.inset-0')) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)));
        } else if (e.key === '-') {
          e.preventDefault();
          setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)));
        } else if (e.key === '0') {
          e.preventDefault();
          setZoom(1.2);
        }
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActive(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActive(pages.length - 1);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, pages.length, setActive]);

  // Колесо мыши: прокрутка листает страницы, а с Ctrl меняет масштаб
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoom((z) =>
          e.deltaY > 0 ? Math.max(0.4, +(z - 0.2).toFixed(2)) : Math.min(3, +(z + 0.2).toFixed(2)),
        );
        return;
      }

      // Пока страница не прокручена до края, крутим её саму
      const atTop = box.scrollTop <= 0;
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
      const now = Date.now();
      if (now - flipAt.current < 280) return;

      if (e.deltaY > 0 && atBottom && active < pages.length - 1) {
        flipAt.current = now;
        go(1);
        requestAnimationFrame(() => (box.scrollTop = 0));
      } else if (e.deltaY < 0 && atTop && active > 0) {
        flipAt.current = now;
        go(-1);
        requestAnimationFrame(() => (box.scrollTop = box.scrollHeight));
      }
    };

    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [active, pages.length, go]);

  const search = async () => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setHits(null);
      return;
    }
    setBusy(true);
    const found: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      const doc = docOf(pages[i]);
      if (!doc) continue;
      const text = (await pageText(doc, pages[i].src)).toLowerCase();
      if (text.includes(q)) found.push(i);
    }
    setHits(found);
    setBusy(false);
    if (found.length) setActive(found[0]);
  };

  const place = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool === 'hand' || !page) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (tool === 'text') {
      const text = window.prompt('Текст надписи');
      if (!text) return;
      addAnnot({ pageUid: page.uid, x, y, text, size: 14, color: '#14181C', kind: 'text' });
    } else {
      addAnnot({ pageUid: page.uid, x, y, text: '', size: 14, color: '#14181C', kind: 'block' });
    }
  };

  if (!page) return null;

  const marks = annots.filter((a) => a.pageUid === page.uid);

  const toolBtn = (id: Tool, icon: string, title: string) => (
    <button
      className={`px-3 py-2 transition-colors ${tool === id ? 'bg-primary text-primary-foreground' : 'hover:bg-card'}`}
      onClick={() => setTool(id)}
      title={title}
    >
      <Icon name={icon} size={16} />
    </button>
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div className="flex items-center border border-border bg-background">
          <button
            className="px-3 py-2 hover:bg-card disabled:opacity-30"
            onClick={() => setActive(Math.max(0, active - 1))}
            disabled={active === 0}
            title="Предыдущая страница (стрелка влево)"
          >
            <Icon name="ChevronLeft" size={16} />
          </button>
          <span className="px-3 font-head text-[0.82rem] font-bold">
            {active + 1} / {pages.length}
          </span>
          <button
            className="px-3 py-2 hover:bg-card disabled:opacity-30"
            onClick={() => setActive(Math.min(pages.length - 1, active + 1))}
            disabled={active === pages.length - 1}
            title="Следующая страница (стрелка вправо)"
          >
            <Icon name="ChevronRight" size={16} />
          </button>
        </div>

        <div className="flex items-center border border-border bg-background">
          <button
            className="px-3 py-2 hover:bg-card"
            onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))}
            title="Уменьшить (Ctrl и колесо мыши)"
          >
            <Icon name="Minus" size={16} />
          </button>
          <button
            className="px-2 font-head text-[0.82rem] font-bold hover:bg-card"
            onClick={() => setZoom(1.2)}
            title="Обычный масштаб (Ctrl и 0)"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="px-3 py-2 hover:bg-card"
            onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))}
            title="Увеличить (Ctrl и колесо мыши)"
          >
            <Icon name="Plus" size={16} />
          </button>
        </div>

        <div className="flex items-center border border-border bg-background">
          <button className="px-3 py-2 hover:bg-card" onClick={() => rotate(page.uid, -90)} title="Повернуть влево">
            <Icon name="RotateCcw" size={16} />
          </button>
          <button className="px-3 py-2 hover:bg-card" onClick={() => rotate(page.uid, 90)} title="Повернуть вправо">
            <Icon name="RotateCw" size={16} />
          </button>
        </div>

        <div className="flex items-center border border-border bg-background">
          {toolBtn('hand', 'MousePointer2', 'Просмотр')}
          {toolBtn('text', 'Type', 'Добавить надпись')}
          {toolBtn('block', 'Square', 'Закрасить данные')}
        </div>

        <div className="ml-auto flex items-center border border-border bg-background">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Поиск по документу"
            className="w-[180px] bg-transparent px-3 py-2 text-[0.86rem] outline-none"
          />
          <button className="px-3 py-2 text-primary hover:bg-card" onClick={search} title="Найти">
            <Icon name="Search" size={16} />
          </button>
        </div>
      </div>

      {hits && (
        <div className="border-b border-border bg-background px-4 py-2 text-[0.8rem] text-muted-foreground">
          {hits.length
            ? `Найдено на страницах: ${hits.map((h) => h + 1).join(', ')}`
            : 'Совпадений не найдено'}
        </div>
      )}

      <div ref={scroller} className="relative flex flex-1 overflow-auto bg-muted">
        {busy && (
          <div className="absolute right-6 top-6 z-20 flex items-center gap-2 border border-border bg-background px-3 py-2 text-[0.8rem]">
            <Icon name="LoaderCircle" size={14} className="animate-spin text-primary" />
            Обработка
          </div>
        )}
        {/* Страница стоит по центру окна, а при увеличении
            остаётся доступной прокрутка во все стороны */}
        <div className="m-auto p-6">
          <div
            className={`relative shadow-[0_2px_14px_rgba(20,24,28,0.16)] ${tool === 'hand' ? '' : 'cursor-crosshair'}`}
            onClick={place}
          >
            <div ref={host} />
            {marks.map((m) => (
              <div
                key={m.id}
                className="group absolute"
                style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
              >
                {m.kind === 'block' ? (
                  <div style={{ background: m.color, width: `${m.size * 8}px`, height: `${m.size * 1.5}px` }} />
                ) : (
                  <span style={{ color: m.color, fontSize: `${m.size}px`, whiteSpace: 'nowrap' }}>
                    {m.text}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAnnot(m.id);
                  }}
                  className="absolute -right-5 -top-2 hidden bg-destructive p-0.5 text-destructive-foreground group-hover:block"
                  title="Удалить"
                >
                  <Icon name="X" size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Viewer;