import Icon from '@/components/ui/icon';

const CtaBanner = () => {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <section className="border-t border-foreground bg-primary text-primary-foreground">
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-10 px-6 py-16 md:px-14 md:py-20 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-7">
          <h2 className="font-head text-[1.9rem] font-black uppercase leading-[1.06] tracking-[-0.03em] md:text-[2.8rem]">
            Один инструмент вместо пяти
          </h2>
          <p className="mt-4 max-w-[30em] text-primary-foreground/85">
            Просмотр, правка, конвертация, склейка и распознавание — в одной программе на рабочем
            месте. Без облака и подписки.
          </p>
        </div>
        <div className="flex flex-col items-start gap-4 lg:col-span-5 lg:items-end">
          <button
            onClick={() => go('download')}
            className="inline-flex items-center gap-2 bg-background px-10 py-5 font-head text-[0.86rem] font-bold uppercase tracking-[0.12em] text-foreground transition-colors hover:bg-card"
          >
            <Icon name="Download" size={18} />
            Скачать программу
          </button>
          <span className="font-body text-[0.76rem] uppercase tracking-[0.12em] text-primary-foreground/80">
            30 дней все функции без оплаты
          </span>
        </div>
      </div>
    </section>
  );
};

export default CtaBanner;
