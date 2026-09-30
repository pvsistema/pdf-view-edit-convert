import { useMemo, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import type { SpellFix } from '@/lib/spell/fixWords';

// Поле распознанного текста с подсветкой слов, исправленных по словарю.
//
// Обычное поле ввода не умеет раскрашивать отдельные слова. Поэтому под
// ним лежит слой с тем же текстом, тем же шрифтом и переносами, где
// исправленные слова залиты жёлтым. Само поле прозрачное, и подсветка
// видна сквозь него. Печатать и править можно как обычно.

type Props = {
  value: string;
  onChange: (v: string) => void;
  fixes: SpellFix[];
  onFixesChange: (f: SpellFix[]) => void;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Одинаковый вид поля и слоя подсветки — иначе подсветка «съезжает»
const BOX =
  'w-full whitespace-pre-wrap break-words border border-transparent p-3 font-[inherit] text-[0.82rem] leading-relaxed [scrollbar-gutter:stable]';

const OcrTextBox = ({ value, onChange, fixes, onFixesChange }: Props) => {
  const area = useRef<HTMLTextAreaElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState(true);
  const [pos, setPos] = useState(0);

  // Слова, на которые заменено. Одно и то же слово могло исправляться
  // несколько раз — ищем все его места
  const targets = useMemo(() => [...new Set(fixes.map((f) => f.to))], [fixes]);
  const wasOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fixes) m.set(f.to, f.from);
    return m;
  }, [fixes]);

  // Места исправленных слов в тексте: только целые слова
  const spots = useMemo(() => {
    if (!targets.length) return [] as { at: number; len: number; word: string }[];
    const re = new RegExp(
      `(?<![А-Яа-яЁёA-Za-z0-9])(${targets.map(esc).join('|')})(?![А-Яа-яЁёA-Za-z0-9])`,
      'g',
    );
    const out: { at: number; len: number; word: string }[] = [];
    for (const m of value.matchAll(re)) out.push({ at: m.index!, len: m[0].length, word: m[0] });
    return out;
  }, [value, targets]);

  const show = marks && spots.length > 0;

  const pieces = useMemo(() => {
    if (!show) return null;
    const out: React.ReactNode[] = [];
    let last = 0;
    spots.forEach((s, k) => {
      out.push(value.slice(last, s.at));
      out.push(
        <mark key={k} className="rounded-[2px] bg-yellow-300/70 text-transparent dark:bg-yellow-500/40">
          {value.slice(s.at, s.at + s.len)}
        </mark>,
      );
      last = s.at + s.len;
    });
    // Лишний перевод строки в конце: иначе последняя пустая строка поля
    // не отражается в слое и прокрутка расходится
    out.push(value.slice(last) + '\n');
    return out;
  }, [show, spots, value]);

  const syncScroll = () => {
    if (layer.current && area.current) layer.current.scrollTop = area.current.scrollTop;
  };

  // Переход к следующему исправленному слову: курсор встаёт на слово
  // и выделяет его — сразу видно, где оно, и можно исправить вручную
  const jump = () => {
    if (!spots.length || !area.current) return;
    const s = spots[pos % spots.length];
    const el = area.current;
    el.focus();
    el.setSelectionRange(s.at, s.at + s.len);
    // Прокручиваем поле к выделенному слову
    const before = value.slice(0, s.at).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.scrollTop = Math.max(0, before * lh - el.clientHeight / 3);
    syncScroll();
    setPos((p) => (p + 1) % spots.length);
  };

  // Вернуть слово, которое прочитал движок, если исправление неверное
  const undoAt = () => {
    const el = area.current;
    if (!el) return;
    const at = el.selectionStart;
    const s = spots.find((x) => at >= x.at && at <= x.at + x.len);
    if (!s) return;
    const was = wasOf.get(s.word);
    if (!was) return;
    onChange(value.slice(0, s.at) + was + value.slice(s.at + s.len));
    // Слово больше не считается исправленным, если других его мест нет
    if (spots.filter((x) => x.word === s.word).length === 1)
      onFixesChange(fixes.filter((f) => f.to !== s.word));
  };

  // Считаем исправления, а не места в тексте: одно и то же слово
  // может встречаться и там, где движок прочитал его верно
  const count = fixes.length;
  const noun =
    count % 10 === 1 && count % 100 !== 11
      ? 'слово'
      : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)
        ? 'слова'
        : 'слов';

  return (
    <div className="mt-3">
      {fixes.length > 0 && (
        <div className="mb-2 text-[0.74rem]">
          <span className="block">
            <mark className="rounded-[2px] bg-yellow-300/70 px-1 text-foreground dark:bg-yellow-500/40">
              Исправлено по словарю: {count} {noun}
            </mark>
          </span>
          {spots.length > 0 && (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <button
                onClick={jump}
                className="flex items-center gap-1 font-bold text-primary hover:underline"
                title="Выделить следующее исправленное слово"
              >
                <Icon name="ChevronDown" size={12} />
                Следующее
              </button>
              <button
                onClick={undoAt}
                className="flex items-center gap-1 font-bold text-primary hover:underline"
                title="Поставьте курсор на подсвеченное слово — вернётся то, что прочитал движок"
              >
                <Icon name="Undo2" size={12} />
                Вернуть как было
              </button>
              <button
                onClick={() => setMarks((v) => !v)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Icon name={marks ? 'EyeOff' : 'Eye'} size={12} />
                {marks ? 'Скрыть' : 'Показать'}
              </button>
            </span>
          )}
        </div>
      )}

      <div className="relative border border-border bg-background focus-within:border-primary">
        {show && (
          <div
            ref={layer}
            aria-hidden
            className={`${BOX} pointer-events-none absolute inset-0 overflow-hidden text-transparent`}
          >
            {pieces}
          </div>
        )}
        <textarea
          ref={area}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          rows={12}
          spellCheck={false}
          className={`${BOX} relative block resize-y bg-transparent outline-none`}
        />
      </div>

      {show && (
        <p className="mt-1.5 text-[0.72rem] leading-snug text-muted-foreground">
          Поставьте курсор на подсвеченное слово и нажмите «Вернуть как было», если исправление неверное
        </p>
      )}
    </div>
  );
};

export default OcrTextBox;
