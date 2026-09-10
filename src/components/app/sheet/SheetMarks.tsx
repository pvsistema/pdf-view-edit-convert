import Icon from '@/components/ui/icon';
import Shape from '@/components/app/Shape';
import type { Annot } from '@/context/DocContext';

// Светлый ли цвет: на белом листе такую заливку почти не видно
const isPale = (hex: string) => {
  const v = hex.replace('#', '');
  if (v.length < 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 190;
};

// Пометки, поставленные на лист: фигуры, маркер, подчёркивание,
// закраска и надписи. У каждой по наведению появляется крестик
const SheetMarks = ({
  marks,
  width,
  height,
  onRemoveMark,
}: {
  marks: Annot[];
  width: number;
  height: number;
  onRemoveMark: (id: string) => void;
}) => (
  <>
    {marks.map((m) => (
      <div
        key={m.id}
        className="group absolute"
        style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
      >
        {m.kind === 'arrow' || m.kind === 'line' || m.kind === 'rect' || m.kind === 'oval' ? (
          // Фигуры рисуем вектором: они остаются чёткими на любом
          // масштабе и не съедают память под большие картинки
          <Shape
            kind={m.kind}
            color={m.color}
            w={(m.w ?? 0.1) * width}
            h={(m.h ?? 0.05) * height}
            flipX={m.flipX}
            flipY={m.flipY}
          />
        ) : m.kind === 'mark' ? (
          // Маркер: полупрозрачная полоса поверх строки.
          // Умножение цветов оставляет буквы читаемыми — как настоящий
          // текстовыделитель по бумаге
          <div
            className="mix-blend-multiply"
            style={{
              background: m.color,
              width: m.w ? `${m.w * width}px` : `${m.size * 8}px`,
              height: m.h ? `${m.h * height}px` : `${m.size * 1.5}px`,
            }}
          />
        ) : m.kind === 'under' || m.kind === 'strike' ? (
          // Линия под текстом или поперёк него: толщину берём от высоты
          // строки, чтобы на любом масштабе выглядела одинаково
          <div
            style={{
              width: m.w ? `${m.w * width}px` : `${m.size * 8}px`,
              height: m.h ? `${m.h * height}px` : `${m.size * 1.5}px`,
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: `${Math.max(1.2, (m.h ? m.h * height : m.size * 1.5) * 0.07)}px`,
                background: m.color,
                // Подчёркивание ведём по самому низу строки, иначе
                // линия липнет к буквам и читается как зачёркивание
                top: m.kind === 'under' ? undefined : '50%',
                bottom: m.kind === 'under' ? '-6%' : undefined,
                transform: m.kind === 'strike' ? 'translateY(-50%)' : undefined,
              }}
            />
          </div>
        ) : m.kind === 'block' ? (
          <div
            style={{
              background: m.color,
              // Пометка по выделенному тексту закрывает ровно его,
              // поэтому размеры считаем от страницы, а не от шрифта
              width: m.w ? `${m.w * width}px` : `${m.size * 8}px`,
              height: m.h ? `${m.h * height}px` : `${m.size * 1.5}px`,
              // Светлую заливку на белом листе не видно — обводим её
              // еле заметной рамкой, чтобы пометку можно было найти
              // и убрать. В сохранённый файл рамка не попадает
              outline: isPale(m.color) ? '1px dashed rgba(20,24,28,.28)' : undefined,
            }}
          />
        ) : (
          <span style={{ color: m.color, fontSize: `${m.size}px`, whiteSpace: 'nowrap' }}>
            {m.text}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemoveMark(m.id);
          }}
          className="absolute -right-5 -top-2 hidden bg-destructive p-0.5 text-destructive-foreground group-hover:block"
          title="Удалить"
        >
          <Icon name="X" size={12} />
        </button>
      </div>
    ))}
  </>
);

export default SheetMarks;
