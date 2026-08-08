import Icon from '@/components/ui/icon';
import DraggableDialog from '@/components/app/DraggableDialog';

type Row = { keys: string[]; label: string };
type Group = { title: string; icon: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    title: 'Файл',
    icon: 'Files',
    rows: [
      { keys: ['Ctrl', 'O'], label: 'Открыть документ' },
      { keys: ['Ctrl', 'S'], label: 'Сохранить' },
      { keys: ['Ctrl', 'Shift', 'S'], label: 'Сохранить как…' },
      { keys: ['Ctrl', 'P'], label: 'Печать' },
    ],
  },
  {
    title: 'Правка',
    icon: 'PenLine',
    rows: [
      { keys: ['Ctrl', 'Z'], label: 'Отменить действие' },
      { keys: ['Ctrl', 'Y'], label: 'Вернуть действие' },
      { keys: ['Ctrl', 'Shift', 'Z'], label: 'Вернуть действие' },
    ],
  },
  {
    title: 'Окна',
    icon: 'AppWindow',
    rows: [
      { keys: ['F1'], label: 'Показать этот список' },
      { keys: ['Esc'], label: 'Закрыть открытое окно' },
    ],
  },
  {
    title: 'Мышь',
    icon: 'MousePointer2',
    rows: [
      { keys: ['Перетащить'], label: 'Файл в окно — открыть документ' },
      { keys: ['Заголовок'], label: 'Перетащить окно печати' },
      { keys: ['Край окна'], label: 'Изменить размер окна' },
    ],
  },
];

const Key = ({ children }: { children: string }) => (
  <kbd className="inline-flex min-w-[2rem] items-center justify-center whitespace-nowrap border border-foreground bg-card px-2 py-1 font-head text-[0.72rem] font-bold shadow-[2px_2px_0_hsl(var(--rule)/0.25)]">
    {children}
  </kbd>
);

const ShortcutsDialog = ({ onClose }: { onClose: () => void }) => (
  <DraggableDialog
    title="Горячие клавиши"
    onClose={onClose}
    width={560}
    height={540}
    minWidth={420}
    minHeight={340}
    footer={
      <div className="flex items-center gap-3 p-4">
        <p className="flex-1 text-[0.8rem] text-muted-foreground">
          Сочетания работают на русской и английской раскладке
        </p>
        <button
          onClick={onClose}
          className="border border-foreground px-5 py-2.5 font-head text-[0.72rem] font-bold uppercase tracking-[0.1em] transition-colors hover:bg-foreground hover:text-background"
        >
          Закрыть
        </button>
      </div>
    }
  >
    <div className="h-full overflow-y-auto p-5">
      {GROUPS.map((g) => (
        <div key={g.title} className="mb-6 last:mb-0">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Icon name={g.icon} size={15} className="text-primary" />
            <span className="font-head text-[0.7rem] font-bold uppercase tracking-[0.12em]">
              {g.title}
            </span>
          </div>

          {g.rows.map((r) => (
            <div
              key={r.label + r.keys.join()}
              className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5 last:border-0"
            >
              <span className="text-[0.88rem]">{r.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {r.keys.map((k, i) => (
                  <span key={k + i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground">+</span>}
                    <Key>{k}</Key>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  </DraggableDialog>
);

export default ShortcutsDialog;