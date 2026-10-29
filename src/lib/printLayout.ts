// Раскладка страницы на листе при печати: размер листа, ориентация,
// поля и — при двусторонней печати — где окажется оборот.
//
// Один расчёт на всех: по нему собирается PDF для принтера и рисуется
// предпросмотр, поэтому то, что видно в окне печати, совпадает с бумагой

export type PaperId = 'original' | 'a3' | 'a4' | 'a5' | 'letter' | 'legal';
export type FitMode = 'fit' | 'fill' | 'stretch' | 'actual';
export type Orientation = 'auto' | 'portrait' | 'landscape';

// off — с одной стороны; long — лист переворачивается по длинному краю
// (как книга); short — по короткому (как блокнот или календарь);
// manual — принтер без двусторонней печати: сначала лицевые стороны,
// затем стопку переворачивают и печатают обороты;
// backs — лицевые уже напечатаны раньше, допечатываем только обороты
export type Duplex = 'off' | 'long' | 'short' | 'manual' | 'backs';

export type Layout = {
  paper: PaperId;
  fit: FitMode;
  orientation: Orientation;
  // Поля, в точках PDF
  margin: number;
  duplex?: Duplex;
  // Край переворота для ручной печати и допечатки оборотов: long —
  // переплёт сбоку (как книга), short — сверху (как блокнот)
  edge?: 'long' | 'short';
  // Переплётное поле, в точках: у лицевой стороны слева (сверху при
  // перевороте по короткому краю), у оборота — справа (снизу)
  gutter?: number;
  // Альбомные страницы кладутся на лист повёрнутыми: все листы одной
  // ориентации, и принтер переворачивает их одинаково
  turn?: boolean;
  // Разница полей самого документа, в долях ширины (высоты) страницы:
  // правое минус левое, нижнее минус верхнее. Оборот сдвигается на неё,
  // и блок текста ложится точно на блок лицевой стороны
  mirrorX?: number;
  mirrorY?: number;
  // Подстройка оборота под принтер, в точках: вправо и вниз
  shiftX?: number;
  shiftY?: number;
  // Размер листа «как в файле» для двусторонней печати — самый частый
  // размер страниц документа, в книжной ориентации. И ориентация листов
  sheet?: [number, number];
  sheetLand?: boolean;
};

export const PAPERS: Record<Exclude<PaperId, 'original'>, [number, number]> = {
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  letter: [612, 792],
  legal: [612, 1008],
};

export const DEFAULT_LAYOUT: Layout = {
  paper: 'original',
  fit: 'fit',
  orientation: 'auto',
  margin: 0,
};

export const MM = 72 / 25.4;

export const isDuplex = (l: Layout) => !!l.duplex && l.duplex !== 'off';

// Раскладка нужна, только если лист отличается от страницы файла
export const needsLayout = (l: Layout) =>
  !(l.paper === 'original' && l.orientation === 'auto' && !isDuplex(l));

// Как ложится оборот: лист переворачивается вокруг вертикальной оси
// (слева направо) или горизонтальной (сверху вниз). Длинный край у
// книжного листа вертикальный, у альбомного — горизонтальный
export const flipsSideways = (l: Layout, pw: number, ph: number) => {
  const byHand = l.duplex === 'manual' || l.duplex === 'backs';
  const short = l.duplex === 'short' || (byHand && l.edge === 'short');
  return short === pw > ph;
};

export type Placement = {
  // Размер листа
  pw: number;
  ph: number;
  // Место страницы на листе: левый верхний угол и размер (отсчёт сверху)
  x: number;
  y: number;
  w: number;
  h: number;
  // Страница повёрнута на листе на 90° против часовой: верх — к левому краю
  turned: boolean;
  // Оборот переворачивается слева направо (иначе — сверху вниз)
  sideways: boolean;
};

// sw, sh — размер страницы так, как её видно на экране (с учётом поворота)
export const placeOnSheet = (sw: number, sh: number, l: Layout, back = false): Placement => {
  const duplex = isDuplex(l);

  let [pw, ph]: [number, number] =
    l.paper === 'original' ? (duplex && l.sheet ? l.sheet : [sw, sh]) : PAPERS[l.paper];

  const pageLand = sw > sh;
  let wantLand: boolean;
  if (l.orientation === 'landscape') wantLand = true;
  else if (l.orientation === 'portrait') wantLand = false;
  else if (duplex && l.turn && l.sheet) wantLand = !!l.sheetLand;
  else wantLand = pageLand;
  if (wantLand !== pw > ph) [pw, ph] = [ph, pw];

  const turned = duplex && !!l.turn && sw !== sh && pageLand !== pw > ph;
  // Сколько страница занимает на листе по ширине и высоте
  const cw = turned ? sh : sw;
  const ch = turned ? sw : sh;

  // Переплёт и выравнивание идут вдоль края, по которому переворачивают
  const sideways = flipsSideways(l, pw, ph);
  // Переворот сверху вниз (календарь): переплёт и сдвиг — по вертикали
  const upDown = !sideways;
  const m = l.margin;
  const g = duplex ? (l.gutter ?? 0) : 0;
  // Переплёт: у лицевой — слева/сверху, у оборота — справа/снизу
  const gLeft = !upDown && !back ? g : 0;
  const gTop = upDown && !back ? g : 0;
  const ax = m + gLeft;
  const ay = m + gTop;
  const aw = Math.max(1, pw - m * 2 - (upDown ? 0 : g));
  const ah = Math.max(1, ph - m * 2 - (upDown ? g : 0));

  let sx = 1;
  let sy = 1;
  if (l.fit === 'fit') sx = sy = Math.min(aw / cw, ah / ch);
  else if (l.fit === 'fill') sx = sy = Math.max(aw / cw, ah / ch);
  else if (l.fit === 'stretch') {
    sx = aw / cw;
    sy = ah / ch;
  }

  const w = cw * sx;
  const h = ch * sy;
  let x = ax + (aw - w) / 2;
  let y = ay + (ah - h) / 2;

  if (duplex && back) {
    // Положенную боком страницу зеркалить по полям не берёмся: её поля
    // идут уже вдоль другого края листа
    if (!turned) {
      if (upDown) y += (l.mirrorY ?? 0) * h;
      else x += (l.mirrorX ?? 0) * w;
    }
    x += l.shiftX ?? 0;
    y += l.shiftY ?? 0;
  }

  return { pw, ph, x, y, w, h, turned, sideways };
};

// Показания тестового листа (мм, вправо и вниз — плюс, как видно с
// лицевой стороны) → новая подстройка оборота. Оборот, сдвинутый на
// своей стороне, на просвет уходит в обратную сторону вдоль оси
// переворота — поэтому знак зависит от того, как переворачивают лист
export const applyReading = (
  sideways: boolean,
  cur: { x: number; y: number },
  read: { x: number; y: number },
) => ({
  x: Math.round((cur.x + (sideways ? read.x : -read.x)) * 10) / 10,
  y: Math.round((cur.y + (sideways ? -read.y : read.y)) * 10) / 10,
});

// Листы для печати: при двусторонней печати у каждой копии чётное
// число страниц — иначе следующая копия начнётся на обороте
export const sheetList = <T>(list: T[], copies: number, duplex: boolean): (T | null)[] => {
  const one: (T | null)[] = [...list];
  if (duplex && one.length % 2) one.push(null);
  return Array.from({ length: Math.max(1, copies) }, () => one).flat();
};