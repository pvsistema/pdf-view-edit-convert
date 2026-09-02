import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { checkUpdate, type UpdateInfo } from '@/lib/adminApi';
import { APP_VERSION } from '@/lib/brand';
import {
  desktopVersion,
  isDesktop,
  startUpdate,
  onUpdateState,
  type UpdateState,
} from '@/lib/desktop';
import { readBlock, saveBlock, saveUpdateInfo } from '@/lib/updateStore';
import { applyServerUsed, trialMachineId } from '@/lib/trial';

// Работа на устаревшей версии запрещена: окно закрыть нельзя, пока
// человек не обновится. Решение принимает сервер, программа лишь
// выполняет — и помнит запрет, чтобы его не снимали отключением сети
const VersionGate = () => {
  const current = desktopVersion() || APP_VERSION;
  const [need, setNeed] = useState(() => readBlock());
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [job, setJob] = useState<UpdateState | null>(null);

  useEffect(() => onUpdateState(setJob), []);

  useEffect(() => {
    // Ответ мог прийти с проверкой лицензии или обновления
    const onInfo = (e: Event) => {
      const r = (e as CustomEvent).detail as UpdateInfo;
      if (typeof r?.blocked !== 'boolean') return;
      saveBlock(r);
      setNeed(r.blocked ? r.min_version || '' : '');
      if (r.blocked) setInfo(r);
    };
    window.addEventListener('pvspdf-update', onInfo);

    // Запрет строгий, поэтому спрашиваем сервер при каждом запуске,
    // а не раз в сутки: иначе снятый запрет держался бы ещё день
    checkUpdate(current, trialMachineId())
      .then((r) => {
        saveBlock(r);
        setNeed(r.blocked ? r.min_version || '' : '');
        if (r.blocked) setInfo(r);
        // Этим же ответом делимся с остальными: баннер обновления и
        // пробный счётчик берут его отсюда, второй раз сервер не тревожим
        saveUpdateInfo(r);
        if (typeof r.trial_used === 'number') applyServerUsed(r.trial_used);
      })
      .catch(() => undefined);

    return () => window.removeEventListener('pvspdf-update', onInfo);
  }, [current]);

  if (!need) return null;

  const working = job?.state === 'start' || job?.state === 'progress' || job?.state === 'installing';
  const percent = job?.percent ?? 0;
  const link = info?.download_url || '';

  const install = () => {
    if (!link) return;
    if (isDesktop()) {
      setJob({ state: 'start' });
      startUpdate(link, info?.latest || need);
    } else {
      window.open(link, '_blank', 'noreferrer');
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-foreground/70 p-5 backdrop-blur-sm">
      <div className="w-[min(460px,100%)] border border-foreground bg-background shadow-[0_20px_60px_rgba(20,24,28,0.4)]">
        <div className="flex items-center gap-2 border-b border-foreground bg-destructive px-4 py-3 text-destructive-foreground">
          <Icon name="ShieldAlert" size={16} />
          <span className="font-head text-[0.72rem] font-bold uppercase tracking-[0.1em]">
            Требуется обновление
          </span>
        </div>

        <div className="p-5">
          <div className="font-head text-[1.05rem] font-bold uppercase">
            Эта версия больше не поддерживается
          </div>

          <p className="mt-3 text-[0.88rem] leading-relaxed text-muted-foreground">
            У вас установлена версия <b className="text-foreground">{current}</b>. Для работы нужна{' '}
            <b className="text-foreground">{need}</b> или новее. Обновитесь — все ваши файлы и
            настройки останутся на месте.
          </p>

          {info?.notes && (
            <p className="mt-3 max-h-[120px] overflow-y-auto whitespace-pre-line border-l-2 border-border pl-3 text-[0.83rem] text-muted-foreground">
              {info.notes}
            </p>
          )}

          {working ? (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-[0.78rem] text-muted-foreground">
                <span>
                  {job?.state === 'installing'
                    ? 'Программа закроется, откроется окно установки'
                    : job?.state === 'start'
                      ? 'Подключение к серверу'
                      : 'Загрузка обновления'}
                </span>
                {job?.state === 'progress' && <span>{percent}%</span>}
              </div>
              <div className="h-2 w-full overflow-hidden border border-border bg-muted">
                <div
                  className={`h-full bg-primary transition-[width] duration-200 ${
                    job?.state === 'progress' ? '' : 'animate-pulse'
                  }`}
                  style={{ width: `${job?.state === 'progress' ? percent : 100}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              {job?.state === 'error' && (
                <div className="mt-4 border border-destructive px-3 py-2 text-[0.8rem] text-destructive">
                  Не удалось обновить: {job.error || 'ошибка загрузки'}
                </div>
              )}

              {link ? (
                <button onClick={install} className="btn-block mt-5 w-full justify-center">
                  <Icon name="Download" size={16} />
                  {isDesktop()
                    ? job?.state === 'error'
                      ? 'Повторить обновление'
                      : 'Обновить сейчас'
                    : 'Скачать новую версию'}
                </button>
              ) : (
                <p className="mt-5 border border-border px-3 py-2.5 text-[0.83rem] text-muted-foreground">
                  Ссылка на установщик пока не готова. Напишите нам — поможем обновиться
                </p>
              )}

              <p className="mt-3 text-[0.78rem] text-muted-foreground">
                {isDesktop() && link
                  ? 'Программа скачает и установит обновление сама, затем откроется заново'
                  : 'После установки новой версии программа заработает как обычно'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default VersionGate;