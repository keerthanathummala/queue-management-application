import express from 'express';
import { db, save, newId } from './db.js';
import { requireAuth } from './auth.js';
import { handle } from './errors.js';
import * as core from './queueCore.js';

export { STATUS } from './status.js';

core.setIdFactory(newId);

/** Wrap a core function as a route; mutations are flushed to disk. */
const route = (fn, { mutates = true, status = 200 } = {}) =>
  handle((req, res) => {
    const result = fn(req);
    if (mutates) save();
    if (result === null) return res.status(204).end();
    res.status(status).json(result);
  });

export const queueRouter = express.Router();
queueRouter.use(requireAuth);

queueRouter.get('/queues', route((req) => core.listQueues(db, req.user.id), { mutates: false }));
queueRouter.post('/queues', route((req) => core.createQueue(db, req.user.id, req.body), { status: 201 }));
queueRouter.get('/queues/:id', route((req) => core.getQueue(db, req.user.id, req.params.id), { mutates: false }));
queueRouter.patch('/queues/:id', route((req) => core.updateQueue(db, req.user.id, req.params.id, req.body)));
queueRouter.delete('/queues/:id', route((req) => core.deleteQueue(db, req.user.id, req.params.id)));

queueRouter.post(
  '/queues/:id/tokens',
  route((req) => core.addToken(db, req.user.id, req.params.id, req.body), { status: 201 }),
);
queueRouter.post('/queues/:id/serve-next', route((req) => core.serveNext(db, req.user.id, req.params.id)));
queueRouter.post(
  '/tokens/:tokenId/move',
  route((req) => core.moveToken(db, req.user.id, req.params.tokenId, req.body?.direction)),
);
queueRouter.post('/tokens/:tokenId/complete', route((req) => core.completeToken(db, req.user.id, req.params.tokenId)));
queueRouter.post(
  '/tokens/:tokenId/cancel',
  route((req) => core.cancelToken(db, req.user.id, req.params.tokenId, req.body?.reason)),
);
