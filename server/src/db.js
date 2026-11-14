import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Tiny JSON-file persistence layer. The whole dataset is kept in memory and
 * flushed to disk atomically (write temp file + rename) after every mutation,
 * so there are no native dependencies and the app runs anywhere Node runs.
 */
const empty = () => ({ users: [], queues: [], tokens: [] });

let state = empty();
let file = config.dataFile;

export function load(customFile) {
  if (customFile) file = customFile;
  if (file === ':memory:') {
    state = empty();
    return;
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    state = { ...empty(), ...JSON.parse(raw) };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not read data file, starting fresh:', err.message);
    state = empty();
  }
}

export function save() {
  if (file === ':memory:') return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

export function reset() {
  state = empty();
  save();
}

export const db = {
  get users() {
    return state.users;
  },
  get queues() {
    return state.queues;
  },
  get tokens() {
    return state.tokens;
  },
};

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
