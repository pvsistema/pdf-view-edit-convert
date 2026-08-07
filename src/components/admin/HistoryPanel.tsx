import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { listHistory, type CheckRecord } from '@/lib/adminApi';

const RESULTS: Record<string, { label: string; cls: string; icon: string }> = {
  ok: { label: 'Успешно', cls: 'text-primary', icon: 'CircleCheck' },
  expired: { label: 'Срок истёк', cls: 'text-foreground', icon: 'Clock' },
  blocked: { label: 'Заблокирован', cls: 'text-destructive', icon: 'Ban' },
  not_found: { label: 'Ключ не найден', cls: 'text-destructive', icon: 'CircleHelp' },
};

const device = (ua: string) => {
  if (!ua) return 'Неизвестно';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os|macintosh/i.test(ua)) return 'macOS';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad/i.test(ua)) return 'iOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Другое';
};

type Props = { licenseId?: number; title?: string; onClose?: () => void };

const HistoryPanel = ({ licenseId = 0, title, onClose }: Props) => {
  const [items, setItems] = useState<CheckRecord[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    listHistory(licenseId)
      .then((r) => {
        setItems(r.items);
        setCounts(r.by_result);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [licenseId]);

  const shown = filter === 'all' ? items : items.filter((i) => i.result === filter);

  const chips = [
    { id: 'all', label: 'Все', n: items.length },
    ...Object.entries(RESULTS).map(([id, r]) => ({ id, label: r.label, n: counts[id] || 0 })),
  ];

  const body = (
    <>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={`border px-3 py-1.5 text-[0.78rem] transition-colors ${
              filter === c.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:border-foreground'
            }`}
          >
            {c.label} <span className="opacity-70">{c.n}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto border border-border">
        <table className="w-full min-w-[700px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-card">
              {['Когда', 'Организация', 'Ключ', 'Результат', 'Система', 'Адрес'].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 font-head text-[0.68rem] font-bold uppercase tracking-[0.1em] text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <Icon name="LoaderCircle" size={20} className="mx-auto animate-spin text-primary" />
                </td>
              </tr>
            )}
            {!loading && !shown.length && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  Проверок пока не было
                </td>
              </tr>
            )}
            {!loading &&
              shown.map((r) => {
                const res = RESULTS[r.result] || { label: r.result, cls: '', icon: 'Circle' };
                return (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-card">
                    <td className="whitespace-nowrap px-4 py-2.5 text-[0.84rem]">{r.checked_at}</td>
                    <td className="px-4 py-2.5 text-[0.84rem]">{r.org_name || '—'}</td>
                    <td className="px-4 py-2.5 font-head text-[0.78rem] font-bold">{r.license_key}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 text-[0.82rem] ${res.cls}`}>
                        <Icon name={res.icon} size={13} />
                        {res.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[0.82rem] text-muted-foreground">
                      {device(r.user_agent)}
                    </td>
                    <td className="px-4 py-2.5 text-[0.82rem] text-muted-foreground">{r.ip || '—'}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </>
  );

  if (!onClose) return body;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-[900px] flex-col border border-foreground bg-background">
        <div className="flex shrink-0 items-center justify-between border-b border-foreground bg-foreground px-5 py-3 text-background">
          <span className="truncate font-head text-[0.74rem] font-bold uppercase tracking-[0.12em]">
            {title || 'История проверок'}
          </span>
          <button onClick={onClose} className="hover:opacity-70">
            <Icon name="X" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{body}</div>
      </div>
    </div>
  );
};

export default HistoryPanel;
