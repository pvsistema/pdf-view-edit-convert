// «Мои подписи»: сохранённые картинки — подпись, печать, факсимиле.
//
// Хранятся на этом компьютере, в базе браузера (IndexedDB): одна подпись
// весит сотни килобайт, и в обычное хранилище настроек их поместилось бы
// всего несколько. Никуда не отправляются

export type Signature = {
  id: string;
  name: string;
  // data:-адрес PNG или JPEG
  img: string;
  // Размер на листе, с которым подпись сохранили, в миллиметрах:
  // при вставке она встаёт сразу нужного размера
  wMm: number;
  hMm: number;
  rotation?: number;
  added: number;
};

const DB = 'pvs-signatures';
const STORE = 'items';

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Хранилище подписей недоступно'));
  });

const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('Не удалось записать подпись'));
      tx.onabort = () => reject(tx.error ?? new Error('Не удалось записать подпись'));
    });
  } finally {
    db.close();
  }
};

// Подписчики: список меняется в одном окне — обновляется во всех вкладках
const listeners = new Set<() => void>();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DB) : null;
channel?.addEventListener('message', () => listeners.forEach((f) => f()));
const changed = () => {
  listeners.forEach((f) => f());
  channel?.postMessage(1);
};

export const onSignaturesChange = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

export const listSignatures = async (): Promise<Signature[]> => {
  const all = await run<Signature[]>('readonly', (s) => s.getAll() as IDBRequest<Signature[]>);
  return all.sort((a, b) => b.added - a.added);
};

export const saveSignature = async (sig: Omit<Signature, 'id' | 'added'>) => {
  const item: Signature = { ...sig, id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, added: Date.now() };
  await run('readwrite', (s) => s.put(item));
  changed();
  return item;
};

export const renameSignature = async (id: string, name: string) => {
  const all = await listSignatures();
  const it = all.find((s) => s.id === id);
  if (!it) return;
  await run('readwrite', (s) => s.put({ ...it, name }));
  changed();
};

export const deleteSignature = async (id: string) => {
  await run('readwrite', (s) => s.delete(id));
  changed();
};
