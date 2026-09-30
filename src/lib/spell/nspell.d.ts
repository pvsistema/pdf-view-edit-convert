declare module 'nspell' {
  type Speller = {
    correct: (word: string) => boolean;
    suggest: (word: string) => string[];
    add: (word: string) => Speller;
  };
  const nspell: (aff: string, dic: string) => Speller;
  export default nspell;
}
