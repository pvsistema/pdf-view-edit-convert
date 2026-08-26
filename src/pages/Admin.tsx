import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { LOGO_URL } from "@/lib/brand";
import AdminLogin from "@/components/admin/AdminLogin";
import LicenseForm from "@/components/admin/LicenseForm";
import HistoryPanel from "@/components/admin/HistoryPanel";
import MachinesPanel from "@/components/admin/MachinesPanel";
import ReleasesPanel from "@/components/admin/ReleasesPanel";
import {
  clearToken,
  deleteLicense,
  getToken,
  listLicenses,
  logout,
  type License,
  type Stats,
} from "@/lib/adminApi";
import { toast } from "@/hooks/use-toast";

const today = () => new Date().toISOString().slice(0, 10);

const statusOf = (l: License) => {
  if (l.status === "blocked")
    return {
      label: "Заблокирована",
      cls: "bg-destructive text-destructive-foreground",
    };
  if (l.valid_until < today())
    return { label: "Истекла", cls: "bg-foreground text-background" };
  return { label: "Активна", cls: "bg-primary text-primary-foreground" };
};

const Admin = () => {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [items, setItems] = useState<License[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    active: 0,
    expired: 0,
    blocked: 0,
  });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<{ open: boolean; item: License | null }>({
    open: false,
    item: null,
  });
  const [tab, setTab] = useState<"licenses" | "history" | "releases">("licenses");
  const [histFor, setHistFor] = useState<License | null>(null);
  const [machFor, setMachFor] = useState<License | null>(null);

  const load = useCallback(async (q = "") => {
    setLoading(true);
    try {
      const res = await listLicenses(q);
      setItems(res.items.filter((i) => i.status !== "deleted"));
      setStats(res.stats);
      return true;
    } catch {
      toast({ title: "Не удалось загрузить список" });
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Отдельная проверка входа не нужна: загрузка списка сама покажет,
  // действует ли вход. Это экономит один запрос при каждом открытии
  useEffect(() => {
    if (!getToken()) {
      setAuthed(false);
      return;
    }
    listLicenses("")
      .then((res) => {
        setItems(res.items.filter((i) => i.status !== "deleted"));
        setStats(res.stats);
        setAuthed(true);
      })
      .catch(() => {
        clearToken();
        setAuthed(false);
      });
  }, []);

  const remove = async (l: License) => {
    if (!window.confirm(`Удалить лицензию «${l.org_name}»?`)) return;
    await deleteLicense(l.id);
    setItems((list) => list.filter((x) => x.id !== l.id));
    toast({ title: "Лицензия удалена" });
  };

  const exit = async () => {
    await logout().catch(() => undefined);
    clearToken();
    setAuthed(false);
  };

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <Icon
          name="LoaderCircle"
          size={28}
          className="animate-spin text-primary"
        />
      </div>
    );
  }

  if (!authed) {
    return (
      <AdminLogin
        onDone={() => {
          setAuthed(true);
          load();
        }}
      />
    );
  }

  const cards = [
    { label: "Всего", value: stats.total, icon: "KeyRound" },
    { label: "Активных", value: stats.active, icon: "CircleCheck" },
    { label: "Истёкших", value: stats.expired, icon: "Clock" },
    { label: "Заблокировано", value: stats.blocked, icon: "Ban" },
  ];

  return (
    <div className="min-h-screen bg-background font-body text-foreground">
      <header className="border-b border-foreground bg-background">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-3 px-5">
          <img src={LOGO_URL} alt="" className="h-7 w-auto" />
          <span className="font-head text-[0.76rem] font-bold uppercase tracking-[0.12em]">
            Панель лицензий
          </span>
          <a
            href="/"
            className="ml-auto hidden items-center gap-2 border border-border px-3 py-2 text-[0.78rem] transition-colors hover:border-foreground sm:inline-flex"
          >
            <Icon name="ExternalLink" size={14} />К программе
          </a>
          <button
            onClick={exit}
            className="inline-flex items-center gap-2 border border-foreground px-3 py-2 font-head text-[0.7rem] font-bold uppercase tracking-[0.1em] transition-colors hover:bg-foreground hover:text-background"
          >
            <Icon name="LogOut" size={14} />
            Выйти
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-5 py-8">
        <div className="grid grid-cols-2 border-l border-t border-border lg:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label} className="border-b border-r border-border p-5">
              <Icon name={c.icon} size={18} className="text-primary" />
              <div className="mt-3 font-head text-[1.8rem] font-black leading-none">
                {c.value}
              </div>
              <div className="mt-1 text-[0.78rem] uppercase tracking-[0.1em] text-muted-foreground">
                {c.label}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex border border-border">
          {(
            [
              ["licenses", "Лицензии"],
              ["history", "История проверок"],
              ["releases", "Версии программы"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 py-3 font-head text-[0.74rem] font-bold uppercase tracking-[0.08em] transition-colors ${
                tab === id ? "bg-foreground text-background" : "hover:bg-card"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "releases" ? (
          <ReleasesPanel />
        ) : tab === "history" ? (
          <div className="mt-6">
            <HistoryPanel />
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div className="flex flex-1 items-center border border-border bg-background">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && load(search)}
                  placeholder="Поиск по организации или ключу"
                  className="w-full bg-transparent px-3 py-3 text-[0.9rem] outline-none"
                />
                <button
                  className="px-3 py-3 text-primary hover:bg-card"
                  onClick={() => load(search)}
                >
                  <Icon name="Search" size={16} />
                </button>
              </div>
              <button
                className="btn-block"
                onClick={() => setForm({ open: true, item: null })}
              >
                <Icon name="Plus" size={16} />
                Новая лицензия
              </button>
            </div>

            <div className="mt-6 overflow-x-auto border border-border">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-card">
                    {[
                      "Организация",
                      "Ключ активации",
                      "Действует до",
                      "Мест",
                      "Проверок",
                      "Статус",
                      "",
                    ].map((h) => (
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
                  {loading && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-10 text-center text-muted-foreground"
                      >
                        <Icon
                          name="LoaderCircle"
                          size={20}
                          className="mx-auto animate-spin text-primary"
                        />
                      </td>
                    </tr>
                  )}
                  {!loading && !items.length && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-12 text-center text-muted-foreground"
                      >
                        Лицензий пока нет — создайте первую
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    items.map((l) => {
                      const s = statusOf(l);
                      return (
                        <tr
                          key={l.id}
                          className="border-b border-border transition-colors last:border-0 hover:bg-card"
                        >
                          <td className="px-4 py-3">
                            <div className="font-head text-[0.9rem] font-bold">
                              {l.org_name}
                            </div>
                            {l.contact && (
                              <div className="text-[0.78rem] text-muted-foreground">
                                {l.contact}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => {
                                navigator.clipboard?.writeText(l.license_key);
                                toast({ title: "Ключ скопирован" });
                              }}
                              className="group flex items-center gap-2 font-head text-[0.82rem] font-bold tracking-[0.05em]"
                              title="Скопировать"
                            >
                              {l.license_key}
                              <Icon
                                name="Copy"
                                size={13}
                                className="opacity-0 group-hover:opacity-60"
                              />
                            </button>
                          </td>
                          <td className="px-4 py-3 text-[0.86rem]">
                            {l.valid_until}
                          </td>
                          <td className="px-4 py-3 text-[0.86rem]">
                            {l.seats}
                          </td>
                          <td className="px-4 py-3 text-[0.86rem] text-muted-foreground">
                            {l.activations}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block px-2 py-1 font-head text-[0.68rem] font-bold uppercase tracking-[0.08em] ${s.cls}`}
                            >
                              {s.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => setMachFor(l)}
                                className="p-2 hover:text-primary"
                                title="Компьютеры лицензии"
                              >
                                <Icon name="MonitorSmartphone" size={15} />
                              </button>
                              <button
                                onClick={() => setHistFor(l)}
                                className="p-2 hover:text-primary"
                                title="История проверок"
                              >
                                <Icon name="History" size={15} />
                              </button>
                              <button
                                onClick={() => setForm({ open: true, item: l })}
                                className="p-2 hover:text-primary"
                                title="Изменить"
                              >
                                <Icon name="Pencil" size={15} />
                              </button>
                              <button
                                onClick={() => remove(l)}
                                className="p-2 hover:text-destructive"
                                title="Удалить"
                              >
                                <Icon name="Trash2" size={15} />
                              </button>
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
      </main>

      {machFor && (
        <MachinesPanel
          licenseId={machFor.id}
          title={machFor.org_name}
          seats={machFor.seats}
          onClose={() => setMachFor(null)}
        />
      )}

      {histFor && (
        <HistoryPanel
          licenseId={histFor.id}
          title={`История: ${histFor.org_name}`}
          onClose={() => setHistFor(null)}
        />
      )}

      {form.open && (
        <LicenseForm
          item={form.item}
          onClose={() => setForm({ open: false, item: null })}
          onSaved={() => {
            setForm({ open: false, item: null });
            load(search);
          }}
        />
      )}
    </div>
  );
};

export default Admin;