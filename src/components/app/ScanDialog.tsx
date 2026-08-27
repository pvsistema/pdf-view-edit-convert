import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { toast } from '@/hooks/use-toast';
import {
  listScanners,
  startScan,
  cancelScan,
  openScanDriverUi,
  onScanners,
  onScanPage,
  onScanDone,
  type ScanDevice,
} from '@/lib/desktop';
import { scansToPdf, scanFileName } from '@/lib/scanToPdf';

type Props = {
  batch?: boolean;
  onReady: (file: File) => void | Promise<void>;
  onClose: () => void;
};

type Shot = { index: number; url: string; turn: number };

const plural = (n: number) => {
  const t = n % 10;
  if (n > 10 && n < 20) return 'страниц';
  if (t === 1) return 'страница';
  if (t > 1 && t < 5) return 'страницы';
  return 'страниц';
};

const DPI = [
  { v: 150, t: '150 — быстро' },
  { v: 200, t: '200' },
  { v: 300, t: '300 — обычно' },
  { v: 400, t: '400' },
  { v: 600, t: '600 — мелкий шрифт' },
];

const COLORS = [
  { v: 'color', t: 'Цветной' },
  { v: 'gray', t: 'Оттенки серого' },
  { v: 'bw', t: 'Чёрно-белый' },
] as const;

const ScanDialog = ({ batch = false, onReady, onClose }: Props) => {
  const [devices, setDevices] = useState<ScanDevice[] | null>(null);
  const [device, setDevice] = useState('');
  const [dpi, setDpi] = useState(300);
  const [color, setColor] = useState<'color' | 'gray' | 'bw'>('color');
  const [feeder, setFeeder] = useState(false);
  const [duplex, setDuplex] = useState(false);
  const [limit, setLimit] = useState(0);

  const [busy, setBusy] = useState(false);
  const [driver, setDriver] = useState(false);
  const [building, setBuilding] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  const strip = useRef<HTMLDivElement>(null);
  const current = devices?.find((d) => d.id === device);

  useEffect(() => {
    const offList = onScanners((list, hint) => {
      setDevices(list);
      setHint(hint || '');
      if (list.length) {
        setDevice((cur) => cur || list[0].id);
        // В пакетном режиме сразу предлагаем автоподатчик,
        // если устройство его умеет
        setFeeder(list[0].feeder && batch);
      }
    });
    listScanners();
    return offList;
  }, [batch]);

  // Снятые листы показываем сразу — видно, что работа идёт
  useEffect(
    () =>
      onScanPage((p) => {
        setShots((list) => [...list, { ...p, turn: 0 }]);
        requestAnimationFrame(() => {
          strip.current?.scrollTo({ left: strip.current.scrollWidth, behavior: 'smooth' });
        });
      }),
    [],
  );

  useEffect(
    () =>
      onScanDone((r) => {
        setBusy(false);
        setDriver(false);
        if (r.cancelled) {
          toast({ title: 'Сканирование остановлено' });
          return;
        }
        if (!r.ok) {
          setError(r.error || 'Сканер не ответил');
          return;
        }
        if (!r.pages?.length) setError('Сканер не передал ни одной страницы');
      }),
    [],
  );

  // Снятое раньше не трогаем: страницы из нескольких заходов
  // складываются в один документ, как в пакетной обработке
  const run = () => {
    setError('');
    setBusy(true);
    startScan({ device, dpi, color, feeder, duplex, limit });
  };

  // Настройки производителя: полезно, когда сканер плохо слушается
  // общих настроек Windows — там свои подсветка, обрезка, очистка фона
  const viaDriver = () => {
    setError('');
    setBusy(true);
    setDriver(true);
    openScanDriverUi(device);
  };

  // Собираем PDF из снятых листов и открываем его как обычный документ
  const finish = async () => {
    if (!shots.length) return;
    setBuilding(true);
    try {
      const bytes = await scansToPdf(shots.map((s) => ({ url: s.url, turn: s.turn })));
      const name = scanFileName();
      await onReady(new File([bytes as BlobPart], name, { type: 'application/pdf' }));
      toast({
        title: 'Документ готов',
        description: `${shots.length} ${plural(shots.length)} из сканера`,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось собрать документ');
    } finally {
      setBuilding(false);
    }
  };

  // Криво лежавший лист можно развернуть здесь, не сканируя заново
  const turnPage = (url: string, dir: number) =>
    setShots((list) =>
      list.map((s) => (s.url === url ? { ...s, turn: (s.turn + dir + 360) % 360 } : s)),
    );

  const turnAll = (dir: number) =>
    setShots((list) => list.map((s) => ({ ...s, turn: (s.turn + dir + 360) % 360 })));

  const none = devices !== null && devices.length === 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/50 p-6">
      <div className="flex max-h-full w-full max-w-[720px] flex-col border border-foreground bg-background">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <div className="label-caps">{batch ? 'Пакетное сканирование' : 'Сканирование'}</div>
            <p className="mt-1 text-[0.8rem] text-muted-foreground">
              {batch ? 'Пачка листов в один документ' : 'Документ собирается на вашем компьютере'}
            </p>
          </div>
          <button onClick={onClose} className="hover:text-destructive" title="Закрыть">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {devices === null && (
            <div className="flex items-center gap-3 text-[0.88rem] text-muted-foreground">
              <Icon name="LoaderCircle" size={16} className="animate-spin text-primary" />
              Ищу подключённые сканеры
            </div>
          )}

          {none && (
            <div className="border border-border bg-card p-5">
              <div className="flex items-center gap-2 font-head text-[0.9rem] font-bold">
                <Icon name="TriangleAlert" size={16} className="text-primary" />
                Сканер не найден
              </div>
              <p className="mt-2 text-[0.84rem] leading-relaxed text-muted-foreground">
                {hint ||
                  'Проверьте, что устройство включено, подключено к компьютеру и для него установлен драйвер производителя. Сетевой сканер должен быть добавлен в разделе Windows «Принтеры и сканеры».'}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    setDevices(null);
                    listScanners();
                  }}
                  className="border border-foreground px-4 py-2 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] transition-colors hover:bg-foreground hover:text-background"
                >
                  Искать снова
                </button>
                <button
                  onClick={viaDriver}
                  disabled={busy || building}
                  title="Выбрать сканер средствами Windows"
                  className="border border-border px-4 py-2 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] transition-colors hover:border-foreground disabled:opacity-40"
                >
                  Выбрать через Windows
                </button>
              </div>
              <p className="mt-3 text-[0.78rem] leading-relaxed text-muted-foreground">
                Некоторые сетевые и многофункциональные устройства не отвечают на общий
                опрос. Окно Windows находит их напрямую — попробуйте этот способ.
              </p>
            </div>
          )}

          {devices !== null && devices.length > 0 && (
            <>
              <label className="label-caps">Устройство</label>
              <select
                value={device}
                disabled={busy}
                onChange={(e) => {
                  setDevice(e.target.value);
                  const d = devices.find((x) => x.id === e.target.value);
                  setFeeder(!!d?.feeder);
                  setDuplex(false);
                }}
                className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
              >
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.twain ? ' — драйвер производителя' : ''}
                  </option>
                ))}
              </select>

              {current?.twain && (
                <p className="mt-2 text-[0.76rem] leading-relaxed text-muted-foreground">
                  Работаем через драйвер производителя — так же, как программы для
                  распознавания. Если сканер не отзывается, закройте другие программы
                  сканирования: драйвер работает только с одной.
                </p>
              )}

              <div className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <label className="label-caps">Качество, точек на дюйм</label>
                  <select
                    value={dpi}
                    disabled={busy}
                    onChange={(e) => setDpi(Number(e.target.value))}
                    className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
                  >
                    {DPI.map((d) => (
                      <option key={d.v} value={d.v}>
                        {d.t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label-caps">Цвет</label>
                  <select
                    value={color}
                    disabled={busy}
                    onChange={(e) => setColor(e.target.value as typeof color)}
                    className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
                  >
                    {COLORS.map((c) => (
                      <option key={c.v} value={c.v}>
                        {c.t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-5 border border-border bg-card p-4">
                <div className="label-caps">Пакетное сканирование</div>

                <label className="mt-3 flex items-center gap-3 text-[0.88rem]">
                  <input
                    type="checkbox"
                    checked={feeder}
                    disabled={busy || !current?.feeder}
                    onChange={(e) => setFeeder(e.target.checked)}
                  />
                  <span className={current?.feeder ? '' : 'text-muted-foreground'}>
                    Пачкой из автоподатчика
                    {!current?.feeder && ' — устройство не поддерживает'}
                  </span>
                </label>

                <label className="mt-2.5 flex items-center gap-3 text-[0.88rem]">
                  <input
                    type="checkbox"
                    checked={duplex}
                    disabled={busy || !feeder || !current?.duplex}
                    onChange={(e) => setDuplex(e.target.checked)}
                  />
                  <span className={feeder && current?.duplex ? '' : 'text-muted-foreground'}>
                    Обе стороны листа
                    {feeder && !current?.duplex && ' — устройство не поддерживает'}
                  </span>
                </label>

                <div className="mt-3.5 flex items-center gap-3">
                  <span className="text-[0.88rem] text-muted-foreground">Сколько листов</span>
                  <input
                    type="number"
                    min={0}
                    value={limit || ''}
                    placeholder="все"
                    disabled={busy || !feeder}
                    onChange={(e) => setLimit(Math.max(0, Number(e.target.value) || 0))}
                    className="w-[110px] border border-border bg-background px-3 py-2 text-[0.88rem] outline-none focus:border-primary disabled:opacity-40"
                  />
                </div>

                <p className="mt-3 text-[0.76rem] leading-relaxed text-muted-foreground">
                  Пустое поле — сканировать, пока в автоподатчике есть бумага. Без автоподатчика
                  берётся один лист со стекла.
                </p>
              </div>

              <p className="mt-4 text-[0.76rem] leading-relaxed text-muted-foreground">
                Если сканер не слушается этих настроек, нажмите «Окно драйвера» — откроются
                настройки производителя устройства, а снимок вернётся сюда.
              </p>
            </>
          )}

          {busy && (
            <div className="mt-5 flex items-center gap-3 border border-primary bg-primary/5 px-4 py-3">
              <Icon name="LoaderCircle" size={16} className="animate-spin text-primary" />
              <span className="text-[0.88rem]">
                {driver
                  ? 'Настройте сканер в окне производителя'
                  : shots.length
                    ? `Снято страниц: ${shots.length}`
                    : 'Готовлю сканер'}
              </span>
              {!driver && (
                <button
                  onClick={cancelScan}
                  className="ml-auto text-[0.78rem] text-muted-foreground hover:text-destructive"
                >
                  Остановить
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="mt-5 border border-destructive bg-destructive/5 px-4 py-3 text-[0.85rem]">
              {error}
            </div>
          )}

          {shots.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="label-caps">
                  Снятые страницы — {shots.length} {plural(shots.length)}
                </span>
                <button
                  onClick={() => turnAll(90)}
                  disabled={busy}
                  title="Повернуть все страницы"
                  className="flex items-center gap-1.5 text-[0.76rem] text-muted-foreground transition-colors hover:text-primary disabled:opacity-40"
                >
                  <Icon name="RotateCw" size={13} />
                  Повернуть все
                </button>
              </div>
              <div ref={strip} className="flex gap-2 overflow-x-auto pb-2">
                {shots.map((s, i) => (
                  <div key={s.url} className="group relative shrink-0">
                    <div className="flex h-[130px] w-[110px] items-center justify-center overflow-hidden border border-border bg-white">
                      <img
                        src={s.url}
                        alt={`Страница ${i + 1}`}
                        style={{ transform: `rotate(${s.turn}deg)` }}
                        className="max-h-full max-w-full object-contain transition-transform"
                      />
                    </div>

                    <button
                      onClick={() => setShots((l) => l.filter((x) => x.url !== s.url))}
                      title="Убрать страницу"
                      className="absolute right-1 top-1 bg-destructive p-0.5 text-destructive-foreground"
                    >
                      <Icon name="X" size={11} />
                    </button>

                    <div className="absolute bottom-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => turnPage(s.url, -90)}
                        title="Повернуть влево"
                        className="bg-foreground/80 p-1 text-background hover:bg-primary"
                      >
                        <Icon name="RotateCcw" size={11} />
                      </button>
                      <button
                        onClick={() => turnPage(s.url, 90)}
                        title="Повернуть вправо"
                        className="bg-foreground/80 p-1 text-background hover:bg-primary"
                      >
                        <Icon name="RotateCw" size={11} />
                      </button>
                    </div>

                    <span className="absolute bottom-1 left-1 bg-foreground/75 px-1.5 text-[0.65rem] text-background">
                      {i + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-4">
          <button
            onClick={run}
            disabled={busy || building || !device}
            className="btn-block justify-center disabled:opacity-40"
          >
            <Icon name="Scan" size={15} />
            {shots.length ? 'Сканировать ещё' : 'Сканировать'}
          </button>

          <button
            onClick={viaDriver}
            disabled={busy || building || !device}
            title="Настройки от производителя сканера"
            className="border border-border px-4 py-3 font-head text-[0.72rem] font-bold uppercase tracking-[0.08em] transition-colors hover:border-foreground disabled:opacity-40"
          >
            <span className="flex items-center gap-2">
              <Icon name="SlidersHorizontal" size={14} />
              Окно драйвера
            </span>
          </button>

          <button
            onClick={() => void finish()}
            disabled={!shots.length || busy || building}
            className="border border-foreground px-5 py-3 font-head text-[0.74rem] font-bold uppercase tracking-[0.1em] transition-colors hover:bg-foreground hover:text-background disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground"
          >
            {building ? 'Собираю документ' : 'Открыть как документ'}
          </button>

          <button
            onClick={onClose}
            className="ml-auto text-[0.82rem] text-muted-foreground hover:text-foreground"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScanDialog;