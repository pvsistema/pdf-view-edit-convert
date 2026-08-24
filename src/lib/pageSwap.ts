import type { PageMeta, SourceFile } from '@/context/DocContext';

// Обмен страницами между вкладками. Каждая вкладка живёт своей жизнью
// и не видит соседние, поэтому перенос идёт через общего посредника:
// вкладка-источник кладёт сюда страницу, вкладка-получатель забирает

// Что именно тащат мышью
export type Cargo = {
  tabId: string;
  page: PageMeta;
  file: SourceFile;
  label: string;
};

// Вкладка сообщает о себе, чтобы получать страницы от соседей
type Slot = {
  accept: (cargo: Cargo, at: number) => void;
  drop: (uid: string) => void;
  count: () => number;
};

const slots = new Map<string, Slot>();
let cargo: Cargo | null = null;

export const registerTab = (tabId: string, slot: Slot) => {
  slots.set(tabId, slot);
  return () => {
    slots.delete(tabId);
  };
};

export const takePage = (c: Cargo | null) => {
  cargo = c;
};

export const heldPage = () => cargo;

// Переносим страницу в другую вкладку. Из исходной она удаляется
// только при перемещении: с зажатым Ctrl страница копируется
export const dropInto = (tabId: string, at: number, copy: boolean) => {
  const c = cargo;
  if (!c || c.tabId === tabId) return false;

  const target = slots.get(tabId);
  if (!target) return false;

  target.accept(c, at);

  if (!copy) {
    const from = slots.get(c.tabId);
    // Последнюю страницу не забираем: документ не может остаться пустым
    if (from && from.count() > 1) from.drop(c.page.uid);
  }

  cargo = null;
  return true;
};

export const MIME = 'application/x-pvspdf-page';

// Учёт того, кто каким файлом пользуется. После переноса страницы
// один и тот же файл нужен сразу двум вкладкам, поэтому закрытие
// одной из них не должно освобождать его из памяти
const owners = new Map<string, Set<string>>();

export const holdFiles = (ownerId: string, fileIds: string[]) => {
  for (const id of fileIds) {
    let set = owners.get(id);
    if (!set) {
      set = new Set();
      owners.set(id, set);
    }
    set.add(ownerId);
  }
};

// Вкладка закрывается: отдаём список файлов, которые больше
// никому не нужны — только их и следует освобождать
export const releaseOwner = (ownerId: string, fileIds: string[]) => {
  const free: string[] = [];
  for (const id of fileIds) {
    const set = owners.get(id);
    if (!set) {
      free.push(id);
      continue;
    }
    set.delete(ownerId);
    if (set.size === 0) {
      owners.delete(id);
      free.push(id);
    }
  }
  return free;
};