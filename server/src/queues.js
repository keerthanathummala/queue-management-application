import express from 'express';
import { db, save, newId, now } from './db.js';
import { requireAuth } from './auth.js';
import { badRequest, conflict, notFound, handle } from './errors.js';

export const STATUS = Object.freeze({
  WAITING: 'waiting',
  SERVING: 'serving',
  SERVED: 'served',
  CANCELLED: 'cancelled',
});

const minutesBetween = (a, b) => (new Date(b) - new Date(a)) / 60000;
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

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

/** Find a queue owned by the current manager or throw 404 (never leak other managers' queues). */
function ownQueue(req, id = req.params.id) {
  const queue = db.queues.find((q) => q.id === id && q.ownerId === req.user.id);
  if (!queue) throw notFound('Queue not found');
  return queue;
}

function ownToken(req) {
  const token = db.tokens.find((t) => t.id === req.params.tokenId);
  if (!token) throw notFound('Token not found');
  ownQueue(req, token.queueId);
  return token;
}

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Token numbers restart at 1 each day (like a ticket roll), but only once the line from the
 * previous day has cleared, so two active tokens can never share a code.
 */
function upcomingNumber(queue) {
  if (queue.numberDay === localDay()) return queue.nextNumber;
  const active = db.tokens.some(
    (t) => t.queueId === queue.id && (t.status === STATUS.WAITING || t.status === STATUS.SERVING),
  );
  return active ? queue.nextNumber : 1;
}

const waitingTokens = (queueId) =>
  db.tokens.filter((t) => t.queueId === queueId && t.status === STATUS.WAITING).sort((a, b) => a.position - b.position);

function queueSummary(queue) {
  const tokens = db.tokens.filter((t) => t.queueId === queue.id);
  const today = startOfToday();
  const servedToday = tokens.filter((t) => t.status === STATUS.SERVED && new Date(t.completedAt) >= today);
  const calledToday = tokens.filter((t) => t.calledAt && new Date(t.calledAt) >= today);
  const avgWait = calledToday.length
    ? calledToday.reduce((s, t) => s + minutesBetween(t.createdAt, t.calledAt), 0) / calledToday.length
    : null;
  const waiting = tokens.filter((t) => t.status === STATUS.WAITING);
  return {
    ...queue,
    nextNumber: upcomingNumber(queue),
    waitingCount: waiting.length,
    servingCount: tokens.filter((t) => t.status === STATUS.SERVING).length,
    servedToday: servedToday.length,
    cancelledToday: tokens.filter((t) => t.status === STATUS.CANCELLED && new Date(t.cancelledAt) >= today).length,
    avgWaitToday: avgWait === null ? null : Math.round(avgWait * 10) / 10,
    oldestWaitingSince: waiting.reduce((min, t) => (!min || t.createdAt < min ? t.createdAt : min), null),
  };
}

function queueDetail(queue) {
  const tokens = db.tokens.filter((t) => t.queueId === queue.id);
  const waiting = waitingTokens(queue.id).map((t, i) => ({ ...t, place: i + 1 }));
  const serving = tokens.filter((t) => t.status === STATUS.SERVING).sort((a, b) => a.calledAt.localeCompare(b.calledAt));
  const history = tokens
    .filter((t) => t.status === STATUS.SERVED || t.status === STATUS.CANCELLED)
    .sort((a, b) => (b.completedAt || b.cancelledAt).localeCompare(a.completedAt || a.cancelledAt))
    .slice(0, 25);
  return { queue: queueSummary(queue), waiting, serving, history };
}

export const queueRouter = express.Router();
queueRouter.use(requireAuth);

// ----- Queues -----

queueRouter.get(
  '/queues',
  handle((req, res) => {
    const queues = db.queues
      .filter((q) => q.ownerId === req.user.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(queueSummary);
    res.json({ queues });
  }),
);

queueRouter.post(
  '/queues',
  handle((req, res) => {
    const name = cleanText(req.body?.name, { field: 'Queue name', min: 1, max: 60 });
    const description = cleanText(req.body?.description, { field: 'Description', max: 200 });
    const prefix = cleanPrefix(req.body?.prefix, name);
    const duplicate = db.queues.some(
      (q) => q.ownerId === req.user.id && q.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) throw conflict('You already have a queue with this name');
    const queue = {
      id: newId(),
      ownerId: req.user.id,
      name,
      description,
      prefix,
      nextNumber: 1,
      numberDay: localDay(),
      createdAt: now(),
    };
    db.queues.push(queue);
    save();
    res.status(201).json({ queue: queueSummary(queue) });
  }),
);

queueRouter.get(
  '/queues/:id',
  handle((req, res) => res.json(queueDetail(ownQueue(req)))),
);

queueRouter.patch(
  '/queues/:id',
  handle((req, res) => {
    const queue = ownQueue(req);
    if (req.body?.name !== undefined) {
      const name = cleanText(req.body.name, { field: 'Queue name', min: 1, max: 60 });
      const duplicate = db.queues.some(
        (q) => q.id !== queue.id && q.ownerId === req.user.id && q.name.toLowerCase() === name.toLowerCase(),
      );
      if (duplicate) throw conflict('You already have a queue with this name');
      queue.name = name;
    }
    if (req.body?.description !== undefined) {
      queue.description = cleanText(req.body.description, { field: 'Description', max: 200 });
    }
    if (req.body?.prefix !== undefined) queue.prefix = cleanPrefix(req.body.prefix, queue.name);
    save();
    res.json({ queue: queueSummary(queue) });
  }),
);

queueRouter.delete(
  '/queues/:id',
  handle((req, res) => {
    const queue = ownQueue(req);
    db.queues.splice(db.queues.indexOf(queue), 1);
    for (let i = db.tokens.length - 1; i >= 0; i--) {
      if (db.tokens[i].queueId === queue.id) db.tokens.splice(i, 1);
    }
    save();
    res.status(204).end();
  }),
);

// ----- Tokens -----

queueRouter.post(
  '/queues/:id/tokens',
  handle((req, res) => {
    const queue = ownQueue(req);
    const name = cleanText(req.body?.name, { field: 'Name', max: 60 });
    const phone = cleanText(req.body?.phone, { field: 'Phone', max: 20 });
    const note = cleanText(req.body?.note, { field: 'Note', max: 140 });
    if (phone && !/^[+\d][\d\s()-]{2,19}$/.test(phone)) throw badRequest('Phone number looks invalid');
    const waiting = waitingTokens(queue.id);
    const number = upcomingNumber(queue);
    queue.nextNumber = number + 1;
    queue.numberDay = localDay();
    const token = {
      id: newId(),
      queueId: queue.id,
      number,
      code: `${queue.prefix}-${String(number).padStart(3, '0')}`,
      name: name || 'Walk-in',
      phone,
      note,
      status: STATUS.WAITING,
      position: waiting.length ? waiting[waiting.length - 1].position + 1 : 1,
      createdAt: now(),
      calledAt: null,
      completedAt: null,
      cancelledAt: null,
    };
    db.tokens.push(token);
    save();
    res.status(201).json({ token: { ...token, place: waiting.length + 1 } });
  }),
);

queueRouter.post(
  '/queues/:id/serve-next',
  handle((req, res) => {
    const queue = ownQueue(req);
    const [next] = waitingTokens(queue.id);
    if (!next) throw conflict('There is nobody waiting in this queue');
    next.status = STATUS.SERVING;
    next.calledAt = now();
    save();
    res.json({ token: next, ...queueDetail(queue) });
  }),
);

queueRouter.post(
  '/tokens/:tokenId/move',
  handle((req, res) => {
    const token = ownToken(req);
    const direction = req.body?.direction;
    if (!['up', 'down', 'top', 'bottom'].includes(direction)) {
      throw badRequest('direction must be one of up, down, top, bottom');
    }
    if (token.status !== STATUS.WAITING) throw conflict('Only waiting tokens can be moved');
    const list = waitingTokens(token.queueId);
    const from = list.findIndex((t) => t.id === token.id);
    const to = { up: from - 1, down: from + 1, top: 0, bottom: list.length - 1 }[direction];
    if (to < 0 || to >= list.length) throw conflict(`Token is already at the ${from === 0 ? 'top' : 'bottom'} of the queue`);
    if (to !== from) {
      list.splice(from, 1);
      list.splice(to, 0, token);
      list.forEach((t, i) => (t.position = i + 1)); // renumber so positions stay dense
      save();
    }
    res.json(queueDetail(ownQueue(req, token.queueId)));
  }),
);

queueRouter.post(
  '/tokens/:tokenId/complete',
  handle((req, res) => {
    const token = ownToken(req);
    if (token.status !== STATUS.SERVING) throw conflict('Only a token being served can be completed');
    token.status = STATUS.SERVED;
    token.completedAt = now();
    save();
    res.json(queueDetail(ownQueue(req, token.queueId)));
  }),
);

queueRouter.post(
  '/tokens/:tokenId/cancel',
  handle((req, res) => {
    const token = ownToken(req);
    if (token.status !== STATUS.WAITING && token.status !== STATUS.SERVING) {
      throw conflict(`Token is already ${token.status}`);
    }
    token.cancelReason = cleanText(req.body?.reason, { field: 'Reason', max: 140 });
    token.cancelledFrom = token.status;
    token.status = STATUS.CANCELLED;
    token.cancelledAt = now();
    save();
    res.json(queueDetail(ownQueue(req, token.queueId)));
  }),
);
