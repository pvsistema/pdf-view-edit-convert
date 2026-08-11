import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { renderPage, pageText, screenDensity, prefetchPage } from '@/lib/pdf';
import { useDoc } from '@/context/DocContext';

export type Tool = 'hand' | 'text' | 'block';

type Props = { tool: Tool; setTool: (t: Tool) => void };

const Viewer = ({ tool, setTool }: Props) => {
  const { pages, active, setActive, docOf, rotate, version, annots, addAnnot, removeAnnot } = useDoc();
  const host = useRef<HTMLDivElement>(null);
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
    renderPage(doc, page.src, zoom, page.rotation, density).then((canvas) => {
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
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div className="flex items-center border border-border bg-background">
          <button
            className="px-3 py-2 hover:bg-card disabled:opacity-30"
            onClick={() => setActive(Math.max(0, active - 1))}
            disabled={active === 0}
            title="Предыдущая страница"
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
            title="Следующая страница"
          >
            <Icon name="ChevronRight" size={16} />
          </button>
        </div>

        <div className="flex items-center border border-border bg-background">
          <button
            className="px-3 py-2 hover:bg-card"
            onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))}
            title="Уменьшить"
          >
            <Icon name="Minus" size={16} />
          </button>
          <span className="px-2 font-head text-[0.82rem] font-bold">{Math.round(zoom * 100)}%</span>
          <button
            className="px-3 py-2 hover:bg-card"
            onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))}
            title="Увеличить"
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

      <div className="relative flex-1 overflow-auto bg-muted p-6">
        {busy && (
          <div className="absolute right-6 top-6 z-20 flex items-center gap-2 border border-border bg-background px-3 py-2 text-[0.8rem]">
            <Icon name="LoaderCircle" size={14} className="animate-spin text-primary" />
            Обработка
          </div>
        )}
        <div className="mx-auto w-fit">
          <div
            className={`relative ${tool === 'hand' ? '' : 'cursor-crosshair'}`}
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