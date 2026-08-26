import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { getBuildInfo } from '@/lib/adminApi';
import { toast } from '@/hooks/use-toast';

// Ключи, нужные при сборке программы. Собраны в одном месте,
// чтобы перед выпуском версии не искать их вручную
const BuildPanel = () => {
  const [info, setInfo] = useState<{ module_key: string; public_key: string } | null>(null);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(false);

  useEffect(() => {
    getBuildInfo()
      .then((r) => setInfo(r))
      .catch(() => setError('Не удалось получить ключи'));
  }, []);

  const copy = (text: string, what: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast({ title: `${what} скопирован` }))
      .catch(() => toast({ title: 'Не удалось скопировать' }));
  };

  const hide = (s: string) => (shown ? s : '•'.repeat(Math.min(s.length, 48)));

  const command = info ? `set PVSPDF_MODULE_KEY=${info.module_key}` : '';

  return (
    <div className="mt-6">
      <div className="border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <Icon name="ShieldCheck" size={18} className="mt-0.5 shrink-0 text-primary" />
          <div>
            <div className="font-head text-[0.92rem] font-bold">Ключи для сборки программы</div>
            <p className="mt-1.5 text-[0.84rem] leading-relaxed text-muted-foreground">
              Ключ модуля закрывает распознавание текста: без него платная функция не
              запустится даже во взломанной программе. Задайте его перед сборкой — иначе
              модуль останется незащищённым.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 border border-destructive bg-destructive/5 px-4 py-3 text-[0.86rem]">
          {error}
        </div>
      )}

      {!info && !error && (
        <div className="mt-6 py-10 text-center">
          <Icon name="LoaderCircle" size={20} className="mx-auto animate-spin text-primary" />
        </div>
      )}

      {info && (
        <>
          <div className="mt-6 border border-foreground p-5">
            <div className="font-head text-[0.88rem] font-bold">Как защитить модуль</div>
            <p className="mt-2 text-[0.84rem] leading-relaxed text-muted-foreground">
              Скачайте файл ключа и положите его в папку проекта, в{' '}
              <code className="font-mono text-[0.8rem]">desktop\module.key</code>. Сборка
              подхватит его сама — вводить ничего не нужно ни сейчас, ни потом.
            </p>
            <button
              onClick={() => {
                const blob = new Blob([info.module_key], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'module.key';
                a.click();
                URL.revokeObjectURL(url);
                toast({
                  title: 'Файл сохранён',
                  description: 'Положите module.key в папку desktop проекта',
                });
              }}
              className="btn-block mt-4"
            >
              <Icon name="Download" size={15} />
              Скачать файл ключа
            </button>
          </div>

          <div className="mt-7 flex items-center justify-between">
            <span className="label-caps">Или задать вручную</span>
            <button
              onClick={() => setShown((v) => !v)}
              className="flex items-center gap-1.5 text-[0.78rem] text-muted-foreground hover:text-primary"
            >
              <Icon name={shown ? 'EyeOff' : 'Eye'} size={14} />
              {shown ? 'Скрыть' : 'Показать'}
            </button>
          </div>

          <div className="mt-2 flex items-stretch border border-foreground">
            <code className="flex-1 overflow-x-auto whitespace-nowrap bg-background px-4 py-3.5 font-mono text-[0.82rem]">
              {shown ? command : `set PVSPDF_MODULE_KEY=${hide(info.module_key)}`}
            </code>
            <button
              onClick={() => copy(command, 'Команда')}
              title="Скопировать"
              className="border-l border-foreground px-4 transition-colors hover:bg-foreground hover:text-background"
            >
              <Icon name="Copy" size={15} />
            </button>
          </div>

          <p className="mt-2.5 text-[0.78rem] leading-relaxed text-muted-foreground">
            Выполните её в том же окне командной строки <b>до</b> запуска{' '}
            <code className="font-mono">build.bat installer</code>. Дождитесь приглашения
            командной строки: если вставить команду, пока сборка ещё идёт, первые символы
            потеряются и ключ не применится.
          </p>

          <div className="mt-7">
            <span className="label-caps">Ключ проверки подписи</span>
            <div className="mt-2 flex items-stretch border border-border">
              <code className="flex-1 overflow-x-auto whitespace-nowrap bg-background px-4 py-3 font-mono text-[0.76rem] text-muted-foreground">
                {hide(info.public_key)}
              </code>
              <button
                onClick={() => copy(info.public_key, 'Ключ')}
                title="Скопировать"
                className="border-l border-border px-4 transition-colors hover:bg-card"
              >
                <Icon name="Copy" size={15} />
              </button>
            </div>
            <p className="mt-2.5 text-[0.78rem] leading-relaxed text-muted-foreground">
              Уже вшит в программу — трогать не нужно. Пригодится, только если ключи придётся
              менять: тогда все выпущенные версии перестанут принимать лицензии.
            </p>
          </div>

          <div className="mt-7 border border-border bg-card px-4 py-3.5">
            <div className="flex items-start gap-2.5">
              <Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0 text-primary" />
              <p className="text-[0.8rem] leading-relaxed text-muted-foreground">
                Ключи никому не передавайте. Ключ модуля не меняется намеренно: при замене
                распознавание перестанет работать во всех уже установленных программах, пока
                пользователи не обновятся.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default BuildPanel;