// Сборка листов для принтера из готового документа (со всеми пометками).
//
// Каждая страница встраивается в файл один раз, а копии и листы лишь
// ссылаются на неё — печать 5 копий весит почти как одна
import { isDuplex, placeOnSheet, sheetList, type Layout } from '@/lib/printLayout';

// Какие листы печатать: всё сразу или — при ручной двусторонней
// печати — отдельно лицевые стороны и обороты
export type PrintPart = 'all' | 'fronts' | 'backs';

const norm = (a: number) => ((a % 360) + 360) % 360;

export const composeSheets = async (
  bytes: Uint8Array,
  layout: Layout,
  opts: { copies?: number; part?: PrintPart; reverseBacks?: boolean } = {},
) => {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const srcPages = src.getPages();
  const embedded = srcPages.length ? await out.embedPages(srcPages) : [];

  const duplex = isDuplex(layout);
  let slots = sheetList(
    srcPages.map((_, i) => i),
    opts.copies ?? 1,
    duplex,
  );
  const part = opts.part ?? 'all';
  // Лицевые — нечётные листы по счёту (1, 3, 5…), обороты — чётные
  const withPos = slots.map((s, i) => ({ s, back: duplex && i % 2 === 1 }));
  let chosen = withPos;
  if (part === 'fronts') chosen = withPos.filter((x) => !x.back);
  if (part === 'backs') {
    chosen = withPos.filter((x) => x.back);
    if (opts.reverseBacks) chosen = [...chosen].reverse();
  }
  slots = chosen.map((x) => x.s);

  let lastSize: [number, number] = layout.sheet ?? [595.28, 841.89];

  for (const { s, back } of chosen) {
    if (s === null) {
      // Пустой оборот: у документа нечётное число страниц. Без него
      // следующая копия началась бы на обороте последнего листа
      out.addPage(lastSize);
      continue;
    }
    const page = srcPages[s];
    const emb = embedded[s];
    const rot = norm(page.getRotation().angle);
    const sw = rot % 180 ? emb.height : emb.width;
    const sh = rot % 180 ? emb.width : emb.height;

    const pl = placeOnSheet(sw, sh, layout, back);
    lastSize = [pl.pw, pl.ph];
    const sheet = out.addPage([pl.pw, pl.ph]);

    // Итоговый поворот по часовой стрелке: свой поворот страницы плюс,
    // если страницу положили на лист боком, ещё 90° против часовой
    const total = norm(rot + (pl.turned ? 270 : 0));
    const theta = norm(360 - total);
    const W = total % 180 ? pl.h : pl.w;
    const H = total % 180 ? pl.w : pl.h;
    // В PDF отсчёт снизу листа
    const bx = pl.x;
    const by = pl.ph - pl.y - pl.h;
    // Куда ставить «нижний левый угол» страницы, чтобы после поворота
    // она точно заняла своё место на листе
    const anchor: Record<number, [number, number]> = {
      0: [bx, by],
      90: [bx + H, by],
      180: [bx + W, by + H],
      270: [bx, by + W],
    };
    const [ax, ay] = anchor[theta];
    sheet.drawPage(emb, { x: ax, y: ay, width: W, height: H, rotate: degrees(theta) });
  }

  return { bytes: await out.save(), sheets: chosen.length };
};

// Тестовый лист для проверки совпадения сторон на просвет: на лице —
// шкалы через середину листа, на обороте — крестик. Оборот проходит тот
// же путь, что и документ, поэтому показания шкалы точно говорят, на
// сколько сдвинуть оборот
export const testSheet = async (size: [number, number]) => {
  const { rgb } = await import('pdf-lib');
  const { makeTextDoc } = await import('@/lib/convert/textPdf');
  const { doc, font, fontBold } = await makeTextDoc();
  const [W, H] = size;
  const MMp = 72 / 25.4;
  const cx = W / 2;
  const cy = H / 2;
  const ink = rgb(0, 0, 0);
  const grey = rgb(0.45, 0.45, 0.45);
  const blue = rgb(0.12, 0.3, 0.6);

  const front = doc.addPage([W, H]);
  const title = 'Проверка двусторонней печати — лицевая сторона';
  front.drawText(title, { x: 40, y: H - 50, size: 13, font: fontBold, color: ink });
  const help = [
    'Посмотрите лист на просвет. Крестик с оборота виден сквозь бумагу.',
    'Найдите на шкалах, где проходят его линии, и введите эти числа в окне печати,',
    'в разделе «Подстройка под принтер» → «Показания тестового листа».',
    'Справа и вниз — плюс, слева и вверх — минус. Если крестик точно на нуле — всё совпадает.',
  ];
  help.forEach((t, i) => front.drawText(t, { x: 40, y: H - 74 - i * 15, size: 9.5, font, color: grey }));

  // Шкалы через середину: ±20 мм, деления через 1 мм
  const R = 20;
  for (let i = -R; i <= R; i++) {
    const big = i % 5 === 0;
    const len = (big ? 9 : 4.5) * (i === 0 ? 1.6 : 1);
    const x = cx + i * MMp;
    const y = cy - i * MMp;
    front.drawLine({ start: { x, y: cy - len / 2 }, end: { x, y: cy + len / 2 }, thickness: big ? 0.7 : 0.35, color: ink });
    front.drawLine({ start: { x: cx - len / 2, y }, end: { x: cx + len / 2, y }, thickness: big ? 0.7 : 0.35, color: ink });
    if (big && i !== 0) {
      const t = (i > 0 ? '+' : '') + i;
      const tw = font.widthOfTextAtSize(t, 7);
      front.drawText(t, { x: x - tw / 2, y: cy - 16, size: 7, font, color: ink });
      front.drawText(t, { x: cx + 9, y: y - 2.5, size: 7, font, color: ink });
    }
  }
  front.drawLine({ start: { x: cx - R * MMp, y: cy }, end: { x: cx + R * MMp, y: cy }, thickness: 0.35, color: ink });
  front.drawLine({ start: { x: cx, y: cy - R * MMp }, end: { x: cx, y: cy + R * MMp }, thickness: 0.35, color: ink });
  front.drawText('мм по горизонтали', { x: cx + R * MMp + 6, y: cy - 3, size: 7.5, font, color: grey });
  front.drawText('мм по вертикали', { x: cx + 6, y: cy - R * MMp - 12, size: 7.5, font, color: grey });
  // Рамка 15 мм от края: видно, не режет ли принтер поля
  const f = 15 * MMp;
  front.drawRectangle({ x: f, y: f, width: W - 2 * f, height: H - 2 * f, borderColor: blue, borderWidth: 0.6, opacity: 0 });

  const back = doc.addPage([W, H]);
  back.drawText('Оборотная сторона', { x: 40, y: H - 50, size: 13, font: fontBold, color: ink });
  back.drawText('Крестик в центре должен лечь на ноль шкал лицевой стороны', {
    x: 40,
    y: H - 68,
    size: 9.5,
    font,
    color: grey,
  });
  const arm = 30 * MMp;
  back.drawLine({ start: { x: cx - arm, y: cy }, end: { x: cx + arm, y: cy }, thickness: 1.4, color: ink });
  back.drawLine({ start: { x: cx, y: cy - arm }, end: { x: cx, y: cy + arm }, thickness: 1.4, color: ink });
  back.drawRectangle({ x: f, y: f, width: W - 2 * f, height: H - 2 * f, borderColor: blue, borderWidth: 0.6, opacity: 0 });

  return doc.save();
};
