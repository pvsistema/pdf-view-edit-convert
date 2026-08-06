import { useState } from 'react';
import Icon from '@/components/ui/icon';

const TABS = [
  {
    key: 'from',
    label: 'Из PDF',
    rows: [
      { from: 'PDF', to: 'DOCX', note: 'Word с сохранением вёрстки и таблиц' },
      { from: 'PDF', to: 'XLSX', note: 'Excel: строки и столбцы без ручного переноса' },
      { from: 'PDF', to: 'JPG', note: 'Страницы картинками, качество на выбор' },
      { from: 'PDF', to: 'TXT', note: 'Чистый текст, в том числе после распознавания' },
    ],
  },
  {
    key: 'to',
    label: 'В PDF',
    rows: [
      { from: 'DOCX', to: 'PDF', note: 'Договор из Word — в неизменяемый файл' },
      { from: 'XLSX', to: 'PDF', note: 'Отчёт из Excel с настройкой области печати' },
      { from: 'JPG', to: 'PDF', note: 'Фото документов собираются в один файл' },
      { from: 'Скан', to: 'PDF/A', note: 'Формат для долгого архивного хранения' },
    ],
  },
  {
    key: 'ops',
    label: 'Операции',
    rows: [
      { from: 'Много', to: 'Один', note: 'Объединение пакета счетов и актов' },
      { from: 'Один', to: 'Много', note: 'Разделение по закладкам или страницам' },
      { from: 'Скан', to: 'Текст', note: 'OCR: русский и английский, поиск по документу' },
      { from: '80 МБ', to: '6 МБ', note: 'Сжатие для отправки по электронной почте' },
    ],
  },
];

const AUDIENCE = [
  { icon: 'Calculator', title: 'Бухгалтерия', text: 'Счета, акты, сверки и отчётность пакетами' },
  { icon: 'Building2', title: 'Малый и средний бизнес', text: 'Договоры и коммерческие предложения' },
  { icon: 'Landmark', title: 'Госорганизации', text: 'Работа офлайн, архивное хранение PDF/A' },
  { icon: 'GraduationCap', title: 'Студенты и преподаватели', text: 'Методички, статьи, сканы книг' },
  { icon: 'Scale', title: 'Юристы', text: 'Правка формулировок и защита данных' },
  { icon: 'Users', title: 'Кадровики', text: 'Личные дела, приказы и заявления' },
];

const Formats = () => {
  const [tab, setTab] = useState(0);

  return (
    <section id="formats" className="border-t border-foreground bg-card py-20 md:py-28">
      <div className="mx-auto max-w-[1400px] px-6 md:px-14">
        <div className="label-caps">Раздел 02</div>
        <h2 className="mt-3 max-w-[14em] font-head text-[2rem] font-black uppercase leading-[1.06] tracking-[-0.03em] md:text-[3rem]">
          Конвертация без потери вёрстки
        </h2>

        <div className="mt-10 flex flex-wrap gap-0 border-b border-rule">
          {TABS.map((t, i) => (
            <button
              key={t.key}
              onClick={() => setTab(i)}
              className={`px-6 py-4 font-head text-[0.78rem] font-bold uppercase tracking-[0.14em] transition-colors ${
                i === tab
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div key={tab} className="animate-fade-in">
          {TABS[tab].rows.map((r) => (
            <div
              key={r.from + r.to}
              className="grid grid-cols-1 items-center gap-2 border-b border-border py-5 sm:grid-cols-12 sm:gap-6"
            >
              <div className="flex items-center gap-3 sm:col-span-4">
                <span className="font-head text-[1.1rem] font-bold uppercase tracking-[-0.02em]">
                  {r.from}
                </span>
                <Icon name="ArrowRight" size={16} className="text-primary" />
                <span className="font-head text-[1.1rem] font-bold uppercase tracking-[-0.02em] text-primary">
                  {r.to}
                </span>
              </div>
              <p className="text-muted-foreground sm:col-span-8">{r.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-20">
          <div className="label-caps">Кому подходит</div>
          <div className="mt-6 grid grid-cols-1 border-l border-t border-border sm:grid-cols-2 lg:grid-cols-3">
            {AUDIENCE.map((a) => (
              <div
                key={a.title}
                className="group border-b border-r border-border bg-background p-7 transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                <Icon
                  name={a.icon}
                  size={24}
                  className="text-primary transition-colors group-hover:text-primary-foreground"
                />
                <h3 className="mt-5 font-head text-[1.05rem] font-bold uppercase tracking-[-0.01em]">
                  {a.title}
                </h3>
                <p className="mt-2 text-[0.92rem] text-muted-foreground transition-colors group-hover:text-primary-foreground/80">
                  {a.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Formats;
