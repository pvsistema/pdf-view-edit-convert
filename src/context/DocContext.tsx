import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { forgetDoc, closeDoc, loadDocFromBytes, loadDocFromUrl } from '@/lib/pdf';
import { holdFiles, releaseOwner } from '@/lib/pageSwap';

export type PageMeta = {
  uid: string;
  src: number;
  fileId: string;
  rotation: number;
};

export type Annot = {
  id: string;
  pageUid: string;
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  kind: 'text' | 'block';
};

// Документ, который уже доступен по адресу — так его передаёт программа
export type DocSource = { name: string; url: string; size?: number };

export type SourceFile = {
  id: string;
  name: string;
  // Байты подтягиваются только при сохранении или печати: для просмотра
  // достаточно читать нужные куски файла с диска
  bytes: () => Promise<ArrayBuffer>;
  doc: any;
  size: number;
  release?: () => void;
};

type Snapshot = { pages: PageMeta[]; annots: Annot[]; label: string };

export type PaperId = 'original' | 'a3' | 'a4' | 'a5' | 'letter' | 'legal';
export type FitMode = 'fit' | 'fill' | 'stretch' | 'actual';
export type Orientation = 'auto' | 'portrait' | 'landscape';

export type Layout = {
  paper: PaperId;
  fit: FitMode;
  orientation: Orientation;
  margin: number;
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

type Ctx = {
  annots: Annot[];
  addAnnot: (a: Omit<Annot, 'id'>) => void;
  updateAnnot: (id: string, patch: Partial<Annot>) => void;
  removeAnnot: (id: string) => void;
  files: SourceFile[];
  pages: PageMeta[];
  name: string;
  loading: boolean;
  active: number;
  setActive: React.Dispatch<React.SetStateAction<number>>;
  open: (file: File | DocSource) => Promise<void>;
  append: (file: File) => Promise<void>;
  rotate: (uid: string, dir: number) => void;
  remove: (uid: string) => void;
  move: (uid: string, dir: number) => void;
  movePageTo: (uid: string, at: number) => void;
  insertPage: (page: PageMeta, file: SourceFile, at: number, label?: string) => void;
  reset: () => void;
  docOf: (p: PageMeta) => any;
  buildPdf: (
    subset?: PageMeta[],
    layout?: Layout,
    onStep?: (done: number, total: number) => void,
  ) => Promise<Uint8Array>;
  version: number;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  selectAllPages: () => void;
  clearAnnots: () => void;
  duplicatePage: (uid: string) => void;
};

const DocCtx = createContext<Ctx | null>(null);

let seq = 0;
const nextId = () => `p${++seq}`;

export const DocProvider = ({ children }: { children: React.ReactNode }) => {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [annots, setAnnots] = useState<Annot[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [version, setVersion] = useState(0);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const filesRef = useRef<SourceFile[]>([]);
  const pagesRef = useRef<PageMeta[]>([]);

  // Своя метка вкладки: по ней ведётся учёт общих файлов
  const ownerId = useRef(`w${++seq}`).current;
  const annotsRef = useRef<Annot[]>([]);

  const apply = useCallback((label: string, next: { pages?: PageMeta[]; annots?: Annot[] }) => {
    setPast((h) => [
      ...h.slice(-49),
      { pages: pagesRef.current, annots: annotsRef.current, label },
    ]);
    setFuture([]);
    if (next.pages) {
      pagesRef.current = next.pages;
      setPages(next.pages);
    }
    if (next.annots) {
      annotsRef.current = next.annots;
      setAnnots(next.annots);
    }
    setVersion((v) => v + 1);
  }, []);

  const commit = useCallback((snap: Snapshot) => {
    pagesRef.current = snap.pages;
    annotsRef.current = snap.annots;
    setPages(snap.pages);
    setAnnots(snap.annots);
    setActive((a) => Math.max(0, Math.min(a, snap.pages.length - 1)));
    setVersion((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    setPast((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [
        { pages: pagesRef.current, annots: annotsRef.current, label: prev.label },
        ...f,
      ]);
      commit(prev);
      return h.slice(0, -1);
    });
  }, [commit]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setPast((h) => [...h, { pages: pagesRef.current, annots: annotsRef.current, label: next.label }]);
      commit(next);
      return f.slice(1);
    });
  }, [commit]);

  const addAnnot = useCallback(
    (a: Omit<Annot, 'id'>) => {
      apply(a.kind === 'text' ? 'добавление надписи' : 'закрашивание', {
        annots: [...annotsRef.current, { ...a, id: `a${++seq}` }],
      });
    },
    [apply],
  );

  const updateAnnot = useCallback(
    (id: string, patch: Partial<Annot>) => {
      apply('изменение надписи', {
        annots: annotsRef.current.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      });
    },
    [apply],
  );

  const removeAnnot = useCallback(
    (id: string) => {
      apply('удаление пометки', { annots: annotsRef.current.filter((a) => a.id !== id) });
    },
    [apply],
  );

  const clearAnnots = useCallback(() => {
    apply('очистку пометок', { annots: [] });
  }, [apply]);

  // Вставка страницы, перенесённой мышью из другой вкладки.
  // Файл-источник подключаем к этой вкладке, если его тут ещё нет
  const insertPage = useCallback(
    (page: PageMeta, file: SourceFile, at: number, label = 'перенос страницы') => {
      if (!filesRef.current.some((f) => f.id === file.id)) {
        // Байты и сам документ общие: второй раз файл не читается.
        // Отмечаемся совладельцем, чтобы файл не пропал вместе
        // с закрытием вкладки, откуда пришла страница
        holdFiles(ownerId, [file.id]);
        filesRef.current = [...filesRef.current, file];
        setFiles((list) => [...list, file]);
      }

      const copy = { ...page, uid: `p${++seq}` };
      const next = [...pagesRef.current];
      next.splice(Math.max(0, Math.min(at, next.length)), 0, copy);
      apply(label, { pages: next });
      setActive(Math.max(0, Math.min(at, next.length - 1)));
    },
    [apply, ownerId],
  );

  // Перестановка страницы на новое место внутри документа
  const movePageTo = useCallback(
    (uid: string, at: number) => {
      const from = pagesRef.current.findIndex((x) => x.uid === uid);
      if (from < 0) return;
      const next = [...pagesRef.current];
      const [item] = next.splice(from, 1);
      const to = Math.max(0, Math.min(at > from ? at - 1 : at, next.length));
      next.splice(to, 0, item);
      if (to === from) return;
      apply('перемещение страницы', { pages: next });
      setActive(to);
    },
    [apply],
  );

  const readFile = useCallback(async (input: File | DocSource) => {
    const id = `f${++seq}`;
    const file = input instanceof File ? input : undefined;
    const name = file ? file.name : (input as DocSource).name;

    // Документ открывается по адресу: просмотрщик читает только те куски,
    // которые нужны для показываемых страниц. Первая страница появляется
    // сразу, не дожидаясь чтения файла целиком
    const own = !!file;
    const url = file ? URL.createObjectURL(file) : (input as DocSource).url;

    let doc: any;
    let openedByUrl = true;
    try {
      doc = await loadDocFromUrl(url);
    } catch {
      // Запасной путь: читаем документ целиком, как раньше
      openedByUrl = false;
      if (own) URL.revokeObjectURL(url);
      const raw = file ? await file.arrayBuffer() : await fetch(url).then((r) => r.arrayBuffer());
      doc = await loadDocFromBytes(raw);
    }

    // Байты нужны только при сохранении и печати — читаем их тогда,
    // и запоминаем, чтобы второй раз не перечитывать
    let cached: Promise<ArrayBuffer> | null = null;
    const bytes = () => {
      if (!cached) {
        cached = file ? file.arrayBuffer() : fetch(url).then((r) => r.arrayBuffer());
      }
      return cached;
    };

    const entry: SourceFile = {
      id,
      name,
      bytes,
      doc,
      size: file ? file.size : ((input as DocSource).size ?? 0),
      release: own && openedByUrl ? () => URL.revokeObjectURL(url) : undefined,
    };

    const list: PageMeta[] = Array.from({ length: doc.numPages }, (_, i) => ({
      uid: nextId(),
      src: i,
      fileId: id,
      rotation: 0,
    }));
    return { entry, list };
  }, []);

  const open = useCallback(
    async (file: File | DocSource) => {
      setLoading(true);
      try {
        // Освобождаем память только от прошлого документа этой вкладки:
        // страницы соседних вкладок остаются готовыми
        filesRef.current.forEach((f) => {
          forgetDoc(f.doc);
          closeDoc(f.doc);
          f.release?.();
        });
        const { entry, list } = await readFile(file);
        holdFiles(ownerId, [entry.id]);
        filesRef.current = [entry];
        pagesRef.current = list;
        annotsRef.current = [];
        setFiles([entry]);
        setPages(list);
        setAnnots([]);
        setName(entry.name);
        setActive(0);
        setPast([]);
        setFuture([]);
        setVersion((v) => v + 1);
      } finally {
        setLoading(false);
      }
    },
    [readFile, ownerId],
  );

  const append = useCallback(
    async (file: File) => {
      setLoading(true);
      try {
        const { entry, list } = await readFile(file);
        holdFiles(ownerId, [entry.id]);
        filesRef.current = [...filesRef.current, entry];
        setFiles((f) => [...f, entry]);
        apply('добавление файла', { pages: [...pagesRef.current, ...list] });
      } finally {
        setLoading(false);
      }
    },
    [readFile, apply, ownerId],
  );

  const rotate = useCallback(
    (uid: string, dir: number) => {
      apply('поворот страницы', {
        pages: pagesRef.current.map((x) =>
          x.uid === uid ? { ...x, rotation: (x.rotation + dir + 360) % 360 } : x,
        ),
      });
    },
    [apply],
  );

  const remove = useCallback(
    (uid: string) => {
      const idx = pagesRef.current.findIndex((x) => x.uid === uid);
      const next = pagesRef.current.filter((x) => x.uid !== uid);
      if (!next.length) return;
      apply('удаление страницы', {
        pages: next,
        annots: annotsRef.current.filter((a) => a.pageUid !== uid),
      });
      setActive((a) => Math.max(0, Math.min(a >= idx ? a - 1 : a, next.length - 1)));
    },
    [apply],
  );

  const move = useCallback(
    (uid: string, dir: number) => {
      const i = pagesRef.current.findIndex((x) => x.uid === uid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= pagesRef.current.length) return;
      const next = [...pagesRef.current];
      [next[i], next[j]] = [next[j], next[i]];
      apply('перемещение страницы', { pages: next });
      setActive(j);
    },
    [apply],
  );

  const duplicatePage = useCallback(
    (uid: string) => {
      const i = pagesRef.current.findIndex((x) => x.uid === uid);
      if (i < 0) return;
      const copy = { ...pagesRef.current[i], uid: nextId() };
      const next = [...pagesRef.current];
      next.splice(i + 1, 0, copy);
      apply('копирование страницы', { pages: next });
    },
    [apply],
  );

  const selectAllPages = useCallback(() => setActive(0), []);

  // Вкладку закрыли — освобождаем только те файлы, которыми
  // больше никто не пользуется. Страницу могли перенести к соседям,
  // и их документ обязан остаться рабочим
  useEffect(
    () => () => {
      const free = new Set(releaseOwner(ownerId, filesRef.current.map((f) => f.id)));
      filesRef.current.forEach((f) => {
        if (!free.has(f.id)) return;
        forgetDoc(f.doc);
        closeDoc(f.doc);
        f.release?.();
      });
      filesRef.current = [];
    },
    [ownerId],
  );

  const reset = useCallback(() => {
    const free = new Set(releaseOwner(ownerId, filesRef.current.map((f) => f.id)));
    filesRef.current.forEach((f) => {
      if (!free.has(f.id)) return;
      forgetDoc(f.doc);
      closeDoc(f.doc);
      f.release?.();
    });
    filesRef.current = [];
    pagesRef.current = [];
    annotsRef.current = [];
    setFiles([]);
    setPages([]);
    setAnnots([]);
    setName('');
    setActive(0);
    setPast([]);
    setFuture([]);
    setVersion((v) => v + 1);
  }, [ownerId]);

  const docOf = useCallback(
    (p: PageMeta) => filesRef.current.find((f) => f.id === p.fileId)?.doc,
    [],
  );

  const buildPdf = useCallback(
    async (
      subset?: PageMeta[],
      layout: Layout = DEFAULT_LAYOUT,
      onStep?: (done: number, total: number) => void,
    ) => {
      const list = subset ?? pages;
      let done = 0;
      const onWork = () => onStep?.(done, list.length);
      // Сборщик PDF подключаем при сохранении, а не при запуске программы
      const { PDFDocument, degrees } = await import('pdf-lib');
      const out = await PDFDocument.create();
      const cache = new Map<string, any>();

      // Страницы копируем пачкой на каждый исходный файл, а не по одной:
      // так сборщик проходит документ один раз вместо сотни. На больших
      // документах это основная экономия времени
      const byFile = new Map<string, number[]>();
      for (const p of list) {
        const seen = byFile.get(p.fileId);
        if (seen) seen.push(p.src);
        else byFile.set(p.fileId, [p.src]);
      }

      type Copied = Awaited<ReturnType<typeof out.copyPages>>[number];
      const copiedOf = new Map<string, Map<number, Copied>>();
      for (const [fileId, srcList] of byFile) {
        const source = filesRef.current.find((f) => f.id === fileId)!;
        let lib = cache.get(fileId);
        if (!lib) {
          const raw = await source.bytes();
          lib = await PDFDocument.load(raw.slice(0), { ignoreEncryption: true });
          cache.set(fileId, lib);
        }
        // Одну и ту же страницу могли добавить дважды — копируем её один раз
        const uniq = [...new Set(srcList)];
        const got = await out.copyPages(lib, uniq);
        const slot = new Map<number, Copied>();
        uniq.forEach((s, i) => slot.set(s, got[i]));
        copiedOf.set(fileId, slot);
        onWork?.();
      }

      // Копия страницы одна на всех, а поворот у каждой свой — поэтому
      // повторные вставки той же страницы делаем отдельными копиями
      const used = new Set<string>();

      for (const p of list) {
        const key = p.fileId + ':' + p.src;
        let copied = copiedOf.get(p.fileId)!.get(p.src)!;
        if (used.has(key)) {
          [copied] = await out.copyPages(cache.get(p.fileId), [p.src]);
        }
        used.add(key);

        if (p.rotation) {
          const cur = copied.getRotation().angle;
          copied.setRotation(degrees((cur + p.rotation) % 360));
        }

        let added;
        if (layout.paper === 'original' && layout.orientation === 'auto') {
          added = out.addPage(copied);
        } else {
          const srcSize = copied.getSize();
          const rot = copied.getRotation().angle % 180 !== 0;
          const sw = rot ? srcSize.height : srcSize.width;
          const sh = rot ? srcSize.width : srcSize.height;

          let [pw, ph] =
            layout.paper === 'original' ? [sw, sh] : PAPERS[layout.paper as keyof typeof PAPERS];
          const wantLand =
            layout.orientation === 'landscape' ||
            (layout.orientation === 'auto' && sw > sh);
          if (wantLand !== pw > ph) [pw, ph] = [ph, pw];

          added = out.addPage([pw, ph]);
          const m = layout.margin;
          const availW = Math.max(1, pw - m * 2);
          const availH = Math.max(1, ph - m * 2);

          let scaleX = 1;
          let scaleY = 1;
          if (layout.fit === 'fit') {
            const s = Math.min(availW / sw, availH / sh);
            scaleX = scaleY = s;
          } else if (layout.fit === 'fill') {
            const s = Math.max(availW / sw, availH / sh);
            scaleX = scaleY = s;
          } else if (layout.fit === 'stretch') {
            scaleX = availW / sw;
            scaleY = availH / sh;
          }

          const embedded = await out.embedPage(copied);
          const dw = sw * scaleX;
          const dh = sh * scaleY;
          added.drawPage(embedded, {
            x: (pw - dw) / 2,
            y: (ph - dh) / 2,
            width: dw,
            height: dh,
          });
        }

        const marks = annots.filter((a) => a.pageUid === p.uid);
        if (marks.length) {
          const { width, height } = added.getSize();
          const k = 2;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width * k);
          canvas.height = Math.round(height * k);
          const ctx = canvas.getContext('2d')!;
          for (const m of marks) {
            const px = m.x * canvas.width;
            const py = m.y * canvas.height;
            if (m.kind === 'block') {
              ctx.fillStyle = m.color;
              ctx.fillRect(px, py, m.size * k * 8, m.size * k * 1.5);
            } else {
              ctx.fillStyle = m.color;
              ctx.font = `${m.size * k}px Inter, Arial, sans-serif`;
              ctx.textBaseline = 'top';
              ctx.fillText(m.text, px, py);
            }
          }
          const png = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
          const img = await out.embedPng(await png.arrayBuffer());
          added.drawImage(img, { x: 0, y: 0, width, height });
        }

        // Раз в несколько страниц отдаём управление окну: так видно
        // ход работы, а программа не выглядит зависшей
        done++;
        if (done % 25 === 0) {
          onWork();
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      onStep?.(list.length, list.length);
      return out.save();
    },
    [pages, annots],
  );

  const value = useMemo(
    () => ({
      annots,
      addAnnot,
      updateAnnot,
      removeAnnot,
      clearAnnots,
      files,
      pages,
      name,
      loading,
      active,
      setActive,
      open,
      append,
      rotate,
      remove,
      move,
      movePageTo,
      insertPage,
      duplicatePage,
      selectAllPages,
      reset,
      docOf,
      buildPdf,
      version,
      undo,
      redo,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undoLabel: past.length ? past[past.length - 1].label : '',
      redoLabel: future.length ? future[0].label : '',
    }),
    [
      annots,
      addAnnot,
      updateAnnot,
      removeAnnot,
      clearAnnots,
      files,
      pages,
      name,
      loading,
      active,
      open,
      append,
      rotate,
      remove,
      move,
      movePageTo,
      insertPage,
      duplicatePage,
      selectAllPages,
      reset,
      docOf,
      buildPdf,
      version,
      undo,
      redo,
      past,
      future,
    ],
  );

  return <DocCtx.Provider value={value}>{children}</DocCtx.Provider>;
};

export const useDoc = () => {
  const ctx = useContext(DocCtx);
  if (!ctx) throw new Error('useDoc must be used inside DocProvider');
  return ctx;
};