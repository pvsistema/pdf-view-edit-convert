import { useEffect, useRef, useState } from 'react';
import MenuShell, { type MenuItem } from '@/components/app/MenuShell';
import { useDoc } from '@/context/DocContext';
import { downloadBlob } from '@/lib/pdf';
import { toast } from '@/hooks/use-toast';
import { requestPrint } from '@/lib/printBus';
import ShortcutsDialog from '@/components/app/ShortcutsDialog';
import { isDesktop } from '@/lib/desktop';

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
  } = useDoc();

  const [menu, setMenu] = useState<'file' | 'edit' | null>(null);
  const [askName, setAskName] = useState(false);
  const [showKeys, setShowKeys] = useState(false);

  const [draft, setDraft] = useState('');
  const openInput = useRef<HTMLInputElement>(null);
  const appendInput = useRef<HTMLInputElement>(null);

  const has = pages.length > 0;
  const current = pages[active];
  const close = () => setMenu(null);

  const makeBlob = async () => {
    const bytes = await buildPdf();
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
        e.shiftKey ? saveAs() : save();
      } else if (k === 'p' && has) {
        e.preventDefault();
        requestPrint();
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
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
    { icon: 'X', label: 'Закрыть документ', fn: act(reset), on: has },
  ];

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

      <input
        ref={openInput}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            close();
            await open(f);
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