import { useState } from 'react';
import Icon from '@/components/ui/icon';
import { changePassword } from '@/lib/adminApi';
import { toast } from '@/hooks/use-toast';

type Props = { onClose: () => void };

const MIN = 6;

// Смена пароля администратора. Логин остаётся прежним —
// он участвует в проверке, поэтому меняется только пароль
const PasswordForm = ({ onClose }: Props) => {
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const field =
    'mt-2 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary';

  const save = async () => {
    if (pass.length < MIN) {
      setErr(`Пароль должен быть не короче ${MIN} символов`);
      return;
    }
    if (pass !== again) {
      setErr('Пароли не совпадают');
      return;
    }

    setBusy(true);
    setErr('');
    try {
      await changePassword(pass);
      toast({
        title: 'Пароль изменён',
        description: 'Новый пароль понадобится при следующем входе',
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось изменить пароль');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground/50 p-4">
      <div className="w-full max-w-[440px] border border-foreground bg-background">
        <div className="flex items-center justify-between border-b border-foreground bg-foreground px-5 py-3 text-background">
          <span className="font-head text-[0.74rem] font-bold uppercase tracking-[0.12em]">
            Смена пароля
          </span>
          <button onClick={onClose} className="hover:opacity-70">
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="p-5">
          <label className="label-caps">Новый пароль</label>
          <div className="mt-2 flex">
            <input
              type={show ? 'text' : 'password'}
              value={pass}
              onChange={(e) => {
                setPass(e.target.value);
                setErr('');
              }}
              autoFocus
              autoComplete="new-password"
              className="w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
            />
            <button
              onClick={() => setShow((v) => !v)}
              title={show ? 'Скрыть' : 'Показать'}
              className="border border-l-0 border-border px-3 transition-colors hover:bg-card"
            >
              <Icon name={show ? 'EyeOff' : 'Eye'} size={15} />
            </button>
          </div>

          <label className="label-caps mt-4 block">Повторите пароль</label>
          <input
            type={show ? 'text' : 'password'}
            value={again}
            onChange={(e) => {
              setAgain(e.target.value);
              setErr('');
            }}
            autoComplete="new-password"
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className={field}
          />

          <p className="mt-3 text-[0.78rem] leading-relaxed text-muted-foreground">
            Не короче {MIN} символов. Логин остаётся прежним. Другие открытые
            входы в панель продолжат работать до конца своего срока.
          </p>

          {err && (
            <div className="mt-4 flex items-center gap-2 border border-destructive bg-destructive/10 px-3 py-2.5 text-[0.85rem] text-destructive">
              <Icon name="TriangleAlert" size={15} />
              {err}
            </div>
          )}

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

export default PasswordForm;
