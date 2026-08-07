import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { verifyKey } from '@/lib/adminApi';

const STORE = 'pv_license';

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
      verifyKey(saved.key)
        .then((r) => {
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
      const r = await verifyKey(clean);
      if (!r.valid) return { ok: false, message: r.reason || 'Ключ недействителен' };
      const next: LicenseState = {
        key: clean,
        org: r.org_name || '',
        validUntil: r.valid_until || '',
        daysLeft: r.days_left ?? 0,
      };
      setLicense(next);
      localStorage.setItem(STORE, JSON.stringify(next));
      return { ok: true, message: `Полная версия активирована для «${next.org}»` };
    } catch {
      return { ok: false, message: 'Не удалось проверить ключ. Проверьте подключение к интернету' };
    }
  }, []);

  const deactivate = useCallback(() => {
    localStorage.removeItem(STORE);
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
