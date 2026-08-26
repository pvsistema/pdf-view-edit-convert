// Шифрование платного модуля после сборки.
//
// Модуль распознавания не попадает в программу в открытом виде: файл
// шифруется этим ключом, а сам ключ выдаёт сервер и только по действующей
// лицензии. Снять замок правкой программы нельзя — нужного кода в ней нет.
//
// Запуск: node scripts/encrypt-module.mjs <папка-сборки> <ключ>

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [, , outDir = 'dist-desktop', secret = ''] = process.argv;

if (!secret) {
  console.error('Не указан ключ модуля. Модуль остаётся незашифрованным.');
  process.exit(1);
}

const assets = join(outDir, 'assets');

let files;
try {
  files = readdirSync(assets);
} catch {
  console.error(`Папка сборки не найдена: ${assets}`);
  process.exit(1);
}

// Модуль уже защищён — так бывает при повторном запуске.
// Это не ошибка: просто выходим, ничего не ломая
if (files.includes('ocr.bin')) {
  console.log('Модуль уже защищён — пропускаем.');
  process.exit(0);
}

// Ищем собранный кусок с модулем распознавания
const target = files.find((f) => /^ocr-.*\.js$/.test(f));

if (!target) {
  console.error('Модуль распознавания в сборке не найден.');
  process.exit(1);
}

const path = join(assets, target);
const plain = readFileSync(path);

// Ключ шифрования выводим из секрета сервера
const key = createHash('sha256').update(secret).digest();
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
const tag = cipher.getAuthTag();

// Складываем всё в один файл: метка, вектор, контрольная сумма, данные
const out = Buffer.concat([Buffer.from('PVOCR1'), iv, tag, enc]);
writeFileSync(join(assets, 'ocr.bin'), out);

// Открытый модуль из сборки убираем
rmSync(path);

console.log(
  `Модуль защищён: ${target} -> ocr.bin (${(out.length / 1024).toFixed(0)} КБ)`,
);