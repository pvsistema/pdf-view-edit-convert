// Пробный режим: платные инструменты работают несколько раз бесплатно.
// Человек видит настоящий результат на своих файлах и решает, покупать ли.
// Счёт ведём на месте, чтобы пробный режим работал и без интернета

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

export const trialUsed = () => read();

export const trialLeft = () => Math.max(0, TRIAL_LIMIT - read());

export const trialOver = () => trialLeft() === 0;

// Засчитываем попытку только после успешного результата: если файл
// не открылся или обработка сорвалась, попытка не должна пропадать
export const spendTrial = () => {
  const next = Math.min(read() + 1, TRIAL_LIMIT);
  localStorage.setItem(STORE, String(next));
  window.dispatchEvent(new CustomEvent('pv-trial-change'));
  return TRIAL_LIMIT - next;
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