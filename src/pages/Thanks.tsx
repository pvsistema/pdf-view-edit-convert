import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { APP_NAME, LOGO_URL } from '@/lib/brand';
import { orderStatus } from '@/lib/adminApi';
import { toast } from '@/hooks/use-toast';

// Банк присылает клиента сюда сразу после оплаты, но подтверждение платежа
// приходит отдельным путём и может немного отстать. Поэтому страница
// сама переспрашивает о заказе, а не пугает человека пустотой
const STEP_MS = 2500;
const GIVE_UP_MS = 3 * 60 * 1000;

type State = 'waiting' | 'paid' | 'slow' | 'unknown';

const Thanks = () => {
  const [params] = useSearchParams();
  const token = params.get('tok') || params.get('Shp_tok') || '';

  const [state, setState] = useState<State>(token ? 'waiting' : 'unknown');
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    const started = Date.now();

    const ask = async () => {
      try {
        const r = await orderStatus(token);
        if (r.title) setTitle(r.title);

        if (r.paid && r.license_key) {
          stop();
          setKey(r.license_key);
          setState('paid');
          return;
        }
        // Банк подтверждает оплату не мгновенно — ждём, но не бесконечно
        if (Date.now() - started > GIVE_UP_MS) {
          stop();
          setState('slow');
        }
      } catch {
        stop();
        setState('unknown');
      }
    };

    void ask();
    timer.current = window.setInterval(ask, STEP_MS);
    return stop;
  }, [token, stop]);

  const copy = () => {
    navigator.clipboard?.writeText(key);
    toast({ title: 'Ключ скопирован' });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-[880px] items-center gap-2.5 px-6 py-4">
          <img src={LOGO_URL} alt="" className="h-7 w-auto" />
          <span className="font-head text-[0.8rem] font-bold uppercase tracking-[0.12em]">
            {APP_NAME}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[560px] flex-1 px-6 py-14">
        {state === 'paid' && (
          <>
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center border border-primary bg-primary/5">
                <Icon name="ShieldCheck" size={28} className="text-primary" />
              </span>
              <div>
                <h1 className="font-head text-[1.5rem] font-black uppercase leading-none">
                  Спасибо за покупку
                </h1>
                <p className="mt-1.5 text-[0.9rem] text-muted-foreground">
                  Оплата прошла. {title && `${title}.`}
                </p>
              </div>
            </div>

            <div className="mt-8">
              <div className="label-caps">Ваш ключ активации</div>
              <div className="mt-2 flex items-stretch border border-foreground">
                <code className="flex-1 bg-card px-4 py-4 text-center font-head text-[1.05rem] font-bold tracking-[0.08em]">
                  {key}
                </code>
                <button
                  onClick={copy}
                  title="Скопировать"
                  className="border-l border-foreground px-5 transition-colors hover:bg-card"
                >
                  <Icon name="Copy" size={16} />
                </button>
              </div>
            </div>

            <div className="mt-8 border-l-2 border-foreground pl-4">
              <div className="label-caps">Что дальше</div>
              <ol className="mt-3 space-y-2.5 text-[0.9rem]">
                <li className="flex gap-2.5">
                  <span className="font-head font-bold text-muted-foreground">1.</span>
                  Вернитесь в программу — если она открыта, полная версия
                  включится сама, вводить ключ не нужно
                </li>
                <li className="flex gap-2.5">
                  <span className="font-head font-bold text-muted-foreground">2.</span>
                  Если программа была закрыта, откройте её, нажмите
                  «Активировать полную версию» и введите ключ
                </li>
              </ol>
            </div>

            <div className="mt-8 flex items-start gap-2.5 border border-border bg-card px-4 py-3.5 text-[0.85rem]">
              <Icon name="Mail" size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span>
                Копия ключа отправлена вам на почту. Сохраните письмо: ключ
                понадобится при переустановке программы.
              </span>
            </div>
          </>
        )}

        {state === 'waiting' && (
          <div className="py-10 text-center">
            <Icon name="LoaderCircle" size={34} className="mx-auto animate-spin text-primary" />
            <h1 className="mt-6 font-head text-[1.3rem] font-black uppercase">
              Подтверждаем оплату
            </h1>
            <p className="mx-auto mt-3 max-w-[380px] text-[0.9rem] leading-relaxed text-muted-foreground">
              Это занимает несколько секунд. Не закрывайте страницу — ключ
              появится здесь сам.
            </p>
          </div>
        )}

        {state === 'slow' && (
          <div className="py-10 text-center">
            <Icon name="Clock" size={30} className="mx-auto text-muted-foreground" />
            <h1 className="mt-6 font-head text-[1.3rem] font-black uppercase">
              Оплата ещё обрабатывается
            </h1>
            <p className="mx-auto mt-3 max-w-[420px] text-[0.9rem] leading-relaxed text-muted-foreground">
              Иногда банк подтверждает платёж дольше обычного. Ключ придёт
              к вам на почту, как только оплата пройдёт — деньги не потеряются.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn-block mx-auto mt-6"
            >
              <Icon name="RefreshCw" size={15} />
              Проверить ещё раз
            </button>
          </div>
        )}

        {state === 'unknown' && (
          <div className="py-10 text-center">
            <Icon name="CircleHelp" size={30} className="mx-auto text-muted-foreground" />
            <h1 className="mt-6 font-head text-[1.3rem] font-black uppercase">
              Не нашли заказ
            </h1>
            <p className="mx-auto mt-3 max-w-[420px] text-[0.9rem] leading-relaxed text-muted-foreground">
              Похоже, ссылка открыта без сведений о покупке. Если вы оплатили —
              ключ придёт на почту, указанную при оформлении.
            </p>
          </div>
        )}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-[880px] px-6 py-4 text-[0.78rem] text-muted-foreground">
          Возникли вопросы по оплате — ответьте на письмо с ключом, поможем.
        </div>
      </footer>
    </div>
  );
};

export default Thanks;
