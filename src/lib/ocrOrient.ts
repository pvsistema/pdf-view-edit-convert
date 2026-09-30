// Определение ориентации листа перед распознаванием.
//
// Лист, вставленный в сканер вверх ногами или боком, движок читает как
// мусор: сам он выправляет только лёгкий перекос в пару градусов.
// Здесь берётся полоса из середины листа, уменьшенная вдвое, и пробно
// читается в четырёх поворотах. Верный поворот узнаётся сразу: в нём
// движок уверен и находит настоящие слова, в остальных — обрывки.
//
// Отдельный файл определения ориентации (osd) не нужен: он требует
// старого движка и добавил бы к программе ещё 10 МБ. Пробное чтение
// обходится тем же движком, что уже загружен

type Reader = {
  recognize: (
    img: HTMLCanvasElement,
    opts?: object,
    out?: object,
  ) => Promise<{ data: { text?: string; confidence?: number } }>;
  setParameters: (p: Record<string, string>) => Promise<unknown>;
};

export type Turn = 0 | 90 | 180 | 270;

// Поворот листа по часовой стрелке на кратный 90° угол
export const turnCanvas = (src: HTMLCanvasElement, deg: Turn) => {
  if (!deg) return src;
  const side = deg === 90 || deg === 270;
  const out = document.createElement('canvas');
  out.width = side ? src.height : src.width;
  out.height = side ? src.width : src.height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
};

// Полоса из середины листа, вдвое мельче: для опознания ориентации
// хватает с запасом, а читается в разы быстрее целого листа
const probeOf = (src: HTMLCanvasElement) => {
  const w = Math.round(src.width * 0.8);
  const h = Math.round(src.height * 0.25);
  const out = document.createElement('canvas');
  out.width = Math.round(w / 2);
  out.height = Math.round(h / 2);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, src.width * 0.1, src.height * 0.3, w, h, 0, 0, out.width, out.height);
  return out;
};

// Оценка прочтения: уверенность движка и число настоящих слов —
// от трёх букв подряд. В перевёрнутом листе движок тоже «видит» буквы,
// но слов из них не складывается
const scoreOf = (text: string, conf: number) =>
  conf * Math.sqrt((text.match(/[А-Яа-яЁёA-Za-z]{3,}/g) || []).length + 1);

// Верная ориентация листа. На пустом листе или картинке без текста
// возвращает 0 — лист оставляем как есть
export const detectTurn = async (page: HTMLCanvasElement, reader: Reader, dpi: number) => {
  const probe = probeOf(page);
  await reader.setParameters({
    tessedit_pageseg_mode: '3',
    user_defined_dpi: String(Math.round(dpi / 2)),
  });

  const read = async (deg: Turn) => {
    const { data } = await reader.recognize(turnCanvas(probe, deg), {}, { text: true });
    return scoreOf(data.text || '', data.confidence ?? 0);
  };

  try {
    // Прямой лист — самый частый случай. Если он читается уверенно,
    // остальные повороты не пробуем и время не тратим
    const straight = await read(0);
    if (straight > 280) return 0 as Turn;

    const tries: [Turn, number][] = [[0, straight]];
    for (const deg of [90, 180, 270] as Turn[]) tries.push([deg, await read(deg)]);
    tries.sort((a, b) => b[1] - a[1]);

    // Поворачиваем, только если выигрыш явный: на листе без текста
    // все повороты читаются одинаково плохо
    const [best, second] = tries;
    if (best[0] !== 0 && best[1] > second[1] * 1.3 && best[1] > straight * 1.5) return best[0];
    return 0 as Turn;
  } finally {
    await reader.setParameters({ user_defined_dpi: String(dpi) });
  }
};
// Лёгкий перекос листа (доли градуса — лист лёг в сканер неровно).
//
// Движок распознавания сам выравнивает такой лист у себя внутри, но места
// слов отдаёт уже на выровненной картинке. А линии, подчёркивания и
// рисунки программа ищет на своей картинке — невыровненной. Места не
// совпадали: края букв торчали из рамок слов и принимались за рисунки.
// Поэтому лист выравниваем сами, до распознавания, — тогда картинка
// у движка и у программы одна и та же.
//
// Угол ищем по строкам: поворачиваем уменьшенную копию на пробные углы
// и считаем, насколько резко чередуются тёмные строки и светлые
// просветы. У ровного листа разница самая большая
export const detectSkew = (src: HTMLCanvasElement) => {
  const scale = Math.min(1, 900 / Math.max(src.width, src.height));
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.fillStyle = '#fff';
  sctx.fillRect(0, 0, w, h);
  sctx.drawImage(src, 0, 0, w, h);
  const px = sctx.getImageData(0, 0, w, h).data;
  const ink: { x: number; y: number }[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11 < 128) ink.push({ x, y });
    }
  if (ink.length < 200) return 0;

  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const bins = new Float32Array(h + w);
    for (const p of ink) {
      const y = Math.round(p.y * cos - p.x * sin + w);
      if (y >= 0 && y < bins.length) bins[y]++;
    }
    let sum = 0;
    for (let k = 1; k < bins.length; k++) sum += (bins[k] - bins[k - 1]) ** 2;
    return sum;
  };

  let best = 0;
  let bestScore = score(0);
  for (let d = -3; d <= 3.001; d += 0.25) {
    const sc = score(d);
    if (sc > bestScore) {
      bestScore = sc;
      best = d;
    }
  }
  // Уточняем шагом в двадцатую долю градуса
  const coarse = best;
  for (let d = coarse - 0.25; d <= coarse + 0.25; d += 0.05) {
    const sc = score(d);
    if (sc > bestScore) {
      bestScore = sc;
      best = d;
    }
  }
  return Math.abs(best) < 0.1 ? 0 : best;
};

// Поворот листа на небольшой угол. Углы, открывшиеся при повороте,
// заливаем цветом бумаги, а не чёрным — иначе они стали бы «рисунками»
export const straighten = (src: HTMLCanvasElement, deg: number) => {
  if (!deg) return src;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((-deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
};
