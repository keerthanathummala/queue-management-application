import express from 'express';
import { db } from './db.js';
import { requireAuth } from './auth.js';
import { notFound, handle } from './errors.js';
import { computeAnalytics } from './analyticsCore.js';

export { computeAnalytics };

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
