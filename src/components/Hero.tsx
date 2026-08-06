const cells = [
  {
    label: 'Исходный файл',
    value: 'PDF',
    className: 'bg-primary text-primary-foreground',
    big: true,
  },
  { label: 'Текст', value: 'DOCX', className: 'bg-card' },
  { label: 'Таблицы', value: 'XLSX', className: 'bg-accent text-accent-foreground' },
  { label: 'Страницы', value: 'JPG', className: '' },
];

const Hero = () => {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <section className="relative overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-x-6 inset-y-0 hidden grid-lines md:inset-x-14 md:block" />

      <div className="relative z-10 mx-auto max-w-[1400px] px-6 md:px-14">
        <div className="rule rule-thick animate-draw" />

        <div className="grid grid-cols-1 gap-14 pt-12 md:pt-14 lg:grid-cols-12 lg:gap-8">
          <div className="animate-rise [animation-delay:0.15s] lg:col-span-7">
            <h1 className="font-head text-[2.6rem] font-black uppercase leading-[1.04] tracking-[-0.035em] sm:text-[3.6rem] lg:text-[4.2rem] xl:text-[4.6rem]">
              Открыть, <em className="not-italic text-primary">исправить</em>
              <br />
              и&nbsp;перевести PDF
              <br />
              в&nbsp;Word за&nbsp;минуту
            </h1>

            <p className="mt-7 max-w-[29em] text-[1.02rem] leading-relaxed text-muted-foreground">
              Правка текста прямо на&nbsp;странице, склейка и&nbsp;разделение документов,
              распознавание сканов договоров и&nbsp;актов.
            </p>

            <div className="mt-10 flex flex-col items-start gap-6 sm:flex-row sm:items-center">
              <button onClick={() => go('download')} className="btn-block">
                Скачать программу
              </button>
              <span className="font-body text-[0.78rem] uppercase leading-relaxed tracking-[0.08em] text-muted-foreground">
                Версия 3.2 · Windows 10 и&nbsp;11
                <br />
                74&nbsp;МБ · 30 дней без оплаты
              </span>
            </div>
          </div>

          <aside className="animate-rise self-start [animation-delay:0.3s] lg:col-span-4 lg:col-start-9">
            <div className="pb-2.5 font-body text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
              Из PDF и обратно
            </div>
            <div className="grid grid-cols-2 border-l border-t border-rule">
              {cells.map((c) => (
                <div
                  key={c.value}
                  className={`flex h-[98px] items-end border-b border-r border-rule px-3.5 pb-3 ${c.className}`}
                >
                  <span>
                    <small
                      className={`mb-1.5 block font-body text-[0.62rem] font-medium uppercase tracking-[0.18em] ${
                        c.big ? 'opacity-80' : 'opacity-70'
                      }`}
                    >
                      {c.label}
                    </small>
                    <span
                      className={`font-head font-bold ${
                        c.big
                          ? 'text-[2.4rem] leading-none tracking-[-0.04em]'
                          : 'text-[1.28rem] leading-none tracking-[-0.02em]'
                      }`}
                    >
                      {c.value}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3.5 font-body text-[0.74rem] uppercase leading-relaxed tracking-[0.06em] text-muted-foreground">
              Скан → текст с&nbsp;поиском:
              <br />
              русский и&nbsp;английский
            </div>
          </aside>
        </div>

        <div className="rule animate-draw mt-14 [animation-delay:0.5s]" />
        <div className="flex flex-col gap-2 py-6 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-body text-[0.74rem] uppercase tracking-[0.18em] text-muted-foreground">
            ПВ-Система PDF
          </span>
          <span className="font-body text-[0.74rem] uppercase tracking-[0.18em] text-muted-foreground">
            Для бухгалтерии, кадров и&nbsp;юристов
          </span>
        </div>
      </div>
    </section>
  );
};

export default Hero;
