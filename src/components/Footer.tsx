import { LOGO_URL } from '@/components/Header';

const LINKS = [
  { id: 'features', label: 'Возможности' },
  { id: 'formats', label: 'Конвертация' },
  { id: 'download', label: 'Скачать' },
  { id: 'contacts', label: 'Поддержка' },
];

const Footer = () => {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <footer className="border-t border-foreground bg-background">
      <div className="mx-auto max-w-[1400px] px-6 py-14 md:px-14">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
          <div className="md:col-span-5">
            <div className="flex items-center gap-3">
              <img src={LOGO_URL} alt="ПВ-Система PDF" className="h-8 w-auto" />
              <span className="font-head text-[0.94rem] font-bold uppercase tracking-[0.14em]">
                ПВ-Система&nbsp;PDF
              </span>
            </div>
            <p className="mt-4 max-w-[26em] text-[0.92rem] text-muted-foreground">
              Программа для просмотра, редактирования и конвертации PDF. Версия 3.2 для Windows 10 и
              11.
            </p>
          </div>

          <div className="md:col-span-3">
            <div className="label-caps">Разделы</div>
            <ul className="mt-4 space-y-2">
              {LINKS.map((l) => (
                <li key={l.id}>
                  <button
                    onClick={() => go(l.id)}
                    className="text-[0.92rem] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="md:col-span-4">
            <div className="label-caps">Контакты</div>
            <ul className="mt-4 space-y-2 text-[0.92rem] text-muted-foreground">
              <li>support@pv-pdf.ru</li>
              <li>8 800 000-00-00 · будни 9:00–18:00 МСК</li>
              <li>Документы для закупок: sales@pv-pdf.ru</li>
            </ul>
          </div>
        </div>

        <div className="rule mt-12" />
        <div className="flex flex-col gap-2 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-body text-[0.74rem] uppercase tracking-[0.18em] text-muted-foreground">
            © {new Date().getFullYear()} ПВ-Система PDF
          </span>
          <span className="font-body text-[0.74rem] uppercase tracking-[0.18em] text-muted-foreground">
            Для бухгалтерии, кадров и юристов
          </span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
