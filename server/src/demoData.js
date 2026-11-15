/**
 * Demo data simulator (pure, no Node dependencies). Used by `npm run seed` and by the
 * browser-only demo build. Simulates a multi-counter FIFO queue per day with realistic
 * arrival peaks, service times and people leaving when the wait is too long.
 */
import { STATUS } from './status.js';

const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const DEMO_EMAIL = 'demo@queue.app';
export const DEMO_PASSWORD = 'demo1234';
const MIN = 60_000;

// Deterministic PRNG so the demo looks the same every time.
let seed = 42;
const ctx = { newId: () => globalThis.crypto.randomUUID(), tokens: [] };
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a, b) => a + rand() * (b - a);
const expo = (mean) => -Math.log(1 - rand()) * mean;

const FIRST = ['Aarav', 'Olivia', 'Liam', 'Priya', 'Noah', 'Mia', 'Ethan', 'Zara', 'Lucas', 'Ava', 'Ravi', 'Chloe', 'Arjun', 'Isla', 'Mason', 'Sana', 'Leo', 'Emma', 'Kai', 'Ananya'];
const LAST = ['Sharma', 'Smith', 'Nguyen', 'Patel', 'Brown', 'Wilson', 'Reddy', 'Taylor', 'Chen', 'Kumar', 'Martin', 'Lee'];
const person = () => `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;

// Arrivals per hour by local hour of day (business hours 9–17, peaks late morning and after lunch).
const HOURLY_RATE = { 9: 5, 10: 9, 11: 10, 12: 7, 13: 8, 14: 10, 15: 7, 16: 5 };

/** Simulate one day of a multi-counter FIFO queue. Only events before `nowMs` are kept. */
function simulateDay(queue, dayStart, nowMs, { counters, load, serviceMean, patience }) {
  const arrivals = [];
  for (const [hour, rate] of Object.entries(HOURLY_RATE)) {
    let t = dayStart + Number(hour) * 60 * MIN;
    const end = t + 60 * MIN;
    const weekday = new Date(dayStart).getDay();
    const dayFactor = weekday === 0 || weekday === 6 ? 0.45 : weekday === 1 ? 1.25 : 1;
    while (true) {
      t += expo((60 / (rate * load * dayFactor)) * MIN);
      if (t >= end) break;
      arrivals.push(t);
    }
  }
  queue.nextNumber = 1; // token numbers restart every day, like a real ticket roll
  const free = Array(counters).fill(dayStart + 9 * 60 * MIN);
  const live = [];
  for (const arrivedAt of arrivals) {
    if (arrivedAt > nowMs) break;
    const counter = free.indexOf(Math.min(...free));
    const callAt = Math.max(arrivedAt, free[counter]);
    const willWait = (callAt - arrivedAt) / MIN;
    const number = queue.nextNumber++;
    const token = {
      id: ctx.newId(),
      queueId: queue.id,
      number,
      code: `${queue.prefix}-${String(number).padStart(3, '0')}`,
      name: person(),
      phone: '',
      note: '',
      status: STATUS.SERVED,
      position: number,
      createdAt: new Date(arrivedAt).toISOString(),
      calledAt: null,
      completedAt: null,
      cancelledAt: null,
    };
    const abandons = willWait > patience * between(0.6, 1.6) || rand() < 0.03;
    if (abandons) {
      const cancelAt = arrivedAt + Math.min(willWait, patience) * MIN * between(0.5, 1);
      if (cancelAt <= nowMs) {
        Object.assign(token, {
          status: STATUS.CANCELLED,
          cancelledAt: new Date(cancelAt).toISOString(),
          cancelledFrom: STATUS.WAITING,
          cancelReason: 'Left the queue',
        });
      } else {
        token.status = STATUS.WAITING;
        live.push(token);
      }
      ctx.tokens.push(token);
      continue;
    }
    const doneAt = callAt + Math.max(1.5, expo(serviceMean)) * MIN;
    free[counter] = doneAt;
    if (callAt > nowMs) {
      token.status = STATUS.WAITING;
      live.push(token);
    } else if (doneAt > nowMs) {
      token.status = STATUS.SERVING;
      token.calledAt = new Date(callAt).toISOString();
    } else {
      token.calledAt = new Date(callAt).toISOString();
      token.completedAt = new Date(doneAt).toISOString();
    }
    ctx.tokens.push(token);
  }
  return live;
}

/**
 * Build three demo queues with ~30 days of simulated history for `ownerId`.
 * Pure: returns new { queues, tokens } arrays and touches no storage.
 */
export function generateDemoData({ ownerId, newId, days = 30, nowMs = Date.now() }) {
  seed = 42; // same demo every time
  if (newId) ctx.newId = newId;
  ctx.tokens = [];
  const queues = [];
  const profiles = [
    { name: 'General Enquiries', description: 'Front desk walk-ins', prefix: 'G', counters: 2, load: 1, serviceMean: 10, patience: 35 },
    { name: 'Billing & Payments', description: 'Invoices, refunds and payment plans', prefix: 'B', counters: 1, load: 0.55, serviceMean: 9, patience: 45 },
    { name: 'Technical Support', description: 'Device and account troubleshooting', prefix: 'T', counters: 2, load: 0.7, serviceMean: 15, patience: 60 },
  ];
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);

  profiles.forEach((p, idx) => {
    const queue = {
      id: ctx.newId(),
      ownerId,
      name: p.name,
      description: p.description,
      prefix: p.prefix,
      nextNumber: 1,
      createdAt: new Date(today.getTime() - days * 86400_000 + idx * MIN).toISOString(),
    };
    queues.push(queue);
    let live = [];
    for (let d = days; d >= 0; d--) {
      const dayStart = new Date(today);
      dayStart.setDate(today.getDate() - d);
      live = simulateDay(queue, dayStart.getTime(), nowMs, p);
    }
    // Outside business hours the demo would have an empty line; add a few live walk-ins so
    // the queue screen always has something to manage.
    const extra = Math.max(0, [4, 2, 3][idx] - live.length);
    for (let i = 0; i < extra; i++) {
      const number = queue.nextNumber++;
      const token = {
        id: ctx.newId(),
        queueId: queue.id,
        number,
        code: `${queue.prefix}-${String(number).padStart(3, '0')}`,
        name: person(),
        phone: '',
        note: i === 0 && idx === 0 ? 'Needs wheelchair access' : '',
        status: STATUS.WAITING,
        position: number,
        createdAt: new Date(nowMs - (extra - i) * between(3, 7) * MIN).toISOString(),
        calledAt: null,
        completedAt: null,
        cancelledAt: null,
      };
      ctx.tokens.push(token);
      live.push(token);
    }
    live.forEach((t, i) => (t.position = i + 1));
    queue.numberDay = localDay(new Date(nowMs));
  });
  return { queues, tokens: ctx.tokens };
}
