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