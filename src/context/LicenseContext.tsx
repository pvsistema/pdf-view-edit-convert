import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { verifyKey } from '@/lib/adminApi';
import { desktopVersion } from '@/lib/desktop';
import { APP_VERSION } from '@/lib/brand';
import { saveUpdateInfo, setLicenseAsking } from '@/lib/updateStore';

const STORE = 'pv_license';
const CHECKED_AT = 'pv_license_checked';

// После активации лицензия перепроверяется на сервере раз в месяц:
// срок действия и статус ключа за это время практически не меняются.
// Досрочная проверка запускается, если подходит конец срока
const CHECK_EVERY = 30 * 24 * 60 * 60 * 1000;

// Когда до конца срока остаётся меньше недели, проверяем чаще —
// раз в сутки, чтобы вовремя увидеть продление лицензии
const RENEW_SOON_DAYS = 7;
const CHECK_WHEN_SOON = 24 * 60 * 60 * 1000;

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

      // Работаем по сохранённым данным, пока не пришёл срок перепроверки
      const last = Number(localStorage.getItem(CHECKED_AT) || 0);
      const until = saved.validUntil ? new Date(saved.validUntil).getTime() : 0;
      const expired = !!until && until < Date.now();
      const endsSoon = !!until && until - Date.now() < RENEW_SOON_DAYS * 24 * 60 * 60 * 1000;
      const period = endsSoon ? CHECK_WHEN_SOON : CHECK_EVERY;

      if (!expired && Date.now() - last < period) {
        setChecking(false);
        return;
      }

      // Одним запросом узнаём и о лицензии, и о новой версии программы
      setLicenseAsking(true);
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
        .finally(() => {
          setLicenseAsking(false);
          setChecking(false);
        });
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

  // Остаток дней считаем по дате окончания, а не по данным последней
  // проверки: между обращениями к серверу проходит до месяца
  const shown = useMemo(() => {
    if (!license) return null;
    if (!license.validUntil) return license;
    const days = Math.ceil((new Date(license.validUntil).getTime() - Date.now()) / 86_400_000);
    return { ...license, daysLeft: Math.max(0, days) };
  }, [license]);

  // Когда срок истёк, полные возможности отключаются даже без связи с сервером
  const isFull = !!shown && (!shown.validUntil || shown.daysLeft > 0);

  const value = useMemo(
    () => ({ license: shown, isFull, checking, activate, deactivate }),
    [shown, isFull, checking, activate, deactivate],
  );

  return <LicCtx.Provider value={value}>{children}</LicCtx.Provider>;
};

export const useLicense = () => {
  const ctx = useContext(LicCtx);
  if (!ctx) throw new Error('useLicense must be used inside LicenseProvider');
  return ctx;
};