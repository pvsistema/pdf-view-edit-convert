const AUTH_URL = 'https://functions.poehali.dev/01789cff-13e5-495c-97c6-ab32c229a8f8';
const LIC_URL = 'https://functions.poehali.dev/75aa9cca-1901-4a09-ae83-b403dbd9062c';
const VER_URL = 'https://functions.poehali.dev/30df1eed-1f2b-4871-a057-0dd656d6f09f';
const PAY_URL = 'https://functions.poehali.dev/c3b8df06-2a49-4c03-a2aa-cc13498ab792';

const TOKEN_KEY = 'pv_admin_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export type License = {
  id: number;
  org_name: string;
  license_key: string;
  valid_until: string;
  seats: number;
  contact: string;
  note: string;
  status: string;
  activations: number;
  created_at: string;
};

export type Stats = { total: number; active: number; expired: number; blocked: number };

export type UpdateInfo = {
  update_available: boolean;
  latest: string;
  download_url?: string;
  notes?: string;
  required?: boolean;
  published_at?: string;
};

// Дольше этого ответа не ждём: при обрыве связи запрос мог висеть
// минутами, и программа впустую держала соединение
const WAIT_MS = 15000;

const post = async (url: string, body: Record<string, unknown>) => {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), WAIT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
      body: JSON.stringify(body),
      signal: stop.signal,
    });
  } catch {
    throw new Error(
      stop.signal.aborted ? 'Сервер не ответил вовремя' : 'Нет связи с сервером',
    );
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

export const login = (loginName: string, password: string) =>
  post(AUTH_URL, { action: 'login', login: loginName, password });

export const checkSession = () => post(AUTH_URL, { action: 'check' });

export const logout = () => post(AUTH_URL, { action: 'logout' });

export const changePassword = (password: string) =>
  post(AUTH_URL, { action: 'change_password', password });

export const listLicenses = (search = '') =>
  post(LIC_URL, { action: 'list', search }) as Promise<{ items: License[]; stats: Stats }>;

export const generateKey = () => post(LIC_URL, { action: 'generate_key' }) as Promise<{ key: string }>;

export const createLicense = (data: Partial<License>) =>
  post(LIC_URL, { action: 'create', ...data }) as Promise<{ item: License }>;

export const updateLicense = (data: Partial<License> & { id: number }) =>
  post(LIC_URL, { action: 'update', ...data }) as Promise<{ item: License }>;

export const deleteLicense = (id: number) => post(LIC_URL, { action: 'delete', id });

// Компьютеры, на которых работает ключ — видно занятые места
export type Machine = {
  machine_id: string;
  machine_name: string;
  first_seen: string;
  last_seen: string;
};

export const listMachines = (id: number) =>
  post(LIC_URL, { action: 'machines', id }) as Promise<{ items: Machine[] }>;

export type CheckRecord = {
  id: number;
  license_key: string;
  result: string;
  ip: string;
  user_agent: string;
  checked_at: string;
  org_name: string;
};

export const listHistory = (id = 0, limit = 200) =>
  post(LIC_URL, { action: 'history', id, limit }) as Promise<{
    items: CheckRecord[];
    by_result: Record<string, number>;
  }>;

// Ключи, нужные при сборке программы — только для панели управления
export const getBuildInfo = () =>
  post(LIC_URL, { action: 'build_info' }) as Promise<{
    module_key: string;
    public_key: string;
  }>;

// Отметка о пробном запуске. Счёт программа ведёт у себя, серверу
// сообщает лишь факт — чтобы в панели была видна отдача пробного режима
export const sendTrialEvent = (data: {
  event: 'used' | 'limit';
  tool: string;
  used: number;
  machine_id: string;
  machine_name: string;
  app_version: string;
}) => post(LIC_URL, { action: 'trial_event', ...data });

// Сколько людей пробовало, упёрлось в лимит и купило после этого
export const trialStats = () =>
  post(LIC_URL, { action: 'trial_stats' }) as Promise<{
    tried: number;
    hit_limit: number;
    bought: number;
    runs: number;
    rate: number;
    by_tool: { tool: string; count: number }[];
    recent: {
      machine_name: string;
      machine_id: string;
      event: string;
      tool: string;
      used: number;
      when: string;
      was_reset: boolean;
    }[];
    reset_machines: number;
    resets: {
      machine_id: string;
      machine_name: string;
      resets: number;
      runs: number;
      last: string;
    }[];
  }>;

// Ключ к платному модулю: сервер отдаёт его только по действующей лицензии
export const getModuleKey = (module: string, key: string, machine = '') =>
  post(LIC_URL, { action: 'module_key', module, key, machine_id: machine }) as Promise<{
    secret?: string;
    error?: string;
  }>;

export type SignedLicense = { payload: string; sig: string };

export const verifyKey = (
  key: string,
  appVersion = '',
  machine = '',
  machineName = '',
) =>
  post(LIC_URL, {
    action: 'verify',
    key,
    app_version: appVersion,
    machine_id: machine,
    machine_name: machineName,
  }) as Promise<{
    valid: boolean;
    reason?: string;
    org_name?: string;
    valid_until?: string;
    days_left?: number;
    signed?: SignedLicense;
    update?: UpdateInfo;
  }>;
export type Release = {
  id: number;
  version: string;
  download_url: string;
  notes: string;
  is_required: boolean;
  is_published: boolean;
  published_at: string;
};

// Отпечаток компьютера передаём, чтобы тем же ответом узнать
// серверный счёт проб — без отдельного обращения
export const checkUpdate = (version: string, machineId = '') =>
  post(VER_URL, { action: 'check', version, machine_id: machineId }) as Promise<
    UpdateInfo & { trial_used?: number }
  >;

export const listReleases = () =>
  post(VER_URL, { action: 'list' }) as Promise<{ items: Release[] }>;

export const publishRelease = (data: Partial<Release>) =>
  post(VER_URL, { action: 'publish', ...data });

export const unpublishRelease = (id: number) => post(VER_URL, { action: 'unpublish', id });

// --- Оплата лицензии ---

export type Tariff = {
  id: number;
  code: string;
  title: string;
  note: string;
  price: number;
  months: number;
  seats: number;
  sort: number;
  is_active: boolean;
};

// ready = приём оплаты настроен: заданы доступы к Робокассе
export const listTariffs = () =>
  post(PAY_URL, { action: 'tariffs' }) as Promise<{ items: Tariff[]; ready: boolean }>;

export const createOrder = (data: {
  tariff: string;
  email?: string;
  org_name?: string;
  machine_id?: string;
  renew_key?: string;
}) =>
  post(PAY_URL, { action: 'create_order', ...data }) as Promise<{
    order_id?: number;
    token?: string;
    pay_url?: string;
    price?: number;
    title?: string;
    error?: string;
  }>;

// Программа спрашивает о своём заказе, пока клиент платит в браузере
export const orderStatus = (token: string) =>
  post(PAY_URL, { action: 'order_status', token }) as Promise<{
    status: string;
    paid: boolean;
    license_key: string;
    title: string;
    price: number;
  }>;

export const adminTariffs = () =>
  post(PAY_URL, { action: 'admin_tariffs' }) as Promise<{ items: Tariff[] }>;

export const saveTariff = (data: Partial<Tariff>) =>
  post(PAY_URL, { action: 'save_tariff', ...data }) as Promise<{ item: Tariff }>;

export const deleteTariff = (id: number) => post(PAY_URL, { action: 'delete_tariff', id });

export type Order = {
  id: number;
  title: string;
  price: number;
  status: string;
  email: string;
  org_name: string;
  license_key: string;
  created_at: string;
  paid_at: string;
  mail_sent: boolean;
  mail_note: string;
};

export const listOrders = (limit = 100) =>
  post(PAY_URL, { action: 'orders', limit }) as Promise<{
    items: Order[];
    stats: { paid: number; total_sum: number };
  }>;

// Выдать ключ вручную: деньги пришли мимо банка — счётом или переводом
export const markOrderPaid = (id: number) =>
  post(PAY_URL, { action: 'mark_paid', id }) as Promise<{ ok: boolean; license_key: string }>;

// Отправить письмо с ключом заново — на тот же или исправленный адрес
export const resendKeyMail = (id: number, email = '') =>
  post(PAY_URL, { action: 'resend_mail', id, email }) as Promise<{ ok: boolean; note: string }>;

export const mailReady = () =>
  post(PAY_URL, { action: 'mail_ready' }) as Promise<{ ready: boolean }>;

// Пробное письмо уходит на собственный ящик магазина
export const testMail = () =>
  post(PAY_URL, { action: 'test_mail' }) as Promise<{
    ok: boolean;
    note: string;
    to: string;
  }>;