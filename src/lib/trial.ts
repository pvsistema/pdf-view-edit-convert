// Пробный режим: платные инструменты работают несколько раз бесплатно.
// Человек видит настоящий результат на своих файлах и решает, покупать ли.
// Счёт ведём на месте, чтобы пробный режим работал и без интернета

import { desktopVersion, machineId, machineName } from '@/lib/desktop';
import { APP_VERSION } from '@/lib/brand';

export const TRIAL_LIMIT = 5;

const STORE = 'pv_trial_used';

// Распознавание текста в счёт не входит: его модуль хранится
// зашифрованным, а ключ к нему сервер выдаёт только по лицензии
export const TRIAL_TOOLS = new Set([
  // Боковая панель
  'word',
  'excel',
  'jpg',
  // Окно конвертации
  'to-word',
  'to-excel',
  'to-jpg',
  'to-png',
]);

export const isTrialTool = (id: string) => TRIAL_TOOLS.has(id);

const read = (): number => {
  const n = Number(localStorage.getItem(STORE) || 0);
  return Number.isFinite(n) && n > 0 ? Math.min(n, TRIAL_LIMIT) : 0;
};

// Сервер помнит пробы по компьютеру. Если у него насчитано больше —
// значит счётчик здесь обнулили, и верить надо серверу. Приходит
// попутно с проверкой версии, отдельных обращений не делаем
export const applyServerUsed = (used: number) => {
  if (!Number.isFinite(used) || used <= read()) return;
  localStorage.setItem(STORE, String(Math.min(used, TRIAL_LIMIT)));
  window.dispatchEvent(new CustomEvent('pv-trial-change'));
};

export const trialUsed = () => read();

export const trialLeft = () => Math.max(0, TRIAL_LIMIT - read());

export const trialOver = () => trialLeft() === 0;

// Засчитываем попытку только после успешного результата: если файл
// не открылся или обработка сорвалась, попытка не должна пропадать
export const spendTrial = (tool = '') => {
  const next = Math.min(read() + 1, TRIAL_LIMIT);
  localStorage.setItem(STORE, String(next));
  window.dispatchEvent(new CustomEvent('pv-trial-change'));

  const rest = TRIAL_LIMIT - next;
  report(rest === 0 ? 'limit' : 'used', tool, next);
  return rest;
};

// Сообщаем на сервер в стороне от работы: интернета может не быть,
// и это не повод мешать человеку получить свой файл
const report = (event: 'used' | 'limit', tool: string, used: number) => {
  import('@/lib/adminApi')
    .then((api) =>
      api.sendTrialEvent({
        event,
        tool,
        used,
        machine_id: machineId() || browserId(),
        machine_name: machineName(),
        app_version: desktopVersion() || APP_VERSION,
      }),
    )
    // Сервер отвечает своим счётом — он мог сохранить больше нашего
    .then((r) => applyServerUsed(Number((r as { used?: number })?.used)))
    .catch(() => undefined);
};

// Отпечаток компьютера для запросов: в программе свой, в браузере — наш
export const trialMachineId = () => machineId() || browserId();

// В браузере отпечатка компьютера нет — заводим свой, чтобы
// не считать один и тот же компьютер за десяток разных
const BROWSER_ID = 'pv_trial_id';

const browserId = () => {
  let id = localStorage.getItem(BROWSER_ID) || '';
  if (!id) {
    id = 'web-' + Math.random().toString(36).slice(2, 12);
    localStorage.setItem(BROWSER_ID, id);
  }
  return id;
};

export const onTrialChange = (cb: () => void) => {
  window.addEventListener('pv-trial-change', cb);
  return () => window.removeEventListener('pv-trial-change', cb);
};

// Слово о остатке — так, как его произносят вслух
export const leftWord = (n: number) => {
  const t = n % 10;
  const h = n % 100;
  if (h > 10 && h < 20) return `${n} попыток`;
  if (t === 1) return `${n} попытка`;
  if (t > 1 && t < 5) return `${n} попытки`;
  return `${n} попыток`;
};