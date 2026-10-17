const BASE = '';

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

// ── Auth ────────────────────────────────────────────────────────────
export async function login(username: string, password: string) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
  return data;
}

export async function register(username: string, password: string) {
  const data = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
  return data;
}

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

export function getCurrentUser() {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

// ── Users ───────────────────────────────────────────────────────────
export async function listUsers() {
  return request('/api/users');
}

export async function inviteUser(username: string, password: string, role: string) {
  return request('/api/users/invite', {
    method: 'POST',
    body: JSON.stringify({ username, password, role }),
  });
}

export async function deleteUser(id: number) {
  return request(`/api/users/${id}`, { method: 'DELETE' });
}

// ── API Keys ────────────────────────────────────────────────────────
export async function listKeys() {
  return request('/api/keys');
}

export async function generateKey(label: string) {
  return request('/api/keys', {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
}

export async function revokeKey(id: number) {
  return request(`/api/keys/${id}`, { method: 'DELETE' });
}

// ── Servers ─────────────────────────────────────────────────────────
export async function listServers() {
  return request('/api/servers');
}

export async function addServer(data: { name: string; slug: string; url: string; auth_type: string; auth_header_name: string; auth_credential: string }) {
  return request('/api/servers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateServer(id: number, data: any) {
  return request(`/api/servers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function toggleServer(id: number) {
  return request(`/api/servers/${id}/toggle`, { method: 'PATCH' });
}

export async function removeServer(id: number) {
  return request(`/api/servers/${id}`, { method: 'DELETE' });
}

// ── Audit ───────────────────────────────────────────────────────────
export async function listAudit(limit = 100, offset = 0) {
  return request(`/api/audit?limit=${limit}&offset=${offset}`);
}

// ── Chat ────────────────────────────────────────────────────────────
export async function sendChatMessage(message: string, history: any[]) {
  return request('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message, history }),
  });
}
