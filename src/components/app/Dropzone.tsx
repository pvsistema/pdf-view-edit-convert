import { useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useDoc } from '@/context/DocContext';
import { toast } from '@/hooks/use-toast';

const Dropzone = () => {
  const { open, loading } = useDoc();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast({ title: 'Нужен файл PDF', description: 'Выберите документ с расширением .pdf' });
      return;
    }
    await open(file);
    toast({ title: 'Документ открыт', description: file.name });
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-[900px]">
        <div className="label-caps">Рабочее место</div>
        <h1 className="mt-3 font-head text-[2rem] font-black uppercase leading-[1.06] tracking-[-0.03em] md:text-[3.2rem]">
          Откройте документ PDF
        </h1>
        <p className="mt-4 max-w-[34em] text-muted-foreground">
          Просмотр, правка страниц, конвертация в Word, Excel и JPG, распознавание сканов.
          Файлы обрабатываются на вашем компьютере и никуда не отправляются.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            handle(e.dataTransfer.files?.[0]);
          }}
          className={`mt-10 flex flex-col items-center justify-center border-2 border-dashed px-6 py-20 text-center transition-colors ${
            over ? 'border-primary bg-card' : 'border-border bg-card/60'
          }`}
        >
          <Icon name={loading ? 'LoaderCircle' : 'FileUp'} size={40} className={loading ? 'animate-spin text-primary' : 'text-primary'} />
          <p className="mt-6 font-head text-[1.1rem] font-bold uppercase tracking-[-0.01em]">
            {loading ? 'Открываю документ' : 'Перетащите файл сюда'}
          </p>
          <p className="mt-2 text-[0.92rem] text-muted-foreground">или выберите на компьютере</p>
          <button className="btn-block mt-8" onClick={() => input.current?.click()} disabled={loading}>
            <Icon name="FolderOpen" size={18} />
            Выбрать файл
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => handle(e.target.files?.[0] ?? undefined)}
          />
        </div>

        <div className="mt-10 grid grid-cols-1 border-l border-t border-border sm:grid-cols-3">
          {[
            { icon: 'BookOpen', t: 'Просмотр', d: 'Страницы, масштаб, поиск по тексту' },
            { icon: 'Repeat', t: 'Конвертация', d: 'В Word, Excel, JPG и текст' },
            { icon: 'ScanText', t: 'Распознавание', d: 'Скан превращается в текст' },
          ].map((c) => (
            <div key={c.t} className="border-b border-r border-border bg-background p-6">
              <Icon name={c.icon} size={22} className="text-primary" />
              <div className="mt-4 font-head text-[1rem] font-bold uppercase">{c.t}</div>
              <p className="mt-1 text-[0.88rem] text-muted-foreground">{c.d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dropzone;
