import { useRef } from 'react';
import Icon from '@/components/ui/icon';
import { LOGO_URL } from '@/lib/brand';
import { useDoc } from '@/context/DocContext';
import { downloadBlob, formatSize } from '@/lib/pdf';
import { toast } from '@/hooks/use-toast';

const AppBar = () => {
  const { name, pages, files, reset, buildPdf, open } = useDoc();
  const input = useRef<HTMLInputElement>(null);

  const save = async () => {
    const bytes = await buildPdf();
    downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), name || 'document.pdf');
    toast({ title: 'Документ сохранён' });
  };

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-foreground bg-background px-4">
      <div className="flex items-center gap-2.5">
        <img src={LOGO_URL} alt="ПВ-Система PDF" className="h-7 w-auto" />
        <span className="font-head text-[0.78rem] font-bold uppercase tracking-[0.12em]">
          ПВ-Система&nbsp;PDF
        </span>
      </div>

      {name && (
        <div className="hidden min-w-0 items-baseline gap-3 border-l border-border pl-4 md:flex">
          <span className="truncate font-head text-[0.9rem] font-bold">{name}</span>
          <span className="shrink-0 text-[0.76rem] uppercase tracking-[0.1em] text-muted-foreground">
            {pages.length} стр. · {formatSize(totalSize)}
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              await open(f);
              toast({ title: 'Документ открыт', description: f.name });
            }
            e.target.value = '';
          }}
        />
        <button
          onClick={() => input.current?.click()}
          className="inline-flex items-center gap-2 border border-foreground px-4 py-2.5 font-head text-[0.74rem] font-bold uppercase tracking-[0.1em] transition-colors hover:bg-foreground hover:text-background"
        >
          <Icon name="FolderOpen" size={15} />
          Открыть
        </button>
        {name && (
          <>
            <button
              onClick={save}
              className="inline-flex items-center gap-2 bg-primary px-4 py-2.5 font-head text-[0.74rem] font-bold uppercase tracking-[0.1em] text-primary-foreground transition-colors hover:bg-deep"
            >
              <Icon name="Save" size={15} />
              Сохранить
            </button>
            <button
              onClick={reset}
              className="flex h-10 w-10 items-center justify-center border border-border transition-colors hover:border-destructive hover:text-destructive"
              title="Закрыть документ"
            >
              <Icon name="X" size={16} />
            </button>
          </>
        )}
      </div>
    </header>
  );
};

export default AppBar;