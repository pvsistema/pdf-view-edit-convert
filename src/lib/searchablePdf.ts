// Сборка PDF, по которому работает поиск.
//
// Так устроен результат промышленных программ распознавания: страница
// выглядит в точности как исходный скан, но под картинкой лежит
// невидимый текстовый слой. Документ можно листать, искать в нём слова,
// копировать текст — при этом печать выглядит как оригинал.
//
// Страницы приходят из двух источников. Сканы разбирает движок и отдаёт
// готовый лист с текстовым слоем. Обычные страницы, где текст и так есть,
// берём из исходного документа без изменений — портить их незачем.

import { PDFDocument } from 'pdf-lib';

// Склейка страниц в один документ.
//
// pieces — готовые листы от движка (пусто там, где страница обычная),
// original — исходный файл, srcIndex — места этих страниц в нём
export const mergeSearchable = async (
  pieces: (Uint8Array | null)[],
  // Исходные страницы документа — на случай, если среди разобранных
  // попались обычные, где текст уже есть
  original: Uint8Array | null,
  srcIndex: number[],
): Promise<Uint8Array | null> => {
  // Ни одной распознанной страницы — собирать нечего
  if (!pieces.some(Boolean)) return null;

  const out = await PDFDocument.create();
  const base = original ? await PDFDocument.load(original, { ignoreEncryption: true }) : null;
  let added = 0;

  for (let n = 0; n < pieces.length; n++) {
    const piece = pieces[n];

    if (piece) {
      // Лист от движка: уже с картинкой и текстовым слоем под ней
      const src = await PDFDocument.load(piece);
      const copied = await out.copyPages(src, src.getPageIndices());
      for (const p of copied) out.addPage(p);
      added += copied.length;
      continue;
    }

    // Обычная страница — переносим из исходного документа как есть:
    // по ней поиск и так работает, портить её незачем
    const at = srcIndex[n];
    if (!base || at === undefined || at >= base.getPageCount()) continue;

    const copied = await out.copyPages(base, [at]);
    for (const p of copied) out.addPage(p);
    added++;
  }

  if (!added) return null;
  return out.save();
};