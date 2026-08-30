import { useMemo, useState } from 'react';
import Icon from '@/components/ui/icon';
import ToolRunner from '@/components/app/ToolRunner';
import ActivateDialog from '@/components/app/ActivateDialog';
import { GROUPS, findTool, searchTools, type ToolDef } from '@/lib/convert/catalog';
import { useLicense } from '@/context/LicenseContext';

type Props = { start?: string; onClose: () => void };

const ConvertDialog = ({ start = '', onClose }: Props) => {
  const { isFull } = useLicense();
  const [openId, setOpenId] = useState(start);
  const [query, setQuery] = useState('');
  const [showAct, setShowAct] = useState(false);

  const found = useMemo(() => searchTools(query), [query]);
  const tool = openId ? findTool(openId) : undefined;

  const card = (t: ToolDef) => (
    <button
      key={t.id}
      onClick={() => setOpenId(t.id)}
      className="group flex items-start gap-3 border border-border bg-card p-4 text-left transition-colors hover:border-foreground"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-background">
        <Icon name={t.icon} size={17} className={t.tint} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="font-head text-[0.86rem] font-bold">{t.title}</span>
          {t.pro && !isFull && (
            <Icon name="Lock" size={11} className="shrink-0 text-muted-foreground" />
          )}
        </span>
        <span className="mt-1 block text-[0.78rem] leading-snug text-muted-foreground">
          {t.note}
        </span>
      </span>
      <Icon
        name="ArrowRight"
        size={15}
        className="ml-auto mt-1 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
      />
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/50 p-6">
      <div className="flex h-full max-h-[760px] w-full max-w-[880px] flex-col border border-foreground bg-background">
        {tool ? (
          <ToolRunner
            tool={tool}
            onBack={() => setOpenId('')}
            onClose={onClose}
            onNeedFull={() => setShowAct(true)}
          />
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <div className="label-caps">Конвертировать</div>
                <p className="mt-1 text-[0.8rem] text-muted-foreground">
                  Все инструменты работают на вашем компьютере
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center border border-border">
                  <Icon name="Search" size={15} className="ml-3 text-muted-foreground" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Что нужно сделать"
                    className="w-[200px] bg-transparent px-3 py-2 text-[0.86rem] outline-none"
                  />
                </div>
                <button onClick={onClose} className="hover:text-destructive" title="Закрыть">
                  <Icon name="X" size={18} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {!found.length && (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <Icon name="SearchX" size={26} className="text-muted-foreground" />
                  <span className="font-head text-[0.9rem] font-bold">Ничего не нашлось</span>
                  <span className="text-[0.82rem] text-muted-foreground">
                    Попробуйте другое слово — например «сжать» или «в word»
                  </span>
                </div>
              )}

              {GROUPS.map((g) => {
                const list = found.filter((t) => t.group === g.id);
                if (!list.length) return null;
                return (
                  <div key={g.id} className="mb-7 last:mb-0">
                    <div className="label-caps mb-3">{g.title}</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{list.map(card)}</div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border px-6 py-3 text-[0.76rem] text-muted-foreground">
              Документы не отправляются в интернет — вся обработка идёт на вашем компьютере
            </div>
          </>
        )}
      </div>

      {showAct && <ActivateDialog onClose={() => setShowAct(false)} />}
    </div>
  );
};

export default ConvertDialog;
