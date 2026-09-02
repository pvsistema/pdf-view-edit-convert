import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { pageText, pageSize } from '@/lib/pdf';
import { useDoc } from '@/context/DocContext';
import { useTabActive } from '@/context/TabsContext';
import SheetView from '@/components/app/SheetView';
import { onSearchRequest } from '@/lib/searchBus';

export type Tool = 'hand' | 'text' | 'block';

type Props = { tool: Tool; setTool: (t: Tool) => void };

const Viewer = ({ tool, setTool }: Props) => {
  const { pages, active, setActive, docOf, rotate, annots, addAnnot, removeAnnot } = useDoc();
  // Клавиши слушает только вкладка, открытая на экране
  const onScreen = useTabActive();
  const scroller = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  // Пока идёт переход к странице по кнопке, номер не пересчитываем
  const jumping = useRef(false);
  // Через эту ссылку клавиша F3 попадает к переходу по находкам
  const jumpRef = useRef<(dir: number) => void>(() => undefined);
  const [zoom, setZoomRaw] = useState(1.2);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<number[] | null>(null);
  // Что именно ищем сейчас — по нему подсвечиваем найденное на странице
  const [found, setFound] = useState('');
  // Разворот: два листа рядом, как в раскрытой книге.
  // Выбор запоминается до следующего запуска программы
  const [spread, setSpread] = useState(() => {
    try {
      return localStorage.getItem('pvs-spread') === '1';
    } catch {
      return false;
    }
  });

  // Подгонка масштаба: по ширине окна или страница целиком.
  // Пока режим включён, масштаб пересчитывается при смене размера окна
  const [fit, setFit] = useState<'none' | 'width' | 'page'>('none');

  // Размер первой страницы — ориентир для всей ленты. Благодаря ему полоса
  // прокрутки сразу верной длины, а файл не читается целиком ради размеров
  const [hint, setHint] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let off = false;
    const first = pages[0];
    const doc = first && docOf(first);
    if (!doc) {
      setHint(null);
      return;
    }
    pageSize(doc, first.src, first.rotation)
      .then((s) => !off && setHint(s))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [pages, docOf]);

  // Как только масштаб меняют вручную, подгонка выключается
  const setZoom: typeof setZoomRaw = (v) => {
    setFit('none');
    setZoomRaw(v);
  };

  const page = pages[active];

  // В режиме разворота листы идут парами: первая страница — обложка,
  // дальше чётная слева и нечётная справа, как в печатной книге
  const rows = useMemo(() => {
    if (!spread) return pages.map((p, i) => [{ p, i }]);
    const out: { p: (typeof pages)[number]; i: number }[][] = [];
    if (pages[0]) out.push([{ p: pages[0], i: 0 }]);
    for (let i = 1; i < pages.length; i += 2) {
      const pair = [{ p: pages[i], i }];
      if (pages[i + 1]) pair.push({ p: pages[i + 1], i: i + 1 });
      out.push(pair);
    }
    return out;
  }, [pages, spread]);

  // Номер страницы, к которому лента уже подведена. Пока он совпадает
  // с текущим, самовольных перелётов не делаем
  const lastJump = useRef(active);

  // Подводим ленту к нужному месту. Вблизи — плавно, издалека — сразу:
  // на длинном документе плавный перелёт через тысячи листов идёт долго
  // и рвано, ведь листы вдали ещё не нарисованы и их высота уточняется
  // на лету, из-за чего цель уезжает прямо во время движения
  const scrollTo = useCallback((top: number) => {
    const box = scroller.current;
    if (!box) return;
    const target = Math.max(0, top);
    const far = Math.abs(target - box.scrollTop) > box.clientHeight * 3;
    jumping.current = true;
    box.scrollTo({ top: target, behavior: far ? 'auto' : 'smooth' });
    // Пока лента едет, номер страницы не пересчитываем: иначе
    // промежуточные листы перебивали бы выбранную цель
    window.setTimeout(() => (jumping.current = false), far ? 60 : 420);
  }, []);

  const scrollToPage = useCallback(
    (i: number) => {
      const box = scroller.current;
      const el = box?.querySelector(`[data-sheet="${i}"]`) as HTMLElement | null;
      if (!el) return;
      scrollTo(el.offsetTop - 24);
    },
    [scrollTo],
  );

  // Считаем масштаб так, чтобы лист вписался в окно
  const applyFit = useCallback(
    async (mode: 'width' | 'page') => {
      const box = scroller.current;
      const target = pages[active];
      if (!box || !target) return;
      const doc = docOf(target);
      if (!doc) return;
      const size = await pageSize(doc, target.src, target.rotation);
      // Поля вокруг листа и место под полосу прокрутки
      const padX = 64 + (spread ? 16 + size.w : 0);
      const padY = 88;
      const byWidth = (box.clientWidth - padX) / size.w;
      const scale = mode === 'width' ? byWidth : Math.min(byWidth, (box.clientHeight - padY) / size.h);
      setZoomRaw(Math.max(0.2, Math.min(3, +scale.toFixed(2))));
    },
    [pages, active, docOf, spread],
  );

  // Пока подгонка включена, масштаб следует за размером окна
  useEffect(() => {
    if (fit === 'none') return;
    applyFit(fit);
    const onResize = () => applyFit(fit);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fit, applyFit]);

  const toggleSpread = () => {
    const next = !spread;
    setSpread(next);
    try {
      localStorage.setItem('pvs-spread', next ? '1' : '0');
    } catch {
      /* хранилище недоступно — не страшно */
    }
    // В развороте два листа рядом, поэтому масштаб уменьшается.
    // Если включена подгонка, она сама пересчитается под новый вид
    if (fit === 'none') {
      setZoomRaw((z) =>
        next ? Math.max(0.4, +(z * 0.62).toFixed(2)) : Math.min(3, +(z / 0.62).toFixed(2)),
      );
    }
    setTimeout(() => scrollToPage(active), 80);
  };

  const go = useCallback(
    (step: number) => {
      // В развороте кнопка перелистывает сразу пару листов
      const size = spread && active > 0 ? 2 : 1;
      const next = Math.min(pages.length - 1, Math.max(0, active + step * size));
      setActive(next);
      scrollToPage(next);
    },
    [pages.length, setActive, active, scrollToPage, spread],
  );

  // Управление с клавиатуры: стрелки и PageUp/PageDown листают страницы,
  // Ctrl и + / - меняют масштаб, Home и End — первая и последняя страница
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!onScreen) return;
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

      // Пока открыто окно печати или другое диалоговое окно, клавиши не трогаем
      if (document.querySelector('.fixed.inset-0')) return;

      // Ctrl+F ставит курсор в поле поиска и выделяет прежний запрос,
      // чтобы сразу можно было набрать новый
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А')) {
        e.preventDefault();
        searchBox.current?.focus();
        searchBox.current?.select();
        return;
      }

      // Escape в поле поиска убирает подсветку и возвращает управление документу
      if (e.key === 'Escape' && typing) {
        e.preventDefault();
        setHits(null);
        setFound('');
        setQuery('');
        searchBox.current?.blur();
        return;
      }

      // F3 — переход к следующей найденной странице
      if (e.key === 'F3') {
        e.preventDefault();
        jumpRef.current(e.shiftKey ? -1 : 1);
        return;
      }

      if (typing) return;

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
        } else if (e.key === '1') {
          e.preventDefault();
          setFit('width');
        } else if (e.key === '2') {
          e.preventDefault();
          setFit('page');
        }
        return;
      }

      const box = scroller.current;

      // Стрелки прокручивают ленту плавно, PageUp и PageDown
      // перемещают ровно на страницу
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        box?.scrollBy({ top: 90, behavior: 'smooth' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        box?.scrollBy({ top: -90, behavior: 'smooth' });
      } else if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        // Сначала двигаем ленту, потом ставим номер: так смена номера
        // не запустит встречный перелёт, который дёргал бы прокрутку
        lastJump.current = 0;
        scrollTo(0);
        setActive(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = pages.length - 1;
        lastJump.current = last;
        if (box) {
          scrollTo(box.scrollHeight);
          // Листы в конце ещё не нарисованы, и настоящая высота ленты
          // становится известна лишь после перехода — доводим до низа
          window.setTimeout(() => {
            const b = scroller.current;
            if (b) b.scrollTop = b.scrollHeight;
          }, 120);
        }
        setActive(last);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, pages.length, setActive, onScreen, scrollTo]);

  // Колесо мыши с Ctrl меняет масштаб. Обычная прокрутка идёт
  // непрерывно через все листы, как в привычных читалках PDF
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) =>
        e.deltaY > 0 ? Math.max(0.4, +(z - 0.2).toFixed(2)) : Math.min(3, +(z + 0.2).toFixed(2)),
      );
    };

    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, []);

  // Номер страницы обновляется по ходу прокрутки: показываем тот лист,
  // который занимает середину окна
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;

    let frame = 0;
    const onScroll = () => {
      if (frame || jumping.current) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const middle = box.scrollTop + box.clientHeight / 2;
        const sheets = box.querySelectorAll('[data-sheet]');
        let at = 0;
        for (let i = 0; i < sheets.length; i++) {
          const el = sheets[i] as HTMLElement;
          if (el.offsetTop <= middle) at = i;
          else break;
        }
        // Номер сменился оттого, что человек крутит колесо. Лента уже
        // там, где нужно, — подводить её ещё раз нельзя: встречный
        // плавный перелёт цеплялся бы за прокрутку и дёргал её
        lastJump.current = at;
        setActive((cur: number) => (cur === at ? cur : at));
      });
    };

    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      box.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [setActive, pages.length]);

  // Когда страницу выбирают в левой панели, лента подъезжает к ней.
  // Если же номер сменился от прокрутки колесом, lastJump уже равен
  // новому — и мы ничего не двигаем, не мешая человеку крутить
  useEffect(() => {
    if (lastJump.current === active) return;
    lastJump.current = active;
    const box = scroller.current;
    const el = box?.querySelector(`[data-sheet="${active}"]`) as HTMLElement | null;
    if (!box || !el) return;
    // Если лист и так на виду, ленту не двигаем
    const top = el.offsetTop - box.scrollTop;
    if (top > -40 && top < box.clientHeight * 0.6) return;
    scrollToPage(active);
  }, [active, scrollToPage]);

  // Слово приходит либо из поля поиска, либо из меню по правой кнопке
  const search = async (text?: string) => {
    const q = (text ?? query).trim();
    if (!q) {
      setHits(null);
      setFound('');
      return;
    }
    setBusy(true);
    const low = q.toLowerCase();
    const list: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      const doc = docOf(pages[i]);
      if (!doc) continue;
      const text = (await pageText(doc, pages[i].src)).toLowerCase();
      if (text.includes(low)) list.push(i);
    }
    setHits(list);
    setFound(list.length ? q : '');
    setBusy(false);
    if (list.length) {
      setActive(list[0]);
      scrollToPage(list[0]);
    }
  };

  // Запрос из меню по правой кнопке: слово попадает в поле поиска,
  // чтобы его было видно и можно было поправить
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(
    () =>
      onSearchRequest((text) => {
        if (!onScreen || !text) return;
        setQuery(text);
        void searchRef.current(text);
      }),
    [onScreen],
  );

  // Переход к следующей или предыдущей найденной странице
  const jumpHit = (dir: number) => {
    if (!hits?.length) return;
    const at = hits.indexOf(active);
    const next = at < 0 ? hits[0] : hits[(at + dir + hits.length) % hits.length];
    setActive(next);
    scrollToPage(next);
  };
  jumpRef.current = jumpHit;

  const place = useCallback(
    (target: typeof pages[number], x: number, y: number) => {
      if (tool === 'text') {
        const text = window.prompt('Текст надписи');
        if (!text) return;
        addAnnot({ pageUid: target.uid, x, y, text, size: 14, color: '#14181C', kind: 'text' });
      } else if (tool === 'block') {
        addAnnot({ pageUid: target.uid, x, y, text: '', size: 14, color: '#14181C', kind: 'block' });
      }
    },
    [tool, addAnnot],
  );

  if (!page) return null;

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
            onClick={() => go(-1)}
            disabled={active === 0}
            title="Предыдущая страница (PageUp)"
          >
            <Icon name="ChevronLeft" size={16} />
          </button>
          <span className="px-3 font-head text-[0.82rem] font-bold">
            {active + 1} / {pages.length}
          </span>
          <button
            className="px-3 py-2 hover:bg-card disabled:opacity-30"
            onClick={() => go(1)}
            disabled={active === pages.length - 1}
            title="Следующая страница (PageDown)"
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
          <button
            className={`border-l border-border px-3 py-2 transition-colors ${
              fit === 'width' ? 'bg-primary text-primary-foreground' : 'hover:bg-card'
            }`}
            onClick={() => setFit(fit === 'width' ? 'none' : 'width')}
            title="По ширине окна (Ctrl и 1)"
          >
            <Icon name="MoveHorizontal" size={16} />
          </button>
          <button
            className={`px-3 py-2 transition-colors ${
              fit === 'page' ? 'bg-primary text-primary-foreground' : 'hover:bg-card'
            }`}
            onClick={() => setFit(fit === 'page' ? 'none' : 'page')}
            title="Страница целиком (Ctrl и 2)"
          >
            <Icon name="Maximize2" size={16} />
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
          <button
            className={`px-3 py-2 transition-colors ${spread ? 'bg-primary text-primary-foreground' : 'hover:bg-card'}`}
            onClick={toggleSpread}
            title={spread ? 'Показывать по одной странице' : 'Две страницы рядом, как разворот книги'}
          >
            <Icon name={spread ? 'BookOpen' : 'File'} size={16} />
          </button>
        </div>

        <div className="flex items-center border border-border bg-background">
          {toolBtn('hand', 'MousePointer2', 'Просмотр')}
          {toolBtn('text', 'Type', 'Добавить надпись')}
          {toolBtn('block', 'Square', 'Закрасить данные')}
        </div>

        <div className="ml-auto flex items-center border border-border bg-background">
          <input
            ref={searchBox}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Поиск (Ctrl+F)"
            className="w-[180px] bg-transparent px-3 py-2 text-[0.86rem] outline-none"
          />
          <button
            className="px-3 py-2 text-primary hover:bg-card"
            onClick={() => void search()}
            title="Найти (Enter), следующее совпадение — F3"
          >
            <Icon name="Search" size={16} />
          </button>
        </div>
      </div>

      {hits && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2 text-[0.8rem] text-muted-foreground">
          {hits.length ? (
            <>
              <Icon name="Search" size={14} className="text-primary" />
              <span>Найдено на {hits.length} стр. — совпадения подсвечены жёлтым</span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => jumpHit(-1)}
                  className="border border-border px-2 py-1 hover:border-foreground"
                  title="Предыдущая найденная страница (Shift+F3)"
                >
                  <Icon name="ChevronUp" size={13} />
                </button>
                <button
                  onClick={() => jumpHit(1)}
                  className="border border-border px-2 py-1 hover:border-foreground"
                  title="Следующая найденная страница (F3)"
                >
                  <Icon name="ChevronDown" size={13} />
                </button>
                <button
                  onClick={() => {
                    setHits(null);
                    setFound('');
                    setQuery('');
                  }}
                  className="border border-border px-2 py-1 hover:border-destructive hover:text-destructive"
                  title="Сбросить поиск (Esc)"
                >
                  <Icon name="X" size={13} />
                </button>
              </div>
            </>
          ) : (
            'Совпадений не найдено'
          )}
        </div>
      )}

      <div
        ref={scroller}
        className="relative flex-1 overflow-auto overscroll-contain bg-muted"
        style={{ scrollBehavior: 'auto' }}
      >
        {busy && (
          <div className="absolute right-6 top-6 z-20 flex items-center gap-2 border border-border bg-background px-3 py-2 text-[0.8rem]">
            <Icon name="LoaderCircle" size={14} className="animate-spin text-primary" />
            Обработка
          </div>
        )}
        {/* Непрерывная лента: все листы идут один за другим,
            прокрутка не прерывается на границах страниц */}
        <div className="flex flex-col items-center p-6">
          {rows.map((row) => (
            <div key={row[0].p.uid} className="flex items-start justify-center gap-4">
              {row.map(({ p, i }) => (
                <SheetView
                  key={p.uid}
                  page={p}
                  index={i}
                  zoom={zoom}
                  doc={docOf(p)}
                  tool={tool}
                  marks={annots.filter((a) => a.pageUid === p.uid)}
                  found={found}
                  hint={hint}
                  onPlace={place}
                  onRemoveMark={removeAnnot}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Viewer;