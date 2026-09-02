import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { getVersionSettings, setMinVersion, type Release } from '@/lib/adminApi';
import { toast } from '@/hooks/use-toast';

type Props = { items: Release[] };

// Минимальная допустимая версия. Программы старее неё перестают работать,
// пока человек не обновится. Пусто — блокировки нет
const MinVersionCard = ({ items }: Props) => {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  const [latest, setLatest] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getVersionSettings()
      .then((r) => {
        setValue(r.min_version);
        setSaved(r.min_version);
        setLatest(r.latest_version);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load, items.length]);

  const apply = async (next: string) => {
    setBusy(true);
    try {
      await setMinVersion(next);
      setSaved(next);
      setValue(next);
      setConfirm(false);
      toast({
        title: next ? 'Обязательное обновление включено' : 'Блокировка выключена',
        description: next
          ? `Программы старее ${next} перестанут работать`
          : 'Все версии снова работают',
      });
    } catch (e: unknown) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : '',
      });
    } finally {
      setBusy(false);
    }
  };

  // Опубликованные версии — из них и выбираем. Требовать неопубликованную
  // нельзя: людям будет некуда обновиться
  const published = items.filter((r) => r.is_published).map((r) => r.version);
  const on = !!saved;
  const changed = value !== saved;

  return (
    <div className={`border p-5 ${on ? 'border-destructive' : 'border-border'}`}>
      <div className="flex items-center gap-2">
        <Icon
          name={on ? 'ShieldCheck' : 'ShieldOff'}
          size={16}
          className={on ? 'text-destructive' : 'text-muted-foreground'}
        />
        <span className="label-caps">Обязательная версия</span>

        {!loading && (
          <span
            className={`ml-auto px-2 py-1 font-head text-[0.66rem] font-bold uppercase tracking-[0.08em] ${
              on ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {on ? `Включена: с ${saved}` : 'Выключена'}
          </span>
        )}
      </div>

      <p className="mt-3 text-[0.83rem] leading-relaxed text-muted-foreground">
        {on ? (
          <>
            Программы версии старее <b className="text-foreground">{saved}</b> не работают: человек
            видит окно с кнопкой «Обновить» и не может пользоваться, пока не обновится. Включайте
            только при важной причине — люди не любят, когда работа встаёт
          </>
        ) : (
          <>
            Здесь можно потребовать обновления: все программы старее выбранной версии перестанут
            работать, пока человек не обновится. Нужно, если в старой версии нашлась серьёзная
            ошибка или дыра в защите
          </>
        )}
      </p>

      {loading ? (
        <Icon name="LoaderCircle" size={18} className="mt-4 animate-spin text-primary" />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="label-caps">Требовать версию не ниже</label>
              <select
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setConfirm(false);
                }}
                className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
              >
                <option value="">Не требовать — работают все версии</option>
                {published.map((v) => (
                  <option key={v} value={v}>
                    {v}
                    {v === latest ? ' — последняя' : ''}
                  </option>
                ))}
              </select>
            </div>

            {changed && !confirm && (
              <button
                onClick={() => (value ? setConfirm(true) : void apply(''))}
                disabled={busy}
                className="btn-block disabled:opacity-50"
              >
                <Icon name="Check" size={15} />
                {value ? 'Применить' : 'Выключить'}
              </button>
            )}
          </div>

          {/* Шаг подтверждения: решение останавливает работу у живых людей,
              поэтому одного щелчка для него мало */}
          {confirm && value && (
            <div className="mt-4 border border-destructive p-4">
              <div className="flex items-center gap-2 text-destructive">
                <Icon name="TriangleAlert" size={15} />
                <span className="font-head text-[0.72rem] font-bold uppercase tracking-[0.08em]">
                  Подтвердите решение
                </span>
              </div>
              <p className="mt-2 text-[0.83rem] leading-relaxed">
                У всех, кто работает на версии старее <b>{value}</b>, программа остановится при
                следующем запуске. Продолжить смогут только после обновления.
                {value !== latest && latest && (
                  <>
                    {' '}
                    Последняя опубликованная версия — <b>{latest}</b>.
                  </>
                )}
              </p>
              <p className="mt-2 text-[0.8rem] text-muted-foreground">
                Убедитесь, что установщик версии {value} выложен и ссылка работает — иначе людям
                будет некуда обновиться
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void apply(value)}
                  disabled={busy}
                  className="btn-block bg-destructive text-destructive-foreground disabled:opacity-50"
                >
                  <Icon
                    name={busy ? 'LoaderCircle' : 'ShieldCheck'}
                    size={15}
                    className={busy ? 'animate-spin' : ''}
                  />
                  Да, требовать {value}
                </button>
                <button
                  onClick={() => {
                    setConfirm(false);
                    setValue(saved);
                  }}
                  className="border border-border px-3 py-2 font-head text-[0.68rem] font-bold uppercase tracking-[0.08em] transition-colors hover:border-foreground"
                >
                  Отмена
                </button>
              </div>
            </div>
          )}

          {!published.length && (
            <p className="mt-3 text-[0.8rem] text-muted-foreground">
              Пока нет опубликованных версий — сначала выложите хотя бы одну
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default MinVersionCard;
