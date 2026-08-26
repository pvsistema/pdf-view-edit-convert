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
  const blob = new Blob([code], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
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
  cachedModule = await runModule(code);
  return cachedModule;
};

export const forgetModuleKey = () => {
  cachedKey = null;
  cachedModule = null;
};
