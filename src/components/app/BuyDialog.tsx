import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { LOGO_URL } from '@/lib/brand';
import { createOrder, listTariffs, orderStatus, type Tariff } from '@/lib/adminApi';
import { machineId } from '@/lib/desktop';
import { useLicense } from '@/context/LicenseContext';
import { toast } from '@/hooks/use-toast';

type Props = { onClose: () => void; renewKey?: string };

const money = (v: number) => `${v.toLocaleString('ru-RU')} ₽`;

const term = (months: number) => {
  if (months % 12 === 0) {
    const y = months / 12;
    return y === 1 ? 'на 1 год' : `на ${y} года`;
  }
  return `на ${months} мес.`;
};

// Пока клиент платит в браузере, программа спрашивает о заказе.
// Сначала часто, потом реже — чтобы не тревожить сервер без нужды
const STEP_MS = 3000;
const GIVE_UP_MS = 30 * 60 * 1000;

const BuyDialog = ({ onClose, renewKey = '' }: Props) => {
  const { activate, license } = useLicense();
  const [items, setItems] = useState<Tariff[]>([]);
  const [ready, setReady] = useState(true);
  const [pick, setPick] = useState('');
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState(license?.org ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [payUrl, setPayUrl] = useState('');
  const [gotKey, setGotKey] = useState('');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    listTariffs()
      .then((r) => {
        setItems(r.items);
        setReady(r.ready);
        if (r.items.length) setPick(r.items[0].code);
      })
      .catch(() => setError('Не удалось загрузить тарифы'));
  }, []);

  // Останавливаем опрос, когда окно закрывают
  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
    },
    [],
  );

  const watch = (token: string) => {
    const started = Date.now();
    setWaiting(true);

    timer.current = window.setInterval(async () => {
      if (Date.now() - started > GIVE_UP_MS) {
        window.clearInterval(timer.current!);
        setWaiting(false);
        return;
      }
      try {
        const r = await orderStatus(token);
        if (!r.paid || !r.license_key) return;

        window.clearInterval(timer.current!);
        setWaiting(false);
        setGotKey(r.license_key);

        // Ключ включаем сразу: человеку не нужно ничего вводить
        const res = await activate(r.license_key);
        if (res.ok) {
          toast({ title: 'Оплата прошла', description: 'Полная версия включена' });
        }
      } catch {
        // Связь могла пропасть — попробуем на следующем шаге
      }
    }, STEP_MS);
  };

  const buy = async () => {
    if (!pick) return;
    setBusy(true);
    setError('');
    try {
      const r = await createOrder({
        tariff: pick,
        email: email.trim(),
        org_name: org.trim(),
        machine_id: machineId(),
        renew_key: renewKey,
      });
      if (r.error || !r.pay_url || !r.token) {
        setError(r.error || 'Не удалось оформить заказ');
        return;
      }
      setPayUrl(r.pay_url);
      // Оплата открывается в браузере: там уже есть карты, СБП и автозаполнение
      window.open(r.pay_url, '_blank');
      watch(r.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось оформить заказ');
    } finally {
      setBusy(false);
    }
  };

  const chosen = items.find((t) => t.code === pick);

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-foreground/50 p-4">
      <div className="max-h-[92vh] w-full max-w-[560px] overflow-y-auto border border-foreground bg-background">
        <div className="flex items-center gap-2.5 border-b border-foreground bg-foreground px-5 py-3 text-background">
          <img src={LOGO_URL} alt="" className="h-6 w-auto" />
          <span className="font-head text-[0.74rem] font-bold uppercase tracking-[0.12em]">
            {renewKey ? 'Продление лицензии' : 'Покупка лицензии'}
          </span>
          <button onClick={onClose} className="ml-auto hover:opacity-70" title="Закрыть">
            <Icon name="X" size={16} />
          </button>
        </div>

        {gotKey ? (
          <div className="p-6">
            <div className="flex items-center gap-3 border border-primary bg-primary/5 p-4">
              <Icon name="ShieldCheck" size={26} className="shrink-0 text-primary" />
              <div>
                <div className="font-head text-[1rem] font-bold uppercase">Оплата прошла</div>
                <div className="mt-0.5 text-[0.86rem] text-muted-foreground">
                  Полная версия включена на этом компьютере
                </div>
              </div>
            </div>

            <div className="mt-5">
              <div className="label-caps">Ваш ключ активации</div>
              <div className="mt-2 flex items-stretch border border-border">
                <code className="flex-1 bg-card px-4 py-3 text-center font-head text-[0.95rem] font-bold tracking-[0.08em]">
                  {gotKey}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(gotKey);
                    toast({ title: 'Ключ скопирован' });
                  }}
                  title="Скопировать"
                  className="border-l border-border px-4 transition-colors hover:bg-card"
                >
                  <Icon name="Copy" size={15} />
                </button>
              </div>
              <p className="mt-2.5 text-[0.8rem] leading-relaxed text-muted-foreground">
                Сохраните ключ: он понадобится при переустановке программы или
                установке на другой компьютер.
              </p>
            </div>

            <button className="btn-block mt-6 w-full justify-center" onClick={onClose}>
              <Icon name="Check" size={16} />
              Готово
            </button>
          </div>
        ) : (
          <div className="p-6">
            {!ready && (
              <div className="mb-5 flex items-start gap-2.5 border border-destructive bg-destructive/5 px-4 py-3 text-[0.85rem]">
                <Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0 text-destructive" />
                Приём оплаты пока не настроен. Свяжитесь с нами — выдадим ключ вручную.
              </div>
            )}

            <div className="label-caps">Выберите тариф</div>
            <div className="mt-3 space-y-2.5">
              {items.map((t) => (
                <label
                  key={t.code}
                  className={`flex cursor-pointer items-start gap-3 border px-4 py-3 transition-colors ${
                    pick === t.code ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground'
                  }`}
                >
                  <input
                    type="radio"
                    checked={pick === t.code}
                    onChange={() => setPick(t.code)}
                    disabled={waiting}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-head text-[0.92rem] font-bold">{t.title}</span>
                      <span className="text-[0.78rem] text-muted-foreground">
                        {term(t.months)}
                        {t.seats > 1 ? `, мест: ${t.seats}` : ''}
                      </span>
                    </span>
                    {t.note && (
                      <span className="mt-0.5 block text-[0.8rem] text-muted-foreground">{t.note}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-head text-[1.05rem] font-black">
                    {money(t.price)}
                  </span>
                </label>
              ))}
              {!items.length && !error && (
                <div className="py-8 text-center">
                  <Icon name="LoaderCircle" size={20} className="mx-auto animate-spin text-primary" />
                </div>
              )}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label-caps">Почта для чека</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={waiting}
                  placeholder="name@mail.ru"
                  className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="label-caps">Организация</label>
                <input
                  value={org}
                  onChange={(e) => setOrg(e.target.value)}
                  disabled={waiting}
                  placeholder="если нужна в документах"
                  className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
                />
              </div>
            </div>

            {error && (
              <div className="mt-4 flex items-center gap-2 border border-destructive bg-destructive/10 px-3 py-2.5 text-[0.85rem] text-destructive">
                <Icon name="TriangleAlert" size={15} />
                {error}
              </div>
            )}

            {waiting ? (
              <div className="mt-5 border border-primary bg-primary/5 px-4 py-4">
                <div className="flex items-center gap-3">
                  <Icon name="LoaderCircle" size={18} className="animate-spin text-primary" />
                  <div>
                    <div className="font-head text-[0.9rem] font-bold">Ждём оплату</div>
                    <div className="mt-0.5 text-[0.82rem] text-muted-foreground">
                      Оплатите в открывшемся окне браузера. Ключ подключится сам —
                      это окно можно не закрывать.
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => window.open(payUrl, '_blank')}
                  className="mt-3 flex items-center gap-1.5 text-[0.82rem] text-primary hover:underline"
                >
                  <Icon name="ExternalLink" size={13} />
                  Открыть оплату заново
                </button>
              </div>
            ) : (
              <button
                onClick={buy}
                disabled={busy || !pick || !ready}
                className="btn-block mt-5 w-full justify-center disabled:opacity-50"
              >
                <Icon
                  name={busy ? 'LoaderCircle' : 'ExternalLink'}
                  size={16}
                  className={busy ? 'animate-spin' : ''}
                />
                {chosen ? `Оплатить ${money(chosen.price)}` : 'Оплатить'}
              </button>
            )}

            <p className="mt-3 text-[0.78rem] leading-relaxed text-muted-foreground">
              Оплата картой или через СБП на защищённой странице банка. Данные карты
              программа не видит и не хранит. После оплаты ключ включится сам.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default BuyDialog;