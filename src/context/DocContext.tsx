import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { clearPageCache, loadDoc, pdfjsLib } from '@/lib/pdf';

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

export type SourceFile = {
  id: string;
  name: string;
  bytes: ArrayBuffer;
  doc: any;
  size: number;
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
  setActive: (i: number) => void;
  open: (file: File) => Promise<void>;
  append: (file: File) => Promise<void>;
  rotate: (uid: string, dir: number) => void;
  remove: (uid: string) => void;
  move: (uid: string, dir: number) => void;
  reset: () => void;
  docOf: (p: PageMeta) => any;
  buildPdf: (subset?: PageMeta[], layout?: Layout) => Promise<Uint8Array>;
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

  const readFile = useCallback(async (file: File) => {
    const bytes = await file.arrayBuffer();
    const doc = await loadDoc(bytes);
    const id = `f${++seq}`;
    const entry: SourceFile = { id, name: file.name, bytes, doc, size: file.size };
    const list: PageMeta[] = Array.from({ length: doc.numPages }, (_, i) => ({
      uid: nextId(),
      src: i,
      fileId: id,
      rotation: 0,
    }));
    return { entry, list };
  }, []);

  const open = useCallback(
    async (file: File) => {
      setLoading(true);
      try {
        // Освобождаем память от страниц прошлого документа
        clearPageCache();
        const { entry, list } = await readFile(file);
        filesRef.current = [entry];
        pagesRef.current = list;
        annotsRef.current = [];
        setFiles([entry]);
        setPages(list);
        setAnnots([]);
        setName(file.name);
        setActive(0);
        setPast([]);
        setFuture([]);
        setVersion((v) => v + 1);
      } finally {
        setLoading(false);
      }
    },
    [readFile],
  );

  const append = useCallback(
    async (file: File) => {
      setLoading(true);
      try {
        const { entry, list } = await readFile(file);
        filesRef.current = [...filesRef.current, entry];
        setFiles((f) => [...f, entry]);
        apply('добавление файла', { pages: [...pagesRef.current, ...list] });
      } finally {
        setLoading(false);
      }
    },
    [readFile, apply],
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

  const reset = useCallback(() => {
    clearPageCache();
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
  }, []);

  const docOf = useCallback(
    (p: PageMeta) => filesRef.current.find((f) => f.id === p.fileId)?.doc,
    [],
  );

  const buildPdf = useCallback(
    async (subset?: PageMeta[], layout: Layout = DEFAULT_LAYOUT) => {
      const list = subset ?? pages;
      // Сборщик PDF подключаем при сохранении, а не при запуске программы
      const { PDFDocument, degrees } = await import('pdf-lib');
      const out = await PDFDocument.create();
      const cache = new Map<string, any>();
      for (const p of list) {
        const source = filesRef.current.find((f) => f.id === p.fileId)!;
        let lib = cache.get(p.fileId);
        if (!lib) {
          lib = await PDFDocument.load(source.bytes.slice(0), { ignoreEncryption: true });
          cache.set(p.fileId, lib);
        }
        const [copied] = await out.copyPages(lib, [p.src]);
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
      }
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

export { pdfjsLib };