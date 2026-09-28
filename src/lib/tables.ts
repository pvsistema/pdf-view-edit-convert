// Поиск таблиц в документе.
//
// Таблица на листе не помечена никак — это просто текст, разложенный
// по столбцам. Человек узнаёт её по виду: несколько строк подряд, и в
// каждой слова начинаются на одних и тех же местах по ширине листа.
// Здесь ищется ровно это.
//
// Разбор работает одинаково и для сканов, и для обычных документов:
// на вход идут кусочки текста с их местом на листе, а откуда они взяты —
// из движка распознавания или из самого файла — неважно.

// Кусочек текста с местом на листе. Доли ширины и высоты страницы,
// поэтому разбор одинаково верен при любом увеличении
export type Cell = { str: string; x: number; y: number; w: number; h: number };

// Строка листа: кусочки, попавшие на один уровень по высоте
export type TableRow = { y: number; h: number; cells: Cell[] };

// Готовая таблица: где она на листе и что в ней
export type FoundTable = { from: number; to: number; rows: string[][] };

// Раскладываем кусочки по строкам. Опора — высота букв: то, что стоит
// ближе половины буквы по вертикали, считаем одной строкой
export const buildRows = (pieces: Cell[]): TableRow[] => {
  const rows: TableRow[] = [];
  const sorted = [...pieces].filter((p) => p.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);

  for (const p of sorted) {
    const near = rows[rows.length - 1];
    if (near && Math.abs(p.y - near.y) < Math.max(p.h, near.h) * 0.6) {
      near.cells.push(p);
      near.h = Math.max(near.h, p.h);
    } else {
      rows.push({ y: p.y, h: p.h, cells: [p] });
    }
  }

  for (const r of rows) r.cells.sort((a, b) => a.x - b.x);
  return rows;
};

// Разбиваем строку на ячейки по заметным разрывам.
//
// Внутри ячейки слова стоят вплотную, между ячейками — широкий просвет.
// Опорой берём высоту букв: просвет шире полутора букв считаем границей
// столбца. По одному пробелу таблицу не разделить — в тексте пробелы тоже
// есть, но они куда уже
const splitRow = (r: TableRow): { text: string; x: number }[] => {
  const out: { text: string; x: number }[] = [];
  let text = '';
  let startX = 0;
  let prevEnd: number | null = null;

  for (const c of r.cells) {
    const gap = prevEnd === null ? 0 : c.x - prevEnd;

    if (prevEnd !== null && gap > r.h * 1.2) {
      // Просвет широкий — прошлая ячейка кончилась
      if (text.trim()) out.push({ text: text.trim(), x: startX });
      text = '';
      startX = c.x;
    } else if (prevEnd !== null && gap > r.h * 0.15) {
      text += ' ';
    }

    if (!text) startX = c.x;
    text += c.str;
    prevEnd = c.x + c.w;
  }

  if (text.trim()) out.push({ text: text.trim(), x: startX });
  return out;
};

// Насколько похожи наборы столбцов у двух строк. У таблицы ячейки
// начинаются примерно на одних местах, у обычного текста — вразнобой
const sameColumns = (a: number[], b: number[]) => {
  if (a.length < 2 || b.length < 2) return false;

  let hit = 0;
  for (const x of a) {
    // Допуск — сотая доля ширины листа: печать и скан всегда немного гуляют
    if (b.some((y) => Math.abs(x - y) < 0.03)) hit++;
  }

  // Совпало большинство столбцов — строки из одной таблицы
  return hit >= Math.min(a.length, b.length) * 0.7;
};

// Поиск таблиц среди строк листа.
//
// Таблицей считаем два и более идущих подряд ряда с одинаковым набором
// столбцов. Одна строка с двумя колонками — это ещё не таблица, а,
// например, подпись с датой справа
export const findTables = (rows: TableRow[]): FoundTable[] => {
  const split = rows.map(splitRow);
  const found: FoundTable[] = [];

  let i = 0;
  while (i < rows.length) {
    const start = split[i];

    // Строка с одной ячейкой столбцов не образует
    if (start.length < 2) {
      i++;
      continue;
    }

    // Смотрим, сколько следующих строк повторяют этот набор столбцов
    let end = i;
    for (let j = i + 1; j < rows.length; j++) {
      const cols = split[j];
      if (cols.length < 2) break;
      if (
        !sameColumns(
          start.map((c) => c.x),
          cols.map((c) => c.x),
        )
      )
        break;

      // Разрыв по высоте больше двух строк — таблица кончилась,
      // дальше идёт другая часть документа
      const gap = rows[j].y - (rows[j - 1].y + rows[j - 1].h);
      if (gap > Math.max(rows[j].h, rows[j - 1].h) * 2) break;

      end = j;
    }

    // Меньше двух рядов — это не таблица
    if (end > i) {
      const body: string[][] = [];
      for (let k = i; k <= end; k++) body.push(split[k].map((c) => c.text));
      found.push({ from: i, to: end, rows: body });
      i = end + 1;
    } else {
      i++;
    }
  }

  return found;
};
