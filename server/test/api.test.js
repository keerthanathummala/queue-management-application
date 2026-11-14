import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { load } from '../src/db.js';

let server;
let base;

before(async () => {
  load(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

let counter = 0;
async function manager() {
  counter++;
  const { data } = await call('/auth/register', {
    method: 'POST',
    body: { name: `Manager ${counter}`, email: `m${counter}@test.dev`, password: 'secret12' },
  });
  return data.token;
}

async function queueWith(token, names) {
  const { data } = await call('/queues', { method: 'POST', token, body: { name: `Desk ${Math.random()}` } });
  for (const name of names) await call(`/queues/${data.queue.id}/tokens`, { method: 'POST', token, body: { name } });
  return data.queue.id;
}

const waitingNames = async (token, id) => (await call(`/queues/${id}`, { token })).data.waiting.map((t) => t.name);

describe('auth', () => {
  test('register, log in and fetch the current user', async () => {
    const reg = await call('/auth/register', {
      method: 'POST',
      body: { name: 'Asha', email: 'Asha@Example.com ', password: 'hunter22' },
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.data.user.email, 'asha@example.com');
    assert.equal(reg.data.user.passwordHash, undefined, 'never leak the hash');

    const login = await call('/auth/login', { method: 'POST', body: { email: 'asha@example.com', password: 'hunter22' } });
    assert.equal(login.status, 200);
    const me = await call('/auth/me', { token: login.data.token });
    assert.equal(me.data.user.name, 'Asha');
  });

  test('rejects duplicates, bad passwords and invalid input', async () => {
    const body = { name: 'Dup', email: 'dup@test.dev', password: 'secret12' };
    assert.equal((await call('/auth/register', { method: 'POST', body })).status, 201);
    assert.equal((await call('/auth/register', { method: 'POST', body })).status, 409);
    assert.equal((await call('/auth/login', { method: 'POST', body: { ...body, password: 'nope' } })).status, 401);
    assert.equal((await call('/auth/register', { method: 'POST', body: { ...body, email: 'x' } })).status, 400);
    assert.equal((await call('/auth/register', { method: 'POST', body: { ...body, email: 'a@b.co', password: '123' } })).status, 400);
  });

  test('protected routes need a valid token', async () => {
    assert.equal((await call('/queues')).status, 401);
    assert.equal((await call('/queues', { token: 'garbage' })).status, 401);
  });
});

describe('queues', () => {
  test('create, rename and delete a queue', async () => {
    const token = await manager();
    const created = await call('/queues', { method: 'POST', token, body: { name: '  Billing   desk ' } });
    assert.equal(created.status, 201);
    assert.equal(created.data.queue.name, 'Billing desk');
    assert.equal(created.data.queue.prefix, 'BD');

    const id = created.data.queue.id;
    const renamed = await call(`/queues/${id}`, { method: 'PATCH', token, body: { name: 'Payments', prefix: 'p' } });
    assert.equal(renamed.data.queue.name, 'Payments');
    assert.equal(renamed.data.queue.prefix, 'P');

    assert.equal((await call(`/queues/${id}`, { method: 'DELETE', token })).status, 204);
    assert.equal((await call(`/queues/${id}`, { token })).status, 404);
  });

  test('requires a name and rejects duplicate names per manager', async () => {
    const token = await manager();
    assert.equal((await call('/queues', { method: 'POST', token, body: { name: '   ' } })).status, 400);
    assert.equal((await call('/queues', { method: 'POST', token, body: { name: 'Front' } })).status, 201);
    assert.equal((await call('/queues', { method: 'POST', token, body: { name: 'front' } })).status, 409);
    // A different manager may use the same name.
    assert.equal((await call('/queues', { method: 'POST', token: await manager(), body: { name: 'Front' } })).status, 201);
  });

  test("managers cannot see or change each other's queues", async () => {
    const alice = await manager();
    const bob = await manager();
    const id = await queueWith(alice, ['Ann']);
    const [tok] = (await call(`/queues/${id}`, { token: alice })).data.waiting;
    assert.equal((await call(`/queues/${id}`, { token: bob })).status, 404);
    assert.equal((await call(`/queues/${id}/tokens`, { method: 'POST', token: bob, body: {} })).status, 404);
    assert.equal((await call(`/tokens/${tok.id}/cancel`, { method: 'POST', token: bob })).status, 404);
    assert.equal((await call('/queues', { token: bob })).data.queues.length, 0);
  });
});

describe('tokens', () => {
  test('adding people creates sequential tokens in arrival order', async () => {
    const token = await manager();
    const { data } = await call('/queues', { method: 'POST', token, body: { name: 'General', prefix: 'G' } });
    const a = await call(`/queues/${data.queue.id}/tokens`, { method: 'POST', token, body: { name: 'Ann' } });
    const b = await call(`/queues/${data.queue.id}/tokens`, { method: 'POST', token, body: {} });
    assert.equal(a.status, 201);
    assert.equal(a.data.token.code, 'G-001');
    assert.equal(b.data.token.code, 'G-002');
    assert.equal(b.data.token.name, 'Walk-in');
    assert.equal(b.data.token.place, 2);
    const detail = await call(`/queues/${data.queue.id}`, { token });
    assert.deepEqual(detail.data.waiting.map((t) => t.place), [1, 2]);
    assert.equal(detail.data.queue.waitingCount, 2);
  });

  test('move tokens up, down, to the top and bottom', async () => {
    const token = await manager();
    const id = await queueWith(token, ['A', 'B', 'C', 'D']);
    const ids = async () => (await call(`/queues/${id}`, { token })).data.waiting;
    let list = await ids();

    await call(`/tokens/${list[2].id}/move`, { method: 'POST', token, body: { direction: 'up' } });
    assert.deepEqual(await waitingNames(token, id), ['A', 'C', 'B', 'D']);

    list = await ids();
    await call(`/tokens/${list[0].id}/move`, { method: 'POST', token, body: { direction: 'down' } });
    assert.deepEqual(await waitingNames(token, id), ['C', 'A', 'B', 'D']);

    list = await ids();
    await call(`/tokens/${list[3].id}/move`, { method: 'POST', token, body: { direction: 'top' } });
    assert.deepEqual(await waitingNames(token, id), ['D', 'C', 'A', 'B']);

    list = await ids();
    await call(`/tokens/${list[0].id}/move`, { method: 'POST', token, body: { direction: 'bottom' } });
    assert.deepEqual(await waitingNames(token, id), ['C', 'A', 'B', 'D']);
  });

  test('cannot move past the ends or with a bad direction', async () => {
    const token = await manager();
    const id = await queueWith(token, ['A', 'B']);
    const [first, second] = (await call(`/queues/${id}`, { token })).data.waiting;
    assert.equal((await call(`/tokens/${first.id}/move`, { method: 'POST', token, body: { direction: 'up' } })).status, 409);
    assert.equal((await call(`/tokens/${second.id}/move`, { method: 'POST', token, body: { direction: 'down' } })).status, 409);
    assert.equal((await call(`/tokens/${first.id}/move`, { method: 'POST', token, body: { direction: 'sideways' } })).status, 400);
    assert.deepEqual(await waitingNames(token, id), ['A', 'B']);
  });

  test('serve next takes the top token, then it can be completed', async () => {
    const token = await manager();
    const id = await queueWith(token, ['A', 'B']);
    const served = await call(`/queues/${id}/serve-next`, { method: 'POST', token });
    assert.equal(served.status, 200);
    assert.equal(served.data.token.name, 'A');
    assert.equal(served.data.token.status, 'serving');
    assert.ok(served.data.token.calledAt);
    assert.deepEqual(served.data.waiting.map((t) => t.name), ['B']);
    assert.equal(served.data.serving.length, 1);

    const done = await call(`/tokens/${served.data.token.id}/complete`, { method: 'POST', token });
    assert.equal(done.data.serving.length, 0);
    assert.equal(done.data.history[0].status, 'served');
    assert.equal(done.data.queue.servedToday, 1);

    // Completing twice is rejected.
    assert.equal((await call(`/tokens/${served.data.token.id}/complete`, { method: 'POST', token })).status, 409);
  });

  test('serve next on an empty queue is a clear error', async () => {
    const token = await manager();
    const id = await queueWith(token, []);
    const res = await call(`/queues/${id}/serve-next`, { method: 'POST', token });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /nobody/i);
  });

  test('cancel removes a token from the line and keeps the order of the rest', async () => {
    const token = await manager();
    const id = await queueWith(token, ['A', 'B', 'C']);
    const [, b] = (await call(`/queues/${id}`, { token })).data.waiting;
    const res = await call(`/tokens/${b.id}/cancel`, { method: 'POST', token, body: { reason: 'Left' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.waiting.map((t) => [t.name, t.place]), [['A', 1], ['C', 2]]);
    assert.equal(res.data.history[0].cancelReason, 'Left');
    // Already cancelled tokens cannot be cancelled, moved or served again.
    assert.equal((await call(`/tokens/${b.id}/cancel`, { method: 'POST', token })).status, 409);
    assert.equal((await call(`/tokens/${b.id}/move`, { method: 'POST', token, body: { direction: 'up' } })).status, 409);
  });

  test('a token being served can be cancelled as a no-show', async () => {
    const token = await manager();
    const id = await queueWith(token, ['A']);
    const { data } = await call(`/queues/${id}/serve-next`, { method: 'POST', token });
    const res = await call(`/tokens/${data.token.id}/cancel`, { method: 'POST', token });
    assert.equal(res.status, 200);
    assert.equal(res.data.serving.length, 0);
  });

  test('validates phone numbers and lengths', async () => {
    const token = await manager();
    const id = await queueWith(token, []);
    assert.equal((await call(`/queues/${id}/tokens`, { method: 'POST', token, body: { phone: 'call me' } })).status, 400);
    assert.equal((await call(`/queues/${id}/tokens`, { method: 'POST', token, body: { name: 'x'.repeat(61) } })).status, 400);
    assert.equal((await call(`/queues/${id}/tokens`, { method: 'POST', token, body: { phone: '+61 400 123 456' } })).status, 201);
  });

  test('deleting a queue removes its tokens', async () => {
    const token = await manager();
    const id = await queueWith(token, ['A']);
    const [a] = (await call(`/queues/${id}`, { token })).data.waiting;
    await call(`/queues/${id}`, { method: 'DELETE', token });
    assert.equal((await call(`/tokens/${a.id}/cancel`, { method: 'POST', token })).status, 404);
  });
});

describe('analytics endpoint', () => {
  test('returns KPIs and trends for the manager, and validates range', async () => {
    const token = await manager();
    const id = await queueWith(token, ['A', 'B', 'C']);
    const { data } = await call(`/queues/${id}/serve-next`, { method: 'POST', token });
    await call(`/tokens/${data.token.id}/complete`, { method: 'POST', token });

    const res = await call('/analytics?range=24h', { token });
    assert.equal(res.status, 200);
    assert.equal(res.data.trend.length, 24);
    assert.equal(res.data.kpis.waitingNow, 2);
    assert.equal(res.data.kpis.served, 1);
    assert.equal(res.data.kpis.totalTokens, 3);
    assert.equal(res.data.perQueue.length, 1);

    assert.equal((await call(`/analytics?queueId=${id}&range=30d`, { token })).data.trend.length, 30);
    assert.equal((await call('/analytics?range=1y', { token })).status, 400);
    assert.equal((await call('/analytics?queueId=nope', { token })).status, 404);
  });
});
