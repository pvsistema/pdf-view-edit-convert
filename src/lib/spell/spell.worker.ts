// Фоновая проверка слов по русскому словарю.
//
// Словарь большой: разбор занимает пару секунд. В основном потоке окно
// на это время замирало бы, поэтому словарь живёт в отдельном потоке
import nspell from 'nspell';

type Init = { type: 'init'; aff: string; dic: string; terms: string[] };
type Check = { type: 'check'; id: number; words: string[] };

let speller: ReturnType<typeof nspell> | null = null;

// Словарь лежит сжатым. Сервер может отдать его как есть или уже
// распакованным (так делает сервер разработки для файлов .gz) —
// смотрим на первые байты: сжатый файл начинается с 1F 8B
const unpack = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Словарь не найден');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return new TextDecoder().decode(buf);
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
};

self.onmessage = async (e: MessageEvent<Init | Check>) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const [aff, dic] = await Promise.all([fetch(m.aff).then((r) => r.text()), unpack(m.dic)]);
      speller = nspell(aff, dic);
      for (const t of m.terms) speller.add(t);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'failed', error: String(err) });
    }
    return;
  }

  if (m.type === 'check') {
    const out: Record<string, string[] | true> = {};
    if (speller) {
      for (const w of m.words) {
        if (speller.correct(w)) out[w] = true;
        else out[w] = speller.suggest(w).slice(0, 6);
      }
    }
    self.postMessage({ type: 'checked', id: m.id, result: out });
  }
};
