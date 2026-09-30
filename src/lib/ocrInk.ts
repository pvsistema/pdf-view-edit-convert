// Разбор того, что на листе не является печатным текстом:
// линии, подчёркивания, герб, рукописные даты и номера, подписи, печати.
//
// Движок распознавания видит только буквы. Всё остальное он либо
// пропускает, либо превращает в мусор, который потом отбрасывается.
// Из-за этого в Word пропадали черта под шапкой бланка, подчёркивание
// «МЧС РОССИИ», герб, вписанные от руки «25 сентября» и «№ 336».
//
// Здесь картинка листа просматривается целиком:
// 1. Находим горизонтальные линии. Линия под словом — подчёркивание,
//    длинная линия сама по себе — черта-разделитель бланка.
// 2. Закрываем всё, что уже прочитано как текст, и линии.
// 3. То, что осталось тёмного, собираем в пятна. Крупное пятно —
//    рисунок: герб, рукопись, подпись, печать. Его вырезаем из скана
//    и ставим в документ картинкой на то же место.

export type Box = { x0: number; y0: number; x1: number; y1: number };

// Линия на листе, в точках картинки
export type HLine = Box & { used?: boolean };

export type Figure = Box & {
  // Пустая черта для заполнения («№ ______») — рисуем подчёркиваниями
  blank: boolean;
};

export type Ink = {
  // Длинные линии-разделители
  rules: HLine[];
  // Номера подчёркнутых слов
  under: Set<number>;
  // Где подчёркивание срезает рамку слова снизу (рамка захватила линию)
  cut: Map<number, number>;
  figures: Figure[];
};

// Порог «тёмного» — по гистограмме листа (метод Оцу): делит бумагу и
// краску так, чтобы разница между ними была наибольшей. Бледная копия
// и синие чернила подписи так тоже считаются краской
const otsu = (hist: Uint32Array, total: number) => {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
};

const median8 = (a: Float32Array) => {
  const s = Array.from(a).sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 255;
};

export const analyzeInk = (
  img: ImageData,
  words: Box[],
  lineH: number,
  // Искать и мелкие пятна — с одну букву («м» в ячейке таблицы). Нужно
  // для дочитывания; как рисунки такие пятна в документ не ставятся
  small = false,
): Ink => {
  const empty: Ink = { rules: [], under: new Set(), cut: new Map(), figures: [] };
  if (!img || lineH <= 0) return empty;

  // Уменьшаем лист втрое: для поиска линий и пятен этого с запасом
  // хватает, а считается в девять раз быстрее. Берём среднее по квадрату:
  // самая тёмная точка «склеивала» засечки соседних букв размытого скана
  // в длинную линию, и обычный текст выходил подчёркнутым
  const S = 3;
  const W = Math.floor(img.width / S);
  const H = Math.floor(img.height / S);
  if (W < 20 || H < 20) return empty;
  const g = new Uint8Array(W * H);
  const hist = new Uint32Array(256);
  const src = img.data;
  const iw = img.width;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let dy = 0; dy < S; dy++) {
        const row = (y * S + dy) * iw;
        for (let dx = 0; dx < S; dx++) {
          const i = (row + x * S + dx) * 4;
          m += (src[i] * 299 + src[i + 1] * 587 + src[i + 2] * 114) / 1000;
        }
      }
      const v = (m / (S * S)) | 0;
      g[y * W + x] = v;
      hist[v]++;
    }
  const lh = Math.max(4, lineH / S);

  // Краска — то, что заметно темнее бумаги вокруг. Один порог на весь
  // лист не годится: у скана с тенью у переплёта или серой плашкой бумага
  // в разных местах разной яркости, и тёмный край листа принимался за
  // рисунок. Поэтому яркость бумаги считаем по участкам: в каждом
  // квадрате в несколько строк берём самое светлое, это и есть бумага
  const B = Math.max(8, Math.round(lh * 3));
  const BW = Math.ceil(W / B);
  const BH = Math.ceil(H / B);
  const paper = new Float32Array(BW * BH);
  for (let by = 0; by < BH; by++)
    for (let bx = 0; bx < BW; bx++) {
      const h2 = new Uint16Array(256);
      let n = 0;
      for (let y = by * B; y < Math.min(H, (by + 1) * B); y++)
        for (let x = bx * B; x < Math.min(W, (bx + 1) * B); x++) {
          h2[g[y * W + x]]++;
          n++;
        }
      // Не самая светлая точка (там может быть блик), а девятая часть
      // самых светлых
      let acc = 0;
      let v = 255;
      for (; v > 0; v--) {
        acc += h2[v];
        if (acc >= n * 0.1) break;
      }
      paper[by * BW + bx] = v;
    }
  // Сглаживаем: соседние участки не должны давать ступенек
  const smooth = new Float32Array(BW * BH);
  for (let by = 0; by < BH; by++)
    for (let bx = 0; bx < BW; bx++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx;
          const y = by + dy;
          if (x < 0 || y < 0 || x >= BW || y >= BH) continue;
          sum += paper[y * BW + x];
          cnt++;
        }
      smooth[by * BW + bx] = Math.max(paper[by * BW + bx], sum / cnt);
    }
  // Насколько краска темнее бумаги в целом по листу — по Оцу. Краской
  // считаем то, что темнее своей бумаги хотя бы на треть этой разницы
  const globalThr = otsu(hist, W * H);
  const contrast = Math.max(40, (median8(smooth) - globalThr) * 0.6);
  const dark = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const by = Math.min(BH - 1, (y / B) | 0);
    for (let x = 0; x < W; x++) {
      const bg = smooth[by * BW + Math.min(BW - 1, (x / B) | 0)];
      dark[y * W + x] = g[y * W + x] < bg - contrast ? 1 : 0;
    }
  }
  const box = (b: Box) => ({
    x0: Math.floor(b.x0 / S),
    y0: Math.floor(b.y0 / S),
    x1: Math.ceil(b.x1 / S),
    y1: Math.ceil(b.y1 / S),
  });
  const wb = words.map(box);

  // 1. Горизонтальные отрезки: сплошная краска длиннее полутора строк.
  // Между буквами слова всегда есть просветы, поэтому текст сюда не
  // попадает — только линии
  const minRun = Math.round(lh * 1.5);
  type Seg = { y: number; x0: number; x1: number };
  const segs: Seg[] = [];
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x <= W; x++) {
      const d = x < W && dark[y * W + x];
      if (d) run++;
      else {
        if (run >= minRun) segs.push({ y, x0: x - run, x1: x });
        run = 0;
      }
    }
  }

  // Склеиваем соседние отрезки в одну линию. Скан почти всегда чуть
  // перекошен: длинная черта идёт лесенкой, и каждый ряд точек несёт
  // только её кусок. Поэтому соседние ряды склеиваем по перекрытию или
  // стыку, а толщину считаем по количеству краски на длину линии
  type Acc = HLine & { area: number; last: number };
  const lines: Acc[] = [];
  for (const s of segs) {
    const l = lines.find(
      (q) => s.y - q.last <= 1 && s.y >= q.last && s.x0 <= q.x1 + lh && s.x1 >= q.x0 - lh,
    );
    if (l) {
      l.y1 = s.y + 1;
      l.last = s.y;
      l.x0 = Math.min(l.x0, s.x0);
      l.x1 = Math.max(l.x1, s.x1);
      l.area += s.x1 - s.x0;
    } else lines.push({ x0: s.x0, x1: s.x1, y0: s.y, y1: s.y + 1, area: s.x1 - s.x0, last: s.y });
  }
  // Толстое — это уже не линия, а залитый блок: его разберём как рисунок.
  // Высота рамки линии у перекошенной черты больше её толщины — проверяем
  // и то, что линия пологая, а не наклонный штрих рисунка
  const thin: HLine[] = lines
    .filter((l) => l.area / Math.max(1, l.x1 - l.x0) <= Math.max(2.5, lh * 0.35))
    .filter((l) => l.y1 - l.y0 <= Math.max(3, (l.x1 - l.x0) * 0.03 + lh * 0.35))
    .map((l) => ({ x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1 }));

  // 2. Подчёркивания: линия под словом, по ширине совпадает со словом
  const under = new Set<number>();
  const cut = new Map<number, number>();
  wb.forEach((w, i) => {
    const h = w.y1 - w.y0;
    const ww = w.x1 - w.x0;
    for (const l of thin) {
      const over = Math.min(w.x1, l.x1) - Math.max(w.x0, l.x0);
      if (over < ww * 0.6) continue;
      // Штрих самой буквы («Д», «2», «Ж» внизу) короче слова. Подчёркивание
      // идёт почти под всем словом — у коротких «Ед.», «120» только так
      // их и отличить
      if (l.x1 - l.x0 < ww * 0.85) continue;
      // Над подчёркиванием — просвет: линия проходит под буквами, не
      // касаясь их по всей длине. Низ букв («Е», «д» в «Ед.») касается
      // «линии» почти везде — это сами буквы
      let touch = 0;
      let span = 0;
      const ry = l.y0 - 1;
      if (ry >= 0)
        for (let x = Math.max(l.x0, w.x0); x < Math.min(l.x1, w.x1); x++) {
          span++;
          if (dark[ry * W + x]) touch++;
        }
      if (span && touch > span * 0.4) continue;
      // Нижний штрих короткого слова («Ед.») сам по себе уже полторы
      // строки длиной. Подчёркивание выходит за края букв — под короткими
      // словами обычно заметно шире их
      if (ww < lh * 2.5 && l.x1 - l.x0 < ww + lh * 0.3) continue;
      // Линия ниже середины слова и не дальше полстроки под ним. Выше —
      // это зачёркивание или линия рамки, ниже — уже следующая строка
      if (l.y0 < w.y0 + h * 0.6 || l.y0 > w.y1 + h * 0.6) continue;
      // Линия много длиннее слова — это черта бланка, а не подчёркивание
      if (l.x1 - l.x0 > ww * 3 + lh * 4) continue;
      under.add(i);
      l.used = true;
      // Рамка слова захватила линию — тогда слово кажется выше, чем есть,
      // и шрифт получался огромным. Срезаем рамку по линию
      if (l.y0 < w.y1) cut.set(i, l.y0 * S);
    }
  });

  // 3. Черты-разделители: длинные линии, не занятые подчёркиванием
  const textL = wb.length ? Math.min(...wb.map((w) => w.x0)) : 0;
  const textR = wb.length ? Math.max(...wb.map((w) => w.x1)) : W;
  const textW = Math.max(1, textR - textL);
  const rules = thin.filter((l) => !l.used && l.x1 - l.x0 >= textW * 0.3);
  rules.forEach((l) => (l.used = true));

  // 4. Всё тёмное, кроме прочитанного текста и найденных линий
  const rest = dark.slice();
  const clear = (b: Box, pad: number) => {
    for (let y = Math.max(0, b.y0 - pad); y < Math.min(H, b.y1 + pad); y++)
      rest.fill(0, y * W + Math.max(0, b.x0 - pad), y * W + Math.min(W, b.x1 + pad));
  };
  // Рамка слова у размытого скана чуть уже самих букв — берём с запасом
  const wpad = Math.max(1, Math.round(lh * 0.15));
  for (const w of wb) clear(w, wpad);
  for (const l of thin) if (l.used) clear(l, 1);

  // Пятна ищем на крупной сетке: клетка в полстроки. Так штрихи одной
  // подписи или одной рукописной даты сливаются в одно пятно, а одиночная
  // пылинка в клетке не считается
  const C = Math.max(2, Math.round(lh * 0.45));
  const CW = Math.ceil(W / C);
  const CH = Math.ceil(H / C);
  const cnt = new Uint16Array(CW * CH);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (rest[y * W + x]) cnt[((y / C) | 0) * CW + ((x / C) | 0)]++;
  const on = new Uint8Array(CW * CH);
  for (let i = 0; i < on.length; i++) on[i] = cnt[i] >= 3 ? 1 : 0;

  const seen = new Uint8Array(CW * CH);
  const figures: Figure[] = [];
  const stack: number[] = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || seen[i]) continue;
    let x0 = CW;
    let y0 = CH;
    let x1 = 0;
    let y1 = 0;
    let ink = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const cx = k % CW;
      const cy = (k / CW) | 0;
      ink += cnt[k];
      if (cx < x0) x0 = cx;
      if (cy < y0) y0 = cy;
      if (cx > x1) x1 = cx;
      if (cy > y1) y1 = cy;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
          const n = ny * CW + nx;
          if (on[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
    }
    // Точные края пятна — по самим точкам, а не по клеткам
    let bx0 = W;
    let by0 = H;
    let bx1 = 0;
    let by1 = 0;
    for (let y = y0 * C; y < Math.min(H, (y1 + 1) * C); y++)
      for (let x = x0 * C; x < Math.min(W, (x1 + 1) * C); x++)
        if (rest[y * W + x]) {
          if (x < bx0) bx0 = x;
          if (y < by0) by0 = y;
          if (x > bx1) bx1 = x;
          if (y > by1) by1 = y;
        }
    if (bx1 <= bx0 || by1 <= by0) continue;
    const fw = bx1 - bx0 + 1;
    const fh = by1 - by0 + 1;

    // Край листа: тень от крышки сканера, чёрные поля — не рисунок
    const edge = W * 0.012;
    if (bx0 < edge || by0 < edge || bx1 > W - edge || by1 > H - edge) continue;

    // Остатки текста: пятно, которое наполовину лежит на прочитанных
    // словах, — это края букв, не попавшие в рамки слов, а не рисунок
    let covered = 0;
    for (const w of wb) {
      const ox = Math.min(bx1 + 1, w.x1) - Math.max(bx0, w.x0);
      const oy = Math.min(by1 + 1, w.y1) - Math.max(by0, w.y0);
      if (ox > 0 && oy > 0) covered += ox * oy;
    }
    if (covered > fw * fh * 0.35) continue;

    // Пустая черта для заполнения: тонкая и длинная. Черта «№ ____»
    // стоит в строке с текстом, а тонкий край буквы под словом — нет:
    // такие куски считаем остатками букв
    const blank = fh <= Math.max(2, lh * 0.35) && fw >= lh * 1.5;
    if (blank) continue;

    // Низкое вытянутое пятно ниже строки — нижние края букв (хвостики «р»,
    // «у», «д»), не попавшие в рамки слов. Рисунок так не выглядит
    if (fh < lh * 0.8 && fw > fh * 3) continue;

    // Ровная заливка — серая плашка под текстом или тень края листа, а не
    // рисунок. У герба, подписи, печати и фотографии яркость внутри
    // сильно гуляет, у заливки она почти одна
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let y = by0; y <= by1; y += 2)
      for (let x = bx0; x <= bx1; x += 2) {
        const v = g[y * W + x];
        sum += v;
        sum2 += v * v;
        n++;
      }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    if (sd < 22) continue;
    // Мелочь — крошки, точки, пыль. И обрывки линий: узкий штрих без
    // ширины — это кусок рамки, а не рисунок
    const minSide = small ? lh * 0.45 : lh * 1.1;
    if (Math.max(fw, fh) < minSide || Math.min(fw, fh) < lh * (small ? 0.3 : 0.4) || ink < lh * lh * (small ? 0.04 : 0.12))
      continue;

    figures.push({ x0: bx0 * S, y0: by0 * S, x1: (bx1 + 1) * S, y1: (by1 + 1) * S, blank });
  }

  // Пятен слишком много — это шумный фон, а не рисунки. Не засоряем
  // документ сотней картинок: оставляем только самые крупные
  const real = figures.filter((f) => !f.blank);
  if (real.length > 12) {
    real.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
    const keep = new Set(real.slice(0, 12));
    for (let i = figures.length - 1; i >= 0; i--)
      if (!figures[i].blank && !keep.has(figures[i])) figures.splice(i, 1);
  }

  return {
    rules: rules.map((l) => ({ x0: l.x0 * S, y0: l.y0 * S, x1: l.x1 * S, y1: l.y1 * S })),
    under,
    cut,
    figures,
  };
};

// Кусок скана в картинку PNG — для вставки в Word
export const cropPng = (img: ImageData, b: Box, pad: number): Uint8Array | null => {
  const x0 = Math.max(0, Math.floor(b.x0 - pad));
  const y0 = Math.max(0, Math.floor(b.y0 - pad));
  const x1 = Math.min(img.width, Math.ceil(b.x1 + pad));
  const y1 = Math.min(img.height, Math.ceil(b.y1 + pad));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  try {
    const c = document.createElement('canvas');
    c.width = x1 - x0;
    c.height = y1 - y0;
    const ctx = c.getContext('2d')!;
    const part = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) {
      const from = ((y0 + y) * img.width + x0) * 4;
      part.data.set(img.data.subarray(from, from + c.width * 4), y * c.width * 4);
    }
    ctx.putImageData(part, 0, 0);
    const url = c.toDataURL('image/png');
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
};

// Места листа, где есть краска, но нет прочитанного текста, — кандидаты
// на дочитывание. Берём рисунки, похожие на строку текста: невысокие
// и вытянутые. Герб, печать и подпись сюда не попадают
export const missedSpots = (img: ImageData, words: Box[], lineH: number): Box[] => {
  const spots = analyzeInk(img, words, lineH, true).figures.filter((f) => {
    const w = f.x1 - f.x0;
    const h = f.y1 - f.y0;
    // Строка или короткая ячейка таблицы («м», «шт», «120») — не выше
    // двух с половиной строк. Герб и печать выше и сюда не попадают
    return !f.blank && h < lineH * 2.6 && w < lineH * 60;
  });
  // Куски одной строки склеиваем: строка, прочитанная целиком, выходит
  // точнее, чем её обрывки по отдельности
  spots.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const out: Box[] = [];
  for (const s of spots) {
    const same = out.find((o) => Math.min(o.y1, s.y1) - Math.max(o.y0, s.y0) > Math.min(o.y1 - o.y0, s.y1 - s.y0) * 0.5);
    if (same) {
      same.x0 = Math.min(same.x0, s.x0);
      same.x1 = Math.max(same.x1, s.x1);
      same.y0 = Math.min(same.y0, s.y0);
      same.y1 = Math.max(same.y1, s.y1);
    } else out.push({ ...s });
  }
  return out;
};
