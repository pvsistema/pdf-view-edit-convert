import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { toast } from '@/hooks/use-toast';
import { formatSize } from '@/lib/files';
import { isDesktop } from '@/lib/desktop';
import { useLicense } from '@/context/LicenseContext';
import { countPages } from '@/lib/convert/pdfOps';
import { DEFAULT_SETTINGS, runTool, type ToolSettings } from '@/lib/convert/runTool';
import type { ToolDef } from '@/lib/convert/catalog';
import { isTrialTool, leftWord, onTrialChange, spendTrial, trialLeft } from '@/lib/trial';

type Props = {
  tool: ToolDef;
  onBack: () => void;
  onClose: () => void;
  onNeedFull: () => void;
};

const plural = (n: number) => {
  const t = n % 10;
  if (n > 10 && n < 20) return 'страниц';
  if (t === 1) return 'страница';
  if (t > 1 && t < 5) return 'страницы';
  return 'страниц';
};

const LEVELS = [
  { v: 'light', t: 'Лёгкое', note: 'Качество почти не меняется' },
  { v: 'medium', t: 'Обычное', note: 'Хорошее соотношение веса и чёткости' },
  { v: 'strong', t: 'Сильное', note: 'Самый маленький файл' },
] as const;

const ToolRunner = ({ tool, onBack, onClose, onNeedFull }: Props) => {
  const { isFull } = useLicense();
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [pages, setPages] = useState<number | null>(null);
  const [set, setSet] = useState<ToolSettings>({ ...DEFAULT_SETTINGS, paper: tool.id === 'from-scan' ? 'a4' : 'fit' });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string>('');

  const [left, setLeft] = useState(() => trialLeft());
  useEffect(() => onTrialChange(() => setLeft(trialLeft())), []);

  const needsRange = ['remove-pages', 'extract-pages', 'reorder'].includes(tool.id);
  // Пока остались пробные попытки, платный инструмент отрабатывает
  // по-настоящему — с готовым файлом на выходе
  const trial = !!tool.pro && !isFull && isTrialTool(tool.id);
  const locked = !!tool.pro && !isFull && (!trial || left === 0);

  // Узнаём количество страниц: без него подсказка про номера
  // страниц была бы гаданием
  useEffect(() => {
    const f = files[0];
    setPages(null);
    if (!f || !f.name.toLowerCase().endsWith('.pdf')) return;
    let off = false;
    countPages(f)
      .then((n) => !off && setPages(n))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [files]);

  const pick = (list: FileList | null) => {
    if (!list?.length) return;
    setError('');
    setDone('');
    setFiles(tool.multiple ? [...files, ...Array.from(list)] : [list[0]]);
  };

  const start = async () => {
    if (!files.length) {
      setError('Сначала выберите файл');
      return;
    }
    if (locked) {
      onNeedFull();
      return;
    }

    setBusy(true);
    setError('');
    setDone('');
    setProgress(0);
    try {
      const r = await runTool(tool.id, files, set, (d, t) =>
        setProgress(t ? Math.round((d / t) * 100) : 0),
      );
      setDone(r.note || r.message);
      toast({ title: r.message, description: r.note });

      // Попытку списываем за готовый файл, а не за нажатие кнопки
      if (trial) {
        const rest = spendTrial(tool.id);
        setLeft(rest);
        toast({
          title: rest > 0 ? `Осталось ${leftWord(rest)}` : 'Пробные попытки закончились',
          description:
            rest > 0
              ? 'Пробный режим: инструмент работает ограниченное число раз'
              : 'Активируйте полную версию, чтобы продолжить',
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выполнить');
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <button onClick={onBack} className="hover:text-primary" title="Ко всем инструментам">
          <Icon name="ArrowLeft" size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon name={tool.icon} size={16} className={tool.tint} />
            <span className="label-caps truncate">{tool.title}</span>
            {tool.pro && !isFull && (
              <span className="border border-primary px-1.5 font-head text-[0.6rem] font-bold uppercase tracking-[0.08em] text-primary">
                {trial ? `Проба: осталось ${left}` : 'Полная версия'}
              </span>
            )}
          </div>
          <p className="mt-1 text-[0.8rem] text-muted-foreground">{tool.note}</p>
        </div>
        <button onClick={onClose} className="hover:text-destructive" title="Закрыть">
          <Icon name="X" size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <input
          ref={picker}
          type="file"
          accept={tool.accept}
          multiple={tool.multiple}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = '';
          }}
        />

        {!files.length ? (
          <button
            onClick={() => picker.current?.click()}
            className="flex w-full flex-col items-center gap-3 border-2 border-dashed border-border px-6 py-12 transition-colors hover:border-primary"
          >
            <Icon name="Upload" size={28} className="text-primary" />
            <span className="font-head text-[0.9rem] font-bold">
              {tool.multiple ? 'Выберите файлы' : 'Выберите файл'}
            </span>
            <span className="text-[0.8rem] text-muted-foreground">
              Файлы обрабатываются на вашем компьютере
            </span>
          </button>
        ) : (
          <>
            <div className="label-caps">Выбрано</div>
            <div className="mt-2 space-y-1.5">
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-3 border border-border bg-card px-3 py-2.5"
                >
                  <Icon name="File" size={15} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[0.86rem]">{f.name}</span>
                  <span className="shrink-0 text-[0.76rem] text-muted-foreground">
                    {formatSize(f.size)}
                  </span>
                  <button
                    onClick={() => setFiles(files.filter((_, k) => k !== i))}
                    disabled={busy}
                    className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-40"
                    title="Убрать"
                  >
                    <Icon name="X" size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-[0.78rem] text-muted-foreground">
              <button
                onClick={() => picker.current?.click()}
                disabled={busy}
                className="flex items-center gap-1.5 text-primary hover:underline disabled:opacity-40"
              >
                <Icon name="Plus" size={13} />
                {tool.multiple ? 'Добавить ещё' : 'Выбрать другой'}
              </button>
              <span>Общий размер: {formatSize(totalSize)}</span>
              {pages !== null && (
                <span>
                  В документе {pages} {plural(pages)}
                </span>
              )}
            </div>
          </>
        )}

        {files.length > 0 && (
          <div className="mt-5 space-y-5">
            {tool.id === 'compress' && (
              <div>
                <div className="label-caps">Насколько сжимать</div>
                <div className="mt-2 space-y-2">
                  {LEVELS.map((l) => (
                    <label
                      key={l.v}
                      className={`flex cursor-pointer items-start gap-3 border px-3 py-2.5 transition-colors ${
                        set.level === l.v ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      <input
                        type="radio"
                        checked={set.level === l.v}
                        onChange={() => setSet({ ...set, level: l.v })}
                        disabled={busy}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-[0.88rem] font-semibold">{l.t}</span>
                        <span className="block text-[0.78rem] text-muted-foreground">{l.note}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[0.76rem] leading-relaxed text-muted-foreground">
                  При сжатии страницы пересобираются снимками: файл становится легче,
                  но текст в нём больше нельзя выделить мышью.
                </p>
              </div>
            )}

            {needsRange && (
              <div>
                <div className="label-caps">
                  {tool.id === 'reorder' ? 'Порядок страниц' : 'Номера страниц'}
                </div>
                <input
                  value={set.range}
                  disabled={busy}
                  onChange={(e) => setSet({ ...set, range: e.target.value })}
                  placeholder={tool.id === 'reorder' ? 'например 3, 1, 2' : 'например 2, 5-7'}
                  className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
                />
                <p className="mt-2 text-[0.76rem] leading-relaxed text-muted-foreground">
                  {tool.id === 'reorder'
                    ? 'Перечислите номера в том порядке, в каком листы должны идти. Не указанные страницы в документ не попадут.'
                    : 'Через запятую, диапазон — через дефис.'}
                  {pages !== null && ` Всего в документе ${pages} ${plural(pages)}.`}
                </p>
              </div>
            )}

            {tool.id === 'blank' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="label-caps">Перед какой страницей</div>
                  <input
                    type="number"
                    min={1}
                    value={set.at}
                    disabled={busy}
                    onChange={(e) => setSet({ ...set, at: Math.max(1, Number(e.target.value) || 1) })}
                    className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <div className="label-caps">Сколько листов</div>
                  <input
                    type="number"
                    min={1}
                    value={set.count}
                    disabled={busy}
                    onChange={(e) =>
                      setSet({ ...set, count: Math.max(1, Number(e.target.value) || 1) })
                    }
                    className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
                  />
                </div>
              </div>
            )}

            {tool.id === 'enhance' && (
              <label className="flex items-center gap-3 text-[0.88rem]">
                <input
                  type="checkbox"
                  checked={set.gray}
                  disabled={busy}
                  onChange={(e) => setSet({ ...set, gray: e.target.checked })}
                />
                Убрать цвет — документ станет чёрно-белым и легче
              </label>
            )}

            {['from-jpg', 'from-heic', 'from-tiff'].includes(tool.id) && (
              <div>
                <div className="label-caps">Размер страницы</div>
                <select
                  value={set.paper}
                  disabled={busy}
                  onChange={(e) => setSet({ ...set, paper: e.target.value as 'a4' | 'fit' })}
                  className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
                >
                  <option value="fit">По размеру изображения</option>
                  <option value="a4">Лист A4 с полями — для печати</option>
                </select>
              </div>
            )}
          </div>
        )}

        {busy && (
          <div className="mt-5 border border-primary bg-primary/5 px-4 py-3">
            <div className="flex items-center gap-3 text-[0.88rem]">
              <Icon name="LoaderCircle" size={16} className="animate-spin text-primary" />
              Работаю над документом{progress > 0 ? ` — ${progress}%` : ''}
            </div>
            <div className="mt-2.5 h-1 w-full bg-border">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="mt-5 border border-destructive bg-destructive/5 px-4 py-3 text-[0.85rem]">
            {error}
          </div>
        )}

        {done && !busy && (
          <div className="mt-5 flex items-start gap-3 border border-emerald-600 bg-emerald-600/5 px-4 py-3 text-[0.85rem]">
            <Icon name="CircleCheck" size={16} className="mt-0.5 shrink-0 text-emerald-600" />
            <span>
              Готово. {done}
              {!isDesktop() && '. Файл сохранён в загрузки'}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border px-6 py-4">
        <button
          onClick={() => void start()}
          disabled={busy || !files.length}
          className="btn-block justify-center disabled:opacity-40"
        >
          <Icon name={locked ? 'Lock' : 'Play'} size={15} />
          {busy ? 'Обрабатываю' : locked ? 'Нужна полная версия' : 'Выполнить'}
        </button>
        {files.length > 0 && !busy && (
          <button
            onClick={() => {
              setFiles([]);
              setDone('');
              setError('');
            }}
            className="text-[0.82rem] text-muted-foreground hover:text-foreground"
          >
            Очистить
          </button>
        )}
        <span className="ml-auto text-[0.76rem] text-muted-foreground">
          Файлы не покидают компьютер
        </span>
      </div>
    </div>
  );
};

export default ToolRunner;