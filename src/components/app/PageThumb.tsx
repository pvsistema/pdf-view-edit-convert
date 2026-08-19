import { memo, useEffect, useRef, useState } from 'react';
import { renderPage, screenDensity, PRIORITY } from '@/lib/pdf';
import type { PageMeta } from '@/context/DocContext';
import { useDoc } from '@/context/DocContext';

type Props = {
  page: PageMeta;
  scale?: number;
  className?: string;
};

const PageThumb = ({ page, scale = 0.28, className = '' }: Props) => {
  const box = useRef<HTMLDivElement>(null);
  const { docOf } = useDoc();
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);

  // Рисуем только те миниатюры, которые попали в видимую часть списка.
  // В документе на 200 страниц это экономит сотни лишних отрисовок
  useEffect(() => {
    const el = box.current?.parentElement;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: null, rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!visible) return;
    const doc = docOf(page);
    if (!doc || !box.current) return;
    setReady(false);
    renderPage(doc, page.src, scale, page.rotation, screenDensity() * 1.6, PRIORITY.thumb).then(
      (canvas) => {
        if (cancelled || !box.current) return;
        box.current.innerHTML = '';
        canvas.className = 'block h-auto w-full';
        canvas.style.width = '';
        canvas.style.height = '';
        box.current.appendChild(canvas);
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [page, page.rotation, scale, docOf, visible]);

  return (
    <div className={`relative bg-white ${className}`}>
      <div ref={box} />
      {!ready && <div className="aspect-[1/1.414] w-full animate-pulse bg-muted" />}
    </div>
  );
};

export default memo(PageThumb);
