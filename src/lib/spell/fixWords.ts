// Исправление ошибок распознавания по словарю.
//
// Движок путает похожие по рисунку буквы: «и» и «н», «ь» и «в», русскую
// «о» и латинскую «o», «3» и «З». Получается «оргаиизация» вместо
// «организации». Здесь каждое слово проверяется по русскому словарю,
// и если его там нет — ищется ближайшее верное.
//
// Правим осторожно, чтобы не испортить верный текст:
// - только слова, в которых сам движок не уверен;
// - только замену похожих по виду букв, а не любую опечатку;
// - только если верный вариант один;
// - фамилии, сокращения, числа и слова из списка терминов не трогаем.

import { MINING_TERMS, TERMS_KEY, readTerms } from '@/lib/spell/terms';

// Пары букв, которые движок путает на сканах. Замена одной на другую —
// признак ошибки распознавания, а не опечатки автора
const LOOKALIKE: [string, string][] = [
  ['и', 'н'], ['и', 'п'], ['н', 'п'], ['л', 'п'], ['и', 'й'], ['ь', 'ы'], ['ь', 'в'],
  ['ь', 'б'], ['ш', 'щ'], ['ц', 'щ'], ['е', 'с'], ['е', 'ё'], ['з', 'э'], ['з', '3'],
  ['о', '0'], ['ч', '4'], ['б', '6'], ['к', 'х'], ['т', 'г'], ['ж', 'х'], ['е', 'я'],
  ['а', 'в'],
  // Латиница, похожая на кириллицу
  ['а', 'a'], ['в', 'b'], ['е', 'e'], ['к', 'k'], ['м', 'm'], ['н', 'h'], ['о', 'o'],
  ['р', 'p'], ['с', 'c'], ['т', 't'], ['у', 'y'], ['х', 'x'], ['и', 'u'], ['п', 'n'],
  ['ь', 'b'], ['г', 'r'], ['і', 'и'], ['і', 'ы'],
];
// Намеренно НЕ включены «о» и «а», «р» и «о», «в» и «з»: в русском
// много настоящих слов, различающихся ровно ими («выпал» и «выпол…»,
// «стенок» и «стеноз»), и замена портила бы верный текст
const PAIRS = new Set(LOOKALIKE.flatMap(([a, b]) => [a + b, b + a]));

const lower = (s: string) => s.toLowerCase();

// Одна буква заменена на похожую по виду — сколько таких замен нужно,
// чтобы из прочитанного получилось словарное слово. Если слова разной
// длины или отличаются непохожими буквами — это не ошибка движка
const lookalikeSteps = (read: string, right: string) => {
  const a = lower(read);
  const b = lower(right);
  if (a.length !== b.length) {
    // Движок иногда разбивает «ы» на «ьі» / «ь|» — одна лишняя буква
    if (a.length === b.length + 1) {
      for (let k = 0; k < b.length; k++) {
        if (a[k] === b[k]) continue;
        const pair = a.slice(k, k + 2);
        if (b[k] === 'ы' && /^ь[іi|1l]$/.test(pair) && a.slice(k + 2) === b.slice(k + 1)) return 1;
        return -1;
      }
    }
    return -1;
  }
  let steps = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] === b[k]) continue;
    if (!PAIRS.has(a[k] + b[k])) return -1;
    steps++;
  }
  return steps;
};

// Слово, которое проверять не нужно: числа, сокращения из заглавных
// («ООО», «ВГСЧ»), слова с дефисом и точкой внутри, короткие
// Короче шести букв — часто обрывок слова, разорванного движком
// («прое|ктом»), а у обрывка «правильных» вариантов слишком много
const skip = (w: string) =>
  w.length < 6 ||
  !/[а-яё]/i.test(w) ||
  /^[А-ЯЁA-Z0-9]+$/.test(w) ||
  /\d.*\d/.test(w) ||
  /[.\-/]/.test(w);

// Слово с заглавной посреди предложения — скорее всего фамилия или
// название. Их в словаре нет, и «исправлять» их нельзя
const properName = (w: string, first: boolean) => !first && /^[А-ЯЁ]/.test(w);

// Регистр исходного слова переносим на исправленное
const keepCase = (orig: string, fixed: string) => {
  if (orig === orig.toUpperCase()) return fixed.toUpperCase();
  if (/^[А-ЯЁA-Z]/.test(orig)) return fixed[0].toUpperCase() + fixed.slice(1);
  return fixed;
};

export type OcrWord = { text?: string; confidence?: number };
type Line = { words?: OcrWord[] };
type Block = { paragraphs?: { lines?: Line[] }[] };

type Checker = (words: string[]) => Promise<Record<string, string[] | true>>;

// Уверенность, ниже которой слово проверяется. Ошибочное слово движок
// бывает читает и с уверенностью 90: «полеречного», «представлеет».
// Верному слову проверка ничем не грозит — словарь его узнает
const DOUBT = 95;

// Чистое слово без знаков препинания по краям
const core = (t: string) => {
  const m = t.match(/^([«"([]*)(.*?)([»")\].,;:!?]*)$/);
  return m ? { pre: m[1], word: m[2], post: m[3] } : { pre: '', word: t, post: '' };
};

// Исправляет слова в разметке листа прямо на месте. Возвращает число
// исправленных слов
export const fixWords = async (blocks: Block[] | null | undefined, check: Checker) => {
  if (!blocks) return 0;
  const terms = new Set([...MINING_TERMS, ...readTerms()].map(lower));

  // Собираем сомнительные слова со всего листа, чтобы проверить их
  // одним заходом
  // name — слово с заглавной посреди строки: фамилия или название.
  // Его правим только на слово из списка терминов
  type Slot = { w: OcrWord; pre: string; word: string; post: string; name: boolean };
  const slots: Slot[] = [];
  for (const b of blocks)
    for (const p of b.paragraphs || [])
      for (const l of p.lines || []) {
        const ws = l.words || [];
        ws.forEach((w, k) => {
          const t = (w.text || '').trim();
          if (!t || (w.confidence ?? 100) >= DOUBT) return;
          const c = core(t);
          if (skip(c.word) || terms.has(lower(c.word))) return;
          slots.push({ w, ...c, name: properName(c.word, k === 0) });
        });
      }
  if (!slots.length) return 0;

  const verdict = await check([...new Set(slots.map((s) => s.word))]);

  let fixed = 0;
  for (const s of slots) {
    const v = verdict[s.word];
    if (!v || v === true) continue;
    const good = v.filter(
      (c) =>
        lookalikeSteps(s.word, c) > 0 &&
        // В коротком слове — не больше одной замены: иначе из него
        // можно «сделать» слишком много других слов
        lookalikeSteps(s.word, c) <= (s.word.length < 8 ? 1 : 2) &&
        (!s.name || terms.has(lower(c))),
    );
    // Два разных верных варианта — угадывать не берёмся
    const uniq = [...new Set(good.map(lower))];
    if (uniq.length !== 1) continue;
    s.w.text = s.pre + keepCase(s.word, good[0]) + s.post;
    fixed++;
  }
  return fixed;
};

export { TERMS_KEY };
