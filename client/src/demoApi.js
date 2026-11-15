/**
 * Browser-only backend used by the GitHub Pages demo (VITE_DEMO=1).
 *
 * It answers the same endpoints as the Express server by calling the very same
 * queue / analytics modules from ../../server/src, and keeps everything in
 * localStorage, so the hosted demo behaves like the real app without a server.
 */
import * as core from '../../server/src/queueCore.js';
import { computeAnalytics } from '../../server/src/analyticsCore.js';
import { generateDemoData, DEMO_EMAIL, DEMO_PASSWORD } from '../../server/src/demoData.js';
import { HttpError, badRequest, conflict, unauthorized, notFound } from '../../server/src/errors.js';

const KEY = 'queuedesk.demo.v1';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
core.setIdFactory(newId);

let store = null;

async function hashPassword(pw) {
  const bytes = new TextEncoder().encode(`queuedesk:${pw}`);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return btoa(String.fromCharCode(...bytes)); // insecure contexts only; demo data never leaves the browser
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage full or blocked: the demo keeps working for this tab */
  }
}

async function seedStore() {
  const user = {
    id: newId(),
    name: 'Demo Manager',
    email: DEMO_EMAIL,
    passwordHash: await hashPassword(DEMO_PASSWORD),
    createdAt: new Date().toISOString(),
  };
  const { queues, tokens } = generateDemoData({ ownerId: user.id, newId });
  store = { users: [user], queues, tokens };
  persist();
}

async function getStore() {
  if (store) return store;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.users) && Array.isArray(parsed.queues) && Array.isArray(parsed.tokens)) {
        store = parsed;
        return store;
      }
    }
  } catch {
    /* fall through to a fresh demo */
  }
  await seedStore();
  return store;
}

/** Wipe everything and start again with fresh demo data. */
export async function resetDemo() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  store = null;
  await seedStore();
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt });
const sessionFor = (u) => `demo.${u.id}`;

function currentUser(s, token) {
  const id = typeof token === 'string' && token.startsWith('demo.') ? token.slice(5) : null;
  const user = id && s.users.find((u) => u.id === id);
  if (!user) throw unauthorized('Session expired, please log in again');
  return user;
}

async function register(s, body = {}) {
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (name.length < 2 || name.length > 60) throw badRequest('Name must be 2–60 characters');
  if (!EMAIL_RE.test(email)) throw badRequest('Please enter a valid email address');
  if (password.length < 6) throw badRequest('Password must be at least 6 characters');
  if (s.users.some((u) => u.email === email)) throw conflict('An account with this email already exists');
  const user = { id: newId(), name, email, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
  s.users.push(user);
  return user;
}

async function login(s, body = {}) {
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) throw badRequest('Email and password are required');
  const user = s.users.find((u) => u.email === email);
  if (!user || user.passwordHash !== (await hashPassword(password))) throw unauthorized('Incorrect email or password');
  return user;
}

/**
 * Handle one API request. Returns { status, data } like an HTTP response.
 */
export async function demoRequest(path, { method = 'GET', body, token } = {}) {
  const s = await getStore();
  const url = new URL(path, 'http://demo.local');
  const p = url.pathname.split('/').filter(Boolean); // e.g. ['queues', ':id', 'tokens']
  // Collection/id/action paths (queues/:id/tokens, tokens/:id/move); auth paths have no ids.
  const shape = p[0] === 'auth' ? p : p.map((seg, i) => (i % 2 === 1 ? ':id' : seg));
  const route = `${method} /${shape.join('/')}`;
  try {
    // ----- auth (no session needed) -----
    if (route === 'POST /auth/register') {
      const user = await register(s, body);
      persist();
      return { status: 201, data: { token: sessionFor(user), user: publicUser(user) } };
    }
    if (route === 'POST /auth/login') {
      const user = await login(s, body);
      return { status: 200, data: { token: sessionFor(user), user: publicUser(user) } };
    }

    const me = currentUser(s, token);
    const id = p[1];
    let data;
    let status = 200;
    let mutates = method !== 'GET';

    switch (route) {
      case 'GET /auth/me':
        data = { user: publicUser(me) };
        break;
      case 'GET /queues':
        data = core.listQueues(s, me.id);
        break;
      case 'POST /queues':
        data = core.createQueue(s, me.id, body);
        status = 201;
        break;
      case 'GET /queues/:id':
        data = core.getQueue(s, me.id, id);
        break;
      case 'PATCH /queues/:id':
        data = core.updateQueue(s, me.id, id, body);
        break;
      case 'DELETE /queues/:id':
        data = core.deleteQueue(s, me.id, id);
        status = 204;
        break;
      case 'POST /queues/:id/tokens':
        data = core.addToken(s, me.id, id, body);
        status = 201;
        break;
      case 'POST /queues/:id/serve-next':
        data = core.serveNext(s, me.id, id);
        break;
      case 'POST /tokens/:id/move':
        data = core.moveToken(s, me.id, id, body?.direction);
        break;
      case 'POST /tokens/:id/complete':
        data = core.completeToken(s, me.id, id);
        break;
      case 'POST /tokens/:id/cancel':
        data = core.cancelToken(s, me.id, id, body?.reason);
        break;
      case 'GET /analytics': {
        let queues = s.queues.filter((q) => q.ownerId === me.id);
        const queueId = url.searchParams.get('queueId');
        if (queueId) {
          queues = queues.filter((q) => q.id === queueId);
          if (!queues.length) throw notFound('Queue not found');
        }
        const ids = new Set(queues.map((q) => q.id));
        const tz = Number(url.searchParams.get('tzOffset'));
        data = computeAnalytics({
          tokens: s.tokens.filter((t) => ids.has(t.queueId)),
          queues,
          range: url.searchParams.get('range') || '7d',
          tzOffset: Number.isFinite(tz) && Math.abs(tz) <= 840 ? tz : 0,
        });
        mutates = false;
        break;
      }
      default:
        throw new HttpError(404, 'Endpoint not found');
    }
    if (mutates) persist();
    return { status, data };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, data: { error: err.message } };
    console.error(err);
    return { status: 500, data: { error: 'Something went wrong in the demo' } };
  }
}
