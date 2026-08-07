import Icon from '@/components/ui/icon';
import { LOGO_URL, APP_NAME } from '@/lib/brand';
import { useDoc } from '@/context/DocContext';
import { downloadBlob, formatSize } from '@/lib/pdf';
import { toast } from '@/hooks/use-toast';
import MenuBar from '@/components/app/MenuBar';

const AppBar = () => {
  const { name, pages, files, buildPdf, undo, redo, canUndo, canRedo } = useDoc();

  const save = async () => {
    const bytes = await buildPdf();
    downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), name || 'document.pdf');
    toast({ title: 'Документ сохранён' });
  };

  const print = async () => {
    const bytes = await buildPdf();
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.src = url;
    frame.onload = () =>
      setTimeout(() => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      }, 300);
    document.body.appendChild(frame);
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60000);
  };

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  return (
    <header className="shrink-0 border-b border-foreground bg-background">
      <div className="flex h-14 items-center gap-3 px-4">
        <MenuBar />

        {name && (
          <>
            <div className="flex items-center border-l border-border pl-3">
              <button
                onClick={undo}
                disabled={!canUndo}
                title="Отменить (Ctrl+Z)"
                className="flex h-9 w-9 items-center justify-center transition-colors hover:bg-card disabled:opacity-30"
              >
                <Icon name="Undo2" size={16} />
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                title="Вернуть (Ctrl+Y)"
                className="flex h-9 w-9 items-center justify-center transition-colors hover:bg-card disabled:opacity-30"
              >
                <Icon name="Redo2" size={16} />
              </button>
            </div>

            <div className="hidden min-w-0 items-baseline gap-3 border-l border-border pl-3 lg:flex">
              <span className="truncate font-head text-[0.88rem] font-bold">{name}</span>
              <span className="shrink-0 text-[0.72rem] uppercase tracking-[0.1em] text-muted-foreground">
                {pages.length} стр. · {formatSize(totalSize)}
              </span>
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {name && (
            <>
              <button
                onClick={print}
                className="inline-flex h-10 items-center gap-2 border border-foreground px-4 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] transition-colors hover:bg-foreground hover:text-background"
                title="Печать (Ctrl+P)"
              >
                <Icon name="Printer" size={15} />
                <span className="hidden md:inline">Печать</span>
              </button>
              <button
                onClick={save}
                className="inline-flex h-10 items-center gap-2 bg-primary px-4 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] text-primary-foreground transition-colors hover:bg-deep"
                title="Сохранить (Ctrl+S)"
              >
                <Icon name="Save" size={15} />
                <span className="hidden md:inline">Сохранить</span>
              </button>
            </>
          )}

          <div className="flex items-center gap-2.5 border-l border-border pl-3">
            <span className="hidden font-head text-[0.76rem] font-bold uppercase tracking-[0.12em] sm:inline">
              ПВ-Система&nbsp;PDF
            </span>
            <img src={LOGO_URL} alt={APP_NAME} className="h-7 w-auto" />
          </div>
        </div>
      </div>
    </header>
  );
};

export default AppBar;
