import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { renderPage } from '@/lib/pdf';
import { useDoc, type PageMeta } from '@/context/DocContext';
import { isDuplex, placeOnSheet, type Layout } from '@/lib/printLayout';
import type { DocMargins } from '@/lib/docMargins';

type Props = {
  page?: PageMeta;
  layout: Layout;
  index: number;
  total: number;
  // Двусторонняя печать: страница ложится на оборот листа
  back?: boolean;
  // Поля документа по тексту: по ним рисуем «просвет» — где на этом
  // листе окажется текст другой стороны
  margins?: DocMargins | null;
  // Есть ли у листа вторая сторона
  hasPair?: boolean;
};

const PrintPreview = ({ page, layout, index, total, back = false, margins, hasPair }: Props) => {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const { docOf } = useDoc();
  // Размер страницы в точках PDF, как её видно на экране
  const [srcSize, setSrcSize] = useState<[number, number]>([595, 842]);

  useEffect(() => {
    let cancelled = false;
    if (!page || !host.current) return;
    const doc = docOf(page);
    if (!doc) return;
    setReady(false);
    renderPage(doc, page.src, 0.5, page.rotation, 2).then((canvas) => {
      if (cancelled || !host.current) return;
      // Холст отрисован в масштабе 0.5 с двойной чёткостью: его ширина
      // в пикселях равна ширине страницы в точках
      setSrcSize([canvas.width, canvas.height]);
      host.current.innerHTML = '';
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      host.current.appendChild(canvas);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [page, docOf]);

  const [sw, sh] = srcSize;
  const pl = placeOnSheet(sw, sh, layout, back);
  const duplex = isDuplex(layout);

  const MAX_H = 250;
  const MAX_W = 230;
  let boxH = MAX_H;
  let boxW = (pl.pw / pl.ph) * boxH;
  if (boxW > MAX_W) {
    boxW = MAX_W;
    boxH = (pl.ph / pl.pw) * boxW;
  }
  const k = boxW / pl.pw;
  const m = layout.margin * k;

  // Страница, положенная на лист боком, рисуется повёрнутой
  const frameW = pl.w * k;
  const frameH = pl.h * k;
  const innerW = pl.turned ? frameH : frameW;
  const innerH = pl.turned ? frameW : frameH;

  // Блок текста в координатах листа (для этой страницы)
  const textBox = (p: typeof pl) =>
    margins && !p.turned
      ? {
          x: p.x + margins.left * p.w,
          y: p.y + margins.top * p.h,
          w: p.w * (1 - margins.left - margins.right),
          h: p.h * (1 - margins.top - margins.bottom),
        }
      : null;

  // Текст другой стороны «на просвет»: её раскладка, отражённая
  // по краю переворота листа
  const other = duplex && hasPair ? placeOnSheet(sw, sh, layout, !back) : null;
  const otherBox = other ? textBox(other) : null;
  const seen =
    otherBox &&
    (pl.sideways
      ? { ...otherBox, x: pl.pw - otherBox.x - otherBox.w }
      : { ...otherBox, y: pl.ph - otherBox.y - otherBox.h });
  const mine = duplex ? textBox(pl) : null;

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative overflow-hidden border border-border bg-white shadow-[3px_3px_0_hsl(var(--rule)/0.2)]"
        style={{ width: boxW, height: boxH }}
      >
        {m > 0 && (
          <div
            className="pointer-events-none absolute border border-dashed border-primary/40"
            style={{ left: m, top: m, right: m, bottom: m }}
          />
        )}
        <div
          className="absolute overflow-hidden"
          style={{ left: pl.x * k, top: pl.y * k, width: frameW, height: frameH }}
        >
          <div
            ref={host}
            className="absolute left-1/2 top-1/2"
            style={{
              width: innerW,
              height: innerH,
              transform: `translate(-50%, -50%)${pl.turned ? ' rotate(-90deg)' : ''}`,
            }}
          />
        </div>

        {mine && (
          <div
            className="pointer-events-none absolute border border-primary/50 bg-primary/5"
            style={{ left: mine.x * k, top: mine.y * k, width: mine.w * k, height: mine.h * k }}
          />
        )}
        {seen && (
          <div
            className="pointer-events-none absolute border border-dashed border-[hsl(var(--destructive))]"
            style={{ left: seen.x * k, top: seen.y * k, width: seen.w * k, height: seen.h * k }}
            title="Где на просвет виден текст другой стороны листа"
          />
        )}

        {duplex && (
          <span className="absolute left-1 top-1 bg-foreground px-1.5 py-0.5 font-head text-[0.6rem] font-bold uppercase tracking-[0.08em] text-background">
            {back ? 'Оборот' : 'Лицевая'}
          </span>
        )}

        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <Icon name="LoaderCircle" size={18} className="animate-spin text-primary" />
          </div>
        )}
      </div>
      <div className="mt-2 text-[0.76rem] text-muted-foreground">
        {total ? `Страница ${index + 1} из ${total}` : 'Нет страниц'}
      </div>
    </div>
  );
};

export default PrintPreview;
