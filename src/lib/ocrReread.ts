// Второй проход по сомнительным строкам — как в FineReader.
//
// Слово, вписанное в рамку бланка («222-км», «24»), движок на целом листе
// читает вместе с линиями рамки и выдаёт мусор с низкой уверенностью или
// вовсе теряет. Здесь строка с сомнительными словами вырезается целиком
// и читается заново как одна строка. Слова нового прочтения, в которых
// движок уверен, заменяют сомнительные и дополняют потерянные.

type Bbox = { x0: number; y0: number; x1: number; y1: number };
type Word = { text?: string; confidence?: number; bbox?: Bbox };
type Line = { text?: string; words?: Word[]; bbox?: Bbox };
type Block = { paragraphs?: { lines?: Line[] }[] };

type RWord = { text: string; confidence: number; bbox: Bbox };
type Reader = {
  recognize: (
    img: HTMLCanvasElement,
    opts?: object,
    out?: object,
  ) => Promise<{
    data: {
      blocks?: { paragraphs?: { lines?: { words?: RWord[] }[] }[] }[] | null;
    };
  }>;
  setParameters: (p: Record<string, string>) => Promise<unknown>;
};

const lettersOf = (t: string) => t.replace(/[^0-9a-zа-яё]/gi, '').length;

// Слово, в котором движок сомневается, или знаки рамки вместо букв
const isWeak = (w: Word) => {
  const t = (w.text || '').trim();
  return !!t && ((w.confidence ?? 100) < 70 || /[|[\]]/.test(t));
};

// Чтение того, что внутри рамки. От места слова идём влево и вправо
// до ближайших вертикальных линий (стенок рамки), берём промежуток
// между ними, отступив от линий, и читаем как одну строку
const readFramed = async (
  page: HTMLCanvasElement,
  b: Bbox,
  lh: number,
  reader: Reader,
): Promise<RWord | null> => {
  const ctx = page.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const y0 = Math.max(0, b.y0);
  const y1 = Math.min(page.height, b.y1);
  const h = y1 - y0;
  const scanW = Math.round(lh * 12);
  const sx0 = Math.max(0, b.x0 - scanW);
  const sx1 = Math.min(page.width, b.x1 + scanW);
  if (h < 4 || sx1 - sx0 < 4) return null;
  const img = ctx.getImageData(sx0, y0, sx1 - sx0, h);
  const W = sx1 - sx0;

  // Столбец — стенка рамки, если он тёмный почти по всей высоте слова
  const wall = (x: number) => {
    let dark = 0;
    for (let y = 0; y < h; y++) if (img.data[(y * W + x) * 4] < 140) dark++;
    return dark >= h * 0.8;
  };

  const mid = Math.round((b.x0 + b.x1) / 2) - sx0;
  let l = -1;
  let r = -1;
  for (let x = mid; x >= 0; x--)
    if (wall(x)) {
      l = x;
      break;
    }
  for (let x = mid; x < W; x++)
    if (wall(x)) {
      r = x;
      break;
    }

  // Отступаем от стенок, чтобы линия не попала в вырезку
  const gap = Math.round(lh * 0.15);
  const cx0 = sx0 + (l >= 0 ? l + gap : Math.max(0, b.x0 - sx0 - gap));
  const cx1 = sx0 + (r >= 0 ? r - gap : Math.min(W, b.x1 - sx0 + gap));
  if (cx1 - cx0 < lh * 0.5) return null;

  // По высоте тоже убираем горизонтальные линии рамки: отступаем внутрь
  const cy0 = y0 + Math.round(h * 0.12);
  const cy1 = y1 - Math.round(h * 0.12);
  const pad = Math.round(lh * 0.6);
  const cut = document.createElement('canvas');
  cut.width = cx1 - cx0 + pad * 2;
  cut.height = cy1 - cy0 + pad * 2;
  const cctx = cut.getContext('2d', { alpha: false })!;
  cctx.fillStyle = '#fff';
  cctx.fillRect(0, 0, cut.width, cut.height);
  cctx.drawImage(page, cx0, cy0, cx1 - cx0, cy1 - cy0, pad, pad, cx1 - cx0, cy1 - cy0);

  const { data } = await reader.recognize(cut, {}, { blocks: true });
  const words: RWord[] = [];
  for (const bb of data.blocks || [])
    for (const p of bb.paragraphs || [])
      for (const ln of p.lines || []) for (const w of ln.words || []) words.push(w);
  const text = words
    .map((w) => (w.text || '').replace(/[|[\]]/g, '').trim())
    .filter(Boolean)
    .join(' ');
  const conf = words.length ? Math.min(...words.map((w) => w.confidence)) : 0;
  if (!text || !lettersOf(text) || conf < 70) return null;
  return {
    text,
    confidence: conf,
    bbox: { x0: cx0, y0: cy0, x1: cx1, y1: cy1 },
  };
};

// Поиск прямоугольных рамок бланка — как зоны в FineReader. Рамка —
// две вертикальные стенки одной высоты, стоящие на одном уровне.
// Вертикальная линия бланка из-за наклона скана рвётся на отрезки,
// поэтому соседние столбцы склеиваем
type Frame = { x0: number; y0: number; x1: number; y1: number };

const findFrames = (page: HTMLCanvasElement, lineH: number): Frame[] => {
  const ctx = page.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  const { width: w, height: h } = page;
  const d = ctx.getImageData(0, 0, w, h).data;
  const minLen = Math.max(20, Math.round(lineH * 1.2));

  // Вертикальные отрезки
  type Seg = { x: number; y0: number; y1: number };
  const segs: Seg[] = [];
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= h; y++) {
      if (y < h && d[(y * w + x) * 4] < 140) run++;
      else {
        if (run >= minLen) segs.push({ x, y0: y - run, y1: y });
        run = 0;
      }
    }
  }

  // Склеиваем отрезки одной линии (соседние столбцы, перекрытие по высоте)
  const walls: Seg[] = [];
  for (const s of segs) {
    const near = walls.find(
      (v) => Math.abs(v.x - s.x) <= 5 && s.y0 <= v.y1 + 6 && s.y1 >= v.y0 - 6,
    );
    if (near) {
      near.y0 = Math.min(near.y0, s.y0);
      near.y1 = Math.max(near.y1, s.y1);
      near.x = Math.round((near.x + s.x) / 2);
    } else walls.push({ ...s });
  }

  // Стенки не выше пяти строк: выше — это край таблицы или поле листа
  const good = walls.filter((v) => v.y1 - v.y0 <= lineH * 6);
  const frames: Frame[] = [];
  for (const a of good)
    for (const b of good) {
      if (b.x <= a.x + lineH * 1.5 || b.x - a.x > w * 0.4) continue;
      const top = Math.max(a.y0, b.y0);
      const bot = Math.min(a.y1, b.y1);
      if (bot - top < lineH * 1.2) continue;
      // Между ними нет другой стенки на этом уровне — это одна рамка
      if (good.some((c) => c.x > a.x + 4 && c.x < b.x - 4 && c.y0 < bot && c.y1 > top)) continue;
      frames.push({ x0: a.x, y0: top, x1: b.x, y1: bot });
    }
  return frames;
};

// Досмотр рамок: всё, что стоит внутри рамки бланка, но не попало в текст
// или попало с сомнением, читается отдельно — только содержимое рамки.
// Так находятся номера документов, коды, числа в клетках
export const readFrames = async (
  blocks: Block[] | null | undefined,
  page: HTMLCanvasElement,
  reader: Reader,
) => {
  if (!blocks) return;
  const lines: Line[] = [];
  for (const b of blocks)
    for (const p of b.paragraphs || []) for (const l of p.lines || []) lines.push(l);
  const heights = lines
    .map((l) => (l.bbox ? l.bbox.y1 - l.bbox.y0 : 0))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const lh = heights[Math.floor(heights.length / 2)] || 40;

  const frames = findFrames(page, lh);
  if (!frames.length || frames.length > 30) return;

  const inside = (w: Word, f: Frame) =>
    !!w.bbox &&
    (w.bbox.x0 + w.bbox.x1) / 2 > f.x0 &&
    (w.bbox.x0 + w.bbox.x1) / 2 < f.x1 &&
    (w.bbox.y0 + w.bbox.y1) / 2 > f.y0 &&
    (w.bbox.y0 + w.bbox.y1) / 2 < f.y1;

  // Рамка бланка — это одна строка: так движок не ищет в ней абзацы
  await reader.setParameters({ tessedit_pageseg_mode: '7' });
  try {
    for (const f of frames) {
      const known = lines.flatMap((l) => (l.words || []).filter((w) => inside(w, f)));
      // Слова, уже прочитанные уверенно, не повторяем; рамку досматриваем
      // всегда: в неё краем может попасть подпись соседнего поля
      const sure = new Set(known.filter((w) => !isWeak(w)).map((w) => (w.text || '').trim()));

      const gap = Math.round(lh * 0.2);
      const x0 = f.x0 + gap;
      const x1 = f.x1 - gap;
      const y0 = f.y0 + gap;
      const y1 = f.y1 - gap;
      if (x1 - x0 < lh || y1 - y0 < lh * 0.6) continue;

      const pad = Math.round(lh * 0.6);
      const cut = document.createElement('canvas');
      cut.width = x1 - x0 + pad * 2;
      cut.height = y1 - y0 + pad * 2;
      const cctx = cut.getContext('2d', { alpha: false })!;
      cctx.fillStyle = '#fff';
      cctx.fillRect(0, 0, cut.width, cut.height);
      cctx.drawImage(page, x0, y0, x1 - x0, y1 - y0, pad, pad, x1 - x0, y1 - y0);

      const { data } = await reader.recognize(cut, {}, { blocks: true });
      for (const bb of data.blocks || [])
        for (const p of bb.paragraphs || [])
          for (const ln of p.lines || []) {
            const ws = (ln.words || [])
              .map((w) => ({
                ...w,
                text: (w.text || '').replace(/[|[\]]/g, '').trim(),
              }))
              .filter(
                (w) => w.text && lettersOf(w.text) && w.confidence >= 60 && !sure.has(w.text),
              );
            if (!ws.length) continue;
            const box: Bbox = {
              x0: Math.min(...ws.map((w) => w.bbox.x0)) - pad + x0,
              y0: Math.min(...ws.map((w) => w.bbox.y0)) - pad + y0,
              x1: Math.max(...ws.map((w) => w.bbox.x1)) - pad + x0,
              y1: Math.max(...ws.map((w) => w.bbox.y1)) - pad + y0,
            };
            const text = ws.map((w) => w.text).join(' ');
            // Уже есть такое слово в тексте — не повторяем
            const same = known.find((k) => (k.text || '').replace(/[|[\]]/g, '').trim() === text);
            if (same) continue;
            // Сомнительные слова на этом месте заменяем прочитанным
            for (const k of known)
              if (isWeak(k) && k.bbox && k.bbox.y0 < box.y1 && k.bbox.y1 > box.y0) k.text = '';
            lines.push({
              text,
              bbox: box,
              words: [{ text, confidence: 90, bbox: box }],
            });
            blocks.push({ paragraphs: [{ lines: [lines[lines.length - 1]] }] });
          }
    }
  } finally {
    await reader.setParameters({ tessedit_pageseg_mode: '3' });
  }
};

export const rereadWeak = async (
  blocks: Block[] | null | undefined,
  page: HTMLCanvasElement,
  reader: Reader,
) => {
  if (!blocks) return;
  const lines: Line[] = [];
  for (const b of blocks)
    for (const p of b.paragraphs || []) for (const l of p.lines || []) lines.push(l);

  // Строки с сомнениями, но не сплошной мусор (герб, печать, подпись):
  // хотя бы половина слов должна быть прочитана уверенно
  const targets = lines.filter((l) => {
    const ws = (l.words || []).filter((w) => (w.text || '').trim());
    const weak = ws.filter(isWeak).length;
    return l.bbox && weak > 0 && ws.length >= 2 && weak <= ws.length / 2 + 0.5;
  });
  if (!targets.length || targets.length > 40) return;

  await reader.setParameters({ tessedit_pageseg_mode: '7' });
  try {
    for (const line of targets) {
      const b = line.bbox!;
      const lh = b.y1 - b.y0;
      const padY = Math.round(lh * 0.3);
      const x0 = Math.max(0, b.x0 - Math.round(lh * 0.5));
      const y0 = Math.max(0, b.y0 - padY);
      const x1 = Math.min(page.width, b.x1 + Math.round(lh * 0.5));
      const y1 = Math.min(page.height, b.y1 + padY);
      if (x1 - x0 < 4 || y1 - y0 < 4) continue;

      const pad = Math.round(lh * 0.6);
      const cut = document.createElement('canvas');
      cut.width = x1 - x0 + pad * 2;
      cut.height = y1 - y0 + pad * 2;
      const cctx = cut.getContext('2d', { alpha: false })!;
      cctx.fillStyle = '#fff';
      cctx.fillRect(0, 0, cut.width, cut.height);
      cctx.drawImage(page, x0, y0, x1 - x0, y1 - y0, pad, pad, x1 - x0, y1 - y0);

      const { data } = await reader.recognize(cut, {}, { blocks: true });
      const fresh: RWord[] = [];
      for (const bb of data.blocks || [])
        for (const p of bb.paragraphs || [])
          for (const l of p.lines || [])
            for (const w of l.words || []) {
              const t = (w.text || '').replace(/[|[\]]/g, '').trim();
              if (!t || !lettersOf(t) || w.confidence < 70) continue;
              // Обратно в координаты листа
              fresh.push({
                text: t,
                confidence: w.confidence,
                bbox: {
                  x0: w.bbox.x0 - pad + x0,
                  y0: w.bbox.y0 - pad + y0,
                  x1: w.bbox.x1 - pad + x0,
                  y1: w.bbox.y1 - pad + y0,
                },
              });
            }
      const words = line.words || [];
      const overlap = (a: Bbox, c: Bbox) =>
        Math.max(0, Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0)) /
        Math.max(1, Math.min(a.x1 - a.x0, c.x1 - c.x0));

      // Слово в рамке («[24», «|222-км|») строка целиком не прочтёт:
      // линии рамки сбивают движок. Такое слово читаем отдельно — только
      // то, что внутри рамки
      for (const w of words) {
        if (!w.bbox || !isWeak(w) || fresh.some((f) => overlap(f.bbox, w.bbox!) > 0.5)) continue;
        const inside = await readFramed(page, w.bbox, lh, reader);
        if (inside) fresh.push(inside);
      }
      if (!fresh.length) continue;

      const used = new Set<RWord>();
      for (const w of words) {
        if (!w.bbox || !isWeak(w)) continue;
        const match = fresh.filter((f) => overlap(f.bbox, w.bbox!) > 0.5);
        if (!match.length) {
          // Сомнительного слова при повторном чтении нет — это линия
          // рамки, прочитанная как буквы
          if ((w.confidence ?? 0) < 35 || (lettersOf(w.text || '') < 3 && !/\d/.test(w.text || '')))
            w.text = '';
          continue;
        }
        const best = [...match].sort((a, c) => c.confidence - a.confidence)[0];
        // Не теряем буквы в словах, прочитанных почти уверенно
        if ((w.confidence ?? 0) >= 50 && lettersOf(best.text) < lettersOf(w.text || '')) continue;
        w.text = match.map((m) => m.text).join(' ');
        w.confidence = best.confidence;
        match.forEach((m) => used.add(m));
      }

      // Слова, которые на целом листе потерялись совсем («222-км»)
      for (const f of fresh) {
        if (used.has(f)) continue;
        if (words.some((w) => w.bbox && overlap(f.bbox, w.bbox) > 0.3)) continue;
        words.push({ text: f.text, confidence: f.confidence, bbox: f.bbox });
      }
      words.sort((a, c) => (a.bbox?.x0 ?? 0) - (c.bbox?.x0 ?? 0));
      line.words = words;
    }
  } finally {
    // Возвращаем обычный режим движка: разбор листа с поиском колонок
    await reader.setParameters({ tessedit_pageseg_mode: '3' });
  }
};
