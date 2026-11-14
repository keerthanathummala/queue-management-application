import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: '7d',
  dataFile: process.env.DATA_FILE || path.join(here, '..', 'data', 'db.json'),
  clientDist: path.join(here, '..', '..', 'client', 'dist'),
};
