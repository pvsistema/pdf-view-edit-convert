import { useState } from 'react';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { toast } from '@/hooks/use-toast';

const CHANNELS = [
  { icon: 'Mail', label: 'Почта поддержки', value: 'support@pv-pdf.ru', note: 'Ответ в течение дня' },
  { icon: 'Phone', label: 'Телефон', value: '8 800 000-00-00', note: 'Будни, 9:00–18:00 МСК' },
  { icon: 'FileText', label: 'Для закупок', value: 'sales@pv-pdf.ru', note: 'Счёт, договор, акт' },
];

const FAQ = [
  {
    q: 'Программа работает без интернета?',
    a: 'Да. Все файлы обрабатываются на вашем компьютере, ничего не отправляется в облако. Интернет нужен только при активации лицензии и при загрузке обновлений.',
  },
  {
    q: 'Сохраняется ли вёрстка при переводе в Word?',
    a: 'Да. Шрифты, отступы, колонтитулы и таблицы переносятся в исходном виде. Для сканов сначала выполняется распознавание, а затем формируется редактируемый документ.',
  },
  {
    q: 'Можно ли обработать сразу много файлов?',
    a: 'В профессиональной редакции есть пакетный режим: указываете папку и нужную операцию — объединение, конвертацию, сжатие или распознавание — программа обрабатывает всё подряд.',
  },
  {
    q: 'Как оплатить организации по счёту?',
    a: 'Напишите на почту для закупок: пришлём коммерческое предложение, счёт и договор. Работаем с бюджетными учреждениями, закрывающие документы предоставляем.',
  },
  {
    q: 'Что будет после 30 дней бесплатного периода?',
    a: 'Программа продолжит открывать и печатать документы. Редактирование, конвертация и распознавание станут доступны после покупки лицензии.',
  },
];

type Errors = { name?: string; contact?: string; message?: string };

const Contacts = () => {
  const [form, setForm] = useState({ name: '', contact: '', message: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [sent, setSent] = useState(false);

  const validate = () => {
    const e: Errors = {};
    if (form.name.trim().length < 2) e.name = 'Укажите имя, минимум 2 символа';
    const c = form.contact.trim();
    const okMail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c);
    const okPhone = /^\+?[\d\s()-]{10,}$/.test(c);
    if (!okMail && !okPhone) e.contact = 'Введите почту или телефон для ответа';
    if (form.message.trim().length < 10) e.message = 'Опишите вопрос подробнее, минимум 10 символов';
    return e;
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setSent(true);
    toast({ title: 'Вопрос отправлен', description: 'Ответим на указанный контакт в рабочее время.' });
    setForm({ name: '', contact: '', message: '' });
  };

  const field = (key: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    if (errors[key]) setErrors((er) => ({ ...er, [key]: undefined }));
  };

  return (
    <section id="contacts" className="border-t border-foreground bg-card py-20 md:py-28">
      <div className="mx-auto max-w-[1400px] px-6 md:px-14">
        <div className="label-caps">Раздел 04</div>
        <h2 className="mt-3 font-head text-[2rem] font-black uppercase leading-[1.06] tracking-[-0.03em] md:text-[3rem]">
          Контакты и поддержка
        </h2>

        <div className="mt-10 grid grid-cols-1 border-l border-t border-border md:grid-cols-3">
          {CHANNELS.map((c) => (
            <div key={c.label} className="border-b border-r border-border bg-background p-7">
              <Icon name={c.icon} size={22} className="text-primary" />
              <div className="mt-5 font-body text-[0.72rem] uppercase tracking-[0.18em] text-muted-foreground">
                {c.label}
              </div>
              <div className="mt-1 font-head text-[1.15rem] font-bold tracking-[-0.02em]">
                {c.value}
              </div>
              <p className="mt-2 text-[0.9rem] text-muted-foreground">{c.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 grid grid-cols-1 gap-14 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-7">
            <div className="label-caps">Частые вопросы</div>
            <Accordion type="single" collapsible className="mt-5 border-t border-rule">
              {FAQ.map((item, i) => (
                <AccordionItem key={item.q} value={`item-${i}`} className="border-border">
                  <AccordionTrigger className="text-left font-head text-[1rem] font-bold uppercase tracking-[-0.01em] hover:no-underline">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-[0.95rem] leading-relaxed text-muted-foreground">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          <div className="lg:col-span-5">
            <div className="label-caps">Написать в поддержку</div>
            {sent ? (
              <div className="animate-scale-in mt-5 border border-rule bg-background p-8">
                <Icon name="CheckCircle2" size={28} className="text-primary" />
                <h3 className="mt-4 font-head text-[1.2rem] font-bold uppercase tracking-[-0.01em]">
                  Вопрос принят
                </h3>
                <p className="mt-2 text-muted-foreground">
                  Специалист ответит на указанный контакт в рабочее время: будни, 9:00–18:00 МСК.
                </p>
                <button onClick={() => setSent(false)} className="btn-ghost-block mt-6">
                  Написать ещё
                </button>
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="mt-5 space-y-5">
                <div>
                  <label className="label-caps" htmlFor="name">
                    Имя
                  </label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => field('name')(e.target.value)}
                    placeholder="Как к вам обращаться"
                    className="mt-2 rounded-none border-foreground bg-background"
                  />
                  {errors.name && <p className="mt-1 text-[0.82rem] text-destructive">{errors.name}</p>}
                </div>
                <div>
                  <label className="label-caps" htmlFor="contact">
                    Почта или телефон
                  </label>
                  <Input
                    id="contact"
                    value={form.contact}
                    onChange={(e) => field('contact')(e.target.value)}
                    placeholder="name@company.ru"
                    className="mt-2 rounded-none border-foreground bg-background"
                  />
                  {errors.contact && (
                    <p className="mt-1 text-[0.82rem] text-destructive">{errors.contact}</p>
                  )}
                </div>
                <div>
                  <label className="label-caps" htmlFor="message">
                    Вопрос
                  </label>
                  <Textarea
                    id="message"
                    rows={5}
                    value={form.message}
                    onChange={(e) => field('message')(e.target.value)}
                    placeholder="Опишите задачу или проблему"
                    className="mt-2 rounded-none border-foreground bg-background"
                  />
                  {errors.message && (
                    <p className="mt-1 text-[0.82rem] text-destructive">{errors.message}</p>
                  )}
                </div>
                <button type="submit" className="btn-block w-full">
                  Отправить вопрос
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contacts;
