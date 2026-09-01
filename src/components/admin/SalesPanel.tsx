import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import {
  adminTariffs,
  deleteTariff,
  listOrders,
  mailReady,
  markOrderPaid,
  resendKeyMail,
  saveTariff,
  testMail,
  type Order,
  type Tariff,
} from '@/lib/adminApi';
import { toast } from '@/hooks/use-toast';

const money = (v: number) => `${v.toLocaleString('ru-RU')} ₽`;

const STATUS: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Оплачен', cls: 'bg-primary text-primary-foreground' },
  new: { label: 'Ожидает оплаты', cls: 'bg-card text-muted-foreground' },
  failed: { label: 'Не прошёл', cls: 'bg-destructive text-destructive-foreground' },
  cancelled: { label: 'Отменён', cls: 'bg-foreground text-background' },
};

const empty: Partial<Tariff> = { title: '', note: '', price: 0, months: 12, seats: 1, sort: 0 };

const SalesPanel = () => {
  const [tab, setTab] = useState<'tariffs' | 'orders'>('tariffs');
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState({ paid: 0, total_sum: 0 });
  const [edit, setEdit] = useState<Partial<Tariff> | null>(null);
  const [busy, setBusy] = useState(false);
  const [mailOn, setMailOn] = useState(true);
  const [sending, setSending] = useState(0);
  const [checking, setChecking] = useState(false);

  const loadTariffs = useCallback(() => {
    adminTariffs()
      .then((r) => setTariffs(r.items))
      .catch(() => toast({ title: 'Не удалось загрузить тарифы' }));
  }, []);

  const loadOrders = useCallback(() => {
    listOrders()
      .then((r) => {
        setOrders(r.items);
        setStats(r.stats);
      })
      .catch(() => toast({ title: 'Не удалось загрузить заказы' }));
  }, []);

  useEffect(() => {
    loadTariffs();
    loadOrders();
    mailReady()
      .then((r) => setMailOn(r.ready))
      .catch(() => undefined);
  }, [loadTariffs, loadOrders]);

  // Проверка почты: письмо уходит на собственный ящик магазина
  const checkMail = async () => {
    setChecking(true);
    try {
      const r = await testMail();
      toast({
        title: r.ok ? 'Письмо отправлено' : 'Письмо не ушло',
        description: r.ok ? `Проверьте ящик ${r.to}` : r.note,
      });
      setMailOn(r.ok);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Не удалось проверить' });
    } finally {
      setChecking(false);
    }
  };

  const resend = async (o: Order) => {
    const to = window.prompt('Отправить ключ на адрес:', o.email || '');
    if (to === null) return;
    setSending(o.id);
    try {
      const r = await resendKeyMail(o.id, to.trim());
      toast({
        title: r.ok ? 'Письмо отправлено' : 'Письмо не ушло',
        description: r.note,
      });
      loadOrders();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Не удалось отправить' });
    } finally {
      setSending(0);
    }
  };

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await saveTariff(edit);
      toast({ title: edit.id ? 'Тариф изменён' : 'Тариф добавлен' });
      setEdit(null);
      loadTariffs();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Не удалось сохранить' });
    } finally {
      setBusy(false);
    }
  };

  const hide = async (t: Tariff) => {
    if (!window.confirm(`Убрать тариф «${t.title}» из продажи?`)) return;
    await deleteTariff(t.id);
    loadTariffs();
    toast({ title: 'Тариф убран из продажи' });
  };

  const giveKey = async (o: Order) => {
    if (!window.confirm(`Выдать ключ по заказу №${o.id}? Деньги должны быть получены.`)) return;
    const r = await markOrderPaid(o.id);
    loadOrders();
    toast({ title: 'Ключ выдан', description: r.license_key });
  };

  const field =
    'mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary';

  return (
    <div className="mt-6">
      <div className="flex border border-border">
        {(
          [
            ['tariffs', 'Тарифы и цены'],
            ['orders', 'Заказы'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2.5 font-head text-[0.72rem] font-bold uppercase tracking-[0.08em] transition-colors ${
              tab === id ? 'bg-foreground text-background' : 'hover:bg-card'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'tariffs' ? (
        <>
          <div className="mt-5 flex items-center justify-between">
            <p className="text-[0.84rem] text-muted-foreground">
              Цены видны в программе сразу после сохранения — пересобирать её не нужно.
            </p>
            <button className="btn-block" onClick={() => setEdit({ ...empty })}>
              <Icon name="Plus" size={15} />
              Новый тариф
            </button>
          </div>

          <div className="mt-5 overflow-x-auto border border-border">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-card">
                  {['Название', 'Цена', 'Срок', 'Мест', 'В продаже', ''].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 font-head text-[0.7rem] font-bold uppercase tracking-[0.1em] text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!tariffs.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      Тарифов пока нет
                    </td>
                  </tr>
                )}
                {tariffs.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-card">
                    <td className="px-4 py-3">
                      <div className="font-head text-[0.9rem] font-bold">{t.title}</div>
                      {t.note && (
                        <div className="text-[0.78rem] text-muted-foreground">{t.note}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-head text-[0.92rem] font-bold">
                      {money(t.price)}
                    </td>
                    <td className="px-4 py-3 text-[0.86rem]">{t.months} мес.</td>
                    <td className="px-4 py-3 text-[0.86rem]">{t.seats}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-1 font-head text-[0.68rem] font-bold uppercase tracking-[0.08em] ${
                          t.is_active
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-card text-muted-foreground'
                        }`}
                      >
                        {t.is_active ? 'Да' : 'Скрыт'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEdit(t)}
                          className="p-2 hover:text-primary"
                          title="Изменить"
                        >
                          <Icon name="Pencil" size={15} />
                        </button>
                        <button
                          onClick={() => hide(t)}
                          className="p-2 hover:text-destructive"
                          title="Убрать из продажи"
                        >
                          <Icon name="Trash2" size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div
            className={`mt-5 flex flex-wrap items-center gap-3 border px-4 py-3 text-[0.85rem] ${
              mailOn ? 'border-border bg-card' : 'border-destructive bg-destructive/5'
            }`}
          >
            <Icon
              name={mailOn ? 'Check' : 'TriangleAlert'}
              size={15}
              className={`shrink-0 ${mailOn ? 'text-primary' : 'text-destructive'}`}
            />
            <span className="min-w-0 flex-1">
              {mailOn
                ? 'Ключ уходит покупателю письмом сразу после оплаты.'
                : 'Отправка писем не настроена — покупатели не получат ключ на почту. В программе ключ всё равно включится сам.'}
            </span>
            <button
              onClick={checkMail}
              disabled={checking}
              className="shrink-0 border border-border bg-background px-3 py-1.5 text-[0.78rem] transition-colors hover:border-foreground disabled:opacity-50"
              title="Отправить пробное письмо на ваш ящик"
            >
              {checking ? 'Отправляю…' : 'Проверить почту'}
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 border-l border-t border-border">
            <div className="border-b border-r border-border p-5">
              <Icon name="CircleCheck" size={18} className="text-primary" />
              <div className="mt-3 font-head text-[1.8rem] font-black leading-none">
                {stats.paid}
              </div>
              <div className="mt-1 text-[0.78rem] uppercase tracking-[0.1em] text-muted-foreground">
                Оплачено заказов
              </div>
            </div>
            <div className="border-b border-r border-border p-5">
              <Icon name="Sparkles" size={18} className="text-primary" />
              <div className="mt-3 font-head text-[1.8rem] font-black leading-none">
                {money(stats.total_sum)}
              </div>
              <div className="mt-1 text-[0.78rem] uppercase tracking-[0.1em] text-muted-foreground">
                Получено всего
              </div>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto border border-border">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-card">
                  {['№', 'Тариф', 'Сумма', 'Покупатель', 'Ключ', 'Статус', 'Письмо', ''].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 font-head text-[0.7rem] font-bold uppercase tracking-[0.1em] text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!orders.length && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                      Заказов пока нет
                    </td>
                  </tr>
                )}
                {orders.map((o) => {
                  const s = STATUS[o.status] || STATUS.new;
                  return (
                    <tr key={o.id} className="border-b border-border last:border-0 hover:bg-card">
                      <td className="px-4 py-3 text-[0.86rem] text-muted-foreground">{o.id}</td>
                      <td className="px-4 py-3">
                        <div className="text-[0.86rem]">{o.title}</div>
                        <div className="text-[0.76rem] text-muted-foreground">{o.created_at}</div>
                      </td>
                      <td className="px-4 py-3 font-head text-[0.9rem] font-bold">
                        {money(o.price)}
                      </td>
                      <td className="px-4 py-3 text-[0.82rem]">
                        {o.org_name || '—'}
                        {o.email && (
                          <div className="text-[0.76rem] text-muted-foreground">{o.email}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {o.license_key ? (
                          <button
                            onClick={() => {
                              navigator.clipboard?.writeText(o.license_key);
                              toast({ title: 'Ключ скопирован' });
                            }}
                            className="font-head text-[0.8rem] font-bold tracking-[0.04em]"
                            title="Скопировать"
                          >
                            {o.license_key}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-1 font-head text-[0.68rem] font-bold uppercase tracking-[0.08em] ${s.cls}`}
                        >
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {!o.license_key ? (
                          <span className="text-muted-foreground">—</span>
                        ) : o.mail_sent ? (
                          <span
                            className="flex items-center gap-1.5 text-[0.78rem] text-primary"
                            title={o.mail_note}
                          >
                            <Icon name="Check" size={13} />
                            Отправлено
                          </span>
                        ) : (
                          <span
                            className="flex items-center gap-1.5 text-[0.78rem] text-destructive"
                            title={o.mail_note || 'Письмо не отправлялось'}
                          >
                            <Icon name="TriangleAlert" size={13} />
                            Не ушло
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          {o.license_key && (
                            <button
                              onClick={() => resend(o)}
                              disabled={sending === o.id}
                              className="border border-border px-2.5 py-1.5 text-[0.76rem] transition-colors hover:border-foreground disabled:opacity-50"
                              title="Отправить ключ письмом ещё раз"
                            >
                              {sending === o.id ? 'Отправляю…' : 'Письмо'}
                            </button>
                          )}
                          {o.status !== 'paid' && (
                            <button
                              onClick={() => giveKey(o)}
                              className="border border-border px-2.5 py-1.5 text-[0.76rem] transition-colors hover:border-foreground"
                              title="Деньги получены другим способом"
                            >
                              Выдать ключ
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {edit && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground/50 p-4">
          <div className="max-h-[92vh] w-full max-w-[520px] overflow-y-auto border border-foreground bg-background">
            <div className="flex items-center justify-between border-b border-foreground bg-foreground px-5 py-3 text-background">
              <span className="font-head text-[0.74rem] font-bold uppercase tracking-[0.12em]">
                {edit.id ? 'Изменить тариф' : 'Новый тариф'}
              </span>
              <button onClick={() => setEdit(null)} className="hover:opacity-70">
                <Icon name="X" size={16} />
              </button>
            </div>

            <div className="p-5">
              <label className="label-caps">Название</label>
              <input
                autoFocus
                value={edit.title ?? ''}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                placeholder="Лицензия на 1 год"
                className={field}
              />

              <label className="label-caps mt-4 block">Пояснение</label>
              <input
                value={edit.note ?? ''}
                onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                placeholder="Одно рабочее место"
                className={field}
              />

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div>
                  <label className="label-caps">Цена, ₽</label>
                  <input
                    type="number"
                    min={1}
                    value={edit.price ?? 0}
                    onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })}
                    className={field}
                  />
                </div>
                <div>
                  <label className="label-caps">Срок, мес.</label>
                  <input
                    type="number"
                    min={1}
                    value={edit.months ?? 12}
                    onChange={(e) => setEdit({ ...edit, months: Number(e.target.value) })}
                    className={field}
                  />
                </div>
                <div>
                  <label className="label-caps">Мест</label>
                  <input
                    type="number"
                    min={1}
                    value={edit.seats ?? 1}
                    onChange={(e) => setEdit({ ...edit, seats: Number(e.target.value) })}
                    className={field}
                  />
                </div>
              </div>

              <label className="mt-4 flex items-center gap-2.5 text-[0.86rem]">
                <input
                  type="checkbox"
                  checked={edit.is_active ?? true}
                  onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })}
                />
                Показывать в программе
              </label>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={save}
                  disabled={busy}
                  className="btn-block flex-1 justify-center disabled:opacity-50"
                >
                  <Icon
                    name={busy ? 'LoaderCircle' : 'Check'}
                    size={16}
                    className={busy ? 'animate-spin' : ''}
                  />
                  Сохранить
                </button>
                <button
                  onClick={() => setEdit(null)}
                  className="border border-border px-5 py-3 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] transition-colors hover:border-foreground"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesPanel;