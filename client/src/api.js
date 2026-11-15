const TOKEN_KEY = 'queuedesk.token';

/** True in the GitHub Pages build, where a browser-only backend replaces the server. */
export const DEMO = import.meta.env.VITE_DEMO === '1';

export const session = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable: session lasts for this tab only */
    }
  },
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = session.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  if (DEMO) {
    const { demoRequest } = await import('./demoApi.js');
    const { status, data } = await demoRequest(path, { method, body, token: auth ? token : undefined });
    if (status >= 400) {
      if (status === 401 && auth) onUnauthorized();
      throw new ApiError(status, data?.error || `Request failed (${status})`);
    }
    return status === 204 ? null : data;
  }

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that it is running and try again.');
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && auth) onUnauthorized();
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  return data;
}
