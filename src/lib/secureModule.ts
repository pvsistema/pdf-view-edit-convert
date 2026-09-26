import { getModuleKey } from '@/lib/adminApi';
import { isDesktop, machineId } from '@/lib/desktop';

// Загрузка платного модуля. В программе он лежит зашифрованным, а ключ
// расшифровки выдаёт сервер и только по действующей лицензии. Кода модуля
// в программе нет, поэтому снять замок её правкой не получится

const MARK = 'PVOCR1';
const FILE = './assets/ocr.bin';

// Ключ помним до перезапуска: повторно сервер не тревожим
let cachedKey: string | null = null;
let cachedModule: unknown = null;

export class ModuleLocked extends Error {
  constructor(message = 'Нужна полная версия') {
    super(message);
    this.name = 'ModuleLocked';
  }
}

const keyFromSecret = async (secret: string) => {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
};

const decrypt = async (blob: ArrayBuffer, secret: string) => {
  const bytes = new Uint8Array(blob);

  const mark = new TextDecoder().decode(bytes.slice(0, MARK.length));
  if (mark !== MARK) throw new Error('Файл модуля повреждён');

  let at = MARK.length;
  const iv = bytes.slice(at, at + 12);
  at += 12;
  // Контрольная сумма лежит отдельно, а браузер ждёт её в конце данных
  const tag = bytes.slice(at, at + 16);
  at += 16;
  const data = bytes.slice(at);

  const body = new Uint8Array(data.length + tag.length);
  body.set(data);
  body.set(tag, data.length);

  const key = await keyFromSecret(secret);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body);
  return new TextDecoder().decode(plain);
};

// Запуск расшифрованного кода. Он остаётся в памяти и на диск не попадает
const runModule = async (code: string) => {
  // Модуль запускается из памяти, а внутри он ссылается на соседний
  // служебный файл коротким путём «./файл.js». От памяти такой путь
  // отсчитать нельзя — браузер спотыкается и распознавание не стартует.
  // Поэтому подставляем полный адрес файла на диске программы
  const assets = new URL(`${import.meta.env.BASE_URL}assets/`, location.href).href;
  const fixed = code.replace(
    /(\bfrom\s*|\bimport\s*\(\s*)(["'])\.\/([^"']+\.js)\2/g,
    (_m, head, q, file) => `${head}${q}${assets}${file}${q}`,
  );

  const blob = new Blob([fixed], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
};

// Достаём из модуля функцию, создающую движок распознавания.
//
// Внутри программы модуль собран иначе, чем в браузере: имена укорочены
// до одной буквы, а наружу торчит не сам набор функций, а «обёртка» —
// её нужно сначала вызвать, и только тогда она отдаёт содержимое.
// Раньше код искал строго createWorker, не находил его и распознавание
// молча срывалось. Теперь разбираем оба случая
type WorkerMaker = typeof import('tesseract.js').createWorker;

const pickWorkerMaker = (mod: Record<string, unknown>): WorkerMaker => {
  const find = (o: unknown): unknown =>
    o && typeof o === 'object' && typeof (o as Record<string, unknown>).createWorker === 'function'
      ? (o as Record<string, unknown>).createWorker
      : null;

  // Обычный случай: набор функций лежит прямо в модуле
  const direct = find(mod);
  if (direct) return direct as WorkerMaker;

  // Собранный случай: разворачиваем обёртку и смотрим, что внутри
  for (const value of Object.values(mod)) {
    if (typeof value !== 'function') continue;
    try {
      const inner = find((value as () => unknown)());
      if (inner) return inner as WorkerMaker;
    } catch {
      // не та функция — пробуем следующую
    }
  }

  throw new Error('Модуль распознавания повреждён');
};

export const loadOcrModule = async (licenseKey: string) => {
  if (cachedModule) return cachedModule;

  // В браузере модуль подключается как обычно: платит здесь не защита,
  // а невозможность продать программу без лицензии
  if (!isDesktop()) return import('tesseract.js');

  if (!cachedKey) {
    const r = await getModuleKey('ocr', licenseKey, machineId());
    if (!r.secret) throw new ModuleLocked(r.error || 'Нужна полная версия');
    cachedKey = r.secret;
  }

  const res = await fetch(FILE);
  if (!res.ok) throw new Error('Модуль распознавания не найден');

  const code = await decrypt(await res.arrayBuffer(), cachedKey);
  const mod = (await runModule(code)) as Record<string, unknown>;

  // Наружу отдаём под привычным именем, чтобы остальной код не зависел
  // от того, как сборщик переименовал внутренности модуля
  cachedModule = { createWorker: pickWorkerMaker(mod) };
  return cachedModule;
};

export const forgetModuleKey = () => {
  cachedKey = null;
  cachedModule = null;
};