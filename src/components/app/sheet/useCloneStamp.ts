import { useEffect, useRef, useState } from 'react';
import type { Annot, PageMeta } from '@/context/DocContext';
import { toast } from '@/hooks/use-toast';
import { healMargin, healPatch } from '@/lib/heal';

// Точка, откуда штамп берёт «чистый» кусок листа. dx/dy — сдвиг от
// кисти до источника: он задаётся первым мазком и дальше сохраняется,
// как в режиме «Выравнивание» Фотошопа
export type StampSource = { pageUid: string; x: number; y: number; dx?: number; dy?: number };

export type StampSettings = {
  size: number;
  // 0 — жёсткий край, 100 — самый мягкий
  soft: number;
  // Восстанавливающий режим: цвет и яркость подгоняются под фон вокруг
  heal?: boolean;
  source: StampSource | null;
  setSource: (s: StampSource | null) => void;
  // Ждём щелчка, который задаст источник (вместо Alt+щелчка)
  choosing: boolean;
  setChoosing: (v: boolean) => void;
};

type Args = {
  active: boolean;
  page: PageMeta;
  marks: Annot[];
  host: React.RefObject<HTMLDivElement>;
  stamp?: StampSettings;
  onPatch?: (page: PageMeta, x: number, y: number, w: number, h: number, img: string) => void;
};

// Разобранные картинки заплаток: из них собирается «текущий вид» листа,
// чтобы штамп мог брать уже исправленные места
const pics = new Map<string, HTMLImageElement>();

const picOf = (m: Annot) => {
  if (!m.img) return null;
  let p = pics.get(m.id);
  if (!p) {
    p = new Image();
    p.src = m.img;
    pics.set(m.id, p);
  }
  return p;
};

// Штамп как в Фотошопе: Alt+щелчок задаёт источник, затем кисть
// переносит пиксели из источника туда, где помарка. Мазок копится
// на прозрачном холсте поверх листа, а по отпусканию мыши становится
// заплаткой-картинкой — её можно отменить или удалить, как любую пометку
export const useCloneStamp = ({ active, page, marks, host, stamp, onPatch }: Args) => {
  const overlay = useRef<HTMLCanvasElement>(null);
  const [ring, setRing] = useState<{ x: number; y: number; alt: boolean } | null>(null);

  const stroke = useRef<{
    src: HTMLCanvasElement;
    dab: HTMLCanvasElement;
    scale: number;
    dx: number;
    dy: number;
    last: { x: number; y: number };
    box: { x0: number; y0: number; x1: number; y1: number };
  } | null>(null);

  // Заранее разбираем картинки заплаток этой страницы
  useEffect(() => {
    marks.forEach((m) => m.kind === 'patch' && picOf(m));
  }, [marks]);

  // Ушли с инструмента — прячем кольцо кисти
  useEffect(() => {
    if (!active) setRing(null);
  }, [active]);

  const pageCanvas = () => host.current?.querySelector('canvas') as HTMLCanvasElement | null;

  const local = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { cx: e.clientX - r.left, cy: e.clientY - r.top, w: r.width, h: r.height };
  };

  // Мягкий отпечаток кисти в точке (cx, cy) — в точках холста листа
  const dabAt = (cx: number, cy: number) => {
    const s = stroke.current;
    const out = overlay.current?.getContext('2d');
    if (!s || !out || !stamp) return;

    const r = Math.max(1, (stamp.size / 2) * s.scale);
    const d = Math.ceil(r * 2) + 2;
    if (s.dab.width !== d) {
      s.dab.width = d;
      s.dab.height = d;
    }
    const t = s.dab.getContext('2d')!;
    t.globalCompositeOperation = 'copy';
    t.clearRect(0, 0, d, d);

    // Кусок из источника. Если он выходит за лист — там просто пусто
    const sx = cx + s.dx - d / 2;
    const sy = cy + s.dy - d / 2;
    t.globalCompositeOperation = 'source-over';
    t.drawImage(s.src, sx, sy, d, d, 0, 0, d, d);

    // Круглая маска с мягким краем
    const inner = r * (1 - (stamp.soft / 100) * 0.95);
    const g = t.createRadialGradient(d / 2, d / 2, Math.max(0, inner), d / 2, d / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    t.globalCompositeOperation = 'destination-in';
    t.fillStyle = g;
    t.fillRect(0, 0, d, d);

    const x0 = cx - d / 2;
    const y0 = cy - d / 2;
    out.drawImage(s.dab, x0, y0);

    s.box.x0 = Math.min(s.box.x0, x0);
    s.box.y0 = Math.min(s.box.y0, y0);
    s.box.x1 = Math.max(s.box.x1, x0 + d);
    s.box.y1 = Math.max(s.box.y1, y0 + d);
  };

  // Ведём кисть отрезком: отпечатки ставим часто, чтобы мазок был
  // сплошным даже при быстром движении мыши
  const lineTo = (cx: number, cy: number) => {
    const s = stroke.current;
    if (!s || !stamp) return;
    const step = Math.max(1, (stamp.size / 2) * s.scale * 0.22);
    const dist = Math.hypot(cx - s.last.x, cy - s.last.y);
    const n = Math.floor(dist / step);
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      dabAt(s.last.x + (cx - s.last.x) * k, s.last.y + (cy - s.last.y) * k);
    }
    if (n > 0) s.last = { x: cx, y: cy };
  };

  const down = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active || !stamp || e.button !== 0) return false;
    e.preventDefault();
    const { cx, cy, w, h } = local(e);
    const nx = cx / w;
    const ny = cy / h;

    // Alt+щелчок (или кнопка «Источник») — запоминаем, откуда брать
    if (e.altKey || stamp.choosing) {
      stamp.setSource({ pageUid: page.uid, x: nx, y: ny });
      stamp.setChoosing(false);
      return true;
    }

    const src = stamp.source;
    if (!src) {
      toast({
        title: 'Сначала выберите источник',
        description: 'Зажмите Alt и щёлкните по чистому месту листа рядом с помаркой',
      });
      return true;
    }
    if (src.pageUid !== page.uid) {
      toast({
        title: 'Источник на другой странице',
        description: 'Зажмите Alt и щёлкните по чистому месту на этой странице',
      });
      return true;
    }

    const base = pageCanvas();
    const canvas = overlay.current;
    if (!base || !canvas) return true;

    // Первый мазок задаёт сдвиг до источника — дальше он сохраняется
    let { dx, dy } = src;
    if (dx === undefined || dy === undefined) {
      dx = src.x - nx;
      dy = src.y - ny;
      stamp.setSource({ ...src, dx, dy });
    }

    // Холст мазка в тех же точках, что и отрисованный лист
    if (canvas.width !== base.width || canvas.height !== base.height) {
      canvas.width = base.width;
      canvas.height = base.height;
    }
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);

    // Источник — лист вместе с уже поставленными заплатками
    const S = document.createElement('canvas');
    S.width = base.width;
    S.height = base.height;
    const sc = S.getContext('2d')!;
    sc.drawImage(base, 0, 0);
    for (const m of marks) {
      if (m.kind !== 'patch') continue;
      const p = picOf(m);
      if (p && p.complete && p.naturalWidth)
        sc.drawImage(p, m.x * S.width, m.y * S.height, (m.w ?? 0) * S.width, (m.h ?? 0) * S.height);
    }

    const scale = base.width / w;
    const px = cx * scale;
    const py = cy * scale;
    stroke.current = {
      src: S,
      dab: document.createElement('canvas'),
      scale,
      dx: dx * base.width,
      dy: dy * base.height,
      last: { x: px, y: py },
      box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
    };
    dabAt(px, py);
    return true;
  };

  const move = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active) return;
    const { cx, cy } = local(e);
    setRing({ x: cx, y: cy, alt: e.altKey || !!stamp?.choosing });
    const s = stroke.current;
    if (s) lineTo(cx * s.scale, cy * s.scale);
  };

  const up = () => {
    const s = stroke.current;
    stroke.current = null;
    const canvas = overlay.current;
    if (!s || !canvas) return;

    let x0 = Math.max(0, Math.floor(s.box.x0));
    let y0 = Math.max(0, Math.floor(s.box.y0));
    let x1 = Math.min(canvas.width, Math.ceil(s.box.x1));
    let y1 = Math.min(canvas.height, Math.ceil(s.box.y1));
    if (x1 - x0 < 2 || y1 - y0 < 2) return;

    let cut: HTMLCanvasElement;
    if (stamp?.heal) {
      // Восстановление: берём полоску вокруг мазка — по ней узнаём,
      // какого цвета и яркости фон, и подгоняем под него заплатку
      const pad = healMargin(x1 - x0, y1 - y0);
      x0 = Math.max(0, x0 - pad);
      y0 = Math.max(0, y0 - pad);
      x1 = Math.min(canvas.width, x1 + pad);
      y1 = Math.min(canvas.height, y1 + pad);
      try {
        cut = healPatch(s.src, canvas, x0, y0, x1 - x0, y1 - y0, s.dx, s.dy);
      } catch {
        cut = document.createElement('canvas');
        cut.width = x1 - x0;
        cut.height = y1 - y0;
        cut.getContext('2d')!.drawImage(canvas, x0, y0, cut.width, cut.height, 0, 0, cut.width, cut.height);
      }
      // На экране сразу показываем подогнанную заплатку вместо мазка
      const octx = canvas.getContext('2d')!;
      octx.clearRect(x0, y0, x1 - x0, y1 - y0);
      octx.drawImage(cut, x0, y0);
    } else {
      cut = document.createElement('canvas');
      cut.width = x1 - x0;
      cut.height = y1 - y0;
      cut.getContext('2d')!.drawImage(canvas, x0, y0, cut.width, cut.height, 0, 0, cut.width, cut.height);
    }
    const bw = x1 - x0;
    const bh = y1 - y0;
    const img = cut.toDataURL('image/png');

    onPatch?.(page, x0 / canvas.width, y0 / canvas.height, bw / canvas.width, bh / canvas.height, img);

    // Мазок убираем, когда заплатка уже нарисовалась на листе —
    // иначе место на миг мигнёт исходной помаркой
    setTimeout(() => {
      if (!stroke.current) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    }, 160);
  };

  const leave = () => {
    up();
    setRing(null);
  };

  return { overlay, ring, down, move, up, leave };
};

export default useCloneStamp;
