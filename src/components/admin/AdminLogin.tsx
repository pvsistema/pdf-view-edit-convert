import { useState } from 'react';
import Icon from '@/components/ui/icon';
import { LOGO_URL } from '@/lib/brand';
import { login, setToken } from '@/lib/adminApi';
import { toast } from '@/hooks/use-toast';

const AdminLogin = ({ onDone }: { onDone: () => void }) => {
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = await login(name.trim(), pass);
      setToken(res.token);
      if (res.first_run) {
        toast({
          title: 'Администратор создан',
          description: 'Это первый вход — логин и пароль сохранены',
        });
      }
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-6 py-16">
      <form onSubmit={submit} className="w-full max-w-[420px] border border-foreground bg-background">
        <div className="flex items-center gap-2.5 border-b border-foreground bg-foreground px-5 py-3 text-background">
          <img src={LOGO_URL} alt="" className="h-6 w-auto" />
          <span className="font-head text-[0.74rem] font-bold uppercase tracking-[0.12em]">
            Панель лицензий
          </span>
        </div>

        <div className="p-6">
          <h1 className="font-head text-[1.5rem] font-black uppercase leading-tight tracking-[-0.02em]">
            Вход администратора
          </h1>
          <p className="mt-2 text-[0.86rem] text-muted-foreground">
            Первый вход создаёт учётную запись автоматически
          </p>

          <label className="label-caps mt-6 block">Логин</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
            className="mt-2 w-full border border-border bg-background px-3 py-3 text-[0.92rem] outline-none focus:border-primary"
          />

          <label className="label-caps mt-4 block">Пароль</label>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            required
            className="mt-2 w-full border border-border bg-background px-3 py-3 text-[0.92rem] outline-none focus:border-primary"
          />

          {err && (
            <div className="mt-4 flex items-center gap-2 border border-destructive bg-destructive/10 px-3 py-2.5 text-[0.85rem] text-destructive">
              <Icon name="TriangleAlert" size={15} />
              {err}
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-block mt-6 w-full justify-center disabled:opacity-50">
            <Icon name={busy ? 'LoaderCircle' : 'LogIn'} size={16} className={busy ? 'animate-spin' : ''} />
            Войти
          </button>
        </div>
      </form>
    </div>
  );
};

export default AdminLogin;
