import { useState } from 'react';
import Icon from '@/components/ui/icon';
import { addScanner } from '@/lib/desktop';

type Props = { onClose: () => void };

// Добавление сканера вручную.
//
// Зачем. Часть аппаратов не отзывается ни на один общий опрос: драйверы
// некоторых сетевых МФУ объявляют устройство только своей программе.
// Такой сканер исправен и работает — его просто не видно в списке.
// Здесь человек называет аппарат сам.
const AddScannerBox = ({ onClose }: Props) => {
  const [name, setName] = useState('');
  const [wia, setWia] = useState(false);
  const [feeder, setFeeder] = useState(false);
  const [duplex, setDuplex] = useState(false);

  const save = () => {
    const clean = name.trim();
    if (!clean) return;

    addScanner({ name: clean, wia, feeder, duplex });
    onClose();
  };

  return (
    <div className="mt-4 border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="label-caps">Добавить сканер вручную</span>
        <button
          onClick={onClose}
          className="text-[0.74rem] text-muted-foreground hover:text-foreground"
        >
          Отмена
        </button>
      </div>

      <p className="mt-2 text-[0.76rem] leading-relaxed text-muted-foreground">
        Название пишите ровно так, как аппарат называется в программе
        производителя или в разделе «Принтеры и сканеры» — по нему программа
        и обратится к драйверу.
      </p>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder="Например: Kyocera TASKalfa 2020"
        autoFocus
        className="mt-3 w-full border border-border bg-background px-3 py-2.5 text-[0.9rem] outline-none focus:border-primary"
      />

      <div className="mt-3 space-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-[0.82rem]">
          <input
            type="checkbox"
            checked={wia}
            onChange={(e) => setWia(e.target.checked)}
            className="accent-primary"
          />
          Снимать через Windows, а не через драйвер производителя
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-[0.82rem]">
          <input
            type="checkbox"
            checked={feeder}
            onChange={(e) => setFeeder(e.target.checked)}
            className="accent-primary"
          />
          У аппарата есть автоподатчик
        </label>

        {feeder && (
          <label className="flex cursor-pointer items-center gap-2 pl-6 text-[0.82rem]">
            <input
              type="checkbox"
              checked={duplex}
              onChange={(e) => setDuplex(e.target.checked)}
              className="accent-primary"
            />
            Умеет снимать обе стороны листа
          </label>
        )}
      </div>

      <button
        onClick={save}
        disabled={!name.trim()}
        className="mt-4 flex items-center gap-2 bg-primary px-4 py-2 text-[0.8rem] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        <Icon name="Plus" size={14} />
        Добавить
      </button>
    </div>
  );
};

export default AddScannerBox;
