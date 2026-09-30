import { useState } from 'react';
import DraggableDialog from '@/components/app/DraggableDialog';
import { MINING_TERMS, parseTerms, readTerms, saveTerms } from '@/lib/spell/terms';
import { toast } from '@/hooks/use-toast';

// Свой список слов для распознавания: названия организаций, фамилии,
// термины и сокращения. Эти слова программа считает верными
const TermsDialog = ({ onClose }: { onClose: () => void }) => {
  const [text, setText] = useState(() => readTerms().join('\n'));
  const count = parseTerms(text).length;

  const save = () => {
    const list = saveTerms(parseTerms(text));
    toast({ title: 'Список сохранён', description: `Слов в списке: ${list.length}` });
    onClose();
  };

  return (
    <DraggableDialog
      title="Мои термины и названия"
      onClose={onClose}
      width={520}
      height={560}
      minWidth={400}
      minHeight={380}
      footer={
        <div className="flex items-center gap-3 p-4">
          <p className="flex-1 text-[0.78rem] text-muted-foreground">Слов: {count}</p>
          <button
            onClick={onClose}
            className="border border-border px-4 py-2.5 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] transition-colors hover:border-foreground"
          >
            Отмена
          </button>
          <button
            onClick={save}
            className="border border-primary bg-primary px-5 py-2.5 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] text-primary-foreground transition-opacity hover:opacity-90"
          >
            Сохранить
          </button>
        </div>
      }
    >
      <div className="flex h-full flex-col gap-3 p-5">
        <p className="text-[0.84rem] leading-snug">
          Слова, которые программа не будет «исправлять» при распознавании, а похожие на них ошибки
          поправит на них. Удобно для названий организаций, фамилий, сокращений и терминов.
        </p>
        <p className="text-[0.76rem] leading-snug text-muted-foreground">
          По слову в строке или через запятую. Каждое слово пишите в тех формах, что встречаются в
          документах: «Шахтострой», «Шахтостроя». Горные термины ({MINING_TERMS.length} слов, например
          «рассечка», «ВГСЧ», «Ростехнадзор») программа уже знает.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Шахтострой\nШахтостроя\nГорнопроходческое управление\nКвершлаг'}
          className="min-h-0 w-full flex-1 resize-none border border-border bg-background p-3 text-[0.84rem] leading-relaxed outline-none focus:border-primary"
        />
      </div>
    </DraggableDialog>
  );
};

export default TermsDialog;
