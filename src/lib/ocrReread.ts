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
            // «Рамкой» оказались стенки одной буквы («А» в «АНАЛИЗ»), и
            // внутри вычитался её кусок. Прочитанное лежит поверх
            // уверенного слова — это не новый текст
            const onSure = lines.some((l) =>
              (l.words || []).some((k) => {
                if (!k.bbox || isWeak(k) || !(k.text || '').trim()) return false;
                const ox = Math.min(k.bbox.x1, box.x1) - Math.max(k.bbox.x0, box.x0);
                const oy = Math.min(k.bbox.y1, box.y1) - Math.max(k.bbox.y0, box.y0);
                return ox > 0 && oy > 0 && ox * oy > (box.x1 - box.x0) * (box.y1 - box.y0) * 0.5;
              }),
            );
            if (onSure) continue;
            // Сомнительные слова на этом месте заменяем прочитанным
            // Сомнительные слова заменяем прочитанным, только если они
            // лежат там же, где прочитанное, а не просто в той же строке.
            // Раньше «12026» из соседней рамки стирало стоящее рядом «2026»
            for (const k of known)
              if (
                isWeak(k) &&
                k.bbox &&
                k.bbox.y0 < box.y1 &&
                k.bbox.y1 > box.y0 &&
                Math.min(k.bbox.x1, box.x1) - Math.max(k.bbox.x0, box.x0) > (k.bbox.x1 - k.bbox.x0) * 0.5
              )
                k.text = '';
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
        // Каждое новое прочтение заменяет только одно слово. Раньше одно
        // прочтение «сентября 2026» подставлялось в оба слова, и в тексте
        // выходило «сентября 2026 сентября 2026»
        const match = fresh.filter((f) => !used.has(f) && overlap(f.bbox, w.bbox!) > 0.5);
        if (!match.length) {
          // Место уже занято новым прочтением соседнего слова — это слово
          // в нём уже учтено
          const took = fresh.find((f) => used.has(f) && overlap(f.bbox, w.bbox!) > 0.5);
          if (took) {
            // Прочтение соседа захватило и это слово — убираем его, только
            // если оно там действительно есть. Иначе «сентября» съедало
            // стоящее рядом «2026»
            const key = (x: string) => x.toLowerCase().replace(/[^0-9a-zа-яё]/g, '');
            if (key(took.text).includes(key(w.text || '')) && key(w.text || '')) w.text = '';
            else {
              const add = took.text.split(/\s+/).find((x) => /\d/.test(x) && /\d/.test(w.text || ''));
              // Сосед прочитал это место цифрами — берём их
              if (add && key(took.text).length > key(add).length) {
                w.text = add;
                took.text = took.text.replace(add, '').trim();
                w.confidence = took.confidence;
              }
            }
            continue;
          }
          // Сомнительного слова при повторном чтении нет — это линия
          // рамки, прочитанная как буквы. Но настоящее слово из трёх и
          // больше букв не выбрасываем: движок иногда ставит уверенность 0
          // последнему слову строки, прочитав его верно («ЧАСТЬ»)
          const t = w.text || '';
          const wordLike = /^[«"(]?[А-ЯЁа-яёA-Za-z]{3,}[»")]?[.,:;]?$/.test(t);
          // Число («2026», «15.09») оставляем: движок иногда помечает его
          // низкой уверенностью из-за линии рядом, прочитав верно
          const numLike = /^\d[\d.,:/-]*$/.test(t) && t.length >= 2;
          if (!wordLike && !numLike && ((w.confidence ?? 0) < 35 || (lettersOf(t) < 3 && !/\d/.test(t))))
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

      // Слова, которые на целом листе потерялись совсем («222-км»).
      // То, что уже есть в строке, второй раз не добавляем: иначе
      // выходило «Работникам про‹ Работникам»
      const norm = (t: string) => t.toLowerCase().replace(/[^0-9a-zа-яё]/g, '');
      const have = new Set(words.map((w) => norm(w.text || '')).filter(Boolean));
      for (const f of fresh) {
        if (used.has(f)) continue;
        if (words.some((w) => w.bbox && overlap(f.bbox, w.bbox) > 0.3)) continue;
        if (f.text.split(/\s+/).every((t) => have.has(norm(t)))) continue;
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

// Номера пунктов «1.», «2.», «3.» в начале строки.
//
// Одинокую цифру с точкой движок на целом листе читает хуже всего:
// «1.» превращалась в «5 2» с низкой уверенностью и выбрасывалась как
// мусор, а у «3.» терялась точка. Отдельно вырезанный номер движок тоже
// не читает — ему не за что зацепиться. Поэтому вырезаем начало строки
// вместе с первым словом («1. Заместителю») и читаем как одну строку:
// так номер узнаётся уверенно, и берём из прочитанного только его
export const readMarks = async (
  blocks: Block[] | null | undefined,
  page: HTMLCanvasElement,
  reader: Reader,
) => {
  if (!blocks) return;
  type Target = { lead: Word[]; next: Word };
  const targets: Target[] = [];
  for (const b of blocks)
    for (const p of b.paragraphs || [])
      for (const line of p.lines || []) {
        const ws = (line.words || []).filter((w) => w.bbox && (w.text || '').trim());
        if (ws.length < 2) continue;
        const lh = median(ws.map((w) => w.bbox!.y1 - w.bbox!.y0));
        // Ведущие короткие кусочки перед первым настоящим словом
        let k = 0;
        while (k < ws.length - 1 && k < 3 && (ws[k].text || '').trim().length <= 3) k++;
        if (!k) continue;
        const lead = ws.slice(0, k);
        const next = ws[k];
        const gap = next.bbox!.x0 - lead[lead.length - 1].bbox!.x1;
        const t0 = (lead[0].text || '').trim();
        const sure = lead.length === 1 && /^\d{1,2}[.)]$/.test(t0) && (lead[0].confidence ?? 0) >= 85;
        // Номер отделён от текста широким просветом — как в списке
        if (sure || gap < lh * 0.8) continue;
        // Кусочки похожи на номер: цифры или обрывки с низкой уверенностью
        const looksMark = lead.every(
          (w) => /^[\d.,)|:;]+$/.test((w.text || '').trim()) || (w.confidence ?? 0) < 70,
        );
        if (!looksMark) continue;
        targets.push({ lead, next });
      }
  if (!targets.length || targets.length > 60) return;

  await reader.setParameters({ tessedit_pageseg_mode: '7' });
  try {
    for (const t of targets) {
      const lh = t.next.bbox!.y1 - t.next.bbox!.y0;
      const x0 = Math.max(0, Math.min(...t.lead.map((w) => w.bbox!.x0)) - Math.round(lh * 0.5));
      const x1 = Math.min(page.width, t.next.bbox!.x1 + Math.round(lh * 0.2));
      const y0 = Math.max(0, Math.min(...t.lead.map((w) => w.bbox!.y0), t.next.bbox!.y0) - Math.round(lh * 0.3));
      const y1 = Math.min(page.height, Math.max(...t.lead.map((w) => w.bbox!.y1), t.next.bbox!.y1) + Math.round(lh * 0.3));
      if (x1 - x0 < 4 || y1 - y0 < 4) continue;
      const pad = Math.round(lh * 0.8);
      const cut = document.createElement('canvas');
      cut.width = x1 - x0 + pad * 2;
      cut.height = y1 - y0 + pad * 2;
      const ctx = cut.getContext('2d', { alpha: false })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cut.width, cut.height);
      ctx.drawImage(page, x0, y0, x1 - x0, y1 - y0, pad, pad, x1 - x0, y1 - y0);
      const { data } = await reader.recognize(cut, {}, { blocks: true });
      const got: RWord[] = [];
      for (const bb of data.blocks || [])
        for (const p of bb.paragraphs || [])
          for (const l of p.lines || []) for (const w of l.words || []) got.push(w);
      if (got.length < 2) continue;
      // Двоеточие или запятая вместо точки после цифры — та же точка,
      // которую движок разглядел хуже
      const mark = (got[0].text || '').trim().replace(/^(\d{1,2})[:,;]$/, '$1.');
      // Первое слово строки прочитано то же — значит, и номер перед ним
      // прочитан из того же места. Черту между ними («2. — Заместителю»)
      // движок иногда добавляет из просвета — её пропускаем
      const key = (x: string) => x.replace(/[^а-яёa-z]/gi, '').toLowerCase();
      const word = got.slice(1).find((g) => key(g.text || ''));
      const same = !!word && key(word.text || '') === key(t.next.text || '');
      if (!/^\d{1,2}[.)]$/.test(mark) || got[0].confidence < 55 || !same) continue;
      // Ведущие кусочки заменяем одним словом-номером
      const first = t.lead[0];
      first.text = mark;
      first.confidence = Math.max(got[0].confidence, 90);
      first.bbox = {
        x0: Math.min(...t.lead.map((w) => w.bbox!.x0)),
        y0: Math.min(...t.lead.map((w) => w.bbox!.y0)),
        x1: Math.max(...t.lead.map((w) => w.bbox!.x1)),
        y1: t.next.bbox!.y1,
      };
      for (const w of t.lead.slice(1)) w.text = '';
    }
  } finally {
    await reader.setParameters({ tessedit_pageseg_mode: '3' });
  }
};

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// Дочитывание того, что движок на листе пропустил.
//
// Строка на серой плашке или бледная строка в конце страницы порой не
// попадает в текст совсем. Раньше такой кусок уходил в Word картинкой
// («проветривания.» вставлялось рисунком). Здесь каждое такое место
// вырезается и читается отдельно; если прочитались уверенные слова,
// они добавляются в текст листа. Что не прочиталось — остаётся рисунком
export const readMissed = async (
  blocks: Block[] | null | undefined,
  page: HTMLCanvasElement,
  reader: Reader,
  spots: { x0: number; y0: number; x1: number; y1: number }[],
  // Обычная высота строки на листе, в точках
  lineH = 40,
) => {
  if (!blocks || !spots.length) return 0;
  let added = 0;
  try {
    for (const b of spots.slice(0, 30)) {
      // Кусок в одну строку читаем как строку: так движок не ищет в нём
      // абзацы и не теряет одиночное слово
      await reader.setParameters({ tessedit_pageseg_mode: b.y1 - b.y0 < lineH * 1.6 ? '7' : '6' });
      const h = b.y1 - b.y0;
      const pad = Math.round(Math.max(10, h * 0.4));
      const x0 = Math.max(0, b.x0 - pad);
      const y0 = Math.max(0, b.y0 - pad);
      const x1 = Math.min(page.width, b.x1 + pad);
      const y1 = Math.min(page.height, b.y1 + pad);
      if (x1 - x0 < 8 || y1 - y0 < 8) continue;
      const cut = document.createElement('canvas');
      cut.width = x1 - x0 + pad * 2;
      cut.height = y1 - y0 + pad * 2;
      const ctx = cut.getContext('2d', { alpha: false })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cut.width, cut.height);
      ctx.drawImage(page, x0, y0, x1 - x0, y1 - y0, pad, pad, x1 - x0, y1 - y0);
      // Кусок на серой плашке: буквы чуть темнее фона. Растягиваем
      // яркость куска — фон становится белым, буквы чёрными. Поле вокруг
      // куска остаётся белым и растяжку не сбивает
      const im = ctx.getImageData(pad, pad, x1 - x0, y1 - y0);
      const hist = new Uint32Array(256);
      for (let i = 0; i < im.data.length; i += 4)
        hist[(im.data[i] * 0.3 + im.data[i + 1] * 0.59 + im.data[i + 2] * 0.11) | 0]++;
      const total = im.data.length / 4;
      let lo = 0;
      let hi = 255;
      for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.02; lo++);
      for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.4; hi--);
      if (hi - lo > 10) {
        for (let i = 0; i < im.data.length; i += 4) {
          const v = im.data[i] * 0.3 + im.data[i + 1] * 0.59 + im.data[i + 2] * 0.11;
          const o = Math.max(0, Math.min(255, ((v - lo) / (hi - lo)) * 255));
          im.data[i] = im.data[i + 1] = im.data[i + 2] = o;
        }
        ctx.putImageData(im, pad, pad);
      }
      const { data } = await reader.recognize(cut, {}, { blocks: true });
      const lines: Line[] = [];
      for (const bb of data.blocks || [])
        for (const p of bb.paragraphs || [])
          for (const l of p.lines || []) {
            const ws = (l.words || [])
              .filter((w) => (w.text || '').trim() && w.confidence >= 60 && lettersOf(w.text) >= 1)
              .map((w) => ({
                text: w.text.trim(),
                confidence: w.confidence,
                bbox: {
                  x0: w.bbox.x0 - pad + x0,
                  y0: w.bbox.y0 - pad + y0,
                  x1: w.bbox.x1 - pad + x0,
                  y1: w.bbox.y1 - pad + y0,
                },
              }));
            if (!ws.length) continue;
            lines.push({
              text: ws.map((w) => w.text).join(' '),
              words: ws,
              bbox: {
                x0: Math.min(...ws.map((w) => w.bbox.x0)),
                y0: Math.min(...ws.map((w) => w.bbox.y0)),
                x1: Math.max(...ws.map((w) => w.bbox.x1)),
                y1: Math.max(...ws.map((w) => w.bbox.y1)),
              },
            });
          }
      // Текст, а не рисунок: слово из трёх букв, или короткое, но прочитанное
      // уверенно («м», «шт», «120» в ячейке таблицы). Почерк и каракули
      // уверенно не читаются — они останутся рисунком
      const real = (w: Word) =>
        lettersOf(w.text || '') >= 3 ? true : (w.confidence ?? 0) >= 85 && /^[А-ЯЁа-яёA-Za-z0-9.,%-]+$/.test((w.text || '').trim());
      if (!lines.some((l) => (l.words || []).some(real))) continue;
      // Вырезка захватила и уже прочитанные слова рядом («2026 г.» возле
      // рукописной даты) — их второй раз не добавляем
      const old: Bbox[] = [];
      for (const bb of blocks)
        for (const p of bb.paragraphs || [])
          for (const l of p.lines || [])
            for (const w of l.words || []) if (w.bbox && (w.text || '').trim()) old.push(w.bbox);
      const known = (q: Bbox) =>
        old.some((o) => {
          const ox = Math.min(o.x1, q.x1) - Math.max(o.x0, q.x0);
          const oy = Math.min(o.y1, q.y1) - Math.max(o.y0, q.y0);
          return ox > 0 && oy > 0 && ox * oy > (q.x1 - q.x0) * (q.y1 - q.y0) * 0.15;
        });
      for (const l of lines) l.words = (l.words || []).filter((w) => !known(w.bbox!));
      const fresh = lines.filter((l) => (l.words || []).some(real));
      if (!fresh.length) continue;
      blocks.push({ paragraphs: [{ lines: fresh }] });
      added++;
    }
  } finally {
    await reader.setParameters({ tessedit_pageseg_mode: '3' });
  }
  return added;
};
