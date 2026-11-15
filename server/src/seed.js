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
import { DEMO_EMAIL, DEMO_PASSWORD, generateDemoData } from './demoData.js';

function removeExistingDemo() {
  const user = db.users.find((u) => u.email === DEMO_EMAIL);
  if (!user) return;
  const queueIds = new Set(db.queues.filter((q) => q.ownerId === user.id).map((q) => q.id));
  for (let i = db.tokens.length - 1; i >= 0; i--) if (queueIds.has(db.tokens[i].queueId)) db.tokens.splice(i, 1);
  for (let i = db.queues.length - 1; i >= 0; i--) if (queueIds.has(db.queues[i].id)) db.queues.splice(i, 1);
  db.users.splice(db.users.indexOf(user), 1);
}

export function seedDemo({ days = 30, nowMs = Date.now() } = {}) {
  removeExistingDemo();
  const user = createUser({ name: 'Demo Manager', email: DEMO_EMAIL, password: DEMO_PASSWORD });
  const { queues, tokens } = generateDemoData({ ownerId: user.id, newId, days, nowMs });
  db.queues.push(...queues);
  db.tokens.push(...tokens);
  save();
  return user;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.js')) {
  load();
  seedDemo();
  console.log(`Seeded demo data (${db.tokens.length} tokens). Log in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}
