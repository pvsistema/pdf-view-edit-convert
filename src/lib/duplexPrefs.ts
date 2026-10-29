// Настройки двусторонней печати запоминаются на этом компьютере:
// режим, переплёт и подстройка оборота — отдельно для каждого принтера,
// ведь у каждого аппарата свой сдвиг листа
import type { Duplex } from '@/lib/printLayout';

export type DuplexPrefs = {
  duplex: Duplex;
  // Миллиметры
  gutter: number;
  shiftX: number;
  shiftY: number;
  // Выравнивать текст оборота по тексту лица
  mirror: boolean;
  // Альбомные страницы — боком на книжный лист
  turn: boolean;
  // Ручной режим: обороты печатать в обратном порядке
  reverseBacks: boolean;
  // Переплёт при ручной печати и допечатке оборотов: сбоку или сверху
  edge: 'long' | 'short';
};

export const DUPLEX_DEFAULTS: DuplexPrefs = {
  duplex: 'off',
  gutter: 0,
  shiftX: 0,
  shiftY: 0,
  mirror: true,
  turn: true,
  reverseBacks: true,
  edge: 'long',
};

const KEY = 'pvs-duplex';

const readAll = (): Record<string, Partial<DuplexPrefs>> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
};

export const loadDuplex = (printer: string): DuplexPrefs => {
  const all = readAll();
  return { ...DUPLEX_DEFAULTS, ...(all['*'] || {}), ...(all[printer || '*'] || {}) };
};

export const saveDuplex = (printer: string, p: DuplexPrefs) => {
  try {
    const all = readAll();
    // Режим и переплёт — общие привычки; сдвиг — свойство аппарата
    all['*'] = {
      duplex: p.duplex,
      gutter: p.gutter,
      mirror: p.mirror,
      turn: p.turn,
      reverseBacks: p.reverseBacks,
      edge: p.edge,
    };
    all[printer || '*'] = { ...all['*'], shiftX: p.shiftX, shiftY: p.shiftY };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* хранилище недоступно — настройки просто не запомнятся */
  }
};
