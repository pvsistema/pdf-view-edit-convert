import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';

export const LOGO_URL =
  'https://cdn.poehali.dev/projects/bd691282-75ee-481f-a896-7c452858c845/bucket/94c44544-3480-4dd3-b620-18a322cec6a9.png';

const NAV = [
  { id: 'features', label: 'Возможности' },
  { id: 'formats', label: 'Конвертация' },
  { id: 'download', label: 'Скачать' },
  { id: 'contacts', label: 'Поддержка' },
];

const Header = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const go = (id: string) => {
    setOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <header className="sticky top-0 z-50 border-b border-foreground bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-[1400px] items-center justify-between px-6 md:h-24 md:px-14">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex items-center gap-3 text-left"
          aria-label="ПВ-Система PDF — наверх"
        >
          <img src={LOGO_URL} alt="ПВ-Система PDF" className="h-8 w-auto md:h-9" />
          <span className="font-head text-[0.82rem] font-bold uppercase tracking-[0.14em] md:text-[0.94rem]">
            ПВ-Система&nbsp;PDF
          </span>
        </button>

        <nav className="hidden gap-9 lg:flex">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              className="border-b border-transparent pb-1 font-body text-[0.78rem] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button
            onClick={() => go('download')}
            className="hidden bg-primary px-6 py-3 font-head text-[0.74rem] font-bold uppercase tracking-[0.12em] text-primary-foreground transition-colors hover:bg-deep lg:inline-flex"
          >
            Скачать
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center border border-foreground lg:hidden"
            aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
          >
            <Icon name={open ? 'X' : 'Menu'} size={20} />
          </button>
        </div>
      </div>

      {open && (
        <div className="animate-fade-in border-t border-foreground bg-background lg:hidden">
          <nav className="mx-auto flex max-w-[1400px] flex-col px-6 py-4">
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                className="border-b border-border py-4 text-left font-body text-[0.85rem] font-medium uppercase tracking-[0.16em] text-foreground"
              >
                {item.label}
              </button>
            ))}
            <button onClick={() => go('download')} className="btn-block mt-6 w-full">
              Скачать программу
            </button>
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
