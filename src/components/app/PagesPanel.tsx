import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import PageRow from '@/components/app/PageRow';
import { useDoc, type PageMeta } from '@/context/DocContext';
import { useTabs } from '@/context/TabsContext';
import { toast } from '@/hooks/use-toast';
import { takePage, heldPage, dropInto, MIME } from '@/lib/pageSwap';
import ThumbMenu from '@/components/app/ThumbMenu';
import TopLayer from '@/components/app/TopLayer';
import { pageToJpeg, pagesToJpegs, jpegName } from '@/lib/pageJpeg';
import { isDesktop, nativeSaveMany } from '@/lib/desktop';
import { downloadBlob } from '@/lib/files';
import { requestPrint } from '@/lib/printBus';

// Номера страниц коротко: 1, 2, 3, 5, 7, 8 → «1-3_5_7-8»
const rangeLabel = (nums: number[]) => {
  const out: string[] = [];
  const sorted = [...nums].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    out.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
  }
  return out.join('_');
};

const PagesPanel = () => {
  const {
    pages,
    files,
    active,
    setActive,
    rotate,
    rotateMany,
    remove,
    removeMany,
    move,
    movePageTo,
    movePagesTo,
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

  // Отмеченные страницы одним файлом PDF, в порядке документа
  const pdfMany = async (list: PageMeta[]) => {
    if (busy || !list.length) return;
    setBusy(true);
    try {
      const bytes = await buildPdf(list);
      const base = (name || 'document').replace(/\.pdf$/i, '');
      const nums = list.map((p) => pages.indexOf(p) + 1);
      downloadBlob(
        new Blob([bytes as BlobPart], { type: 'application/pdf' }),
        `${base}-стр-${rangeLabel(nums)}.pdf`,
      );
      if (!isDesktop()) toast({ title: 'Страницы сохранены', description: `${list.length} стр. в одном PDF` });
    } catch {
      toast({ title: 'Не удалось сохранить страницы', description: 'Попробуйте ещё раз' });
    } finally {
      setBusy(false);
    }
  };

  // Удаление спрашиваем заранее: страниц сразу несколько
  const [askDel, setAskDel] = useState(false);
  const deleteMany = () => {
    const uids = pickedPages.map((p) => p.uid);
    removeMany(uids);
    setPicked([]);
    setAskDel(false);
    toast({
      title: `Удалено страниц: ${uids.length}`,
      description: 'Вернуть можно сочетанием Ctrl+Z',
    });
  };

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
  // Тянут одну из нескольких отмеченных страниц — едет вся группа
  const groupHeld = (uid: string) => picked.length > 1 && picked.includes(uid);

  // Перенос отмеченных в начало или в конец документа
  const moveGroup = (where: 'start' | 'end') => {
    movePagesTo(picked, where === 'start' ? 0 : pages.length);
    toast({
      title: `Страницы перенесены ${where === 'start' ? 'в начало' : 'в конец'}`,
      description: 'Вернуть можно сочетанием Ctrl+Z',
    });
  };

  const start = (e: React.DragEvent, page: PageMeta) => {
    const file = files.find((f) => f.id === page.fileId);
    if (!file) return;

    setHeld(page.uid);
    takePage({ tabId, page, file, label: name });
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(MIME, page.uid);
    const group = picked.length > 1 && picked.includes(page.uid);
    e.dataTransfer.setData(
      'text/plain',
      group ? `Страниц: ${picked.length}` : `Страница ${pages.indexOf(page) + 1}`,
    );
    // Под курсором показываем, сколько страниц едет
    if (group) {
      const tag = document.createElement('div');
      tag.textContent = `Страниц: ${picked.length}`;
      tag.style.cssText =
        'position:fixed;top:-100px;left:0;padding:6px 10px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));font:700 12px sans-serif;';
      document.body.appendChild(tag);
      e.dataTransfer.setDragImage(tag, 10, 10);
      setTimeout(() => tag.remove(), 0);
    }
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
      if (groupHeld(cargo.page.uid)) movePagesTo(picked, at);
      else movePageTo(cargo.page.uid, at);
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
      if (groupHeld(cargo.page.uid)) movePagesTo(picked, pages.length);
      else movePageTo(cargo.page.uid, pages.length);
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
            first={i === 0}
            lastRow={i === pages.length - 1}
            dragging={held === p.uid || (!!held && groupHeld(held) && picked.includes(p.uid))}
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
          страниц — их можно разом перенести, повернуть, сохранить или удалить. Отмеченные
          страницы перетаскиваются все вместе.
        </p>
      </div>

      {/* Полоса действий с отмеченными страницами */}
      {pickedPages.length > 1 && (
        <div className="flex items-center gap-1 border-t border-border bg-background px-3 py-2.5">
          <span className="flex-1 whitespace-nowrap text-[0.78rem]" title="Отмечено страниц">
            <Icon name="CheckCheck" size={13} className="mr-1 inline -translate-y-px text-primary" fallback="Check" />
            <b>{pickedPages.length}</b>
          </span>
          <button
            onClick={() => void exportMany(pickedPages)}
            disabled={busy}
            title="Сохранить отмеченные страницы картинками JPEG"
            className="flex items-center gap-1.5 bg-primary px-2 py-1.5 font-head text-[0.66rem] font-bold uppercase tracking-[0.06em] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Icon name={busy ? 'LoaderCircle' : 'Image'} size={13} className={busy ? 'animate-spin' : ''} />
            JPEG
          </button>
          <button
            onClick={() => void pdfMany(pickedPages)}
            disabled={busy}
            title="Сохранить отмеченные страницы в отдельный PDF"
            className="flex items-center gap-1.5 border border-foreground px-2 py-1.5 font-head text-[0.66rem] font-bold uppercase tracking-[0.06em] transition-colors hover:bg-card disabled:opacity-50"
          >
            <Icon name="FileOutput" size={13} />
            PDF
          </button>
          <button
            onClick={() => moveGroup('start')}
            disabled={busy}
            title="Перенести отмеченные в начало документа"
            className="p-1.5 text-muted-foreground transition-colors hover:text-primary disabled:opacity-35"
          >
            <Icon name="ArrowUpToLine" size={15} />
          </button>
          <button
            onClick={() => moveGroup('end')}
            disabled={busy}
            title="Перенести отмеченные в конец документа"
            className="p-1.5 text-muted-foreground transition-colors hover:text-primary disabled:opacity-35"
          >
            <Icon name="ArrowDownToLine" size={15} />
          </button>
          <button
            onClick={() => rotateMany(pickedPages.map((p) => p.uid), -90)}
            disabled={busy}
            title="Повернуть отмеченные влево на 90°"
            className="p-1.5 text-muted-foreground transition-colors hover:text-primary disabled:opacity-35"
          >
            <Icon name="RotateCcw" size={15} />
          </button>
          <button
            onClick={() => rotateMany(pickedPages.map((p) => p.uid), 90)}
            disabled={busy}
            title="Повернуть отмеченные вправо на 90°"
            className="p-1.5 text-muted-foreground transition-colors hover:text-primary disabled:opacity-35"
          >
            <Icon name="RotateCw" size={15} />
          </button>
          <button
            onClick={() => setAskDel(true)}
            disabled={busy || pickedPages.length >= pages.length}
            title={
              pickedPages.length >= pages.length
                ? 'Все страницы удалить нельзя'
                : 'Удалить отмеченные страницы'
            }
            className="p-1.5 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-35"
          >
            <Icon name="Trash2" size={15} />
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

      {askDel && (
        <TopLayer>
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-foreground/40 px-4">
            <div className="w-full max-w-[400px] border border-border bg-background shadow-xl">
              <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
                <Icon name="Trash2" size={17} className="shrink-0 text-destructive" />
                <span className="label-caps">Удалить страницы</span>
              </div>
              <p className="px-5 py-4 text-[0.88rem] leading-relaxed">
                Удалить отмеченные страницы ({pickedPages.length} шт.:{' '}
                {rangeLabel(pickedPages.map((p) => pages.indexOf(p) + 1)).replace(/_/g, ', ')})?
                Вернуть их можно сочетанием Ctrl+Z.
              </p>
              <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
                <button
                  onClick={() => setAskDel(false)}
                  className="px-3 py-2 font-head text-[0.72rem] font-bold uppercase tracking-[0.08em] hover:underline"
                >
                  Отмена
                </button>
                <button
                  onClick={deleteMany}
                  autoFocus
                  className="bg-destructive px-3 py-2 font-head text-[0.72rem] font-bold uppercase tracking-[0.08em] text-destructive-foreground hover:opacity-90"
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>
        </TopLayer>
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
              icon: 'FileOutput',
              label: `Сохранить отмеченные (${pickedPages.length}) в отдельный PDF`,
              on: !busy,
              fn: () => void pdfMany(pickedPages),
            },
            {
              icon: 'ArrowUpToLine',
              label: 'Перенести отмеченные в начало',
              sep: true,
              fn: () => moveGroup('start'),
            },
            {
              icon: 'ArrowDownToLine',
              label: 'Перенести отмеченные в конец',
              fn: () => moveGroup('end'),
            },
            {
              icon: 'RotateCw',
              label: 'Повернуть отмеченные вправо на 90°',
              sep: true,
              fn: () => rotateMany(pickedPages.map((p) => p.uid), 90),
            },
            {
              icon: 'RotateCcw',
              label: 'Повернуть отмеченные влево на 90°',
              fn: () => rotateMany(pickedPages.map((p) => p.uid), -90),
            },
            {
              icon: 'Trash2',
              label: `Удалить отмеченные (${pickedPages.length})`,
              sep: true,
              danger: true,
              on: pickedPages.length < pages.length,
              fn: () => setAskDel(true),
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