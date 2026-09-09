// Список недавних документов для стартового окна.
// Сам файл не храним — только имя, размер и время открытия:
// так список остаётся лёгким и не занимает место на диске

export type RecentDoc = {
  name: string;
  size: number;
  at: number;
  // Ссылка на файл, если документ пришёл из программы,
  // — по ней его можно открыть повторно
  url?: string;
};

const KEY = 'pvs-recent';
const LIMIT = 12;

export const readRecent = (): RecentDoc[] => {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentDoc[]) : [];
    return Array.isArray(list) ? list.filter((d) => d && d.name) : [];
  } catch {
    return [];
  }
};

export const addRecent = (doc: Omit<RecentDoc, 'at'>) => {
  try {
    // Один и тот же документ не повторяем: старая запись уступает свежей
    const rest = readRecent().filter((d) => d.name !== doc.name || d.size !== doc.size);
    const list = [{ ...doc, at: Date.now() }, ...rest].slice(0, LIMIT);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* хранилище недоступно — список просто не сохранится */
  }
};

export const clearRecent = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* нечего чистить */
  }
};

// «Сегодня в 14:30», «вчера», «3 сентября» — как пишут в проводнике
export const whenLabel = (at: number) => {
  const d = new Date(at);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `сегодня в ${d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`;
  }
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'вчера';
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'long' });
};

export const sizeLabel = (bytes: number) => {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
};
