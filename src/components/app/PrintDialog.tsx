import { useMemo, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useDoc } from '@/context/DocContext';
import { printBlob, downloadBlob } from '@/lib/pdf';
import { toast } from '@/hooks/use-toast';

type Scope = 'all' | 'current' | 'range' | 'even' | 'odd';

export const parseRange = (text: string, total: number) => {
  const set = new Set<number>();
  for (const part of text.split(/[,;]/)) {
    const chunk = part.trim();
    if (!chunk) continue;
    const m = chunk.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (m) {
      const a = Math.min(+m[1], +m[2]);
      const b = Math.max(+m[1], +m[2]);
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) set.add(i - 1);
    } else if (/^\d+$/.test(chunk)) {
      const n = +chunk;
      if (n >= 1 && n <= total) set.add(n - 1);
    }
  }
  return [...set].sort((a, b) => a - b);
};

const PrintDialog = ({ onClose }: { onClose: () => void }) => {
  const { pages, active, name, buildPdf } = useDoc();
  const [scope, setScope] = useState<Scope>('all');
  const [range, setRange] = useState(`${active + 1}`);
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);

  const indexes = useMemo(() => {
    const total = pages.length;
    if (scope === 'all') return pages.map((_, i) => i);
    if (scope === 'current') return [active];
    if (scope === 'odd') return pages.map((_, i) => i).filter((i) => i % 2 === 0);
    if (scope === 'even') return pages.map((_, i) => i).filter((i) => i % 2 === 1);
    return parseRange(range, total);
  }, [scope, range, active, pages]);

  const run = async (mode: 'print' | 'save') => {
    if (!indexes.length) {
      toast({ title: 'Страницы не выбраны', description: 'Проверьте указанный диапазон' });
      return;
    }
    setBusy(true);
    try {
      let list = indexes.map((i) => pages[i]);
      if (copies > 1) list = Array.from({ length: copies }, () => list).flat();
      const bytes = await buildPdf(list);
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const file = `${(name || 'document').replace(/\.pdf$/i, '')}-печать.pdf`;
      if (mode === 'print') {
        printBlob(blob, file);
        toast({ title: 'Готовим печать', description: `Страниц: ${list.length}` });
      } else {
        downloadBlob(blob, file);
        toast({ title: 'Выборка сохранена', description: `Страниц: ${list.length}` });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const options: { id: Scope; label: string; note: string }[] = [
    { id: 'all', label: 'Все страницы', note: `${pages.length} шт.` },
    { id: 'current', label: 'Текущая страница', note: `№ ${active + 1}` },
    { id: 'range', label: 'Диапазон', note: 'например 1-3, 7' },
    { id: 'odd', label: 'Нечётные', note: '1, 3, 5…' },
    { id: 'even', label: 'Чётные', note: '2, 4, 6…' },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/50 p-6">
      <div className="w-full max-w-[460px] border border-foreground bg-background">
        <div className="flex items-center justify-between border-b border-foreground bg-foreground px-4 py-3 text-background">
          <span className="font-head text-[0.76rem] font-bold uppercase tracking-[0.12em]">
            Печать документа
          </span>
          <button onClick={onClose} className="transition-opacity hover:opacity-70" title="Закрыть">
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="p-5">
          <div className="label-caps">Что печатать</div>
          <div className="mt-3 border-l border-t border-border">
            {options.map((o) => (
              <button
                key={o.id}
                onClick={() => setScope(o.id)}
                className={`flex w-full items-center gap-3 border-b border-r border-border px-4 py-3 text-left transition-colors ${
                  scope === o.id ? 'bg-primary text-primary-foreground' : 'hover:bg-card'
                }`}
              >
                <Icon
                  name={scope === o.id ? 'CircleDot' : 'Circle'}
                  size={15}
                  className="shrink-0"
                />
                <span className="flex-1 text-[0.9rem]">{o.label}</span>
                <span
                  className={`text-[0.76rem] ${
                    scope === o.id ? 'text-primary-foreground/80' : 'text-muted-foreground'
                  }`}
                >
                  {o.note}
                </span>
              </button>
            ))}
          </div>

          {scope === 'range' && (
            <input
              autoFocus
              value={range}
              onChange={(e) => setRange(e.target.value)}
              placeholder="1-3, 5, 8-10"
              className="mt-3 w-full border border-border bg-background px-3 py-3 text-[0.9rem] outline-none focus:border-primary"
            />
          )}

          <div className="mt-5 flex items-center justify-between border-t border-border pt-5">
            <span className="text-[0.88rem]">Копий</span>
            <div className="flex items-center border border-border">
              <button
                className="px-3 py-2 hover:bg-card disabled:opacity-30"
                onClick={() => setCopies((c) => Math.max(1, c - 1))}
                disabled={copies <= 1}
              >
                <Icon name="Minus" size={14} />
              </button>
              <span className="w-10 text-center font-head text-[0.86rem] font-bold">{copies}</span>
              <button
                className="px-3 py-2 hover:bg-card disabled:opacity-30"
                onClick={() => setCopies((c) => Math.min(20, c + 1))}
                disabled={copies >= 20}
              >
                <Icon name="Plus" size={14} />
              </button>
            </div>
          </div>

          <div className="mt-4 bg-card px-4 py-3 text-[0.84rem] text-muted-foreground">
            К печати:{' '}
            <span className="font-head font-bold text-foreground">
              {indexes.length * copies} стр.
            </span>
            {indexes.length > 0 && indexes.length <= 12 && (
              <span> · номера: {indexes.map((i) => i + 1).join(', ')}</span>
            )}
          </div>

          <div className="mt-5 flex gap-3">
            <button
              className="btn-block flex-1 justify-center disabled:opacity-50"
              onClick={() => run('print')}
              disabled={busy || !indexes.length}
            >
              <Icon name={busy ? 'LoaderCircle' : 'Printer'} size={16} className={busy ? 'animate-spin' : ''} />
              Печать
            </button>
            <button
              className="border border-foreground px-4 py-3 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] transition-colors hover:bg-foreground hover:text-background disabled:opacity-50"
              onClick={() => run('save')}
              disabled={busy || !indexes.length}
              title="Сохранить выбранные страницы в файл"
            >
              В файл
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintDialog;
