import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { verifyKey } from '@/lib/adminApi';
import { desktopVersion } from '@/lib/desktop';
import { APP_VERSION } from '@/lib/brand';
import { saveUpdateInfo } from '@/lib/updateStore';

const STORE = 'pv_license';
const CHECKED_AT = 'pv_license_checked';

// Лицензия проверяется на сервере не чаще раза в сутки:
// программу открывают много раз в день, а срок действия за час не меняется
const CHECK_EVERY = 24 * 60 * 60 * 1000;

export type LicenseState = {
  key: string;
  org: string;
  validUntil: string;
  daysLeft: number;
};

type Ctx = {
  license: LicenseState | null;
  isFull: boolean;
  checking: boolean;
  activate: (key: string) => Promise<{ ok: boolean; message: string }>;
  deactivate: () => void;
};

const LicCtx = createContext<Ctx | null>(null);

export const LicenseProvider = ({ children }: { children: React.ReactNode }) => {
  const [license, setLicense] = useState<LicenseState | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem(STORE);
    if (!raw) {
      setChecking(false);
      return;
    }
    try {
      const saved = JSON.parse(raw) as LicenseState;
      setLicense(saved);

      // Пока срок действия не истёк и с прошлой проверки прошло меньше суток,
      // работаем по сохранённым данным — обращение к серверу не нужно
      const last = Number(localStorage.getItem(CHECKED_AT) || 0);
      const notExpired = !saved.validUntil || new Date(saved.validUntil) > new Date();
      if (notExpired && Date.now() - last < CHECK_EVERY) {
        setChecking(false);
        return;
      }

      // Одним запросом узнаём и о лицензии, и о новой версии программы
      verifyKey(saved.key, desktopVersion() || APP_VERSION)
        .then((r) => {
          localStorage.setItem(CHECKED_AT, String(Date.now()));
          if (r.update) saveUpdateInfo(r.update);
          if (r.valid) {
            const next = {
              key: saved.key,
              org: r.org_name || saved.org,
              validUntil: r.valid_until || saved.validUntil,
              daysLeft: r.days_left ?? 0,
            };
            setLicense(next);
            localStorage.setItem(STORE, JSON.stringify(next));
          } else {
            localStorage.removeItem(STORE);
            localStorage.removeItem(CHECKED_AT);
            setLicense(null);
          }
        })
        .catch(() => undefined)
        .finally(() => setChecking(false));
    } catch {
      localStorage.removeItem(STORE);
      setChecking(false);
    }
  }, []);

  const activate = useCallback(async (key: string) => {
    const clean = key.trim().toUpperCase();
    if (!clean) return { ok: false, message: 'Введите ключ активации' };
    try {
      const r = await verifyKey(clean, desktopVersion() || APP_VERSION);
      if (r.update) saveUpdateInfo(r.update);
      if (!r.valid) return { ok: false, message: r.reason || 'Ключ недействителен' };
      const next: LicenseState = {
        key: clean,
        org: r.org_name || '',
        validUntil: r.valid_until || '',
        daysLeft: r.days_left ?? 0,
      };
      setLicense(next);
      localStorage.setItem(STORE, JSON.stringify(next));
      localStorage.setItem(CHECKED_AT, String(Date.now()));
      return { ok: true, message: `Полная версия активирована для «${next.org}»` };
    } catch {
      return { ok: false, message: 'Не удалось проверить ключ. Проверьте подключение к интернету' };
    }
  }, []);

  const deactivate = useCallback(() => {
    localStorage.removeItem(STORE);
    localStorage.removeItem(CHECKED_AT);
    setLicense(null);
  }, []);

  const value = useMemo(
    () => ({ license, isFull: !!license, checking, activate, deactivate }),
    [license, checking, activate, deactivate],
  );

  return <LicCtx.Provider value={value}>{children}</LicCtx.Provider>;
};

export const useLicense = () => {
  const ctx = useContext(LicCtx);
  if (!ctx) throw new Error('useLicense must be used inside LicenseProvider');
  return ctx;
};