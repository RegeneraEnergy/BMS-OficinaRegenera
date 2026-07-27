const API_BASE = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';

export { API_BASE };

export default function apiFetch(path, options = {}) {
  const token = localStorage.getItem('bms_token');
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
