import { useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useDoc } from '@/context/DocContext';
import { toast } from '@/hooks/use-toast';
import { isDesktop, openByPath } from '@/lib/desktop';
import { readRecent, clearRecent, whenLabel, sizeLabel, type RecentDoc } from '@/lib/recent';

type Props = {
  // Открыть файл в работу
  onFile: (file: File) => void;
  // Запустить сканирование или конвертацию — их окна живут выше
  onScan: (batch: boolean) => void;
  onConvert: (kind: string) => void;
};

// Стартовое окно — всё на одном экране, без закладок.
//
// Раньше виды работ прятались за тремя закладками слева: чтобы увидеть
// сканер или последние файлы, нужно было догадаться переключиться.
// Теперь человек сразу видит три вещи: куда бросить файл, что можно
// сделать и с чем он работал недавно. Надписи обычными буквами, а не
// заглавными — так их быстрее читать
const StartScreen = ({ onFile, onScan, onConvert }: Props) => {
  const { loading } = useDoc();
  const input = useRef<HTMLInputElement>(null);
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

  // Повторное открытие из списка последних. Раньше здесь бралась
  // временная ссылка на копию файла, а копии удаляются при следующем
  // запуске программы — поэтому документ «не открывался». Теперь
  // программа открывает сам файл по его месту на диске
  const reopen = (d: RecentDoc) => {
    if (d.path && isDesktop()) {
      openByPath(d.path);
      return;
    }
    toast({
      title: 'Укажите файл заново',
      description: `Выберите «${d.name}» на компьютере — дальше он будет открываться из списка сразу`,
    });
    input.current?.click();
  };

  // Распознавание работает внутри открытого документа — сначала
  // открываем файл и подсказываем, где кнопка
  const recognize = () => {
    toast({
      title: 'Выберите скан',
      description: 'После открытия нажмите «Распознать» в панели инструментов справа',
    });
    input.current?.click();
  };

  // Плитка задачи: значок, короткое название и пояснение в одну строку
  const tile = (icon: string, title: string, note: string, fn: () => void, tint: string) => (
    <button
      key={title}
      onClick={fn}
      disabled={loading}
      className="group flex items-center gap-3 border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary hover:bg-background disabled:opacity-50"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center ${tint}`}>
        <Icon name={icon} size={20} />
      </span>
      <span className="min-w-0">
        <span className="block font-head text-[0.95rem] font-bold leading-tight">{title}</span>
        <span className="mt-0.5 block text-[0.8rem] leading-snug text-muted-foreground">{note}</span>
      </span>
    </button>
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto grid max-w-[1180px] gap-6 px-4 py-5 md:px-8 md:py-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {/* Главное действие — открыть документ. Большое поле: файл можно
              бросить мышью или выбрать кнопкой */}
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
            className={`flex flex-col items-center justify-center border-2 border-dashed px-4 py-8 text-center transition-colors md:py-10 ${
              over ? 'border-primary bg-card' : 'border-border bg-card/60'
            }`}
          >
            <Icon
              name={loading ? 'LoaderCircle' : 'FileUp'}
              size={34}
              className={loading ? 'animate-spin text-primary' : 'text-primary'}
            />
            <p className="mt-3 font-head text-[1.15rem] font-bold">
              {loading ? 'Открываю документ…' : 'Откройте документ PDF'}
            </p>
            {!loading && (
              <p className="mt-1 text-[0.88rem] text-muted-foreground">
                Перетащите файл в это окно или нажмите кнопку
              </p>
            )}
            <button
              className="btn-block mt-5 !px-8 !py-4 normal-case !tracking-normal !text-[0.95rem]"
              onClick={() => input.current?.click()}
              disabled={loading}
            >
              <Icon name="FolderOpen" size={18} />
              Выбрать файл
            </button>
          </div>

          <h2 className="mt-8 font-head text-[1.05rem] font-bold">Что нужно сделать?</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {tile('Scan', 'Сканировать', 'Лист со сканера сразу в PDF', () => onScan(false), 'bg-primary text-primary-foreground')}
            {tile('Layers', 'Сканировать несколько листов', 'Стопка бумаг в один документ', () => onScan(true), 'bg-secondary text-primary')}
            {tile('FileText', 'PDF в Word', 'Редактируемый документ', () => onConvert('to-word'), 'bg-secondary text-blue-700')}
            {tile('Sheet', 'PDF в Excel', 'Таблицы из документа', () => onConvert('to-excel'), 'bg-secondary text-emerald-700')}
            {tile('ScanText', 'Распознать текст', 'Из скана — текст, который можно править', recognize, 'bg-secondary text-primary')}
            {tile('Image', 'PDF в картинки', 'Каждая страница — файл JPG', () => onConvert('to-jpg'), 'bg-secondary text-amber-700')}
            {tile('Combine', 'Объединить файлы', 'Несколько PDF в один', () => onConvert('merge'), 'bg-secondary text-primary')}
            {tile('Minimize2', 'Сжать PDF', 'Чтобы файл проходил по почте', () => onConvert('compress'), 'bg-secondary text-primary')}
          </div>
          <button
            onClick={() => onConvert('')}
            className="mt-3 inline-flex items-center gap-1.5 text-[0.88rem] font-medium text-primary underline-offset-4 hover:underline"
          >
            Все инструменты
            <Icon name="ArrowRight" size={14} />
          </button>
        </div>

        {/* Последние документы — сразу на виду, одним щелчком */}
        <aside className="min-w-0 lg:border-l lg:border-border lg:pl-6">
          <div className="flex items-center gap-3">
            <h2 className="font-head text-[1.05rem] font-bold">Недавние документы</h2>
            {recent.length > 0 && (
              <button
                onClick={() => {
                  clearRecent();
                  setRecent([]);
                }}
                className="ml-auto text-[0.8rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Очистить
              </button>
            )}
          </div>

          {recent.length === 0 ? (
            <div className="mt-3 border border-dashed border-border px-5 py-8 text-center">
              <Icon name="Clock" size={22} className="text-muted-foreground" />
              <p className="mt-2 text-[0.86rem] text-muted-foreground">
                Здесь появятся документы, с которыми вы работали
              </p>
            </div>
          ) : (
            <div className="mt-3 grid gap-1">
              {recent.slice(0, 10).map((d) => (
                <button
                  key={`${d.name}-${d.at}`}
                  onClick={() => reopen(d)}
                  className="flex items-center gap-3 px-2 py-2.5 text-left transition-colors hover:bg-card"
                >
                  <Icon name="FileText" size={18} className="shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate text-[0.9rem] font-medium">{d.name}</span>
                    <span className="text-[0.78rem] text-muted-foreground">
                      {whenLabel(d.at)}
                      {sizeLabel(d.size) ? ` · ${sizeLabel(d.size)}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <p className="mt-6 flex items-start gap-2 text-[0.8rem] leading-snug text-muted-foreground">
            <Icon name="ShieldCheck" size={15} className="mt-0.5 shrink-0" />
            Документы обрабатываются на вашем компьютере и никуда не отправляются
          </p>
        </aside>
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
