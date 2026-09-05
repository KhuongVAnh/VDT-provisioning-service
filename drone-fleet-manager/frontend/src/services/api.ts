import { DroneDevice, DashboardStats, UserProfile } from '../types';

export const getStoredToken = (): string | null => {
  return localStorage.getItem('jwt_token');
};

export const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_profile');
    window.dispatchEvent(new Event('auth:unauthorized'));
  }

  return res;
};

export const apiLogin = async (email: string, password: string): Promise<{ token: string; user: UserProfile }> => {
  const res = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok || json.status === 'error') {
    throw new Error(json.message || 'Đăng nhập thất bại');
  }
  const token = json.accessToken || json.token || json.data?.accessToken || json.data?.token;
  const user = json.user || json.data?.user;
  return { token, user };
};

export const apiRegister = async (email: string, password: string, fullName: string): Promise<{ token: string; user: UserProfile }> => {
  const res = await fetch('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, fullName }),
  });
  const json = await res.json();
  if (!res.ok || json.status === 'error') {
    throw new Error(json.message || 'Đăng ký thất bại');
  }
  const token = json.accessToken || json.token || json.data?.accessToken || json.data?.token;
  const user = json.user || json.data?.user;
  return { token, user };
};

export const fetchFleetStates = async (): Promise<DroneDevice[]> => {
  const res = await authFetch('/api/v1/telemetry/fleet/states');
  const json = await res.json();
  if (json?.status === 'success') {
    return json.data || [];
  }
  return [];
};

export const fetchDashboardStats = async (): Promise<DashboardStats | null> => {
  const res = await authFetch('/api/v1/dashboard/stats');
  const json = await res.json();
  if (json?.status === 'success') {
    return json.data;
  }
  return null;
};

export const registerManualDevice = async (
  deviceId: string,
  vpnIp: string,
  hardwareModel: string
): Promise<any> => {
  const res = await authFetch('/api/v1/dashboard/devices/manual', {
    method: 'POST',
    body: JSON.stringify({ deviceId, vpnIp, hardwareModel }),
  });
  const json = await res.json();
  if (!res.ok || json.status === 'error') {
    throw new Error(json.message || 'Đăng ký thiết bị thất bại');
  }
  return json.data;
};

export const sendDroneCommand = async (
  deviceId: string,
  command: 'arm' | 'disarm' | 'rtl' | 'takeoff' | 'land',
  params?: Record<string, any>
): Promise<any> => {
  const res = await authFetch(`/api/v1/devices/${deviceId}/command`, {
    method: 'POST',
    body: JSON.stringify({ command, ...params }),
  });
  return res.json();
};

export const fetchIpPoolMatrix = async (): Promise<any[]> => {
  try {
    const res = await authFetch('/api/v1/dashboard/ip-pool');
    const json = await res.json();
    if (json?.status === 'success') {
      return json.data || [];
    }
    return [];
  } catch (err) {
    console.warn('[API] Lỗi khi tải IP Pool Matrix:', err);
    return [];
  }
};

