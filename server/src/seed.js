/**
 * Seeds a demo manager with three queues and ~30 days of realistic history,
 * so the analytics dashboard has something meaningful to show.
 *
 *   npm run seed            -> adds demo data (replaces any existing demo account)
 *
 * Demo login: demo@queue.app / demo1234
 */
import { load, save, db, newId } from './db.js';
import { createUser } from './auth.js';
import { STATUS } from './queues.js';

const DEMO_EMAIL = 'demo@queue.app';
const MIN = 60_000;

// Deterministic PRNG so the demo looks the same every time.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a, b) => a + rand() * (b - a);
const expo = (mean) => -Math.log(1 - rand()) * mean;

const FIRST = ['Aarav', 'Olivia', 'Liam', 'Priya', 'Noah', 'Mia', 'Ethan', 'Zara', 'Lucas', 'Ava', 'Ravi', 'Chloe', 'Arjun', 'Isla', 'Mason', 'Sana', 'Leo', 'Emma', 'Kai', 'Ananya'];
const LAST = ['Sharma', 'Smith', 'Nguyen', 'Patel', 'Brown', 'Wilson', 'Reddy', 'Taylor', 'Chen', 'Kumar', 'Martin', 'Lee'];
const person = () => `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;

// Arrivals per hour by local hour of day (business hours 9–17, peaks late morning and after lunch).
const HOURLY_RATE = { 9: 5, 10: 9, 11: 10, 12: 7, 13: 8, 14: 10, 15: 7, 16: 5 };

function removeExistingDemo() {
  const user = db.users.find((u) => u.email === DEMO_EMAIL);
  if (!user) return;
  const queueIds = new Set(db.queues.filter((q) => q.ownerId === user.id).map((q) => q.id));
  for (let i = db.tokens.length - 1; i >= 0; i--) if (queueIds.has(db.tokens[i].queueId)) db.tokens.splice(i, 1);
  for (let i = db.queues.length - 1; i >= 0; i--) if (queueIds.has(db.queues[i].id)) db.queues.splice(i, 1);
  db.users.splice(db.users.indexOf(user), 1);
}

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
  const free = Array(counters).fill(dayStart + 9 * 60 * MIN);
  const live = [];
  for (const arrivedAt of arrivals) {
    if (arrivedAt > nowMs) break;
    const counter = free.indexOf(Math.min(...free));
    const callAt = Math.max(arrivedAt, free[counter]);
    const willWait = (callAt - arrivedAt) / MIN;
    const number = queue.nextNumber++;
    const token = {
      id: newId(),
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
      db.tokens.push(token);
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
    db.tokens.push(token);
  }
  return live;
}

export function seedDemo({ days = 30, nowMs = Date.now() } = {}) {
  removeExistingDemo();
  const user = createUser({ name: 'Demo Manager', email: DEMO_EMAIL, password: 'demo1234' });
  const profiles = [
    { name: 'General Enquiries', description: 'Front desk walk-ins', prefix: 'G', counters: 2, load: 1, serviceMean: 10, patience: 35 },
    { name: 'Billing & Payments', description: 'Invoices, refunds and payment plans', prefix: 'B', counters: 1, load: 0.55, serviceMean: 9, patience: 45 },
    { name: 'Technical Support', description: 'Device and account troubleshooting', prefix: 'T', counters: 2, load: 0.7, serviceMean: 15, patience: 60 },
  ];
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);

  profiles.forEach((p, idx) => {
    const queue = {
      id: newId(),
      ownerId: user.id,
      name: p.name,
      description: p.description,
      prefix: p.prefix,
      nextNumber: 1,
      createdAt: new Date(today.getTime() - days * 86400_000 + idx * MIN).toISOString(),
    };
    db.queues.push(queue);
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
        id: newId(),
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
      db.tokens.push(token);
      live.push(token);
    }
    live.forEach((t, i) => (t.position = i + 1));
  });
  save();
  return user;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.js')) {
  load();
  seedDemo();
  const n = db.tokens.length;
  console.log(`Seeded demo data (${n} tokens). Log in with ${DEMO_EMAIL} / demo1234`);
}
