import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pageTextLayout, type TextPiece } from '@/lib/pdf';

type Props = {
  doc: any;
  pageIndex: number;
  rotation: number;
  width: number;
  height: number;
  active: boolean;
};

// Невидимый слой с настоящим текстом страницы поверх картинки.
// Благодаря ему текст в документе можно выделять мышью и копировать,
// как на обычной веб-странице
const TextLayer = ({ doc, pageIndex, rotation, width, height, active }: Props) => {
  const [pieces, setPieces] = useState<TextPiece[] | null>(null);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let off = false;
    if (!doc || !active) return;
    pageTextLayout(doc, pageIndex, rotation)
      .then((list) => !off && setPieces(list))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [doc, pageIndex, rotation, active]);

  // Подгоняем ширину каждого кусочка под ту, что он занимает в документе.
  // Без этого выделение уезжает: шрифт на экране шире или уже исходного
  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !pieces?.length) return;
    const spans = el.children;
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i] as HTMLElement;
      const want = pieces[i].w * width;
      if (want <= 0) continue;
      span.style.transform = '';
      const real = span.getBoundingClientRect().width;
      if (!real) continue;
      const scaleX = want / real;
      const turn = pieces[i].angle ? `rotate(${pieces[i].angle}rad) ` : '';
      span.style.transform = `${turn}scaleX(${scaleX})`;
    }
  }, [pieces, width, height]);

  if (!pieces?.length) return null;

  return (
    <div
      ref={host}
      className="pvs-text-layer absolute inset-0"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${p.x * 100}%`,
            top: `${p.y * 100}%`,
            fontSize: `${p.h * height}px`,
          }}
        >
          {p.str}
        </span>
      ))}
    </div>
  );
};

export default TextLayer;