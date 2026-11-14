import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { authRouter } from './auth.js';
import { queueRouter } from './queues.js';
import { errorMiddleware } from './errors.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api', queueRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));

  // Serve the built React client in production.
  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist));
    app.get('*', (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }

  app.use(errorMiddleware);
  return app;
}
