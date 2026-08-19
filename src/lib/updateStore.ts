import type { UpdateInfo } from '@/lib/adminApi';

export const UPDATE_CHECKED_AT = 'pv_update_checked';
export const UPDATE_CACHED = 'pv_update_info';

// Обновления выходят не каждый день, поэтому сервер спрашиваем раз в сутки.
// Найденное обновление хранится и показывается без повторных обращений
export const UPDATE_EVERY = 24 * 60 * 60 * 1000;

export const saveUpdateInfo = (info: UpdateInfo) => {
  localStorage.setItem(UPDATE_CHECKED_AT, String(Date.now()));
  if (info.update_available) localStorage.setItem(UPDATE_CACHED, JSON.stringify(info));
  else localStorage.removeItem(UPDATE_CACHED);
  window.dispatchEvent(new CustomEvent('pvspdf-update', { detail: info }));
};

export const readUpdateInfo = (): UpdateInfo | null => {
  const raw = localStorage.getItem(UPDATE_CACHED);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UpdateInfo;
  } catch {
    localStorage.removeItem(UPDATE_CACHED);
    return null;
  }
};

export const updateCheckDue = () =>
  Date.now() - Number(localStorage.getItem(UPDATE_CHECKED_AT) || 0) >= UPDATE_EVERY;

// Пока идёт проверка лицензии, сведения о версии придут вместе с ней —
// отдельный запрос в этот момент не нужен
let licenseAsking = false;

export const setLicenseAsking = (v: boolean) => {
  licenseAsking = v;
};

export const isLicenseAsking = () => licenseAsking;