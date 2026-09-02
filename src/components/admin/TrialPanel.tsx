import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { trialStats } from '@/lib/adminApi';

type Stats = Awaited<ReturnType<typeof trialStats>>;

// Названия инструментов человеческим языком: в базе лежат
// служебные обозначения, читать их неудобно
const TOOL_NAMES: Record<string, string> = {
  word: 'В Word',
  excel: 'В Excel',
  jpg: 'В картинки',
  'to-word': 'PDF в Word',
  'to-excel': 'PDF в Excel',
  'to-jpg': 'PDF в JPG',
  'to-png': 'PDF в PNG',
};

const toolName = (id: string) => TOOL_NAMES[id] || id;

const TrialPanel = () => {
  const [data, setData] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');

  const load = () => {
    setBusy(true);
    trialStats()
      .then((r) => {
        setData(r);
        setErr('');
      })
      .catch(() => setErr('Не удалось загрузить статистику'))
      .finally(() => setBusy(false));
  };

  useEffect(load, []);

  if (busy && !data) {
    return (
      <div className="mt-6 flex justify-center py-16">
        <Icon name="LoaderCircle" size={26} className="animate-spin text-primary" />
      </div>
    );
  }

  if (err) {
    return (
      <div className="mt-6 flex items-center gap-2 border border-destructive bg-destructive/10 px-4 py-3 text-[0.86rem] text-destructive">
        <Icon name="TriangleAlert" size={16} />
        {err}
      </div>
    );
  }

  if (!data) return null;

  const cards: {
    label: string;
    value: string | number;
    icon: string;
    note: string;
    alert?: boolean;
  }[] = [
    {
      label: 'Пробовали',
      value: data.tried,
      icon: 'Users',
      note: 'Компьютеров, где запускали платные инструменты',
    },
    {
      label: 'Упёрлись в лимит',
      value: data.hit_limit,
      icon: 'LockKeyhole',
      note: 'Израсходовали все пробные запуски',
    },
    {
      label: 'Купили после',
      value: data.bought,
      icon: 'ShoppingCart',
      note: 'Оплатили ключ с того же компьютера',
    },
    {
      label: 'Доля покупок',
      value: `${data.rate}%`,
      icon: 'TrendingUp',
      note: 'Из тех, кто израсходовал пробы',
    },
    {
      label: 'Обнуляли счётчик',
      value: data.reset_machines,
      icon: 'ShieldAlert',
      note: 'Пытались получить пробы заново — сервер не даёт',
      alert: data.reset_machines > 0,
    },
  ];

  const most = data.by_tool[0]?.count || 1;

  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 border-l border-t border-border lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="border-b border-r border-border p-5">
            <Icon
              name={c.icon}
              size={18}
              className={c.alert ? 'text-destructive' : 'text-primary'}
            />
            <div className="mt-3 font-head text-[1.8rem] font-black leading-none">{c.value}</div>
            <div className="mt-1 text-[0.78rem] uppercase tracking-[0.1em] text-muted-foreground">
              {c.label}
            </div>
            <div className="mt-2 text-[0.75rem] leading-snug text-muted-foreground">{c.note}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3 border border-border bg-card px-4 py-3">
        <Icon name="Info" size={15} className="shrink-0 text-muted-foreground" />
        <span className="text-[0.82rem] text-muted-foreground">
          Всего пробных запусков: <b className="text-foreground">{data.runs}</b>. Счёт ведётся по
          компьютерам — один человек с пятью запусками считается один раз
        </span>
        <button
          onClick={load}
          disabled={busy}
          className="ml-auto flex shrink-0 items-center gap-1.5 border border-border px-3 py-1.5 text-[0.78rem] transition-colors hover:border-foreground disabled:opacity-50"
        >
          <Icon name={busy ? 'LoaderCircle' : 'RefreshCw'} size={13} className={busy ? 'animate-spin' : ''} />
          Обновить
        </button>
      </div>

      {/* Обнуления счётчика. Показываем, только если они вообще были:
          пустой раздел на глазах каждый день внушал бы ложную тревогу */}
      {data.reset_machines > 0 && (
        <div className="mt-6 border border-border">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Icon name="ShieldAlert" size={15} className="text-destructive" />
            <span className="label-caps">Обнуляли счётчик</span>
            <span className="ml-auto text-[0.78rem] text-muted-foreground">
              Компьютеров: <b className="text-foreground">{data.reset_machines}</b>
            </span>
          </div>

          <div className="border-b border-border bg-card px-4 py-3 text-[0.8rem] leading-relaxed text-muted-foreground">
            Здесь компьютеры, где пробный счётчик сбрасывали, чтобы получить попытки заново.
            Сейчас это не срабатывает — сервер помнит израсходованные пробы и восстанавливает счёт
            при следующем запуске. Список нужен, чтобы видеть, есть ли злоупотребления вообще
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[0.84rem]">
              <thead>
                <tr className="border-b border-border text-[0.72rem] uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Компьютер</th>
                  <th className="px-4 py-2.5 font-medium">Сбросов</th>
                  <th className="px-4 py-2.5 font-medium">Всего запусков</th>
                  <th className="px-4 py-2.5 font-medium">Последний раз</th>
                </tr>
              </thead>
              <tbody>
                {data.resets.map((r) => (
                  <tr key={r.machine_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">
                      {r.machine_name || (
                        <span className="text-muted-foreground">{r.machine_id}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-destructive">
                        <Icon name="RotateCcw" size={13} />
                        {r.resets}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={r.runs > 5 ? 'font-bold text-destructive' : ''}>
                        {r.runs}
                      </span>
                      <span className="ml-1 text-muted-foreground">из 5 положенных</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{r.last}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.by_tool.length > 0 && (
        <div className="mt-6 border border-border">
          <div className="border-b border-border px-4 py-3">
            <span className="label-caps">Что пробуют чаще всего</span>
          </div>
          <div className="p-4">
            {data.by_tool.map((t) => (
              <div key={t.tool} className="mb-3 last:mb-0">
                <div className="flex items-baseline justify-between">
                  <span className="text-[0.86rem]">{toolName(t.tool)}</span>
                  <span className="font-head text-[0.86rem] font-bold">{t.count}</span>
                </div>
                <div className="mt-1 h-1.5 w-full bg-border">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.max(3, (t.count / most) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 border border-border">
        <div className="border-b border-border px-4 py-3">
          <span className="label-caps">Последние запуски</span>
        </div>

        {!data.recent.length ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Icon name="Inbox" size={26} className="text-muted-foreground" />
            <span className="font-head text-[0.9rem] font-bold">Пока никто не пробовал</span>
            <span className="text-[0.82rem] text-muted-foreground">
              Отметки появятся, когда программу с пробным режимом установят
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[0.84rem]">
              <thead>
                <tr className="border-b border-border text-[0.72rem] uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Когда</th>
                  <th className="px-4 py-2.5 font-medium">Компьютер</th>
                  <th className="px-4 py-2.5 font-medium">Инструмент</th>
                  <th className="px-4 py-2.5 font-medium">Запуск</th>
                  <th className="px-4 py-2.5 font-medium">Итог</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{r.when}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        {r.was_reset && (
                          <Icon
                            name="RotateCcw"
                            size={12}
                            className="shrink-0 text-destructive"
                          />
                        )}
                        {r.machine_name || (
                          <span className="text-muted-foreground">{r.machine_id}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">{toolName(r.tool)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.used} из 5</td>
                    <td className="px-4 py-2.5">
                      {r.event === 'limit' ? (
                        <span className="inline-flex items-center gap-1.5 text-destructive">
                          <Icon name="LockKeyhole" size={13} />
                          Пробы кончились
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <Icon name="Check" size={13} />
                          Пробует
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrialPanel;