// Запоминаем, чем и как человек сканирует. При следующем открытии
// окна настройки уже выставлены — заново их трогать не нужно.
// Обычное и пакетное сканирование помним раздельно: у пачки листов
// свои привычные настройки (автоподатчик, две стороны)

export type ScanPrefs = {
  device: string;
  deviceName: string;
  dpi: number;
  color: 'color' | 'gray' | 'bw';
  feeder: boolean;
  duplex: boolean;
  limit: number;
};

const KEY = 'pvs-scan-prefs';

const DEFAULTS: ScanPrefs = {
  device: '',
  deviceName: '',
  dpi: 300,
  color: 'color',
  feeder: false,
  duplex: false,
  limit: 0,
};

const slot = (batch: boolean) => (batch ? 'batch' : 'single');

export const loadScanPrefs = (batch: boolean): ScanPrefs => {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    const saved = all[slot(batch)];
    if (!saved || typeof saved !== 'object') return { ...DEFAULTS };

    // Читаем бережно: настройки могли остаться от прошлой версии
    return {
      device: typeof saved.device === 'string' ? saved.device : '',
      deviceName: typeof saved.deviceName === 'string' ? saved.deviceName : '',
      dpi: Number.isFinite(saved.dpi) ? saved.dpi : DEFAULTS.dpi,
      color: ['color', 'gray', 'bw'].includes(saved.color) ? saved.color : DEFAULTS.color,
      feeder: !!saved.feeder,
      duplex: !!saved.duplex,
      limit: Number.isFinite(saved.limit) && saved.limit >= 0 ? saved.limit : 0,
    };
  } catch {
    return { ...DEFAULTS };
  }
};

export const saveScanPrefs = (batch: boolean, prefs: ScanPrefs) => {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    all[slot(batch)] = prefs;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Память браузера может быть переполнена — не беда,
    // настройки просто не сохранятся
  }
};
