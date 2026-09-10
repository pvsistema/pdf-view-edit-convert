import { useRef, useState } from 'react';
import { pageText } from '@/lib/pdf';
import type { PageMeta } from '@/context/DocContext';
import type { Tool } from '@/components/app/Viewer';
import type { MenuPoint } from '@/components/app/PageMenu';
import { toast } from '@/hooks/use-toast';

type Args = {
  page: PageMeta;
  doc: any;
  tool: Tool;
  picking?: boolean;
  host: React.RefObject<HTMLDivElement>;
  onPlace: (page: PageMeta, x: number, y: number) => void;
  onCover: (page: PageMeta, x: number, y: number, w: number, h: number) => void;
  onPick?: (color: string) => void;
  onNote?: (page: PageMeta, x: number, y: number) => void;
  onShape?: (
    page: PageMeta,
    x: number,
    y: number,
    w: number,
    h: number,
    kind: 'arrow' | 'line' | 'rect' | 'oval',
    dir: { flipX: boolean; flipY: boolean },
  ) => void;
};

// Всё, что человек делает мышью по листу: меню правой кнопкой,
// щелчок пипеткой или пометкой и протяжка рамки
export const useSheetInput = ({
  page,
  doc,
  tool,
  picking,
  host,
  onPlace,
  onCover,
  onPick,
  onNote,
  onShape,
}: Args) => {
  const [menu, setMenu] = useState<MenuPoint | null>(null);

  // Правая кнопка открывает меню с копированием.
  // Если пользователь ничего не выделил, но щёлкнул по слову —
  // подхватываем это слово, чтобы копировать было что
  const rightClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== 'hand') return;
    e.preventDefault();

    const sel = window.getSelection();
    let text = sel?.toString() ?? '';
    const sheet = e.currentTarget.getBoundingClientRect();
    let spans: { x: number; y: number; w: number; h: number }[] = [];

    // Запоминаем, где именно лежит выделенное: замазывание и удаление
    // должны накрыть ровно эти слова
    const toSpan = (r: DOMRect) => ({
      x: (r.left - sheet.left) / sheet.width,
      y: (r.top - sheet.top) / sheet.height,
      w: r.width / sheet.width,
      h: r.height / sheet.height,
    });

    if (text.trim() && sel && sel.rangeCount > 0) {
      const rects = Array.from(sel.getRangeAt(0).getClientRects());
      spans = rects
        // Строки за пределами этого листа не наши: выделение могло
        // растянуться на соседние страницы ленты
        .filter((r) => r.width > 0 && r.bottom > sheet.top && r.top < sheet.bottom)
        .map(toSpan);
    }

    if (!text.trim()) {
      const target = e.target as HTMLElement | null;
      const word = target?.closest('.pvs-text-layer span');
      text = (word?.textContent ?? '').trim();
      if (word) spans = [toSpan(word.getBoundingClientRect())];
    }

    setMenu({ x: e.clientX, y: e.clientY, text, spans });
  };

  // Весь текст листа — на случай, когда выделять вручную неудобно
  const copyPageText = async () => {
    if (!doc) return;
    const text = await pageText(doc, page.src);
    if (!text.trim()) {
      toast({
        title: 'На странице нет текста',
        description: 'Похоже, это скан. Распознайте его в инструментах',
      });
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => toast({ title: 'Текст страницы скопирован' }))
      .catch(() => toast({ title: 'Не удалось скопировать' }));
  };

  const click = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();

    // Пипетка: берём цвет ровно той точки листа, куда попал курсор
    if (picking) {
      const canvas = host.current?.querySelector('canvas') as HTMLCanvasElement | null;
      if (!canvas) return;
      const px = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
      const py = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const data = ctx?.getImageData(px, py, 1, 1).data;
      if (!data) return;
      const hex = `#${[data[0], data[1], data[2]]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')}`.toUpperCase();
      onPick?.(hex);
      return;
    }

    // Заметка встаёт там, куда щёлкнули: значок остаётся на листе,
    // а сам текст живёт в панели замечаний
    if (tool === 'note') {
      onNote?.(page, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      return;
    }

    // Надпись ставится щелчком, а закраска — протяжкой,
    // поэтому по щелчку её не создаём
    if (tool !== 'text') return;
    onPlace(page, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  };

  // Рамка, которую человек тянет мышью, чтобы закрасить область целиком
  const [frame, setFrame] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null,
  );
  const dragging = useRef(false);

  const spot = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  // Протяжкой мыши рисуются и закраска, и фигуры
  const DRAWN = ['block', 'arrow', 'line', 'rect', 'oval'];

  const dragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    // Пока включена пипетка, рамку не тянем: щелчок берёт цвет
    if (!DRAWN.includes(tool) || e.button !== 0 || picking) return;
    e.preventDefault();
    const p = spot(e);
    dragging.current = true;
    setFrame({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  };

  const dragMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const p = spot(e);
    setFrame((f) => (f ? { ...f, x2: p.x, y2: p.y } : f));
  };

  const dragEnd = () => {
    if (!dragging.current || !frame) return;
    dragging.current = false;
    const x = Math.min(frame.x1, frame.x2);
    const y = Math.min(frame.y1, frame.y2);
    const w = Math.abs(frame.x2 - frame.x1);
    const h = Math.abs(frame.y2 - frame.y1);
    setFrame(null);

    // Фигуры: стрелка и линия могут быть почти вертикальными или
    // горизонтальными, поэтому им хватает длины хотя бы по одной стороне
    if (tool !== 'block') {
      const thin = tool === 'arrow' || tool === 'line';
      if (thin ? w < 0.01 && h < 0.01 : w < 0.01 || h < 0.01) return;
      onShape?.(page, x, y, w, h, tool as 'arrow' | 'line' | 'rect' | 'oval', {
        flipX: frame.x2 < frame.x1,
        flipY: frame.y2 < frame.y1,
      });
      return;
    }

    // Случайный щелчок без протяжки не должен оставлять точку на листе
    if (w < 0.004 || h < 0.004) return;
    onCover(page, x, y, w, h);
  };

  return {
    menu,
    setMenu,
    rightClick,
    copyPageText,
    click,
    frame,
    dragStart,
    dragMove,
    dragEnd,
  };
};

export default useSheetInput;
