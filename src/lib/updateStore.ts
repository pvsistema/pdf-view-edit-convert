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

// Запрет работы на устаревшей версии. Держим отдельно от сведений
// об обновлении: те живут сутки, а запрет должен пережить перезапуск
// и отключённый интернет — иначе его снимали бы, просто выдернув сеть
const BLOCK_KEY = 'pv_min_version';

export const saveBlock = (info: UpdateInfo) => {
  // Сервер ответил — верим только ему. Снял запрет, значит сняли
  if (info.blocked && info.min_version) {
    localStorage.setItem(BLOCK_KEY, info.min_version);
  } else if (typeof info.blocked === 'boolean') {
    localStorage.removeItem(BLOCK_KEY);
  }
};

// Запомненный запрет: применяем, пока сервер не сказал обратного
export const readBlock = (): string => localStorage.getItem(BLOCK_KEY) || '';

// Версия, которую человек отложил кнопкой «Потом». Ручная проверка
// эту отметку снимает: раз попросили проверить — значит, хотят видеть
export const SKIP_KEY = 'pv_skip_version';

export const forgetSkipped = () => localStorage.removeItem(SKIP_KEY);

export const updateCheckDue = () =>
  Date.now() - Number(localStorage.getItem(UPDATE_CHECKED_AT) || 0) >= UPDATE_EVERY;

// Пока идёт проверка лицензии, сведения о версии придут вместе с ней —
// отдельный запрос в этот момент не нужен
let licenseAsking = false;

export const setLicenseAsking = (v: boolean) => {
  licenseAsking = v;
};

export const isLicenseAsking = () => licenseAsking;