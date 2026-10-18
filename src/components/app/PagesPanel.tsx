import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import PageRow from '@/components/app/PageRow';
import { useDoc, type PageMeta } from '@/context/DocContext';
import { useTabs } from '@/context/TabsContext';
import { toast } from '@/hooks/use-toast';
import { takePage, heldPage, dropInto, MIME } from '@/lib/pageSwap';
import ThumbMenu from '@/components/app/ThumbMenu';
import { pageToJpeg, pagesToJpegs, jpegName } from '@/lib/pageJpeg';
import { isDesktop, nativeSaveMany } from '@/lib/desktop';
import { downloadBlob } from '@/lib/files';
import { requestPrint } from '@/lib/printBus';

const PagesPanel = () => {
  const {
    pages,
    files,
    active,
    setActive,
    rotate,
    remove,
    move,
    movePageTo,
    append,
    name,
    buildPdf,
  } = useDoc();
  const input = useRef<HTMLInputElement>(null);
  const tabsApi = useTabs();
  const tabId = tabsApi?.activeId ?? 'single';

  const [held, setHeld] = useState<string | null>(null);
  const [mark, setMark] = useState<number | null>(null);
  // Меню по правой кнопке на миниатюре
  const [menu, setMenu] = useState<{ x: number; y: number; page: PageMeta; index: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  // Отмеченные страницы: Ctrl+щелчок — добавить или убрать одну,
  // Shift+щелчок — отметить подряд от выбранной до этой
  const [picked, setPicked] = useState<string[]>([]);
  const anchor = useRef<number>(0);

  // Удалённые страницы из отметки убираем
  useEffect(() => {
    setPicked((list) => {
      const next = list.filter((uid) => pages.some((p) => p.uid === uid));
      return next.length === list.length ? list : next;
    });
  }, [pages]);

  const select = useCallback(
    (i: number, e: React.MouseEvent) => {
      const uid = pages[i]?.uid;
      if (!uid) return;
      if (e.ctrlKey || e.metaKey) {
        setPicked((list) => {
          // Первая отметка с Ctrl захватывает и ту страницу, что уже открыта
          const base = list.length ? list : [pages[active]?.uid].filter(Boolean) as string[];
          return base.includes(uid) ? base.filter((x) => x !== uid) : [...base, uid];
        });
        anchor.current = i;
      } else if (e.shiftKey) {
        const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
        setPicked(pages.slice(a, b + 1).map((p) => p.uid));
      } else {
        setPicked([]);
        anchor.current = i;
      }
      setActive(i);
    },
    [pages, active, setActive],
  );

  // Esc снимает отметку
  useEffect(() => {
    if (!picked.length) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPicked([]);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [picked.length]);

  // Отмеченные страницы в порядке документа
  const pickedPages = pages.filter((p) => picked.includes(p.uid));

  const exportMany = async (list: PageMeta[]) => {
    if (busy || !list.length) return;
    setBusy(true);
    const t = toast({ title: 'Сохраняю страницы', description: `0 из ${list.length}` });
    try {
      const bytes = await buildPdf(list);
      const names = list.map((p) => jpegName(name, pages.indexOf(p) + 1));
      const items = await pagesToJpegs(bytes, names, (done, total) =>
        t.update({ id: t.id, title: 'Сохраняю страницы', description: `${done} из ${total}` }),
      );
      // В программе папку выбирают один раз, а не окно на каждую страницу
      if (isDesktop()) {
        await nativeSaveMany(items);
        t.dismiss();
      } else {
        for (const it of items) {
          downloadBlob(it.blob, it.name);
          await new Promise((r) => setTimeout(r, 250));
        }
        t.update({ id: t.id, title: 'Страницы сохранены', description: `${items.length} картинок JPEG` });
      }
    } catch {
      t.update({ id: t.id, title: 'Не удалось сохранить страницы', description: 'Попробуйте ещё раз' });
    } finally {
      setBusy(false);
    }
  };

  const openMenu = (e: React.MouseEvent, page: PageMeta, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    // Щелчок правой кнопкой вне отметки — работаем с одной этой страницей
    if (!picked.includes(page.uid)) setPicked([]);
    setActive(index);
    setMenu({ x: e.clientX, y: e.clientY, page, index });
  };

  // Одна страница отдельным файлом — картинкой или PDF
  const exportPage = async (page: PageMeta, index: number, kind: 'jpeg' | 'pdf') => {
    if (busy) return;
    setBusy(true);
    try {
      const bytes = await buildPdf([page]);
      if (kind === 'jpeg') {
        downloadBlob(await pageToJpeg(bytes), jpegName(name, index + 1));
      } else {
        const base = (name || 'document').replace(/\.pdf$/i, '');
        downloadBlob(
          new Blob([bytes as BlobPart], { type: 'application/pdf' }),
          `${base}-стр-${index + 1}.pdf`,
        );
      }
    } catch {
      toast({ title: 'Не удалось сохранить страницу', description: 'Попробуйте ещё раз' });
    } finally {
      setBusy(false);
    }
  };

  // Берём страницу мышью: кладём её в общий обменник, чтобы
  // соседняя вкладка смогла принять этот же лист
  const start = (e: React.DragEvent, page: PageMeta) => {
    const file = files.find((f) => f.id === page.fileId);
    if (!file) return;

    setHeld(page.uid);
    takePage({ tabId, page, file, label: name });
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(MIME, page.uid);
    e.dataTransfer.setData('text/plain', `Страница ${pages.indexOf(page) + 1}`);
  };

  const finish = () => {
    setHeld(null);
    setMark(null);
    takePage(null);
  };

  // Место вставки определяем по тому, выше или ниже середины строки курсор
  const over = (e: React.DragEvent, index: number) => {
    if (!heldPage()) return;
    e.preventDefault();
    const copy = e.ctrlKey || e.metaKey;
    e.dataTransfer.dropEffect = copy ? 'copy' : 'move';

    const box = e.currentTarget.getBoundingClientRect();
    setMark(e.clientY < box.top + box.height / 2 ? index : index + 1);
  };

  const put = (e: React.DragEvent, index: number) => {
    const cargo = heldPage();
    if (!cargo) return;
    e.preventDefault();
    e.stopPropagation();

    const box = e.currentTarget.getBoundingClientRect();
    const at = e.clientY < box.top + box.height / 2 ? index : index + 1;
    const copy = e.ctrlKey || e.metaKey;

    if (cargo.tabId === tabId) {
      movePageTo(cargo.page.uid, at);
    } else if (dropInto(tabId, at, copy)) {
      toast({
        title: copy ? 'Страница скопирована' : 'Страница перенесена',
        description: `Из документа «${cargo.label}»`,
      });
    }
    finish();
  };

  // Бросок в пустое место списка — страница встаёт в конец
  const putLast = (e: React.DragEvent) => {
    const cargo = heldPage();
    if (!cargo) return;
    e.preventDefault();
    const copy = e.ctrlKey || e.metaKey;

    if (cargo.tabId === tabId) {
      movePageTo(cargo.page.uid, pages.length);
    } else if (dropInto(tabId, pages.length, copy)) {
      toast({
        title: copy ? 'Страница скопирована' : 'Страница перенесена',
        description: `Из документа «${cargo.label}»`,
      });
    }
    finish();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="label-caps">Страницы</span>
        <button
          className="text-primary hover:opacity-70"
          title="Добавить файл к документу"
          onClick={() => input.current?.click()}
        >
          <Icon name="Plus" size={16} />
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            await append(f);
            toast({ title: 'Файл добавлен', description: `${f.name} присоединён к документу` });
            e.target.value = '';
          }}
        />
      </div>

      <div
        className="flex-1 overflow-y-auto p-3"
        onDragOver={(e) => heldPage() && e.preventDefault()}
        onDrop={putLast}
      >
        {pages.map((p, i) => (
          <PageRow
            key={p.uid}
            page={p}
            index={i}
            activeRow={i === active}
            picked={picked.includes(p.uid)}
            last={pages.length === 1}
            dragging={held === p.uid}
            markAbove={mark === i}
            markBelow={mark === i + 1 && i === pages.length - 1}
            onSelect={select}
            onRotate={rotate}
            onRemove={remove}
            onMove={move}
            onDragStart={start}
            onDragEnd={finish}
            onDragOver={over}
            onDrop={put}
            onMenu={openMenu}
          />
        ))}

        <p className="px-1 pb-2 pt-1 text-[0.7rem] leading-relaxed text-muted-foreground">
          Страницы можно перетаскивать мышью — внутри документа и на вкладку другого файла.
          С клавишей Ctrl страница копируется. Щелчок с Ctrl или Shift отмечает несколько
          страниц — их можно разом сохранить картинками.
        </p>
      </div>

      {/* Полоса действий с отмеченными страницами */}
      {pickedPages.length > 1 && (
        <div className="flex items-center gap-2 border-t border-border bg-background px-3 py-2.5">
          <span className="flex-1 text-[0.78rem]">
            Отмечено: <b>{pickedPages.length}</b>
          </span>
          <button
            onClick={() => void exportMany(pickedPages)}
            disabled={busy}
            title="Сохранить отмеченные страницы картинками JPEG"
            className="flex items-center gap-1.5 bg-primary px-2.5 py-1.5 font-head text-[0.68rem] font-bold uppercase tracking-[0.06em] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Icon name={busy ? 'LoaderCircle' : 'Image'} size={13} className={busy ? 'animate-spin' : ''} />
            В JPEG
          </button>
          <button
            onClick={() => setPicked([])}
            title="Снять отметку (Esc)"
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <Icon name="X" size={15} />
          </button>
        </div>
      )}

      {menu && (
        <ThumbMenu
          x={menu.x}
          y={menu.y}
          title={
            pickedPages.length > 1
              ? `Отмечено страниц: ${pickedPages.length}`
              : `Страница ${menu.index + 1}`
          }
          onClose={() => setMenu(null)}
          items={pickedPages.length > 1 ? [
            {
              icon: 'Images',
              label: `Экспорт отмеченных (${pickedPages.length}) в JPEG`,
              on: !busy,
              fn: () => void exportMany(pickedPages),
            },
            {
              icon: 'X',
              label: 'Снять отметку',
              sep: true,
              fn: () => setPicked([]),
            },
          ] : [
            {
              icon: 'Image',
              label: 'Экспорт страницы в JPEG',
              on: !busy,
              fn: () => void exportPage(menu.page, menu.index, 'jpeg'),
            },
            {
              icon: 'FileOutput',
              label: 'Экспорт страницы в PDF',
              on: !busy,
              fn: () => void exportPage(menu.page, menu.index, 'pdf'),
            },
            {
              icon: 'Printer',
              label: 'Печать страницы',
              fn: () => requestPrint({ scope: 'current' }),
            },
            {
              icon: 'RotateCw',
              label: 'Повернуть вправо на 90°',
              sep: true,
              fn: () => rotate(menu.page.uid, 90),
            },
            {
              icon: 'RotateCcw',
              label: 'Повернуть влево на 90°',
              fn: () => rotate(menu.page.uid, -90),
            },
            {
              icon: 'ArrowUp',
              label: 'Переместить выше',
              on: menu.index > 0,
              fn: () => move(menu.page.uid, -1),
            },
            {
              icon: 'ArrowDown',
              label: 'Переместить ниже',
              on: menu.index < pages.length - 1,
              fn: () => move(menu.page.uid, 1),
            },
            {
              icon: 'Trash2',
              label: 'Удалить страницу',
              sep: true,
              danger: true,
              on: pages.length > 1,
              fn: () => {
                remove(menu.page.uid);
                toast({ title: 'Страница удалена' });
              },
            },
          ]}
        />
      )}
    </div>
  );
};

export default PagesPanel;