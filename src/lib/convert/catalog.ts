// Каталог инструментов вкладки «Конвертировать».
// Каждая карточка описывает, что принимает и что отдаёт

export type ToolGroup = 'pdf' | 'from' | 'to';

export type ToolDef = {
  id: string;
  group: ToolGroup;
  title: string;
  note: string;
  icon: string;
  tint: string;
  // Что можно выбрать в окне выбора файла
  accept: string;
  multiple?: boolean;
  // Слова, по которым инструмент находится поиском
  alias?: string;
  pro?: boolean;
};

export const GROUPS: { id: ToolGroup; title: string }[] = [
  { id: 'pdf', title: 'Действия с PDF' },
  { id: 'to', title: 'Из PDF в другой формат' },
  { id: 'from', title: 'Создать PDF' },
];

const PDF = 'application/pdf';
const IMG = 'image/jpeg,image/png,image/heic,image/heif,image/tiff,.jpg,.jpeg,.png,.heic,.heif,.tif,.tiff';

export const TOOLS: ToolDef[] = [
  // Действия с PDF
  {
    id: 'merge',
    group: 'pdf',
    title: 'Объединить PDF',
    note: 'Соберите несколько файлов в один документ',
    icon: 'Combine',
    tint: 'text-rose-600',
    accept: PDF,
    multiple: true,
    alias: 'склеить соединить merge объединение',
  },
  {
    id: 'compress',
    group: 'pdf',
    title: 'Сжать PDF',
    note: 'Уменьшите размер для почты и Госуслуг',
    icon: 'Minimize2',
    tint: 'text-emerald-600',
    accept: PDF,
    alias: 'вес уменьшить compress лёгкий',
  },
  {
    id: 'remove-pages',
    group: 'pdf',
    title: 'Удалить страницы',
    note: 'Уберите лишние листы без пересборки',
    icon: 'FileMinus2',
    tint: 'text-emerald-600',
    accept: PDF,
    alias: 'вырезать убрать лишние',
  },
  {
    id: 'extract-pages',
    group: 'pdf',
    title: 'Извлечь страницы',
    note: 'Сохраните только нужные листы отдельным файлом',
    icon: 'FileOutput',
    tint: 'text-emerald-600',
    accept: PDF,
    alias: 'разделить split вытащить выделить',
  },
  {
    id: 'reorder',
    group: 'pdf',
    title: 'Поменять порядок',
    note: 'Переставьте страницы в нужной последовательности',
    icon: 'ArrowUpDown',
    tint: 'text-rose-600',
    accept: PDF,
    alias: 'сортировка переставить местами',
  },
  {
    id: 'blank',
    group: 'pdf',
    title: 'Добавить лист',
    note: 'Вставьте чистые страницы в любое место',
    icon: 'FilePlus2',
    tint: 'text-rose-600',
    accept: PDF,
    alias: 'пустой чистый вставить',
  },
  {
    id: 'enhance',
    group: 'pdf',
    title: 'Улучшить скан',
    note: 'Повысьте контраст и читаемость документа',
    icon: 'Sun',
    tint: 'text-emerald-600',
    accept: PDF,
    alias: 'контраст осветлить почистить фон',
  },

  // Из PDF
  {
    id: 'to-word',
    group: 'to',
    title: 'PDF в Word',
    note: 'Превратите документ в редактируемый файл',
    icon: 'FileText',
    tint: 'text-sky-600',
    accept: PDF,
    alias: 'doc docx ворд редактировать',
    pro: true,
  },
  {
    id: 'to-excel',
    group: 'to',
    title: 'PDF в Excel',
    note: 'Перенесите строки документа в таблицу',
    icon: 'Table',
    tint: 'text-emerald-600',
    accept: PDF,
    alias: 'xls xlsx таблица эксель',
    pro: true,
  },
  {
    id: 'to-jpg',
    group: 'to',
    title: 'PDF в JPG',
    note: 'Каждая страница станет изображением',
    icon: 'Image',
    tint: 'text-amber-600',
    accept: PDF,
    alias: 'картинка фото jpeg',
    pro: true,
  },
  {
    id: 'to-png',
    group: 'to',
    title: 'PDF в PNG',
    note: 'Страницы как чёткие изображения PNG',
    icon: 'Images',
    tint: 'text-sky-600',
    accept: PDF,
    alias: 'картинка чёткий прозрачный',
    pro: true,
  },
  {
    id: 'to-text',
    group: 'to',
    title: 'PDF в текст',
    note: 'Извлеките весь текст в простой файл TXT',
    icon: 'AlignLeft',
    tint: 'text-slate-600',
    accept: PDF,
    alias: 'txt содержимое скопировать',
  },
  {
    id: 'to-html',
    group: 'to',
    title: 'PDF в HTML',
    note: 'Веб-страница с текстом документа',
    icon: 'Code',
    tint: 'text-emerald-600',
    accept: PDF,
    alias: 'сайт веб страница',
  },

  // В PDF
  {
    id: 'from-jpg',
    group: 'from',
    title: 'JPG и фото в PDF',
    note: 'Соберите снимки страниц в аккуратный PDF',
    icon: 'ImagePlus',
    tint: 'text-amber-600',
    accept: IMG,
    multiple: true,
    alias: 'картинки png снимки камера фотография',
  },
  {
    id: 'from-scan',
    group: 'from',
    title: 'Скан и фото в PDF',
    note: 'Фото документа станет ровным листом A4',
    icon: 'ScanLine',
    tint: 'text-emerald-600',
    accept: IMG,
    multiple: true,
    alias: 'снимок телефон документ лист',
  },
  {
    id: 'from-heic',
    group: 'from',
    title: 'HEIC в PDF',
    note: 'Фотографии с iPhone в формате HEIC и HEIF',
    icon: 'Smartphone',
    tint: 'text-rose-600',
    accept: 'image/heic,image/heif,.heic,.heif',
    multiple: true,
    alias: 'айфон apple heif телефон',
  },
  {
    id: 'from-tiff',
    group: 'from',
    title: 'TIFF в PDF',
    note: 'Одно- и многостраничные сканы TIFF',
    icon: 'Layers',
    tint: 'text-sky-600',
    accept: 'image/tiff,.tif,.tiff',
    multiple: true,
    alias: 'тиф сканер многостраничный',
  },
  {
    id: 'from-text',
    group: 'from',
    title: 'Текст в PDF',
    note: 'Превратите TXT-файл в читаемый документ',
    icon: 'FileType',
    tint: 'text-slate-600',
    accept: 'text/plain,.txt',
    alias: 'txt блокнот записка',
  },
];

export const findTool = (id: string) => TOOLS.find((t) => t.id === id);

// Поиск по названию, пояснению и дополнительным словам
export const searchTools = (query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return TOOLS;
  return TOOLS.filter((t) =>
    `${t.title} ${t.note} ${t.alias ?? ''}`.toLowerCase().includes(q),
  );
};
