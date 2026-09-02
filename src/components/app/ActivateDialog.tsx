import { useState } from 'react';
import Icon from '@/components/ui/icon';
import { LOGO_URL } from '@/lib/brand';
import { useLicense } from '@/context/LicenseContext';
import { toast } from '@/hooks/use-toast';
import BuyDialog from '@/components/app/BuyDialog';
import { trialLeft, TRIAL_LIMIT } from '@/lib/trial';

const FREE = [
  'Просмотр документов',
  'Поворот и порядок страниц',
  'Поиск по тексту',
  `Конвертация — ${TRIAL_LIMIT} пробных запуска`,
];
const PAID = [
  'Конвертация в Word, Excel и JPG',
  'Распознавание сканов (OCR)',
  'Надписи и закрашивание данных',
  'Сохранение и печать без ограничений',
];

const mask = (v: string) => {
  const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('PVPDF') ? raw.slice(5) : raw;
  const groups = body.match(/.{1,5}/g) || [];
  return ['PVPDF', ...groups.slice(0, 4)].join('-');
};

// Ключ сверяется с сервером раз в месяц — показываем, когда это произойдёт
const nextCheck = () => {
  const last = Number(localStorage.getItem('pv_license_checked') || 0);
  if (!last) return 'при следующем запуске';
  return new Date(last + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('ru-RU');
};

const ActivateDialog = ({ onClose }: { onClose: () => void }) => {
  const { license, isFull, activate, deactivate } = useLicense();
  const [key, setKey] = useState(license?.key ?? 'PVPDF-');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Пустая строка — обычная покупка, ключ — продление действующей лицензии
  const [buyFor, setBuyFor] = useState<string | null>(null);
  const left = trialLeft();

  const submit = async () => {
    setErr('');
    setBusy(true);
    const res = await activate(key);
    setBusy(false);
    if (res.ok) {
      toast({ title: 'Готово', description: res.message });
      onClose();
    } else {
      setErr(res.message);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-foreground/50 p-4">
      <div className="max-h-[92vh] w-full max-w-[520px] overflow-y-auto border border-foreground bg-background">
        <div className="flex items-center gap-2.5 border-b border-foreground bg-foreground px-5 py-3 text-background">
          <img src={LOGO_URL} alt="" className="h-6 w-auto" />
          <span className="font-head text-[0.74rem] font-bold uppercase tracking-[0.12em]">
            Активация полной версии
          </span>
          <button onClick={onClose} className="ml-auto hover:opacity-70" title="Закрыть">
            <Icon name="X" size={16} />
          </button>
        </div>

        {isFull ? (
          <div className="p-6">
            <div className="flex items-center gap-3 border border-primary bg-primary/5 p-4">
              <Icon name="ShieldCheck" size={26} className="shrink-0 text-primary" />
              <div>
                <div className="font-head text-[1rem] font-bold uppercase">Полная версия активна</div>
                <div className="mt-0.5 text-[0.86rem] text-muted-foreground">{license?.org}</div>
              </div>
            </div>

            <div className="mt-5 border-l border-t border-border">
              {[
                ['Ключ', license?.key],
                ['Организация', license?.org],
                ['Действует до', license?.validUntil],
                ['Осталось дней', String(license?.daysLeft ?? '')],
                ['Следующая сверка', nextCheck()],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between border-b border-r border-border px-4 py-3">
                  <span className="text-[0.82rem] uppercase tracking-[0.08em] text-muted-foreground">{k}</span>
                  <span className="font-head text-[0.88rem] font-bold">{v}</span>
                </div>
              ))}
            </div>

            {/* Ближе к концу срока предлагаем продлить: после
                окончания программа вернётся к бесплатной версии */}
            {(license?.daysLeft ?? 0) <= 60 && (
              <button
                onClick={() => setBuyFor(license?.key ?? '')}
                className="mt-5 flex w-full items-center gap-3 border border-primary bg-primary/5 px-4 py-3.5 text-left transition-colors hover:bg-primary/10"
              >
                <Icon name="Repeat" size={20} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block font-head text-[0.92rem] font-bold">
                    Продлить лицензию
                  </span>
                  <span className="mt-0.5 block text-[0.8rem] text-muted-foreground">
                    Осталось дней: {license?.daysLeft}. Срок прибавится к текущему
                  </span>
                </span>
                <Icon name="ArrowRight" size={16} className="shrink-0 text-primary" />
              </button>
            )}

            <div className="mt-6 flex gap-3">
              <button className="btn-block flex-1 justify-center" onClick={onClose}>
                <Icon name="Check" size={16} />
                Закрыть
              </button>
              <button
                onClick={() => {
                  deactivate();
                  toast({ title: 'Ключ отвязан от этого компьютера' });
                  onClose();
                }}
                className="border border-border px-4 py-3 font-head text-[0.7rem] font-bold uppercase tracking-[0.1em] transition-colors hover:border-destructive hover:text-destructive"
              >
                Отвязать
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6">
            {/* Сначала — положение дел: сколько проб осталось */}
            <div
              className={`mb-5 flex items-center gap-3 border p-4 ${
                left > 0 ? 'border-border bg-card' : 'border-destructive bg-destructive/10'
              }`}
            >
              <Icon
                name={left > 0 ? 'Gift' : 'LockKeyhole'}
                size={22}
                className={`shrink-0 ${left > 0 ? 'text-primary' : 'text-destructive'}`}
              />
              <div className="min-w-0">
                <div className="font-head text-[0.92rem] font-bold uppercase">
                  {left > 0 ? `Пробных запусков: ${left} из ${TRIAL_LIMIT}` : 'Пробные запуски закончились'}
                </div>
                <div className="mt-0.5 text-[0.82rem] text-muted-foreground">
                  {left > 0
                    ? 'Конвертация в Word, Excel и картинки работает полностью — без пометок на файлах'
                    : 'Просмотр документов остаётся бесплатным. Для конвертации нужен ключ'}
                </div>
              </div>
            </div>

            <button
              onClick={() => setBuyFor('')}
              className="flex w-full items-center gap-3 border border-primary bg-primary/5 px-4 py-3.5 text-left transition-colors hover:bg-primary/10"
            >
              <Icon name="ShoppingCart" size={20} className="shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block font-head text-[0.92rem] font-bold">
                  Купить лицензию на год
                </span>
                <span className="mt-0.5 block text-[0.8rem] text-muted-foreground">
                  Оплата картой или через СБП — ключ включится сам
                </span>
              </span>
              <Icon name="ArrowRight" size={16} className="shrink-0 text-primary" />
            </button>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[0.76rem] uppercase tracking-[0.1em] text-muted-foreground">
                или
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <p className="text-[0.9rem] text-muted-foreground">
              Введите ключ активации, если он уже у вас есть.
            </p>

            <label className="label-caps mt-5 block">Ключ активации</label>
            <input
              autoFocus
              value={key}
              onChange={(e) => setKey(mask(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="PVPDF-XXXXX-XXXXX-XXXXX-XXXXX"
              className="mt-2 w-full border border-border bg-card px-3 py-3 text-center font-head text-[1rem] font-bold tracking-[0.1em] outline-none focus:border-primary"
            />

            {err && (
              <div className="mt-4 flex items-center gap-2 border border-destructive bg-destructive/10 px-3 py-2.5 text-[0.85rem] text-destructive">
                <Icon name="TriangleAlert" size={15} />
                {err}
              </div>
            )}

            <button
              onClick={submit}
              disabled={busy}
              className="btn-block mt-5 w-full justify-center disabled:opacity-50"
            >
              <Icon name={busy ? 'LoaderCircle' : 'KeyRound'} size={16} className={busy ? 'animate-spin' : ''} />
              Активировать
            </button>

            <div className="mt-7 grid grid-cols-1 gap-5 border-t border-border pt-6 sm:grid-cols-2">
              <div>
                <div className="label-caps">Бесплатно</div>
                <ul className="mt-3 space-y-2">
                  {FREE.map((f) => (
                    <li key={f} className="flex gap-2 text-[0.84rem]">
                      <Icon name="Check" size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="label-caps text-primary">Полная версия</div>
                <ul className="mt-3 space-y-2">
                  {PAID.map((f) => (
                    <li key={f} className="flex gap-2 text-[0.84rem]">
                      <Icon name="Check" size={14} className="mt-0.5 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {buyFor !== null && (
        <BuyDialog
          renewKey={buyFor}
          onClose={() => {
            setBuyFor(null);
            // Ключ мог включиться прямо в окне оплаты
            if (isFull) onClose();
          }}
        />
      )}
    </div>
  );
};

export default ActivateDialog;