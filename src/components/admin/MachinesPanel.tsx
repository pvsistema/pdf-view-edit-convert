import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { listMachines, type Machine } from '@/lib/adminApi';

type Props = {
  licenseId: number;
  title: string;
  seats: number;
  onClose: () => void;
};

const MachinesPanel = ({ licenseId, title, seats, onClose }: Props) => {
  const [items, setItems] = useState<Machine[] | null>(null);

  useEffect(() => {
    listMachines(licenseId)
      .then((r) => setItems(r.items || []))
      .catch(() => setItems([]));
  }, [licenseId]);

  // Место считается занятым, пока компьютер выходил на связь
  // в последние полгода — так учитывается замена техники
  const half = Date.now() - 180 * 86_400_000;
  const active = (items || []).filter((m) => new Date(m.last_seen).getTime() > half).length;
  const over = active > seats;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/50 p-4">
      <div className="flex max-h-[88vh] w-full max-w-[720px] flex-col border border-foreground bg-background">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="label-caps">Компьютеры лицензии</div>
            <p className="mt-1 text-[0.82rem] text-muted-foreground">{title}</p>
          </div>
          <button onClick={onClose} className="hover:text-destructive" title="Закрыть">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="border-b border-border px-5 py-3">
          <span
            className={`font-head text-[0.86rem] font-bold ${over ? 'text-destructive' : ''}`}
          >
            Занято мест: {active} из {seats}
          </span>
          {over && (
            <span className="ml-2 text-[0.8rem] text-destructive">— превышение</span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {items === null && (
            <div className="px-5 py-10 text-center">
              <Icon name="LoaderCircle" size={20} className="mx-auto animate-spin text-primary" />
            </div>
          )}

          {items?.length === 0 && (
            <div className="px-5 py-12 text-center text-muted-foreground">
              Пока ни один компьютер не активировал этот ключ
            </div>
          )}

          {items && items.length > 0 && (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-card">
                  {['Компьютер', 'Отпечаток', 'Первый вход', 'Последний вход'].map((h) => (
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
                {items.map((m) => {
                  const stale = new Date(m.last_seen).getTime() <= half;
                  return (
                    <tr
                      key={m.machine_id}
                      className={`border-b border-border last:border-0 ${stale ? 'opacity-45' : ''}`}
                    >
                      <td className="px-4 py-3 font-head text-[0.86rem] font-bold">
                        {m.machine_name || '—'}
                        {stale && (
                          <span className="ml-2 text-[0.72rem] font-normal text-muted-foreground">
                            место освобождено
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[0.76rem] text-muted-foreground">
                        {m.machine_id.slice(0, 12)}…
                      </td>
                      <td className="px-4 py-3 text-[0.82rem]">{m.first_seen}</td>
                      <td className="px-4 py-3 text-[0.82rem]">{m.last_seen}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-border px-5 py-3 text-[0.76rem] leading-relaxed text-muted-foreground">
          Компьютер, не выходивший на связь более полугода, место не занимает — лицензия
          освобождается сама при замене техники.
        </div>
      </div>
    </div>
  );
};

export default MachinesPanel;
