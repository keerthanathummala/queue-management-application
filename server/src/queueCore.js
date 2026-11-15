/**
 * Queue and token rules, written as plain functions over a `store`
 * ({ users, queues, tokens } arrays) with no Node or Express dependencies.
 *
 * The Express routes (queues.js) and the browser-only demo build both call these,
 * so the demo behaves exactly like the real server.
 */
import { STATUS } from './status.js';
import { badRequest, conflict, notFound } from './errors.js';

export { STATUS };

let makeId = () => globalThis.crypto.randomUUID();
/** Override how ids are generated (the server passes node:crypto's randomUUID). */
export const setIdFactory = (fn) => (makeId = fn);
const nowIso = () => new Date().toISOString();

const minutesBetween = (a, b) => (new Date(b) - new Date(a)) / 60000;
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function cleanText(value, { field, min = 0, max }) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (text.length < min) throw badRequest(min === 1 ? `${field} is required` : `${field} must be at least ${min} characters`);
  if (text.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return text;
}

function derivePrefix(name) {
  const letters = name
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/gi, '')[0])
    .filter(Boolean)
    .join('')
    .toUpperCase();
  return (letters || 'Q').slice(0, 3);
}

function cleanPrefix(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') return derivePrefix(name);
  const p = String(value).trim().toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(p)) throw badRequest('Token prefix must be 1–4 letters or digits');
  return p;
}

/** Find a queue owned by this manager or throw 404 (never leak other managers' queues). */
function ownQueue(store, ownerId, id) {
  const queue = store.queues.find((q) => q.id === id && q.ownerId === ownerId);
  if (!queue) throw notFound('Queue not found');
  return queue;
}

function ownToken(store, ownerId, tokenId) {
  const token = store.tokens.find((t) => t.id === tokenId);
  if (!token) throw notFound('Token not found');
  ownQueue(store, ownerId, token.queueId);
  return token;
}

const waitingTokens = (store, queueId) =>
  store.tokens
    .filter((t) => t.queueId === queueId && t.status === STATUS.WAITING)
    .sort((a, b) => a.position - b.position);

/**
 * Token numbers restart at 1 each day (like a ticket roll), but only once the line from the
 * previous day has cleared, so two active tokens can never share a code.
 */
function upcomingNumber(store, queue) {
  if (queue.numberDay === localDay()) return queue.nextNumber;
  const active = store.tokens.some(
    (t) => t.queueId === queue.id && (t.status === STATUS.WAITING || t.status === STATUS.SERVING),
  );
  return active ? queue.nextNumber : 1;
}

function queueSummary(store, queue) {
  const tokens = store.tokens.filter((t) => t.queueId === queue.id);
  const today = startOfToday();
  const servedToday = tokens.filter((t) => t.status === STATUS.SERVED && new Date(t.completedAt) >= today);
  const calledToday = tokens.filter((t) => t.calledAt && new Date(t.calledAt) >= today);
  const avgWait = calledToday.length
    ? calledToday.reduce((s, t) => s + minutesBetween(t.createdAt, t.calledAt), 0) / calledToday.length
    : null;
  const waiting = tokens.filter((t) => t.status === STATUS.WAITING);
  return {
    ...queue,
    nextNumber: upcomingNumber(store, queue),
    waitingCount: waiting.length,
    servingCount: tokens.filter((t) => t.status === STATUS.SERVING).length,
    servedToday: servedToday.length,
    cancelledToday: tokens.filter((t) => t.status === STATUS.CANCELLED && new Date(t.cancelledAt) >= today).length,
    avgWaitToday: avgWait === null ? null : Math.round(avgWait * 10) / 10,
    oldestWaitingSince: waiting.reduce((min, t) => (!min || t.createdAt < min ? t.createdAt : min), null),
  };
}

function queueDetail(store, queue) {
  const tokens = store.tokens.filter((t) => t.queueId === queue.id);
  const waiting = waitingTokens(store, queue.id).map((t, i) => ({ ...t, place: i + 1 }));
  const serving = tokens
    .filter((t) => t.status === STATUS.SERVING)
    .sort((a, b) => a.calledAt.localeCompare(b.calledAt));
  const history = tokens
    .filter((t) => t.status === STATUS.SERVED || t.status === STATUS.CANCELLED)
    .sort((a, b) => (b.completedAt || b.cancelledAt).localeCompare(a.completedAt || a.cancelledAt))
    .slice(0, 25);
  return { queue: queueSummary(store, queue), waiting, serving, history };
}

const nameTaken = (store, ownerId, name, exceptId) =>
  store.queues.some(
    (q) => q.id !== exceptId && q.ownerId === ownerId && q.name.toLowerCase() === name.toLowerCase(),
  );

// ----- Queues -----

export function listQueues(store, ownerId) {
  return {
    queues: store.queues
      .filter((q) => q.ownerId === ownerId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((q) => queueSummary(store, q)),
  };
}

export function createQueue(store, ownerId, body = {}) {
  const name = cleanText(body.name, { field: 'Queue name', min: 1, max: 60 });
  const description = cleanText(body.description, { field: 'Description', max: 200 });
  const prefix = cleanPrefix(body.prefix, name);
  if (nameTaken(store, ownerId, name)) throw conflict('You already have a queue with this name');
  const queue = {
    id: makeId(),
    ownerId,
    name,
    description,
    prefix,
    nextNumber: 1,
    numberDay: localDay(),
    createdAt: nowIso(),
  };
  store.queues.push(queue);
  return { queue: queueSummary(store, queue) };
}

export const getQueue = (store, ownerId, id) => queueDetail(store, ownQueue(store, ownerId, id));

export function updateQueue(store, ownerId, id, body = {}) {
  const queue = ownQueue(store, ownerId, id);
  if (body.name !== undefined) {
    const name = cleanText(body.name, { field: 'Queue name', min: 1, max: 60 });
    if (nameTaken(store, ownerId, name, queue.id)) throw conflict('You already have a queue with this name');
    queue.name = name;
  }
  if (body.description !== undefined) {
    queue.description = cleanText(body.description, { field: 'Description', max: 200 });
  }
  if (body.prefix !== undefined) queue.prefix = cleanPrefix(body.prefix, queue.name);
  return { queue: queueSummary(store, queue) };
}

export function deleteQueue(store, ownerId, id) {
  const queue = ownQueue(store, ownerId, id);
  store.queues.splice(store.queues.indexOf(queue), 1);
  for (let i = store.tokens.length - 1; i >= 0; i--) {
    if (store.tokens[i].queueId === queue.id) store.tokens.splice(i, 1);
  }
  return null;
}

// ----- Tokens -----

export function addToken(store, ownerId, queueId, body = {}) {
  const queue = ownQueue(store, ownerId, queueId);
  const name = cleanText(body.name, { field: 'Name', max: 60 });
  const phone = cleanText(body.phone, { field: 'Phone', max: 20 });
  const note = cleanText(body.note, { field: 'Note', max: 140 });
  if (phone && !/^[+\d][\d\s()-]{2,19}$/.test(phone)) throw badRequest('Phone number looks invalid');
  const waiting = waitingTokens(store, queue.id);
  const number = upcomingNumber(store, queue);
  queue.nextNumber = number + 1;
  queue.numberDay = localDay();
  const token = {
    id: makeId(),
    queueId: queue.id,
    number,
    code: `${queue.prefix}-${String(number).padStart(3, '0')}`,
    name: name || 'Walk-in',
    phone,
    note,
    status: STATUS.WAITING,
    position: waiting.length ? waiting[waiting.length - 1].position + 1 : 1,
    createdAt: nowIso(),
    calledAt: null,
    completedAt: null,
    cancelledAt: null,
  };
  store.tokens.push(token);
  return { token: { ...token, place: waiting.length + 1 } };
}

export function serveNext(store, ownerId, queueId) {
  const queue = ownQueue(store, ownerId, queueId);
  const [next] = waitingTokens(store, queue.id);
  if (!next) throw conflict('There is nobody waiting in this queue');
  next.status = STATUS.SERVING;
  next.calledAt = nowIso();
  return { token: next, ...queueDetail(store, queue) };
}

export function moveToken(store, ownerId, tokenId, direction) {
  const token = ownToken(store, ownerId, tokenId);
  if (!['up', 'down', 'top', 'bottom'].includes(direction)) {
    throw badRequest('direction must be one of up, down, top, bottom');
  }
  if (token.status !== STATUS.WAITING) throw conflict('Only waiting tokens can be moved');
  const list = waitingTokens(store, token.queueId);
  const from = list.findIndex((t) => t.id === token.id);
  const to = { up: from - 1, down: from + 1, top: 0, bottom: list.length - 1 }[direction];
  if (to < 0 || to >= list.length) {
    throw conflict(`Token is already at the ${from === 0 ? 'top' : 'bottom'} of the queue`);
  }
  if (to !== from) {
    list.splice(from, 1);
    list.splice(to, 0, token);
    list.forEach((t, i) => (t.position = i + 1)); // renumber so positions stay dense
  }
  return queueDetail(store, ownQueue(store, ownerId, token.queueId));
}

export function completeToken(store, ownerId, tokenId) {
  const token = ownToken(store, ownerId, tokenId);
  if (token.status !== STATUS.SERVING) throw conflict('Only a token being served can be completed');
  token.status = STATUS.SERVED;
  token.completedAt = nowIso();
  return queueDetail(store, ownQueue(store, ownerId, token.queueId));
}

export function cancelToken(store, ownerId, tokenId, reason) {
  const token = ownToken(store, ownerId, tokenId);
  if (token.status !== STATUS.WAITING && token.status !== STATUS.SERVING) {
    throw conflict(`Token is already ${token.status}`);
  }
  token.cancelReason = cleanText(reason, { field: 'Reason', max: 140 });
  token.cancelledFrom = token.status;
  token.status = STATUS.CANCELLED;
  token.cancelledAt = nowIso();
  return queueDetail(store, ownQueue(store, ownerId, token.queueId));
}
