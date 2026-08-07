import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { createLicense, generateKey, updateLicense, type License } from '@/lib/adminApi';
import { toast } from '@/hooks/use-toast';

type Props = {
  item: License | null;
  onClose: () => void;
  onSaved: (item: License) => void;
};

const addMonths = (m: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return d.toISOString().slice(0, 10);
};

const LicenseForm = ({ item, onClose, onSaved }: Props) => {
  const [org, setOrg] = useState(item?.org_name ?? '');
  const [key, setKey] = useState(item?.license_key ?? '');
  const [until, setUntil] = useState(item?.valid_until ?? addMonths(12));
  const [seats, setSeats] = useState(item?.seats ?? 1);
  const [contact, setContact] = useState(item?.contact ?? '');
  const [note, setNote] = useState(item?.note ?? '');
  const [status, setStatus] = useState(item?.status ?? 'active');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!item && !key) {
      generateKey()
        .then((r) => setKey(r.key))
        .catch(() => undefined);
    }
  }, [item, key]);

  const regen = async () => {
    const r = await generateKey();
    setKey(r.key);
    toast({ title: 'Ключ создан заново' });
  };

  const save = async () => {
    if (!org.trim()) {
      setErr('Укажите название организации');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const data = {
        org_name: org.trim(),
        license_key: key.trim().toUpperCase(),
        valid_until: until,
        seats: Number(seats) || 1,
        contact: contact.trim(),
        note: note.trim(),
        status,
      };
      const res = item ? await updateLicense({ id: item.id, ...data }) : await createLicense(data);
      toast({ title: item ? 'Лицензия обновлена' : 'Лицензия создана', description: org });
      onSaved(res.item);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const field = 'mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground/50 p-4">
      <div className="max-h-[92vh] w-full max-w-[560px] overflow-y-auto border border-foreground bg-background">
        <div className="sticky top-0 flex items-center justify-between border-b border-foreground bg-foreground px-5 py-3 text-background">
          <span className="font-head text-[0.74rem] font-bold uppercase tracking-[0.12em]">
            {item ? 'Изменить лицензию' : 'Новая лицензия'}
          </span>
          <button onClick={onClose} className="hover:opacity-70">
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="p-5">
          <label className="label-caps">Организация</label>
          <input value={org} onChange={(e) => setOrg(e.target.value)} autoFocus className={field} />

          <label className="label-caps mt-4 block">Ключ активации</label>
          <div className="mt-2 flex">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              className="w-full border border-border bg-card px-3 py-2.5 font-head text-[0.92rem] font-bold tracking-[0.06em] outline-none focus:border-primary"
            />
            <button
              onClick={regen}
              title="Сгенерировать заново"
              className="border border-l-0 border-border px-3 transition-colors hover:bg-card"
            >
              <Icon name="RefreshCw" size={15} />
            </button>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(key);
                toast({ title: 'Ключ скопирован' });
              }}
              title="Скопировать"
              className="border border-l-0 border-border px-3 transition-colors hover:bg-card"
            >
              <Icon name="Copy" size={15} />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-caps">Срок действия</label>
              <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={field} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[
                  [1, '1 мес'],
                  [3, '3 мес'],
                  [12, '1 год'],
                  [36, '3 года'],
                ].map(([m, l]) => (
                  <button
                    key={m as number}
                    onClick={() => setUntil(addMonths(m as number))}
                    className="border border-border px-2 py-1 text-[0.74rem] transition-colors hover:border-foreground"
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label-caps">Рабочих мест</label>
              <input
                type="number"
                min={1}
                value={seats}
                onChange={(e) => setSeats(Number(e.target.value))}
                className={field}
              />
              <label className="label-caps mt-3 block">Статус</label>
              <div className="mt-2 flex">
                {[
                  ['active', 'Активна'],
                  ['blocked', 'Заблокирована'],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setStatus(v)}
                    className={`flex-1 border px-2 py-2 text-[0.78rem] transition-colors ${
                      status === v
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:border-foreground'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="label-caps mt-4 block">Контакт</label>
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="почта или телефон"
            className={field}
          />

          <label className="label-caps mt-4 block">Заметка</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className={`${field} resize-y`}
          />

          {err && (
            <div className="mt-4 flex items-center gap-2 border border-destructive bg-destructive/10 px-3 py-2.5 text-[0.85rem] text-destructive">
              <Icon name="TriangleAlert" size={15} />
              {err}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button onClick={save} disabled={busy} className="btn-block flex-1 justify-center disabled:opacity-50">
              <Icon name={busy ? 'LoaderCircle' : 'Check'} size={16} className={busy ? 'animate-spin' : ''} />
              Сохранить
            </button>
            <button
              onClick={onClose}
              className="border border-border px-5 py-3 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] transition-colors hover:border-foreground"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LicenseForm;
