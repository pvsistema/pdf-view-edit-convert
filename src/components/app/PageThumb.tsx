import { useEffect, useRef, useState } from 'react';
import { renderPage } from '@/lib/pdf';
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

  useEffect(() => {
    let cancelled = false;
    const doc = docOf(page);
    if (!doc || !box.current) return;
    setReady(false);
    renderPage(doc, page.src, scale, page.rotation).then((canvas) => {
      if (cancelled || !box.current) return;
      box.current.innerHTML = '';
      canvas.className = 'block h-auto w-full';
      box.current.appendChild(canvas);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [page, page.rotation, scale, docOf]);

  return (
    <div className={`relative bg-white ${className}`}>
      <div ref={box} />
      {!ready && <div className="aspect-[1/1.414] w-full animate-pulse bg-muted" />}
    </div>
  );
};

export default PageThumb;
