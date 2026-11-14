import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAnalytics } from '../src/analytics.js';

const NOW = Date.parse('2026-03-10T12:30:00Z');
const at = (min) => new Date(NOW - min * 60000).toISOString();
const queues = [{ id: 'q1', name: 'Front' }];

function tok(over) {
  return { queueId: 'q1', status: 'waiting', createdAt: at(10), calledAt: null, completedAt: null, cancelledAt: null, ...over };
}

test('wait and service statistics', () => {
  const tokens = [
    tok({ status: 'served', createdAt: at(60), calledAt: at(50), completedAt: at(45) }), // waited 10, service 5
    tok({ status: 'served', createdAt: at(40), calledAt: at(20), completedAt: at(5) }), // waited 20, service 15
    tok({ status: 'serving', createdAt: at(30), calledAt: at(0) }), // waited 30
    tok({ status: 'cancelled', createdAt: at(25), cancelledAt: at(15), cancelledFrom: 'waiting' }),
    tok({ status: 'waiting', createdAt: at(12) }),
  ];
  const { kpis } = computeAnalytics({ tokens, queues, range: '24h', nowMs: NOW });
  assert.equal(kpis.totalTokens, 5);
  assert.equal(kpis.avgWait, 20);
  assert.equal(kpis.medianWait, 20);
  assert.equal(kpis.maxWait, 30);
  assert.equal(kpis.avgService, 10);
  assert.equal(kpis.served, 2);
  assert.equal(kpis.cancelled, 1);
  assert.equal(kpis.cancelRate, 33.3);
  assert.equal(kpis.waitingNow, 1);
  assert.equal(kpis.servingNow, 1);
  assert.equal(kpis.longestCurrentWait, 12);
});

test('queue length trend counts people in line at the end of each bucket', () => {
  const tokens = [
    tok({ createdAt: at(200) }), // waiting for 3+ hours
    tok({ status: 'served', createdAt: at(150), calledAt: at(100), completedAt: at(95) }),
  ];
  const { trend } = computeAnalytics({ tokens, queues, range: '24h', nowMs: NOW });
  assert.equal(trend.length, 24);
  assert.equal(trend.at(-1).queueLength, 1, 'only the still-waiting token is in line now');
  const peak = Math.max(...trend.map((t) => t.peakQueueLength));
  assert.equal(peak, 2, 'both were waiting together for a while');
});

test('buckets follow the viewer time zone', () => {
  // Brisbane is UTC+10 → getTimezoneOffset() = -600. 12:30Z is 22:30 local.
  const tokens = [tok({ createdAt: '2026-03-10T00:15:00Z' })]; // 10:15 local
  const { byHour, trend } = computeAnalytics({ tokens, queues, range: '7d', tzOffset: -600, nowMs: NOW });
  assert.equal(byHour[10].arrivals, 1);
  assert.equal(trend.length, 7);
  assert.equal(trend.at(-1).start, '2026-03-09T14:00:00.000Z', 'last bucket starts at local midnight');
  assert.equal(trend.at(-1).arrivals, 1);
});

test('empty data does not produce NaN', () => {
  const out = computeAnalytics({ tokens: [], queues, range: '30d', nowMs: NOW });
  assert.equal(out.kpis.avgWait, null);
  assert.equal(out.kpis.cancelRate, null);
  assert.equal(out.kpis.peakHour, null);
  assert.ok(out.trend.every((t) => t.queueLength === 0 && t.avgWait === null));
});
