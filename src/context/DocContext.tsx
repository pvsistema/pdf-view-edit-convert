import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';
import { loadDoc, pdfjsLib } from '@/lib/pdf';

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
  buildPdf: (subset?: PageMeta[]) => Promise<Uint8Array>;
  version: number;
};

const DocCtx = createContext<Ctx | null>(null);

let seq = 0;
const nextId = () => `p${++seq}`;

export const DocProvider = ({ children }: { children: React.ReactNode }) => {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [version, setVersion] = useState(0);
  const [annots, setAnnots] = useState<Annot[]>([]);
  const filesRef = useRef<SourceFile[]>([]);

  const addAnnot = useCallback((a: Omit<Annot, 'id'>) => {
    setAnnots((list) => [...list, { ...a, id: `a${++seq}` }]);
  }, []);

  const updateAnnot = useCallback((id: string, patch: Partial<Annot>) => {
    setAnnots((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const removeAnnot = useCallback((id: string) => {
    setAnnots((list) => list.filter((a) => a.id !== id));
  }, []);

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
        const { entry, list } = await readFile(file);
        filesRef.current = [entry];
        setFiles([entry]);
        setPages(list);
        setName(file.name);
        setActive(0);
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
        setPages((p) => [...p, ...list]);
        setVersion((v) => v + 1);
      } finally {
        setLoading(false);
      }
    },
    [readFile],
  );

  const rotate = useCallback((uid: string, dir: number) => {
    setPages((p) =>
      p.map((x) => (x.uid === uid ? { ...x, rotation: (x.rotation + dir + 360) % 360 } : x)),
    );
    setVersion((v) => v + 1);
  }, []);

  const remove = useCallback((uid: string) => {
    setPages((p) => {
      const idx = p.findIndex((x) => x.uid === uid);
      const next = p.filter((x) => x.uid !== uid);
      setActive((a) => Math.max(0, Math.min(a >= idx ? a - 1 : a, next.length - 1)));
      return next;
    });
    setVersion((v) => v + 1);
  }, []);

  const move = useCallback((uid: string, dir: number) => {
    setPages((p) => {
      const i = p.findIndex((x) => x.uid === uid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      setActive(j);
      return next;
    });
    setVersion((v) => v + 1);
  }, []);

  const reset = useCallback(() => {
    filesRef.current = [];
    setFiles([]);
    setPages([]);
    setName('');
    setActive(0);
    setAnnots([]);
    setVersion((v) => v + 1);
  }, []);

  const docOf = useCallback(
    (p: PageMeta) => filesRef.current.find((f) => f.id === p.fileId)?.doc,
    [],
  );

  const buildPdf = useCallback(
    async (subset?: PageMeta[]) => {
      const list = subset ?? pages;
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
        const added = out.addPage(copied);
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
      reset,
      docOf,
      buildPdf,
      version,
    }),
    [
      annots,
      addAnnot,
      updateAnnot,
      removeAnnot,
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
      reset,
      docOf,
      buildPdf,
      version,
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