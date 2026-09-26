// Шифрование платного модуля после сборки.
//
// Модуль распознавания не попадает в программу в открытом виде: файл
// шифруется этим ключом, а сам ключ выдаёт сервер и только по действующей
// лицензии. Снять замок правкой программы нельзя — нужного кода в ней нет.
//
// Запуск: node scripts/encrypt-module.mjs <папка-сборки> <ключ>

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [, , outDir = 'dist-desktop', secret = ''] = process.argv;

if (!secret) {
  console.error('ERROR: module key is empty - OCR module stays unprotected.');
  process.exit(1);
}

// Проверка комплектности распознавания. Движок подгружает ядро по строго
// определённым именам, и нехватка даже одного файла тихо ломает разбор:
// программа думает, что работает, а текст не появляется. Уже наступали на
// это — теперь сборка падает сразу, а не у пользователя
const OCR_FILES = [
  'tessdata/rus.traineddata.gz',
  'tessdata/eng.traineddata.gz',
  'tessdata/worker.min.js',
  'tessdata/core/tesseract-core-simd-lstm.wasm',
  'tessdata/core/tesseract-core-simd-lstm.wasm.js',
  'tessdata/core/tesseract-core-lstm.wasm',
  'tessdata/core/tesseract-core-lstm.wasm.js',
];

const missing = OCR_FILES.filter((f) => !existsSync(join(outDir, f)));

if (missing.length) {
  console.error('ERROR: OCR files are missing from the build:');
  for (const f of missing) console.error(`       ${f}`);
  process.exit(1);
}

const assets = join(outDir, 'assets');

let files;
try {
  files = readdirSync(assets);
} catch {
  console.error(`ERROR: build folder not found: ${assets}`);
  process.exit(1);
}

// Модуль уже защищён — так бывает при повторном запуске.
// Это не ошибка: просто выходим, ничего не ломая
if (files.includes('ocr.bin')) {
  console.log('    OCR module already protected - skipping.');
  process.exit(0);
}

// Ищем собранный кусок с модулем распознавания
const target = files.find((f) => /^ocr-.*\.js$/.test(f));

if (!target) {
  console.error('ERROR: OCR module not found in the build.');
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
  `    OCR module protected: ${target} -> ocr.bin (${(out.length / 1024).toFixed(0)} KB)`,
);