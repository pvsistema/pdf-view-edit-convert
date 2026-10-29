import { useState } from 'react';
import Icon from '@/components/ui/icon';
import { Checkbox } from '@/components/ui/checkbox';
import type { Duplex } from '@/lib/printLayout';
import type { DuplexPrefs } from '@/lib/duplexPrefs';
import type { DocMargins } from '@/lib/docMargins';

const MODES: { id: Duplex; label: string; note: string; icon: string }[] = [
  { id: 'off', label: 'С одной стороны', note: 'Обычная печать', icon: 'File' },
  {
    id: 'long',
    label: 'По длинному краю',
    note: 'Как книга: для отчётов, договоров, документов в папку',
    icon: 'BookOpen',
  },
  {
    id: 'short',
    label: 'По короткому краю',
    note: 'Как блокнот: переплёт сверху',
    icon: 'Notebook',
  },
  {
    id: 'manual',
    label: 'Вручную',
    note: 'Принтер без двусторонней печати: сначала лицевые, затем обороты',
    icon: 'Hand',
  },
];

const Row = ({ label, children, note }: { label: string; children: React.ReactNode; note?: string }) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <div className="min-w-0">
      <div className="text-[0.86rem]">{label}</div>
      {note && <div className="text-[0.72rem] leading-snug text-muted-foreground">{note}</div>}
    </div>
    {children}
  </div>
);

// Поле числа в миллиметрах с кнопками ±
const MmInput = ({
  value,
  onChange,
  step = 0.5,
  min = -15,
  max = 15,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) => {
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)) * 10) / 10;
  return (
    <div className="flex shrink-0 items-center border border-border">
      <button className="px-2 py-1.5 hover:bg-card" onClick={() => onChange(clamp(value - step))}>
        <Icon name="Minus" size={12} />
      </button>
      <input
        value={String(value).replace('.', ',')}
        onChange={(e) => {
          const v = parseFloat(e.target.value.replace(',', '.'));
          if (!Number.isNaN(v)) onChange(clamp(v));
          else if (e.target.value === '' || e.target.value === '-') onChange(0);
        }}
        className="w-12 bg-transparent text-center font-head text-[0.82rem] font-bold outline-none"
      />
      <button className="px-2 py-1.5 hover:bg-card" onClick={() => onChange(clamp(value + step))}>
        <Icon name="Plus" size={12} />
      </button>
    </div>
  );
};

const DuplexTab = ({
  prefs,
  set,
  margins,
  measuring,
  desktop,
  onTestSheet,
  onApplyReading,
  sideways,
  pageCount,
}: {
  prefs: DuplexPrefs;
  set: (p: Partial<DuplexPrefs>) => void;
  margins: DocMargins | null;
  measuring: boolean;
  desktop: boolean;
  onTestSheet: () => void;
  onApplyReading: (x: number, y: number) => void;
  // Оборот переворачивается слева направо
  sideways: boolean;
  // Сколько страниц выбрано к печати
  pageCount: number;
}) => {
  const [readX, setReadX] = useState(0);
  const [readY, setReadY] = useState(0);
  const on = prefs.duplex !== 'off';

  const mm = (v: number) => Math.round(v * 10) / 10;
  const diff = margins
    ? sideways
      ? margins.right - margins.left
      : margins.bottom - margins.top
    : 0;

  return (
    <>
      <div className="label-caps mt-5">Двусторонняя печать</div>
      <div className="mt-2 border-l border-t border-border">
        {MODES.map((o) => (
          <button
            key={o.id}
            onClick={() => set({ duplex: o.id })}
            className={`flex w-full items-start gap-3 border-b border-r border-border px-4 py-2.5 text-left transition-colors ${
              prefs.duplex === o.id ? 'bg-primary text-primary-foreground' : 'hover:bg-card'
            }`}
          >
            <Icon name={o.icon} size={16} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block text-[0.9rem]">{o.label}</span>
              <span
                className={`block text-[0.74rem] ${
                  prefs.duplex === o.id ? 'text-primary-foreground/80' : 'text-muted-foreground'
                }`}
              >
                {o.note}
              </span>
            </span>
          </button>
        ))}
      </div>

      {on && pageCount < 2 && (
        <div className="mt-3 flex items-start gap-2 border border-[hsl(var(--destructive))] px-3 py-2.5 text-[0.78rem] leading-snug">
          <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0 text-[hsl(var(--destructive))]" />
          <span>
            К печати выбрана одна страница — оборот у листа будет пустым, и двусторонняя печать ничего
            не изменит. Выберите «Все страницы» или диапазон хотя бы из двух страниц.
          </span>
        </div>
      )}

      {prefs.duplex === 'manual' && (
        <div className="mt-3 border border-border bg-card px-3 py-2.5 text-[0.78rem] leading-snug">
          <div className="flex items-start gap-2">
            <Icon name="Info" size={14} className="mt-0.5 shrink-0 text-primary" />
            <span>
              Кнопка «Печать» отправит лицевые стороны. Затем программа попросит перевернуть стопку и
              вложить её обратно — и напечатает обороты.
            </span>
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 pl-6">
            <Checkbox checked={prefs.reverseBacks} onCheckedChange={(v) => set({ reverseBacks: !!v })} />
            <span>Обороты в обратном порядке</span>
          </label>
          <div className="pl-6 text-[0.7rem] text-muted-foreground">
            Нужно большинству принтеров: последний напечатанный лист оказывается сверху стопки
          </div>
        </div>
      )}

      {on && (
        <>
          <div className="label-caps mt-5">Совпадение полей</div>
          <div className="mt-1 divide-y divide-border border-y border-border">
            <div className="py-2">
              <label className="flex cursor-pointer items-start gap-2.5">
                <Checkbox
                  className="mt-0.5"
                  checked={prefs.mirror}
                  onCheckedChange={(v) => set({ mirror: !!v })}
                />
                <span className="min-w-0">
                  <span className="block text-[0.86rem]">Текст оборота точно под текстом лицевой</span>
                  <span className="block text-[0.72rem] leading-snug text-muted-foreground">
                    {measuring
                      ? 'Измеряю поля документа…'
                      : margins
                        ? Math.abs(diff) < 0.004
                          ? `Поля документа одинаковые${margins.by === 'image' ? ' (измерено по скану)' : ''} — сдвиг не нужен`
                          : `Поля документа разные (${sideways ? 'слева и справа' : 'сверху и снизу'}${margins.by === 'image' ? ', измерено по скану' : ''}): оборот сдвинется зеркально, и на просвет строки совпадут`
                        : 'Поля не удалось определить — страницы стоят по центру листа'}
                  </span>
                </span>
              </label>
            </div>

            <Row
              label="Переплёт, мм"
              note={
                sideways ? 'Лицевая — отступ слева, оборот — справа' : 'Лицевая — отступ сверху, оборот — снизу'
              }
            >
              <MmInput value={prefs.gutter} onChange={(v) => set({ gutter: v })} min={0} max={30} step={1} />
            </Row>

            <div className="py-2">
              <label className="flex cursor-pointer items-start gap-2.5">
                <Checkbox className="mt-0.5" checked={prefs.turn} onCheckedChange={(v) => set({ turn: !!v })} />
                <span className="min-w-0">
                  <span className="block text-[0.86rem]">Альбомные страницы — боком на книжный лист</span>
                  <span className="block text-[0.72rem] leading-snug text-muted-foreground">
                    Все листы одной ориентации, и принтер переворачивает их одинаково. Иначе таблица на
                    альбомной странице окажется на обороте вверх ногами
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="label-caps mt-5">Подстройка под принтер</div>
          <p className="mt-1 text-[0.74rem] leading-snug text-muted-foreground">
            Многие принтеры чуть сдвигают оборот. Напечатайте тестовый лист, посмотрите на просвет и
            введите, где виден крестик.{desktop ? ' Сдвиг запоминается для этого принтера.' : ''}
          </p>
          <button
            onClick={onTestSheet}
            className="mt-2 flex w-full items-center justify-center gap-2 border border-foreground px-3 py-2 text-[0.8rem] transition-colors hover:bg-foreground hover:text-background"
          >
            <Icon name="Crosshair" size={14} />
            Напечатать тестовый лист
          </button>

          <div className="mt-3 border border-border p-3">
            <div className="text-[0.8rem] font-medium">Показания тестового листа</div>
            <div className="mt-0.5 text-[0.7rem] text-muted-foreground">
              Где крестик с оборота на шкалах лицевой стороны: вправо и вниз — плюс
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 text-[0.78rem]">
                <Icon name="ArrowLeftRight" size={13} /> <MmInput value={readX} onChange={setReadX} />
              </span>
              <span className="flex items-center gap-1.5 text-[0.78rem]">
                <Icon name="ArrowDownUp" size={13} /> <MmInput value={readY} onChange={setReadY} />
              </span>
              <button
                disabled={!readX && !readY}
                onClick={() => {
                  onApplyReading(readX, readY);
                  setReadX(0);
                  setReadY(0);
                }}
                className="border border-primary bg-primary px-3 py-1.5 text-[0.76rem] text-primary-foreground disabled:opacity-40"
              >
                Учесть
              </button>
            </div>
          </div>

          <Row label="Сдвиг оборота вправо, мм">
            <MmInput value={prefs.shiftX} onChange={(v) => set({ shiftX: v })} />
          </Row>
          <Row label="Сдвиг оборота вниз, мм">
            <MmInput value={prefs.shiftY} onChange={(v) => set({ shiftY: v })} />
          </Row>
          {(prefs.shiftX !== 0 || prefs.shiftY !== 0) && (
            <button
              onClick={() => set({ shiftX: 0, shiftY: 0 })}
              className="text-[0.74rem] text-primary hover:underline"
            >
              Сбросить сдвиг ({mm(prefs.shiftX)}; {mm(prefs.shiftY)} мм)
            </button>
          )}
        </>
      )}
    </>
  );
};

export default DuplexTab;
