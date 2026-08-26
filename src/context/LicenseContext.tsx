import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { verifyKey } from '@/lib/adminApi';
import {
  clearNativeLicense,
  desktopVersion,
  isDesktop,
  machineId,
  machineName,
  nativeIsFull,
  nativeLicense,
  onNativeLicense,
  saveNativeLicense,
} from '@/lib/desktop';
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

const daysTo = (until: string) =>
  until ? Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 86_400_000)) : 0;

// В программе состояние лицензии приходит из неё самой
const fromNative = (): LicenseState | null => {
  const l = nativeLicense();
  if (!l || !l.key) return null;
  return { key: l.key, org: l.org, validUntil: l.until, daysLeft: daysTo(l.until) };
};

export const LicenseProvider = ({ children }: { children: React.ReactNode }) => {
  const desktop = isDesktop();

  const [license, setLicense] = useState<LicenseState | null>(() =>
    desktop ? fromNative() : null,
  );
  // В программе решение о полной версии принимает она сама
  const [nativeFull, setNativeFull] = useState(() => desktop && nativeIsFull());
  const [checking, setChecking] = useState(true);

  // Программа сообщает о смене состояния лицензии
  useEffect(() => {
    if (!desktop) return;
    return onNativeLicense((s) => {
      setNativeFull(s.full);
      setLicense(
        s.key ? { key: s.key, org: s.org, validUntil: s.until, daysLeft: daysTo(s.until) } : null,
      );
    });
  }, [desktop]);

  useEffect(() => {
    // В браузере лицензия хранится на месте, в программе — в ней самой
    const saved = desktop ? fromNative() : readStored();
    if (!saved) {
      setChecking(false);
      return;
    }
    if (!desktop) setLicense(saved);

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
    verifyKey(saved.key, desktopVersion() || APP_VERSION, machineId(), machineName())
      .then((r) => {
        localStorage.setItem(CHECKED_AT, String(Date.now()));
        if (r.update) saveUpdateInfo(r.update);

        // Подписанный ответ передаём программе: она проверит подпись
        // и сама решит, оставлять ли полную версию
        if (desktop && r.signed) {
          saveNativeLicense(r.signed.payload, r.signed.sig);
          if (!r.valid) clearNativeLicense();
          return;
        }

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
  }, [desktop]);

  const activate = useCallback(
    async (key: string) => {
      const clean = key.trim().toUpperCase();
      if (!clean) return { ok: false, message: 'Введите ключ активации' };
      try {
        const r = await verifyKey(clean, desktopVersion() || APP_VERSION, machineId(), machineName());
        if (r.update) saveUpdateInfo(r.update);
        if (!r.valid) return { ok: false, message: r.reason || 'Ключ недействителен' };

        // В программе ключ включает полную версию только после того,
        // как она сама проверит подпись сервера
        if (desktop) {
          if (!r.signed) {
            return { ok: false, message: 'Сервер вернул ответ без подписи. Обновите программу' };
          }
          saveNativeLicense(r.signed.payload, r.signed.sig);
          localStorage.setItem(CHECKED_AT, String(Date.now()));
          return { ok: true, message: `Полная версия активирована для «${r.org_name || ''}»` };
        }

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
        return {
          ok: false,
          message: 'Не удалось проверить ключ. Проверьте подключение к интернету',
        };
      }
    },
    [desktop],
  );

  const deactivate = useCallback(() => {
    localStorage.removeItem(STORE);
    localStorage.removeItem(CHECKED_AT);
    if (desktop) clearNativeLicense();
    setLicense(null);
  }, [desktop]);

  // Остаток дней считаем по дате окончания, а не по данным последней
  // проверки: между обращениями к серверу проходит до месяца
  const shown = useMemo(() => {
    if (!license) return null;
    if (!license.validUntil) return license;
    return { ...license, daysLeft: daysTo(license.validUntil) };
  }, [license]);

  // В программе слово за ней: правка памяти браузера полную версию
  // больше не включает. В браузере — по сроку из сохранённых данных
  const isFull = desktop ? nativeFull : !!shown && (!shown.validUntil || shown.daysLeft > 0);

  const value = useMemo(
    () => ({ license: shown, isFull, checking, activate, deactivate }),
    [shown, isFull, checking, activate, deactivate],
  );

  return <LicCtx.Provider value={value}>{children}</LicCtx.Provider>;
};

const readStored = (): LicenseState | null => {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as LicenseState) : null;
  } catch {
    localStorage.removeItem(STORE);
    return null;
  }
};

export const useLicense = () => {
  const ctx = useContext(LicCtx);
  if (!ctx) throw new Error('useLicense must be used inside LicenseProvider');
  return ctx;
};
