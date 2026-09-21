import { useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useDoc } from '@/context/DocContext';
import { useTabs } from '@/context/TabsContext';
import { toast } from '@/hooks/use-toast';
import { readRecent, clearRecent, whenLabel, sizeLabel, type RecentDoc } from '@/lib/recent';

type Tab = 'open' | 'scan' | 'recent';

type Props = {
  // Открыть файл в работу
  onFile: (file: File) => void;
  // Запустить сканирование или конвертацию — их окна живут выше
  onScan: (batch: boolean) => void;
  onConvert: (kind: string) => void;
};

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'open', icon: 'FolderOpen', label: 'Открыть' },
  { id: 'scan', icon: 'Scan', label: 'Сканировать' },
  { id: 'recent', icon: 'Clock', label: 'Последние' },
];

// Стартовое окно: слева закладки с видами работ, справа сами задачи.
// Человек сразу видит, что программа умеет, и начинает с нужного
const StartScreen = ({ onFile, onScan, onConvert }: Props) => {
  const { loading } = useDoc();
  const tabsApi = useTabs();
  const input = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>('open');
  const [over, setOver] = useState(false);
  const [recent, setRecent] = useState<RecentDoc[]>(() => readRecent());

  const take = (file?: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast({ title: 'Нужен файл PDF', description: 'Выберите документ с расширением .pdf' });
      return;
    }
    onFile(file);
  };

  // Повторное открытие из списка последних: файл берём по сохранённой
  // ссылке, а если её нет — просим указать документ заново
  const reopen = (d: RecentDoc) => {
    if (d.url && tabsApi) {
      tabsApi.openTab({ name: d.name, url: d.url, size: d.size });
      return;
    }
    toast({
      title: 'Укажите файл заново',
      description: `Программа не хранит сам документ — выберите «${d.name}» на компьютере`,
    });
    input.current?.click();
  };

  const task = (icon: string, title: string, note: string, fn: () => void, accent?: boolean) => (
    <button
      key={title}
      onClick={fn}
      disabled={loading}
      className="flex w-full items-center gap-3 border border-border bg-card px-3 py-3 text-left transition-colors hover:border-primary hover:bg-background disabled:opacity-50 md:gap-4 md:px-5 md:py-4"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center md:h-11 md:w-11 ${
          accent ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary'
        }`}
      >
        <Icon name={icon} size={20} />
      </span>
      <span className="min-w-0">
        <span className="block font-head text-[0.85rem] font-bold uppercase leading-tight tracking-[-0.01em] md:text-[0.98rem]">
          {title}
        </span>
        <span className="mt-0.5 block text-[0.78rem] text-muted-foreground md:text-[0.86rem]">{note}</span>
      </span>
      <Icon name="ChevronRight" size={16} className="ml-auto shrink-0 text-muted-foreground" />
    </button>
  );

  return (
    // На телефоне колонка с видами работ съедала половину экрана,
    // поэтому там она превращается в полосу закладок сверху
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:flex-row">
      {/* Закладки видов работ — как в привычных деловых программах */}
      <div className="flex shrink-0 overflow-x-auto border-b border-border bg-panel text-panel-foreground md:w-[210px] md:flex-col md:overflow-visible md:border-b-0 md:border-r md:py-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              if (t.id === 'recent') setRecent(readRecent());
            }}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-4 py-3 text-left transition-colors md:gap-3 md:border-b-0 md:border-l-[3px] md:px-5 ${
              tab === t.id
                ? 'border-primary bg-panel-foreground/10 font-bold'
                : 'border-transparent hover:bg-panel-foreground/5'
            }`}
          >
            <Icon name={t.icon} size={17} />
            <span className="font-head text-[0.8rem] uppercase tracking-[0.02em] md:text-[0.86rem]">
              {t.label}
            </span>
          </button>
        ))}

        <div className="mt-auto hidden px-5 pb-1 pt-4 text-[0.72rem] uppercase tracking-[0.14em] text-panel-foreground/50 md:block">
          Файлы обрабатываются
          <br />
          на вашем компьютере
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-auto px-4 py-5 md:px-8 md:py-7">
        {tab === 'open' && (
          <>
            <h1 className="font-head text-[1.15rem] font-black uppercase tracking-[-0.02em] md:text-[1.6rem]">
              Просмотр и правка PDF
            </h1>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                take(e.dataTransfer.files?.[0]);
              }}
              className={`mt-4 flex flex-col items-center justify-center border-2 border-dashed px-4 py-7 text-center md:px-6 md:py-10 transition-colors ${
                over ? 'border-primary bg-card' : 'border-border bg-card/60'
              }`}
            >
              <Icon
                name={loading ? 'LoaderCircle' : 'FileUp'}
                size={32}
                className={loading ? 'animate-spin text-primary' : 'text-primary'}
              />
              <p className="mt-4 font-head text-[1rem] font-bold uppercase">
                {loading ? 'Открываю документ' : 'Перетащите файл сюда'}
              </p>
              <button
                className="btn-block mt-5"
                onClick={() => input.current?.click()}
                disabled={loading}
              >
                <Icon name="FolderOpen" size={17} />
                Открыть документ PDF
              </button>
            </div>

            <h2 className="mt-8 font-head text-[1rem] font-black uppercase tracking-[-0.02em] md:text-[1.2rem]">
              Конвертация документов
            </h2>
            <div className="mt-4 grid gap-2">
              {task('FileType', 'Конвертировать в Word', 'Редактируемый документ', () =>
                onConvert('word'),
              )}
              {task('Sheet', 'Конвертировать в Excel', 'Таблица из документа', () =>
                onConvert('excel'),
              )}
              {task('Image', 'Конвертировать в JPG', 'Каждая страница картинкой', () =>
                onConvert('jpg'),
              )}
              {task('ScanText', 'Распознать текст', 'Скан превращается в текст', () =>
                onConvert('ocr'),
              )}
            </div>
          </>
        )}

        {tab === 'scan' && (
          <>
            <h1 className="font-head text-[1.15rem] font-black uppercase tracking-[-0.02em] md:text-[1.6rem]">
              Сканирование
            </h1>
            <p className="mt-3 max-w-[40em] text-muted-foreground">
              Получите изображение со сканера и работайте с ним как с обычным документом.
            </p>
            <div className="mt-6 grid gap-2">
              {task('Scan', 'Сканировать страницу', 'Один лист со сканера', () => onScan(false), true)}
              {task('Layers', 'Пакетное сканирование', 'Несколько листов подряд', () =>
                onScan(true),
              )}
            </div>
          </>
        )}

        {tab === 'recent' && (
          <>
            <div className="flex items-center gap-3">
              <h1 className="font-head text-[1.15rem] font-black uppercase tracking-[-0.02em] md:text-[1.6rem]">
                Последние документы
              </h1>
              {recent.length > 0 && (
                <button
                  onClick={() => {
                    clearRecent();
                    setRecent([]);
                  }}
                  className="ml-auto text-[0.84rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Очистить список
                </button>
              )}
            </div>

            {recent.length === 0 ? (
              <div className="mt-6 border border-dashed border-border bg-card/60 px-6 py-14 text-center">
                <Icon name="Clock" size={26} className="text-muted-foreground" />
                <p className="mt-3 text-muted-foreground">
                  Здесь появятся документы, с которыми вы работали
                </p>
              </div>
            ) : (
              <div className="mt-5 grid gap-2">
                {recent.map((d) => (
                  <button
                    key={`${d.name}-${d.at}`}
                    onClick={() => reopen(d)}
                    className="flex items-center gap-4 border border-border bg-card px-5 py-3 text-left transition-colors hover:border-primary hover:bg-background"
                  >
                    <Icon name="FileText" size={20} className="shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{d.name}</span>
                      <span className="text-[0.82rem] text-muted-foreground">
                        {whenLabel(d.at)}
                        {sizeLabel(d.size) ? ` · ${sizeLabel(d.size)}` : ''}
                      </span>
                    </span>
                    <Icon
                      name="ChevronRight"
                      size={16}
                      className="ml-auto shrink-0 text-muted-foreground"
                    />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
};

export default StartScreen;