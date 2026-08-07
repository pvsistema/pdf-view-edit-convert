import Icon from '@/components/ui/icon';
import { LOGO_URL, APP_NAME } from '@/lib/brand';
import { useDoc } from '@/context/DocContext';
import { downloadBlob, formatSize } from '@/lib/pdf';
import { toast } from '@/hooks/use-toast';
import FileMenu from '@/components/app/FileMenu';

const AppBar = () => {
  const { name, pages, files, buildPdf } = useDoc();

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
        <div className="flex items-center gap-2.5">
          <img src={LOGO_URL} alt={APP_NAME} className="h-7 w-auto" />
          <span className="hidden font-head text-[0.78rem] font-bold uppercase tracking-[0.12em] sm:inline">
            ПВ-Система&nbsp;PDF
          </span>
        </div>

        <div className="ml-2 flex items-center border-l border-border pl-2">
          <FileMenu />
        </div>

        {name && (
          <div className="hidden min-w-0 items-baseline gap-3 border-l border-border pl-4 md:flex">
            <span className="truncate font-head text-[0.9rem] font-bold">{name}</span>
            <span className="shrink-0 text-[0.74rem] uppercase tracking-[0.1em] text-muted-foreground">
              {pages.length} стр. · {formatSize(totalSize)}
            </span>
          </div>
        )}

        {name && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={print}
              className="inline-flex h-10 items-center gap-2 border border-foreground px-4 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] transition-colors hover:bg-foreground hover:text-background"
              title="Печать (Ctrl+P)"
            >
              <Icon name="Printer" size={15} />
              <span className="hidden sm:inline">Печать</span>
            </button>
            <button
              onClick={save}
              className="inline-flex h-10 items-center gap-2 bg-primary px-4 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] text-primary-foreground transition-colors hover:bg-deep"
              title="Сохранить (Ctrl+S)"
            >
              <Icon name="Save" size={15} />
              <span className="hidden sm:inline">Сохранить</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default AppBar;
