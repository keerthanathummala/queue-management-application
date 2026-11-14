import express from 'express';
import { db } from './db.js';
import { requireAuth } from './auth.js';
import { badRequest, notFound, handle } from './errors.js';
import { STATUS } from './queues.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const RANGES = {
  '24h': { span: DAY, bucket: HOUR },
  '7d': { span: 7 * DAY, bucket: DAY },
  '30d': { span: 30 * DAY, bucket: DAY },
};
const WAIT_BINS = [
  { label: '< 5 min', max: 5 },
  { label: '5–10', max: 10 },
  { label: '10–15', max: 15 },
  { label: '15–30', max: 30 },
  { label: '30–60', max: 60 },
  { label: '60+ min', max: Infinity },
];

const ms = (iso) => (iso ? Date.parse(iso) : null);
const round1 = (n) => (n === null || Number.isNaN(n) ? null : Math.round(n * 10) / 10);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function percentile(xs, p) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Minutes a token spent waiting before it was called (null if it never was). */
const waitMinutes = (t) => (t.calledAt ? (ms(t.calledAt) - ms(t.createdAt)) / 60000 : null);
const serviceMinutes = (t) => (t.calledAt && t.completedAt ? (ms(t.completedAt) - ms(t.calledAt)) / 60000 : null);
/** When the token stopped occupying a place in the waiting line. */
const leftLineAt = (t) => ms(t.calledAt) ?? (t.cancelledFrom === STATUS.WAITING ? ms(t.cancelledAt) : null);
const inLineAt = (t, at) => ms(t.createdAt) <= at && (leftLineAt(t) ?? Infinity) > at;

/**
 * Build analytics for a set of tokens.
 * @param tokens   tokens to analyse (already scoped to the manager / queue)
 * @param queues   queues those tokens belong to
 * @param range    '24h' | '7d' | '30d'
 * @param tzOffset client's Date#getTimezoneOffset() in minutes, so day/hour buckets match the viewer's clock
 * @param nowMs    injectable clock for tests
 */
export function computeAnalytics({ tokens, queues, range = '7d', tzOffset = 0, nowMs = Date.now() }) {
  const cfg = RANGES[range];
  if (!cfg) throw badRequest('range must be one of 24h, 7d, 30d');
  const shift = -tzOffset * 60000; // local = utc + shift

  // Align bucket edges to local hour / local midnight.
  const alignedNow = Math.floor((nowMs + shift) / cfg.bucket) * cfg.bucket - shift;
  const bucketCount = Math.round(cfg.span / cfg.bucket);
  const firstStart = alignedNow - (bucketCount - 1) * cfg.bucket;
  const from = firstStart;

  const inRange = tokens.filter((t) => ms(t.createdAt) >= from && ms(t.createdAt) <= nowMs);
  const called = tokens.filter((t) => t.calledAt && ms(t.calledAt) >= from && ms(t.calledAt) <= nowMs);
  const waits = called.map(waitMinutes);
  const services = tokens
    .filter((t) => t.completedAt && ms(t.completedAt) >= from)
    .map(serviceMinutes)
    .filter((x) => x !== null);
  const served = tokens.filter((t) => t.status === STATUS.SERVED && ms(t.completedAt) >= from);
  const cancelled = tokens.filter((t) => t.status === STATUS.CANCELLED && ms(t.cancelledAt) >= from);
  const waitingNow = tokens.filter((t) => t.status === STATUS.WAITING);
  const servingNow = tokens.filter((t) => t.status === STATUS.SERVING);

  const trend = [];
  for (let i = 0; i < bucketCount; i++) {
    const start = firstStart + i * cfg.bucket;
    const end = Math.min(start + cfg.bucket, nowMs);
    const within = (iso) => iso && ms(iso) >= start && ms(iso) < start + cfg.bucket;
    const bucketWaits = tokens.filter((t) => within(t.calledAt)).map(waitMinutes);
    // Sample queue length across the part of the bucket where the queue was active (first arrival
    // to last departure), so overnight hours don't dilute the daily average.
    const touched = tokens.filter((t) => ms(t.createdAt) < start + cfg.bucket && (leftLineAt(t) ?? Infinity) >= start);
    const activeFrom = Math.max(start, Math.min(...touched.map((t) => ms(t.createdAt)), end));
    const activeTo = Math.min(end, Math.max(...touched.map((t) => leftLineAt(t) ?? nowMs), activeFrom));
    const samples = [];
    const steps = cfg.bucket === HOUR ? 12 : 48;
    for (let s = 0; s <= steps; s++) {
      const at = activeFrom + ((activeTo - activeFrom) * s) / steps;
      samples.push(tokens.filter((t) => inLineAt(t, at)).length);
    }
    const lengthAtEnd = tokens.filter((t) => inLineAt(t, end)).length;
    trend.push({
      start: new Date(start).toISOString(),
      arrivals: tokens.filter((t) => within(t.createdAt)).length,
      served: tokens.filter((t) => t.status === STATUS.SERVED && within(t.completedAt)).length,
      cancelled: tokens.filter((t) => t.status === STATUS.CANCELLED && within(t.cancelledAt)).length,
      avgWait: round1(mean(bucketWaits)),
      queueLength: lengthAtEnd,
      avgQueueLength: round1(mean(samples)),
      peakQueueLength: Math.max(...samples),
    });
  }

  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, arrivals: 0, waits: [] }));
  for (const t of inRange) {
    const hour = new Date(ms(t.createdAt) + shift).getUTCHours();
    byHour[hour].arrivals++;
    const w = waitMinutes(t);
    if (w !== null) byHour[hour].waits.push(w);
  }

  const distribution = WAIT_BINS.map((b) => ({ label: b.label, count: 0 }));
  for (const w of waits) distribution[WAIT_BINS.findIndex((b) => w < b.max)].count++;

  const perQueue = queues.map((q) => {
    const qt = tokens.filter((t) => t.queueId === q.id);
    const qWaits = qt.filter((t) => t.calledAt && ms(t.calledAt) >= from).map(waitMinutes);
    return {
      id: q.id,
      name: q.name,
      waiting: qt.filter((t) => t.status === STATUS.WAITING).length,
      serving: qt.filter((t) => t.status === STATUS.SERVING).length,
      served: qt.filter((t) => t.status === STATUS.SERVED && ms(t.completedAt) >= from).length,
      cancelled: qt.filter((t) => t.status === STATUS.CANCELLED && ms(t.cancelledAt) >= from).length,
      avgWait: round1(mean(qWaits)),
    };
  });

  const closed = served.length + cancelled.length;
  const peakHour = byHour.reduce((best, h) => (h.arrivals > best.arrivals ? h : best), byHour[0]);

  return {
    range,
    from: new Date(from).toISOString(),
    to: new Date(nowMs).toISOString(),
    bucket: cfg.bucket === HOUR ? 'hour' : 'day',
    kpis: {
      totalTokens: inRange.length,
      served: served.length,
      cancelled: cancelled.length,
      cancelRate: closed ? round1((cancelled.length / closed) * 100) : null,
      avgWait: round1(mean(waits)),
      medianWait: round1(percentile(waits, 0.5)),
      p90Wait: round1(percentile(waits, 0.9)),
      maxWait: round1(waits.length ? Math.max(...waits) : null),
      avgService: round1(mean(services)),
      waitingNow: waitingNow.length,
      servingNow: servingNow.length,
      longestCurrentWait: round1(
        waitingNow.length ? Math.max(...waitingNow.map((t) => (nowMs - ms(t.createdAt)) / 60000)) : null,
      ),
      peakHour: peakHour.arrivals ? peakHour.hour : null,
    },
    trend,
    byHour: byHour.map((h) => ({ hour: h.hour, arrivals: h.arrivals, avgWait: round1(mean(h.waits)) })),
    waitDistribution: distribution,
    perQueue,
  };
}

export const analyticsRouter = express.Router();
analyticsRouter.use(requireAuth);

analyticsRouter.get(
  '/',
  handle((req, res) => {
    let queues = db.queues.filter((q) => q.ownerId === req.user.id);
    if (req.query.queueId) {
      queues = queues.filter((q) => q.id === req.query.queueId);
      if (!queues.length) throw notFound('Queue not found');
    }
    const ids = new Set(queues.map((q) => q.id));
    const tz = Number(req.query.tzOffset);
    res.json(
      computeAnalytics({
        tokens: db.tokens.filter((t) => ids.has(t.queueId)),
        queues,
        range: req.query.range || '7d',
        tzOffset: Number.isFinite(tz) && Math.abs(tz) <= 840 ? tz : 0,
      }),
    );
  }),
);
