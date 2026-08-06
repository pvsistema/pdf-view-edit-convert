import { useState } from 'react';
import Icon from '@/components/ui/icon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';

const EDITIONS = [
  {
    key: 'home',
    name: 'Базовая',
    price: 'Бесплатно 30 дней',
    note: 'Полный набор функций на время знакомства',
    items: ['Просмотр и печать', 'Правка текста и страниц', 'Конвертация в Word и JPG'],
  },
  {
    key: 'pro',
    name: 'Профессиональная',
    price: '4 900 ₽ / рабочее место',
    note: 'Бессрочная лицензия, обновления год',
    items: ['Всё из базовой', 'Excel и пакетная обработка', 'Распознавание (OCR) RU + EN'],
    featured: true,
  },
  {
    key: 'org',
    name: 'Для организаций',
    price: 'От 10 рабочих мест',
    note: 'Для госорганизаций и бюджетных учреждений',
    items: ['Установка по сети', 'Работа без интернета', 'Договор и закрывающие документы'],
  },
];

const REQUIREMENTS = [
  ['Операционная система', 'Windows 10 / 11 (64-бит)'],
  ['Процессор', 'От 2 ядер, 1,8 ГГц'],
  ['Оперативная память', 'От 4 ГБ, для OCR — 8 ГБ'],
  ['Место на диске', '400 МБ для установки'],
  ['Экран', 'От 1366 × 768'],
  ['Интернет', 'Нужен только для активации'],
];

const Download = () => {
  const [edition, setEdition] = useState(1);
  const [open, setOpen] = useState(false);

  const start = () => {
    setOpen(true);
    toast({
      title: 'Загрузка начата',
      description: 'Установочный файл ПВ-Система PDF 3.2 (74 МБ)',
    });
  };

  return (
    <section id="download" className="border-t border-foreground bg-background py-20 md:py-28">
      <div className="mx-auto max-w-[1400px] px-6 md:px-14">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="label-caps">Раздел 03</div>
            <h2 className="mt-3 font-head text-[2rem] font-black uppercase leading-[1.06] tracking-[-0.03em] md:text-[3rem]">
              Скачать программу
            </h2>
          </div>
          <p className="max-w-[24em] text-muted-foreground">
            Версия 3.2 · 74 МБ · установка занимает около минуты. Первые 30 дней — все функции без
            оплаты.
          </p>
        </div>

        <div className="rule mt-10" />

        <div className="grid grid-cols-1 border-l border-border md:grid-cols-3">
          {EDITIONS.map((e, i) => (
            <button
              key={e.key}
              onClick={() => setEdition(i)}
              className={`border-b border-r border-border p-8 text-left transition-colors ${
                i === edition ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-card/70'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-head text-[1.15rem] font-bold uppercase tracking-[-0.01em]">
                  {e.name}
                </span>
                {i === edition && <Icon name="Check" size={20} />}
              </div>
              <div className="mt-3 font-head text-[1.4rem] font-black tracking-[-0.03em]">
                {e.price}
              </div>
              <p
                className={`mt-2 text-[0.9rem] ${
                  i === edition ? 'text-primary-foreground/80' : 'text-muted-foreground'
                }`}
              >
                {e.note}
              </p>
              <ul className="mt-6 space-y-2">
                {e.items.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-[0.9rem]">
                    <Icon name="Minus" size={16} className="mt-0.5 shrink-0 opacity-60" />
                    {it}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>

        <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="label-caps">Установка</div>
            <div className="mt-5 flex flex-col items-start gap-4">
              <button onClick={start} className="btn-block w-full sm:w-auto">
                <Icon name="Download" size={18} />
                Скачать для Windows
              </button>
              <span className="font-body text-[0.78rem] uppercase leading-relaxed tracking-[0.08em] text-muted-foreground">
                Выбрана редакция: {EDITIONS[edition].name}
                <br />
                Файл подписан цифровой подписью издателя
              </span>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="label-caps">Системные требования</div>
            <dl className="mt-5 border-t border-rule">
              {REQUIREMENTS.map(([k, v]) => (
                <div
                  key={k}
                  className="grid grid-cols-1 gap-1 border-b border-border py-4 sm:grid-cols-2 sm:gap-6"
                >
                  <dt className="font-body text-[0.78rem] uppercase tracking-[0.12em] text-muted-foreground">
                    {k}
                  </dt>
                  <dd className="font-head text-[0.98rem] font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none border-foreground">
          <DialogHeader>
            <DialogTitle className="font-head text-[1.3rem] font-black uppercase tracking-[-0.02em]">
              Загрузка началась
            </DialogTitle>
            <DialogDescription className="pt-2">
              ПВ-Система PDF 3.2 · редакция «{EDITIONS[edition].name}» · 74 МБ
            </DialogDescription>
          </DialogHeader>
          <ol className="mt-2 border-t border-border">
            {[
              'Запустите скачанный файл установки',
              'Подтвердите установку в окне Windows',
              'Откройте программу и работайте 30 дней без оплаты',
            ].map((s, i) => (
              <li key={s} className="flex gap-4 border-b border-border py-3">
                <span className="font-head text-[0.8rem] font-bold text-primary">0{i + 1}</span>
                <span className="text-[0.94rem]">{s}</span>
              </li>
            ))}
          </ol>
          <button onClick={() => setOpen(false)} className="btn-block mt-4 w-full">
            Понятно
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default Download;
