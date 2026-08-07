import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { listReleases, publishRelease, unpublishRelease, type Release } from '@/lib/adminApi';
import { toast } from '@/hooks/use-toast';

const empty = {
  version: '',
  download_url: '',
  notes: '',
  is_required: false,
  is_published: true,
};

const ReleasesPanel = () => {
  const [items, setItems] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...empty });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listReleases()
      .then((r) => setItems(r.items))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const save = async () => {
    if (!/^\d+\.\d+\.\d+$/.test(form.version.trim())) {
      toast({ title: 'Неверный номер версии', description: 'Формат: 1.0.0' });
      return;
    }
    setBusy(true);
    try {
      await publishRelease(form);
      toast({ title: 'Версия опубликована', description: form.version });
      setForm({ ...empty });
      load();
    } catch (e: unknown) {
      toast({ title: 'Не удалось опубликовать', description: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const hide = async (r: Release) => {
    await unpublishRelease(r.id);
    toast({ title: 'Версия снята с публикации', description: r.version });
    load();
  };

  const field =
    'mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary';

  return (
    <div className="mt-6">
      <div className="border border-border p-5">
        <div className="label-caps">Опубликовать новую версию</div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label-caps">Номер версии</label>
            <input
              value={form.version}
              onChange={(e) => setForm({ ...form, version: e.target.value })}
              placeholder="1.1.0"
              className={field}
            />
          </div>
          <div>
            <label className="label-caps">Ссылка на установщик</label>
            <input
              value={form.download_url}
              onChange={(e) => setForm({ ...form, download_url: e.target.value })}
              placeholder="https://…/PVSPDF-Setup-1.1.0.exe"
              className={field}
            />
          </div>
        </div>

        <label className="label-caps mt-4 block">Что нового</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={3}
          placeholder="Список изменений — по строке на пункт"
          className={`${field} resize-y`}
        />

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-[0.86rem]">
            <input
              type="checkbox"
              checked={form.is_required}
              onChange={(e) => setForm({ ...form, is_required: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            Обязательное обновление
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[0.86rem]">
            <input
              type="checkbox"
              checked={form.is_published}
              onChange={(e) => setForm({ ...form, is_published: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            Показывать пользователям
          </label>

          <button onClick={save} disabled={busy} className="btn-block ml-auto disabled:opacity-50">
            <Icon name={busy ? 'LoaderCircle' : 'Upload'} size={16} className={busy ? 'animate-spin' : ''} />
            Опубликовать
          </button>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto border border-border">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-card">
              {['Версия', 'Опубликована', 'Ссылка', 'Что нового', 'Статус', ''].map((h) => (
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
            {!loading && !items.length && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  Версии пока не публиковались
                </td>
              </tr>
            )}
            {!loading &&
              items.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-card">
                  <td className="px-4 py-3 font-head text-[0.9rem] font-bold">{r.version}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[0.84rem]">{r.published_at}</td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-[0.82rem] text-muted-foreground">
                    {r.download_url || '—'}
                  </td>
                  <td className="max-w-[240px] truncate px-4 py-3 text-[0.82rem] text-muted-foreground">
                    {r.notes || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-1 font-head text-[0.66rem] font-bold uppercase tracking-[0.08em] ${
                        !r.is_published
                          ? 'bg-muted text-muted-foreground'
                          : r.is_required
                            ? 'bg-destructive text-destructive-foreground'
                            : 'bg-primary text-primary-foreground'
                      }`}
                    >
                      {!r.is_published ? 'Скрыта' : r.is_required ? 'Обязательная' : 'Доступна'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.is_published && (
                      <button
                        onClick={() => hide(r)}
                        className="p-2 hover:text-destructive"
                        title="Снять с публикации"
                      >
                        <Icon name="EyeOff" size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ReleasesPanel;
