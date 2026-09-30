// Связь с фоновым потоком словаря. Словарь загружается один раз
// за время работы программы и дальше отвечает мгновенно
import { MINING_TERMS, readTerms } from '@/lib/spell/terms';

type Result = Record<string, string[] | true>;

let worker: Worker | null = null;
let ready: Promise<boolean> | null = null;
let loadedTerms = '';
let seq = 0;
const waiting = new Map<number, (r: Result) => void>();

const base = () =>
  new URL(`${import.meta.env.BASE_URL}spell`, location.href).href.replace(/\/$/, '');

const start = () => {
  const terms = [...MINING_TERMS, ...readTerms()];
  const mark = terms.join('\n');

  // Список терминов поменялся — словарь перезагружаем с новыми словами
  if (ready && mark === loadedTerms) return ready;
  worker?.terminate();
  loadedTerms = mark;

  worker = new Worker(new URL('./spell.worker.ts', import.meta.url), { type: 'module' });
  ready = new Promise<boolean>((resolve) => {
    worker!.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') resolve(true);
      else if (m.type === 'failed') resolve(false);
      else if (m.type === 'checked') {
        waiting.get(m.id)?.(m.result);
        waiting.delete(m.id);
      }
    };
    worker!.onerror = () => resolve(false);
  });
  worker.postMessage({
    type: 'init',
    aff: `${base()}/ru.aff`,
    dic: `${base()}/ru.dic.pack`,
    terms,
  });
  return ready;
};

// Заранее начинаем загрузку, пока движок распознавания читает лист
export const warmSpeller = () => void start();

// Проверка слов. Если словарь не загрузился — отвечаем пусто,
// распознавание при этом идёт как обычно, просто без исправлений
export const checkWords = async (words: string[]): Promise<Result> => {
  const ok = await start();
  if (!ok || !worker || !words.length) return {};
  const id = ++seq;
  return new Promise<Result>((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ type: 'check', id, words });
    // Подстраховка: словарь не ответил — не держим распознавание
    window.setTimeout(() => {
      if (waiting.has(id)) {
        waiting.delete(id);
        resolve({});
      }
    }, 20000);
  });
};
