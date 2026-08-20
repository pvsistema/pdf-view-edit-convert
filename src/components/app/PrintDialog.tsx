import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/icon';
import {
  useDoc,
  DEFAULT_LAYOUT,
  type Layout,
  type PaperId,
  type FitMode,
  type Orientation,
} from '@/context/DocContext';
import { printBlob, downloadBlob } from '@/lib/files';
import { toast } from '@/hooks/use-toast';
import PrintPreview from '@/components/app/PrintPreview';
import DraggableDialog from '@/components/app/DraggableDialog';
import { isDesktop, nativePrint, openPrinterSetup, printerList, savedPrinter } from '@/lib/desktop';

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

const PAPER_LIST: { id: PaperId; label: string }[] = [
  { id: 'original', label: 'Как в файле' },
  { id: 'a4', label: 'A4' },
  { id: 'a3', label: 'A3' },
  { id: 'a5', label: 'A5' },
  { id: 'letter', label: 'Letter' },
  { id: 'legal', label: 'Legal' },
];

const FIT_LIST: { id: FitMode; label: string; note: string }[] = [
  { id: 'fit', label: 'Вписать', note: 'Целиком, с полями по краям' },
  { id: 'fill', label: 'Заполнить', note: 'На весь лист, края обрежутся' },
  { id: 'stretch', label: 'Растянуть', note: 'Точно по листу, пропорции меняются' },
  { id: 'actual', label: 'Реальный размер', note: 'Без масштабирования' },
];

const ORIENT: { id: Orientation; label: string; icon: string }[] = [
  { id: 'auto', label: 'Авто', icon: 'Sparkles' },
  { id: 'portrait', label: 'Книжная', icon: 'RectangleVertical' },
  { id: 'landscape', label: 'Альбомная', icon: 'RectangleHorizontal' },
];

const PrintDialog = ({ onClose }: { onClose: () => void }) => {
  const { pages, active, name, buildPdf } = useDoc();
  const [scope, setScope] = useState<Scope>('all');
  const [range, setRange] = useState(`${active + 1}`);
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [tab, setTab] = useState<'pages' | 'paper'>('pages');
  const [preview, setPreview] = useState(0);

  const desktop = isDesktop();
  const [printers, setPrinters] = useState<string[]>(() => (desktop ? printerList() : []));
  const [printer, setPrinter] = useState(() =>
    desktop ? savedPrinter() || printerList()[0] || '' : '',
  );

  // Программа ищет принтеры в фоне — подхватываем список, когда он готов
  useEffect(() => {
    if (!desktop) return;
    const sync = () => {
      const list = printerList();
      setPrinters(list);
      setPrinter((p) => (p && list.includes(p) ? p : savedPrinter() || list[0] || ''));
    };
    sync();
    window.addEventListener('pvspdf-printers', sync);
    return () => window.removeEventListener('pvspdf-printers', sync);
  }, [desktop]);

  const indexes = useMemo(() => {
    const total = pages.length;
    if (scope === 'all') return pages.map((_, i) => i);
    if (scope === 'current') return [active];
    if (scope === 'odd') return pages.map((_, i) => i).filter((i) => i % 2 === 0);
    if (scope === 'even') return pages.map((_, i) => i).filter((i) => i % 2 === 1);
    return parseRange(range, total);
  }, [scope, range, active, pages]);

  const pos = Math.min(preview, Math.max(0, indexes.length - 1));
  const shown = pages[indexes[pos]];

  const set = (patch: Partial<Layout>) => setLayout((l) => ({ ...l, ...patch }));

  const run = async (mode: 'print' | 'save') => {
    if (!indexes.length) {
      toast({ title: 'Страницы не выбраны', description: 'Проверьте указанный диапазон' });
      return;
    }
    setBusy(true);
    try {
      let list = indexes.map((i) => pages[i]);
      if (copies > 1) list = Array.from({ length: copies }, () => list).flat();
      const bytes = await buildPdf(list, layout);
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const file = `${(name || 'document').replace(/\.pdf$/i, '')}-печать.pdf`;
      if (mode === 'print') {
        // Закрываем окно настроек до вызова печати: системный диалог блокирует
        // страницу, и без этого настройки остаются висеть поверх него
        onClose();
        if (desktop) {
          // Документ уходит сразу на выбранный принтер,
          // итог печати покажем после ответа программы
          await nativePrint(blob, file, printer);
        } else {
          setTimeout(() => printBlob(blob, file), 60);
          toast({ title: 'Готовим печать', description: `Страниц: ${list.length}` });
        }
        return;
      } else {
        downloadBlob(blob, file);
        toast({ title: 'Выборка сохранена', description: `Страниц: ${list.length}` });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const scopes: { id: Scope; label: string; note: string }[] = [
    { id: 'all', label: 'Все страницы', note: `${pages.length} шт.` },
    { id: 'current', label: 'Текущая страница', note: `№ ${active + 1}` },
    { id: 'range', label: 'Диапазон', note: 'например 1-3, 7' },
    { id: 'odd', label: 'Нечётные', note: '1, 3, 5…' },
    { id: 'even', label: 'Чётные', note: '2, 4, 6…' },
  ];

  const footer = (
    <div className="p-4">
      <div className="flex gap-3">
      <button
        className="btn-block flex-1 justify-center disabled:opacity-50"
        onClick={() => run('print')}
        disabled={busy || !indexes.length || (desktop && !printer)}
        title={desktop && printer ? `Печать на ${printer}` : undefined}
      >
        <Icon name={busy ? 'LoaderCircle' : 'Printer'} size={16} className={busy ? 'animate-spin' : ''} />
        Печать
      </button>
      <button
        className="border border-foreground px-5 py-3 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] transition-colors hover:bg-foreground hover:text-background disabled:opacity-50"
        onClick={() => run('save')}
        disabled={busy || !indexes.length}
        title="Сохранить выбранные страницы в файл"
      >
        В файл
      </button>
      <button
        className="border border-border px-5 py-3 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] transition-colors hover:border-foreground"
        onClick={onClose}
      >
        Отмена
      </button>
      </div>
    </div>
  );

  return (
    <DraggableDialog
      title="Печать документа"
      onClose={onClose}
      footer={footer}
      width={900}
      height={620}
      minWidth={560}
      minHeight={420}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden md:flex-row">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
            <div className="flex shrink-0 border border-border">
              {(
                [
                  ['pages', 'Страницы'],
                  ['paper', 'Формат листа'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex-1 py-2.5 font-head text-[0.74rem] font-bold uppercase tracking-[0.08em] transition-colors ${
                    tab === id ? 'bg-foreground text-background' : 'hover:bg-card'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'pages' ? (
              <>
                {desktop && (
                  <div className="mt-4 shrink-0">
                    <div className="mb-1.5 font-head text-[0.68rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      Принтер
                    </div>
                    {printers.length ? (
                      <div className="flex gap-2">
                        <div className="relative min-w-0 flex-1">
                          <Icon
                            name="Printer"
                            size={15}
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                          />
                          <select
                            value={printer}
                            onChange={(e) => setPrinter(e.target.value)}
                            className="w-full appearance-none border border-border bg-card py-2.5 pl-9 pr-9 text-[0.86rem] outline-none transition-colors hover:border-foreground focus:border-foreground"
                          >
                            {printers.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                          <Icon
                            name="ChevronDown"
                            size={15}
                            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                          />
                        </div>
                        <button
                          onClick={() => openPrinterSetup(printer)}
                          title="Настройки принтера: качество, лотки, двусторонняя печать"
                          className="flex shrink-0 items-center gap-1.5 border border-border px-3 text-[0.78rem] transition-colors hover:border-foreground"
                        >
                          <Icon name="Settings2" size={15} />
                          Настройки
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 border border-border bg-card px-3 py-2.5 text-[0.82rem] text-muted-foreground">
                        <span className="flex-1">Принтеры не найдены</span>
                        <button
                          onClick={() => openPrinterSetup('')}
                          className="shrink-0 font-head text-[0.7rem] font-bold uppercase tracking-[0.08em] text-primary hover:underline"
                        >
                          Добавить принтер
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4 border-l border-t border-border">
                  {scopes.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => {
                        setScope(o.id);
                        setPreview(0);
                      }}
                      className={`flex w-full items-center gap-3 border-b border-r border-border px-4 py-2.5 text-left transition-colors ${
                        scope === o.id ? 'bg-primary text-primary-foreground' : 'hover:bg-card'
                      }`}
                    >
                      <Icon name={scope === o.id ? 'CircleDot' : 'Circle'} size={15} className="shrink-0" />
                      <span className="flex-1 text-[0.9rem]">{o.label}</span>
                      <span
                        className={`text-[0.74rem] ${
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
                    className="mt-3 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
                  />
                )}

                <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
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
              </>
            ) : (
              <>
                <div className="label-caps mt-5">Размер листа</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PAPER_LIST.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => set({ paper: p.id })}
                      className={`border px-3 py-2 font-head text-[0.76rem] font-bold uppercase tracking-[0.06em] transition-colors ${
                        layout.paper === p.id
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:border-foreground'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div className="label-caps mt-5">Ориентация</div>
                <div className="mt-2 flex gap-2">
                  {ORIENT.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => set({ orientation: o.id })}
                      className={`flex flex-1 items-center justify-center gap-2 border px-3 py-2 text-[0.8rem] transition-colors ${
                        layout.orientation === o.id
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:border-foreground'
                      }`}
                    >
                      <Icon name={o.icon} size={14} />
                      {o.label}
                    </button>
                  ))}
                </div>

                <div className="label-caps mt-5">Как разместить</div>
                <div className="mt-2 border-l border-t border-border">
                  {FIT_LIST.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => set({ fit: f.id })}
                      className={`flex w-full items-start gap-3 border-b border-r border-border px-4 py-2.5 text-left transition-colors ${
                        layout.fit === f.id ? 'bg-primary text-primary-foreground' : 'hover:bg-card'
                      }`}
                    >
                      <Icon
                        name={layout.fit === f.id ? 'CircleDot' : 'Circle'}
                        size={15}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block text-[0.9rem]">{f.label}</span>
                        <span
                          className={`block text-[0.74rem] ${
                            layout.fit === f.id ? 'text-primary-foreground/80' : 'text-muted-foreground'
                          }`}
                        >
                          {f.note}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="mt-5 flex items-center justify-between">
                  <span className="text-[0.88rem]">Поля, мм</span>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={40}
                      step={5}
                      value={Math.round(layout.margin / 2.835)}
                      onChange={(e) => set({ margin: +e.target.value * 2.835 })}
                      className="w-[150px] accent-primary"
                    />
                    <span className="w-8 text-right font-head text-[0.84rem] font-bold">
                      {Math.round(layout.margin / 2.835)}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex w-full shrink-0 flex-col items-center overflow-y-auto border-t border-border bg-card p-5 md:w-[300px] md:border-l md:border-t-0">
            <div className="label-caps mb-4 self-start">Предпросмотр</div>
            <PrintPreview page={shown} layout={layout} index={pos} total={indexes.length} />

            {indexes.length > 1 && (
              <div className="mt-3 flex items-center border border-border bg-background">
                <button
                  className="px-3 py-1.5 hover:bg-card disabled:opacity-30"
                  onClick={() => setPreview((p) => Math.max(0, p - 1))}
                  disabled={pos === 0}
                >
                  <Icon name="ChevronLeft" size={14} />
                </button>
                <span className="px-2 font-head text-[0.76rem] font-bold">
                  {pos + 1} / {indexes.length}
                </span>
                <button
                  className="px-3 py-1.5 hover:bg-card disabled:opacity-30"
                  onClick={() => setPreview((p) => Math.min(indexes.length - 1, p + 1))}
                  disabled={pos >= indexes.length - 1}
                >
                  <Icon name="ChevronRight" size={14} />
                </button>
              </div>
            )}

            <div className="mt-auto w-full pt-5 text-center text-[0.82rem] text-muted-foreground">
              К печати:{' '}
              <span className="font-head font-bold text-foreground">
                {indexes.length * copies} стр.
              </span>
            </div>
          </div>
        </div>
    </DraggableDialog>
  );
};

export default PrintDialog;