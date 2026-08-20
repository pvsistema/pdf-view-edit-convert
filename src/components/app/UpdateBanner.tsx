import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { checkUpdate, type UpdateInfo } from '@/lib/adminApi';
import {
  desktopVersion,
  isDesktop,
  startUpdate,
  cancelUpdate,
  onUpdateState,
  type UpdateState,
} from '@/lib/desktop';
import { APP_VERSION } from '@/lib/brand';
import {
  isLicenseAsking,
  readUpdateInfo,
  saveUpdateInfo,
  updateCheckDue,
} from '@/lib/updateStore';

const SKIP_KEY = 'pv_skip_version';

const size = (n: number) => {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`;
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`;
  return `${n} Б`;
};

const UpdateBanner = () => {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
  // Ход загрузки обновления внутри программы
  const [job, setJob] = useState<UpdateState | null>(null);

  // Программа сообщает, сколько уже скачано
  useEffect(() => onUpdateState(setJob), []);

  useEffect(() => {
    const current = desktopVersion() || APP_VERSION;

    const show = (r: UpdateInfo) => {
      if (!r.update_available || r.latest === current) return;
      if (!r.required && localStorage.getItem(SKIP_KEY) === r.latest) return;
      setInfo(r);
      setOpen(true);
    };

    // Показываем ранее найденное обновление сразу, без обращения к серверу
    const saved = readUpdateInfo();
    if (saved) show(saved);

    // Сведения могли прийти вместе с проверкой лицензии
    const onInfo = (e: Event) => show((e as CustomEvent).detail as UpdateInfo);
    window.addEventListener('pvspdf-update', onInfo);

    // Спрашиваем сервер, только если за сутки о версии ещё не узнали.
    // У активированных программ ответ обычно уже пришёл вместе с лицензией
    const timer = setTimeout(() => {
      if (!updateCheckDue() || isLicenseAsking()) return;
      checkUpdate(current)
        .then((r) => {
          saveUpdateInfo(r);
          show(r);
        })
        .catch(() => undefined);
    }, 6000);

    return () => {
      window.removeEventListener('pvspdf-update', onInfo);
      clearTimeout(timer);
    };
  }, []);

  if (!info || !open) return null;

  const skip = () => {
    if (!info.required) localStorage.setItem(SKIP_KEY, info.latest);
    setOpen(false);
  };

  const working = job?.state === 'start' || job?.state === 'progress' || job?.state === 'installing';
  const percent = job?.percent ?? 0;

  // В программе обновление ставится само: скачали — установили — запустили.
  // В браузере остаётся обычная ссылка на загрузку
  const install = () => {
    if (!info.download_url) return;
    if (isDesktop()) {
      setJob({ state: 'start' });
      startUpdate(info.download_url, info.latest);
    } else {
      window.open(info.download_url, '_blank', 'noreferrer');
    }
  };

  const stop = () => {
    cancelUpdate();
    setJob(null);
  };

  return (
    <div className="fixed bottom-5 right-5 z-[85] w-[min(380px,calc(100vw-2.5rem))] animate-fade-in border border-foreground bg-background shadow-[0_12px_40px_rgba(20,24,28,0.25)]">
      <div className="flex items-center gap-2 border-b border-foreground bg-primary px-4 py-2.5 text-primary-foreground">
        <Icon name="Download" size={15} />
        <span className="font-head text-[0.72rem] font-bold uppercase tracking-[0.1em]">
          {info.required ? 'Обязательное обновление' : 'Доступно обновление'}
        </span>
        {!info.required && !working && (
          <button onClick={() => setOpen(false)} className="ml-auto hover:opacity-70" title="Скрыть">
            <Icon name="X" size={15} />
          </button>
        )}
      </div>

      <div className="p-4">
        <div className="font-head text-[1rem] font-bold uppercase">Версия {info.latest}</div>
        {info.notes && (
          <p className="mt-2 max-h-[130px] overflow-y-auto whitespace-pre-line text-[0.85rem] text-muted-foreground">
            {info.notes}
          </p>
        )}

        {/* Идёт загрузка: показываем полосу и объём скачанного */}
        {working ? (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-[0.78rem] text-muted-foreground">
              <span>
                {job?.state === 'installing'
                  ? 'Программа закроется и обновится'
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

            {job?.state === 'progress' && !!job.total && (
              <div className="mt-2 text-[0.75rem] text-muted-foreground">
                {size(job.loaded ?? 0)} из {size(job.total)}
              </div>
            )}

            {job?.state !== 'installing' && (
              <button
                onClick={stop}
                className="mt-3 w-full border border-border px-3 py-2 font-head text-[0.68rem] font-bold uppercase tracking-[0.08em] transition-colors hover:border-destructive hover:text-destructive"
              >
                Отменить
              </button>
            )}
          </div>
        ) : (
          <>
            {job?.state === 'error' && (
              <div className="mt-3 border border-destructive px-3 py-2 text-[0.78rem] text-destructive">
                Не удалось обновить: {job.error || 'ошибка загрузки'}
              </div>
            )}
            {job?.state === 'cancelled' && (
              <div className="mt-3 text-[0.78rem] text-muted-foreground">Загрузка отменена</div>
            )}

            <div className="mt-4 flex gap-2">
              {info.download_url ? (
                <button onClick={install} className="btn-block flex-1 justify-center">
                  <Icon name="Download" size={15} />
                  {isDesktop()
                    ? job?.state === 'error' || job?.state === 'cancelled'
                      ? 'Повторить'
                      : 'Обновить'
                    : 'Скачать'}
                </button>
              ) : (
                <span className="flex-1 text-[0.82rem] text-muted-foreground">
                  Ссылка на загрузку появится позже
                </span>
              )}
              {!info.required && (
                <button
                  onClick={skip}
                  className="border border-border px-3 py-2 font-head text-[0.68rem] font-bold uppercase tracking-[0.08em] transition-colors hover:border-foreground"
                >
                  Позже
                </button>
              )}
            </div>

            {isDesktop() && info.download_url && (
              <p className="mt-2 text-[0.74rem] text-muted-foreground">
                Программа скачает и установит обновление сама, затем откроется заново.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default UpdateBanner;