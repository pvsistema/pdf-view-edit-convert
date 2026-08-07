const AUTH_URL = 'https://functions.poehali.dev/01789cff-13e5-495c-97c6-ab32c229a8f8';
const LIC_URL = 'https://functions.poehali.dev/75aa9cca-1901-4a09-ae83-b403dbd9062c';

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

export const verifyKey = (key: string) =>
  post(LIC_URL, { action: 'verify', key }) as Promise<{
    valid: boolean;
    reason?: string;
    org_name?: string;
    valid_until?: string;
    days_left?: number;
  }>;
