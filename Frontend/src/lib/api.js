import { supabase } from './supabase';

const BASE = (import.meta.env.VITE_BACKEND_URL || 'https://telegram-product-sync.onrender.com').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, timeout = 60000 } = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new ApiError('Login expire thai gayu. Fari login karo.', 401);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let json = null;
    try { json = await res.json(); } catch { /* not json */ }
    if (!res.ok || json?.ok === false) throw new ApiError(json?.error || `Server error (${res.status})`, res.status);
    return json;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('Server jagi rahyo che (free server). 20-40 second pachi fari try karo.', 0);
  } finally {
    clearTimeout(timer);
  }
}

// one automatic retry when the free server was asleep
async function withWake(path, opts) {
  try {
    return await request(path, opts);
  } catch (e) {
    if (e.status !== 0) throw e;
    await new Promise((r) => setTimeout(r, 4000));
    return request(path, opts);
  }
}

export const api = {
  status: () => withWake('/status'),
  sendOtp: (phone) => withWake('/send-otp', { method: 'POST', body: { phone } }),
  verifyOtp: (otp) => request('/verify-otp', { method: 'POST', body: { otp } }),
  verify2fa: (password) => request('/verify-2fa', { method: 'POST', body: { password } }),
  refreshChannels: () => withWake('/channels/refresh', { method: 'POST' }),
  toggleChannels: (channel_ids, enabled) => withWake('/channels/toggle', { method: 'POST', body: { channel_ids, enabled } }),
  disconnect: (purge) => withWake('/disconnect', { method: 'POST', body: { purge } }),
  wake: () => fetch(`${BASE}/health`, { cache: 'no-store' }).catch(() => {}),
};
