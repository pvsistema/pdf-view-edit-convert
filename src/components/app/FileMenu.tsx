import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useDoc } from '@/context/DocContext';
import { downloadBlob } from '@/lib/pdf';
import { toast } from '@/hooks/use-toast';

const FileMenu = () => {
  const { name, pages, open, append, reset, buildPdf } = useDoc();
  const [show, setShow] = useState(false);
  const [askName, setAskName] = useState(false);
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const appendInput = useRef<HTMLInputElement>(null);

  const has = pages.length > 0;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const makeBlob = async () => {
    const bytes = await buildPdf();
    return new Blob([bytes as BlobPart], { type: 'application/pdf' });
  };

  const save = async () => {
    setShow(false);
    downloadBlob(await makeBlob(), name || 'document.pdf');
    toast({ title: 'Документ сохранён' });
  };

  const saveAs = () => {
    setShow(false);
    setDraft((name || 'document.pdf').replace(/\.pdf$/i, ''));
    setAskName(true);
  };

  const confirmSaveAs = async () => {
    const file = `${draft.trim() || 'document'}.pdf`;
    setAskName(false);
    downloadBlob(await makeBlob(), file);
    toast({ title: 'Файл сохранён', description: file });
  };

  const print = async () => {
    setShow(false);
    const blob = await makeBlob();
    const url = URL.createObjectURL(blob);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.src = url;
    frame.onload = () => {
      setTimeout(() => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      }, 300);
    };
    document.body.appendChild(frame);
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60000);
    toast({ title: 'Отправлено на печать', description: 'Выберите принтер в окне печати' });
  };

  const close = () => {
    setShow(false);
    reset();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'o') {
        e.preventDefault();
        openInput.current?.click();
      } else if (k === 's' && has) {
        e.preventDefault();
        if (e.shiftKey) saveAs();
        else save();
      } else if (k === 'p' && has) {
        e.preventDefault();
        print();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const items = [
    { icon: 'FolderOpen', label: 'Открыть', hint: 'Ctrl+O', fn: () => openInput.current?.click(), on: true },
    { icon: 'FilePlus2', label: 'Добавить файл', hint: '', fn: () => appendInput.current?.click(), on: has },
    { icon: 'Save', label: 'Сохранить', hint: 'Ctrl+S', fn: save, on: has, sep: true },
    { icon: 'SaveAll', label: 'Сохранить как…', hint: 'Ctrl+Shift+S', fn: saveAs, on: has },
    { icon: 'Printer', label: 'Печать…', hint: 'Ctrl+P', fn: print, on: has, sep: true },
    { icon: 'X', label: 'Закрыть документ', hint: '', fn: close, on: has },
  ];

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setShow((v) => !v)}
        className={`flex h-9 items-center gap-1.5 px-3 font-head text-[0.78rem] font-bold uppercase tracking-[0.08em] transition-colors ${
          show ? 'bg-foreground text-background' : 'hover:bg-card'
        }`}
      >
        Файл
        <Icon name="ChevronDown" size={13} />
      </button>

      {show && (
        <div className="animate-fade-in absolute left-0 top-full z-50 mt-px w-[280px] border border-foreground bg-background shadow-[6px_6px_0_hsl(var(--rule)/0.25)]">
          {items.map((it) => (
            <button
              key={it.label}
              onClick={it.fn}
              disabled={!it.on}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:opacity-35 ${
                it.sep ? 'border-t border-border' : ''
              } enabled:hover:bg-card`}
            >
              <Icon name={it.icon} size={16} className="shrink-0 text-primary" />
              <span className="flex-1 text-[0.88rem]">{it.label}</span>
              {it.hint && (
                <span className="font-head text-[0.7rem] tracking-[0.06em] text-muted-foreground">
                  {it.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <input
        ref={openInput}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            setShow(false);
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
            setShow(false);
            await append(f);
            toast({ title: 'Файл добавлен', description: f.name });
          }
          e.target.value = '';
        }}
      />

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

export default FileMenu;
