type Props = {
  kind: 'arrow' | 'line' | 'rect' | 'oval';
  color: string;
  // Размеры в точках экрана
  w: number;
  h: number;
  // Протяжку вели справа налево или снизу вверх
  flipX?: boolean;
  flipY?: boolean;
};

// Фигуры поверх страницы: стрелка, линия, рамка и овал.
// Рисуются вектором, поэтому остаются чёткими при увеличении
const Shape = ({ kind, color, w, h, flipX, flipY }: Props) => {
  const bw = Math.max(1, w);
  const bh = Math.max(1, h);
  // Толщина линии от размера фигуры, но в разумных пределах:
  // мелкая пометка не превращается в кляксу, крупная — в паутинку
  const thick = Math.min(6, Math.max(1.6, Math.min(bw, bh) * 0.035 + 1.4));
  // Поле вокруг, чтобы наконечник и толстая обводка не срезались краем
  const pad = thick * 3;

  // Направление протяжки: стрелка смотрит туда, куда её вели
  const x1 = flipX ? bw : 0;
  const y1 = flipY ? bh : 0;
  const x2 = flipX ? 0 : bw;
  const y2 = flipY ? 0 : bh;

  const common = {
    stroke: color,
    strokeWidth: thick,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <svg
      width={bw + pad * 2}
      height={bh + pad * 2}
      style={{ position: 'absolute', left: -pad, top: -pad, overflow: 'visible' }}
      viewBox={`${-pad} ${-pad} ${bw + pad * 2} ${bh + pad * 2}`}
    >
      {kind === 'rect' && <rect x={0} y={0} width={bw} height={bh} {...common} />}

      {kind === 'oval' && (
        <ellipse cx={bw / 2} cy={bh / 2} rx={bw / 2} ry={bh / 2} {...common} />
      )}

      {(kind === 'line' || kind === 'arrow') && (
        <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
      )}

      {kind === 'arrow' &&
        (() => {
          // Наконечник строим по направлению линии: две коротких черты
          // под углом к её концу
          const ang = Math.atan2(y2 - y1, x2 - x1);
          const len = Math.min(22, Math.max(9, Math.hypot(bw, bh) * 0.18));
          const spread = 0.42;
          const p1 = [x2 - len * Math.cos(ang - spread), y2 - len * Math.sin(ang - spread)];
          const p2 = [x2 - len * Math.cos(ang + spread), y2 - len * Math.sin(ang + spread)];
          return (
            <polyline points={`${p1[0]},${p1[1]} ${x2},${y2} ${p2[0]},${p2[1]}`} {...common} />
          );
        })()}
    </svg>
  );
};

export default Shape;
