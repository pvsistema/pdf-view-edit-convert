import { useEffect, useMemo, useRef, useState } from 'react';
import MenuShell, { type MenuItem } from '@/components/app/MenuShell';
import { useDoc } from '@/context/DocContext';
import { downloadBlob } from '@/lib/files';
import { pageText } from '@/lib/pdf';
import { toast } from '@/hooks/use-toast';
import { requestPrint } from '@/lib/printBus';
import ShortcutsDialog from '@/components/app/ShortcutsDialog';
import ScanDialog from '@/components/app/ScanDialog';
import { isDesktop } from '@/lib/desktop';
import { loadScanPrefs } from '@/lib/scanPrefs';
import { useTabs, useTabActive } from '@/context/TabsContext';

// Названия сканеров бывают длинными: в подсказке меню
// оставляем начало, чтобы строка не разъезжалась
const shortName = (s: string) => (s.length > 18 ? s.slice(0, 17) + '…' : s);

const MenuBar = () => {
  const {
    name,
    pages,
    active,
    open,
    append,
    reset,
    buildPdf,
    undo,
    redo,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    rotate,
    remove,
    move,
    duplicatePage,
    annots,
    clearAnnots,
    docOf,
  } = useDoc();

  const tabsApi = useTabs();
  const onScreen = useTabActive();

  const [menu, setMenu] = useState<'file' | 'edit' | 'scan' | null>(null);
  const [askName, setAskName] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [scanMode, setScanMode] = useState<'single' | 'batch'>('single');
  const [scanAppend, setScanAppend] = useState(false);
  // Повтор с прошлыми настройками: окно открывается и сразу работает
  const [quick, setQuick] = useState(false);

  const [draft, setDraft] = useState('');
  const openInput = useRef<HTMLInputElement>(null);
  const appendInput = useRef<HTMLInputElement>(null);

  const has = pages.length > 0;
  const current = pages[active];
  const close = () => setMenu(null);

  const makeBlob = async () => {
    // На большом документе показываем ход работы: молчаливое ожидание
    // выглядит как зависшая программа
    const big = pages.length > 60;
    let shown = 0;
    const bytes = await buildPdf(undefined, undefined, (done, total) => {
      // Не чаще раза в сто страниц, иначе сообщения завалят экран
      if (!big || !done || done >= total || done - shown < 100) return;
      shown = done;
      toast({ title: 'Готовлю документ', description: `${done} из ${total} страниц` });
    });
    return new Blob([bytes as BlobPart], { type: 'application/pdf' });
  };

  const save = async () => {
    close();
    downloadBlob(await makeBlob(), name || 'document.pdf');
    if (!isDesktop()) toast({ title: 'Документ сохранён' });
  };

  const saveAs = async () => {
    close();
    // В десктопной версии имя и папку спрашивает системное окно Windows
    if (isDesktop()) {
      downloadBlob(await makeBlob(), name || 'document.pdf');
      return;
    }
    setDraft((name || 'document.pdf').replace(/\.pdf$/i, ''));
    setAskName(true);
  };

  const confirmSaveAs = async () => {
    const file = `${draft.trim() || 'document'}.pdf`;
    setAskName(false);
    downloadBlob(await makeBlob(), file);
    toast({ title: 'Файл сохранён', description: file });
  };

  const print = () => {
    close();
    requestPrint();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Скрытые вкладки остаются в памяти, но клавиши обрабатывает
      // только та, что сейчас на экране
      if (!onScreen) return;
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;

      if (e.key === 'F1') {
        e.preventDefault();
        setShowKeys(true);
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) return;

      // Определяем клавишу по её месту на клавиатуре (e.code), а не по букве:
      // на русской раскладке Ctrl+P даёт букву "з", и проверка по букве не срабатывала.
      const byCode = /^Key([A-Z])$/.exec(e.code)?.[1]?.toLowerCase();
      const k = byCode || e.key.toLowerCase();

      if (k === 'o') {
        e.preventDefault();
        openInput.current?.click();
      } else if (k === 's' && has) {
        e.preventDefault();
        if (e.shiftKey) saveAs();
        else save();
      } else if (k === 'p' && has) {
        e.preventDefault();
        requestPrint();
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      } else if (k === 'w' && tabsApi?.activeId) {
        // Закрываем текущий документ, как вкладку в браузере
        e.preventDefault();
        tabsApi.closeTab(tabsApi.activeId);
      } else if (e.key === 'Tab' && tabsApi && tabsApi.tabs.length > 1) {
        // Переход к следующему открытому документу
        e.preventDefault();
        const at = tabsApi.tabs.findIndex((t) => t.id === tabsApi.activeId);
        const step = e.shiftKey ? -1 : 1;
        const next = (at + step + tabsApi.tabs.length) % tabsApi.tabs.length;
        tabsApi.selectTab(tabsApi.tabs[next].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const act = (fn: () => void) => () => {
    close();
    fn();
  };

  const fileItems: MenuItem[] = [
    { icon: 'FolderOpen', label: 'Открыть', hint: 'Ctrl+O', fn: () => openInput.current?.click(), on: true },
    { icon: 'FilePlus2', label: 'Добавить файл', fn: () => appendInput.current?.click(), on: has },
    { icon: 'Save', label: 'Сохранить', hint: 'Ctrl+S', fn: save, on: has, sep: true },
    { icon: 'SaveAll', label: 'Сохранить как…', hint: 'Ctrl+Shift+S', fn: saveAs, on: has },
    { icon: 'Printer', label: 'Печать…', hint: 'Ctrl+P', fn: print, on: has, sep: true },
    {
      icon: 'Keyboard',
      label: 'Горячие клавиши',
      hint: 'F1',
      fn: act(() => setShowKeys(true)),
      on: true,
      sep: true,
    },
    {
      icon: 'X',
      label: 'Закрыть документ',
      hint: 'Ctrl+W',
      fn: act(() => {
        // С вкладками закрывается текущая, без них — очищается окно
        if (tabsApi?.activeId) tabsApi.closeTab(tabsApi.activeId);
        else reset();
      }),
      on: has,
    },
  ];

  // Копируем то, что пользователь выделил мышью в документе
  const copySelection = () => {
    const sel = window.getSelection()?.toString() ?? '';
    if (!sel.trim()) {
      toast({
        title: 'Нечего копировать',
        description: 'Сначала выделите текст в документе мышью',
      });
      return;
    }
    void navigator.clipboard
      .writeText(sel)
      .then(() => toast({ title: 'Текст скопирован' }))
      .catch(() =>
        toast({ title: 'Не удалось скопировать', description: 'Попробуйте сочетание Ctrl+C' }),
      );
  };

  // Забираем весь текст текущей страницы, не выделяя его вручную
  const copyPageText = async () => {
    if (!current) return;
    const doc = docOf(current);
    if (!doc) return;
    const text = await pageText(doc, current.src);
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

  const editItems: MenuItem[] = [
    {
      icon: 'Undo2',
      label: canUndo ? `Отменить ${undoLabel}` : 'Отменить',
      hint: 'Ctrl+Z',
      fn: act(undo),
      on: canUndo,
    },
    {
      icon: 'Redo2',
      label: canRedo ? `Вернуть ${redoLabel}` : 'Вернуть',
      hint: 'Ctrl+Y',
      fn: act(redo),
      on: canRedo,
    },
    {
      icon: 'Copy',
      label: 'Копировать выделенное',
      hint: 'Ctrl+C',
      fn: act(copySelection),
      on: has,
      sep: true,
    },
    {
      icon: 'ScanText',
      label: 'Копировать весь текст страницы',
      fn: act(() => void copyPageText()),
      on: has,
    },
    {
      icon: 'RotateCw',
      label: 'Повернуть страницу',
      fn: act(() => current && rotate(current.uid, 90)),
      on: has,
      sep: true,
    },
    {
      icon: 'Copy',
      label: 'Дублировать страницу',
      fn: act(() => current && duplicatePage(current.uid)),
      on: has,
    },
    {
      icon: 'ArrowUp',
      label: 'Переместить выше',
      fn: act(() => current && move(current.uid, -1)),
      on: has && active > 0,
    },
    {
      icon: 'ArrowDown',
      label: 'Переместить ниже',
      fn: act(() => current && move(current.uid, 1)),
      on: has && active < pages.length - 1,
    },
    {
      icon: 'Trash2',
      label: 'Удалить страницу',
      fn: act(() => current && remove(current.uid)),
      on: has && pages.length > 1,
      sep: true,
    },
    {
      icon: 'Eraser',
      label: 'Убрать все пометки',
      fn: act(clearAnnots),
      on: annots.length > 0,
    },
  ];

  // Сканер доступен только в программе: браузеру Windows
  // доступ к устройству не даёт
  const canScan = isDesktop();

  const openScan = (mode: 'single' | 'batch', addTo = false) =>
    act(() => {
      if (!canScan) {
        toast({
          title: 'Сканирование в программе',
          description: 'Установите ПВ-Систему PDF на компьютер — браузеру доступ к сканеру закрыт',
        });
        return;
      }
      setScanMode(mode);
      setScanAppend(addTo);
      setQuick(false);
      setShowScan(true);
    });

  // Прошлые настройки: если человек уже сканировал, повтор делаем
  // сразу — окно с настройками для этого открывать незачем.
  // Перечитываем при открытии меню: настройки могли поменяться
  const lastScan = useMemo(
    () => (canScan && menu === 'scan' ? loadScanPrefs(false) : null),
    [canScan, menu],
  );
  const canRepeat = !!lastScan?.device;

  const scanItems: MenuItem[] = [
    {
      icon: 'Scan',
      label: 'Сканировать страницу',
      fn: openScan('single'),
      on: true,
    },
    {
      icon: 'RotateCw',
      label: 'Сканировать ещё раз',
      // Подсказываем, чем именно — чтобы нажатие не было неожиданностью
      hint: canRepeat ? shortName(lastScan?.deviceName || '') : '',
      fn: act(() => {
        setScanMode('single');
        setScanAppend(false);
        setQuick(true);
        setShowScan(true);
      }),
      on: canRepeat,
    },
    {
      icon: 'Layers',
      label: 'Пакетное сканирование',
      fn: openScan('batch'),
      on: true,
    },
    {
      icon: 'FilePlus2',
      label: 'Добавить скан к документу',
      fn: openScan('batch', true),
      on: has,
      sep: true,
    },
  ];

  return (
    <div className="flex items-center gap-1">
      <MenuShell
        title="Файл"
        open={menu === 'file'}
        onToggle={() => setMenu((m) => (m === 'file' ? null : 'file'))}
        onClose={() => setMenu((m) => (m === 'file' ? null : m))}
        items={fileItems}
      />
      <MenuShell
        title="Правка"
        open={menu === 'edit'}
        onToggle={() => setMenu((m) => (m === 'edit' ? null : 'edit'))}
        onClose={() => setMenu((m) => (m === 'edit' ? null : m))}
        items={editItems}
      />

      <MenuShell
        title="Сканировать"
        open={menu === 'scan'}
        onToggle={() => setMenu((m) => (m === 'scan' ? null : 'scan'))}
        onClose={() => setMenu((m) => (m === 'scan' ? null : m))}
        items={scanItems}
      />

      <input
        ref={openInput}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            close();
            // Открываем рядом: прежний документ остаётся в своей вкладке
            if (tabsApi) tabsApi.openTab(f);
            else await open(f);
            toast({ title: 'Документ открыт', description: f.name });
          }
          e.target.value = '';
        }}
      />
      <input
        ref={appendInput}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            close();
            await append(f);
            toast({ title: 'Файл добавлен', description: f.name });
          }
          e.target.value = '';
        }}
      />



      {showScan && (
        <ScanDialog
          batch={scanMode === 'batch'}
          quick={quick}
          onReady={async (f) => {
            // Листы либо присоединяются к открытому документу,
            // либо становятся новым документом в своей вкладке
            if (scanAppend) {
              await append(f);
              toast({ title: 'Страницы добавлены', description: 'Сканы в конце документа' });
            } else if (tabsApi) {
              tabsApi.openTab(f);
            } else {
              await open(f);
            }
          }}
          onClose={() => setShowScan(false)}
        />
      )}

      {showKeys && <ShortcutsDialog onClose={() => setShowKeys(false)} />}

      {askName && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/50 p-6">
          <div className="w-full max-w-[420px] border border-foreground bg-background p-6">
            <div className="label-caps">Сохранить как</div>
            <p className="mt-3 text-[0.88rem] text-muted-foreground">Укажите имя файла</p>
            <div className="mt-4 flex items-center border border-border">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmSaveAs()}
                className="w-full bg-background px-3 py-3 text-[0.92rem] outline-none"
              />
              <span className="px-3 font-head text-[0.82rem] text-muted-foreground">.pdf</span>
            </div>
            <div className="mt-6 flex gap-3">
              <button className="btn-block flex-1 justify-center" onClick={confirmSaveAs}>
                Сохранить
              </button>
              <button
                className="border border-foreground px-5 py-3 font-head text-[0.74rem] font-bold uppercase tracking-[0.1em] transition-colors hover:bg-foreground hover:text-background"
                onClick={() => setAskName(false)}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuBar;