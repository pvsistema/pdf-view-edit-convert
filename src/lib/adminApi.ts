const AUTH_URL = 'https://functions.poehali.dev/01789cff-13e5-495c-97c6-ab32c229a8f8';
const LIC_URL = 'https://functions.poehali.dev/75aa9cca-1901-4a09-ae83-b403dbd9062c';
const VER_URL = 'https://functions.poehali.dev/30df1eed-1f2b-4871-a057-0dd656d6f09f';

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

const post = async (url: string, body: Record<string, unknown>) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
    body: JSON.stringify(body),
  });
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

export const checkUpdate = (version: string) =>
  post(VER_URL, { action: 'check', version }) as Promise<UpdateInfo>;

export const listReleases = () =>
  post(VER_URL, { action: 'list' }) as Promise<{ items: Release[] }>;

export const publishRelease = (data: Partial<Release>) =>
  post(VER_URL, { action: 'publish', ...data });

export const unpublishRelease = (id: number) => post(VER_URL, { action: 'unpublish', id });