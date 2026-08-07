import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { renderPage } from '@/lib/pdf';
import { useDoc, PAPERS, type Layout, type PageMeta } from '@/context/DocContext';

type Props = { page?: PageMeta; layout: Layout; index: number; total: number };

const PrintPreview = ({ page, layout, index, total }: Props) => {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const { docOf } = useDoc();
  const [srcSize, setSrcSize] = useState<[number, number]>([595, 842]);

  useEffect(() => {
    let cancelled = false;
    if (!page || !host.current) return;
    const doc = docOf(page);
    if (!doc) return;
    setReady(false);
    renderPage(doc, page.src, 0.5, page.rotation).then((canvas) => {
      if (cancelled || !host.current) return;
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
  let [pw, ph] = layout.paper === 'original' ? [sw, sh] : PAPERS[layout.paper as keyof typeof PAPERS];
  const wantLand = layout.orientation === 'landscape' || (layout.orientation === 'auto' && sw > sh);
  if (wantLand !== pw > ph) [pw, ph] = [ph, pw];

  const boxH = 250;
  const boxW = (pw / ph) * boxH;
  const mScale = boxW / pw;
  const m = layout.margin * mScale;
  const availW = Math.max(1, boxW - m * 2);
  const availH = Math.max(1, boxH - m * 2);

  let dw = availW;
  let dh = availH;
  if (layout.fit === 'fit') {
    const s = Math.min(availW / sw, availH / sh);
    dw = sw * s;
    dh = sh * s;
  } else if (layout.fit === 'fill') {
    const s = Math.max(availW / sw, availH / sh);
    dw = sw * s;
    dh = sh * s;
  } else if (layout.fit === 'actual') {
    dw = sw;
    dh = sh;
  }

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
          ref={host}
          className="absolute overflow-hidden"
          style={{
            width: dw,
            height: dh,
            left: (boxW - dw) / 2,
            top: (boxH - dh) / 2,
          }}
        />
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
