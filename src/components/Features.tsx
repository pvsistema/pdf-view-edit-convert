import { useState } from 'react';
import Icon from '@/components/ui/icon';

type Feature = {
  num: string;
  icon: string;
  title: string;
  short: string;
  bullets: string[];
};

const FEATURES: Feature[] = [
  {
    num: '01',
    icon: 'BookOpen',
    title: 'Просмотр PDF',
    short: 'Быстрое открытие тяжёлых документов и сканов',
    bullets: [
      'Документ на 800 страниц открывается за секунды',
      'Режимы: одна страница, разворот, миниатюры',
      'Поиск по тексту и по закладкам',
      'Вкладки: несколько договоров одновременно',
    ],
  },
  {
    num: '02',
    icon: 'PenLine',
    title: 'Редактирование текста и страниц',
    short: 'Правка прямо на странице, без пересборки файла',
    bullets: [
      'Исправить сумму, дату или ФИО в готовом акте',
      'Повернуть, удалить, переставить страницы',
      'Штампы, подписи и водяные знаки',
      'Комментарии и выделение для согласования',
    ],
  },
  {
    num: '03',
    icon: 'Repeat',
    title: 'Конвертация форматов',
    short: 'PDF ↔ Word, Excel, JPG с сохранением вёрстки',
    bullets: [
      'Таблицы переносятся в Excel ячейка в ячейку',
      'Word сохраняет шрифты, отступы и колонтитулы',
      'Экспорт страниц в JPG и PNG нужного качества',
      'Пакетная обработка папки целиком',
    ],
  },
  {
    num: '04',
    icon: 'Combine',
    title: 'Объединение и разделение',
    short: 'Собрать пакет документов или разобрать на части',
    bullets: [
      'Склейка счетов и актов в один файл',
      'Разделение по закладкам, страницам или размеру',
      'Извлечение выбранных листов в новый документ',
      'Сжатие итогового файла для отправки по почте',
    ],
  },
  {
    num: '05',
    icon: 'ScanText',
    title: 'Распознавание текста (OCR)',
    short: 'Скан превращается в документ с поиском',
    bullets: [
      'Русский и английский, смешанные документы',
      'Распознавание таблиц из отсканированных отчётов',
      'Слой текста поверх скана — оригинал не меняется',
      'Экспорт результата в Word или обычный текст',
    ],
  },
  {
    num: '06',
    icon: 'ShieldCheck',
    title: 'Защита документов',
    short: 'Пароли, права доступа и удаление данных',
    bullets: [
      'Пароль на открытие и на печать',
      'Скрытие персональных данных заливкой',
      'Работа полностью на вашем компьютере, без облака',
      'Журнал изменений документа',
    ],
  },
];

const Features = () => {
  const [active, setActive] = useState(0);
  const current = FEATURES[active];

  return (
    <section id="features" className="border-t border-foreground bg-background py-20 md:py-28">
      <div className="mx-auto max-w-[1400px] px-6 md:px-14">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="label-caps">Раздел 01</div>
            <h2 className="mt-3 max-w-[16em] font-head text-[2rem] font-black uppercase leading-[1.06] tracking-[-0.03em] md:text-[3rem]">
              Возможности программы
            </h2>
          </div>
          <p className="max-w-[26em] text-muted-foreground">
            Шесть блоков закрывают полный цикл работы с документом: от просмотра входящего скана до
            готового пакета на отправку.
          </p>
        </div>

        <div className="rule mt-10" />

        <div className="grid grid-cols-1 lg:grid-cols-12">
          <div className="border-b border-border lg:col-span-5 lg:border-b-0 lg:border-r lg:border-rule">
            {FEATURES.map((f, i) => (
              <button
                key={f.num}
                onClick={() => setActive(i)}
                className={`flex w-full items-start gap-5 border-b border-border px-1 py-6 text-left transition-colors lg:pr-8 ${
                  i === active ? 'bg-card' : 'hover:bg-card/60'
                }`}
              >
                <span
                  className={`font-head text-[0.78rem] font-bold tracking-[0.1em] ${
                    i === active ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {f.num}
                </span>
                <span className="flex-1">
                  <span className="block font-head text-[1.05rem] font-bold uppercase tracking-[-0.01em] md:text-[1.2rem]">
                    {f.title}
                  </span>
                  <span className="mt-1 block text-[0.9rem] text-muted-foreground">{f.short}</span>
                </span>
                <Icon
                  name="ArrowRight"
                  size={18}
                  className={`mt-1 shrink-0 transition-transform ${
                    i === active ? 'translate-x-0 text-primary' : '-translate-x-1 opacity-40'
                  }`}
                />
              </button>
            ))}
          </div>

          <div className="lg:col-span-7">
            <div key={active} className="animate-fade-in h-full px-0 py-10 lg:px-12 lg:py-12">
              <div className="flex h-14 w-14 items-center justify-center bg-primary text-primary-foreground">
                <Icon name={current.icon} size={26} />
              </div>
              <h3 className="mt-7 font-head text-[1.7rem] font-black uppercase leading-tight tracking-[-0.03em] md:text-[2.2rem]">
                {current.title}
              </h3>
              <p className="mt-3 max-w-[30em] text-muted-foreground">{current.short}</p>

              <ul className="mt-9 border-t border-rule">
                {current.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-4 border-b border-border py-4">
                    <Icon name="Check" size={18} className="mt-0.5 shrink-0 text-primary" />
                    <span className="text-[0.98rem] leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Features;
