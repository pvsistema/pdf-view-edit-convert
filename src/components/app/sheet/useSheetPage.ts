import { useEffect, useRef, useState } from 'react';
import { renderPage, pageSize, screenDensity, findOnPage, PRIORITY, type TextHit } from '@/lib/pdf';
import type { PageMeta } from '@/context/DocContext';

type Args = {
  page: PageMeta;
  zoom: number;
  doc: any;
  found: string;
};

// Вся «жизнь» листа в ленте: следит, близко ли он к экрану, рисует
// картинку, узнаёт размер и ищет совпадения. Вынесено отдельно, чтобы
// сам лист занимался только показом
export const useSheetPage = ({ page, zoom, doc, found }: Args) => {
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [spots, setSpots] = useState<TextHit[]>([]);

  // Следим, близко ли лист к экрану
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setNear(entries[0]?.isIntersecting ?? false), {
      root: null,
      rootMargin: '900px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Точный размер узнаём только у листов рядом с экраном. Иначе документ
  // на тысячу страниц пришлось бы прочитать целиком ради одних размеров
  useEffect(() => {
    let off = false;
    if (!doc || !near) return;
    pageSize(doc, page.src, page.rotation)
      .then((s) => !off && setSize(s))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [doc, page.src, page.rotation, near]);

  useEffect(() => {
    let off = false;
    if (!near) {
      // Лист далеко — освобождаем картинку, память не копится
      if (host.current) host.current.innerHTML = '';
      setDrawn(false);
      return;
    }
    if (!doc) return;
    renderPage(doc, page.src, zoom, page.rotation, screenDensity(), PRIORITY.view)
      .then((canvas) => {
        if (off || !host.current) return;
        host.current.innerHTML = '';
        canvas.className = 'block';
        host.current.appendChild(canvas);
        setDrawn(true);
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [near, doc, page.src, page.rotation, zoom]);

  // Подсветка найденного
  useEffect(() => {
    let off = false;
    if (!found || !near || !doc) {
      setSpots([]);
      return;
    }
    findOnPage(doc, page.src, found, page.rotation)
      .then((list) => !off && setSpots(list))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [found, near, doc, page.src, page.rotation]);

  return { box, host, near, drawn, size, spots };
};

export default useSheetPage;
