import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db, save, newId, now } from './db.js';
import { badRequest, conflict, unauthorized, handle } from './errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt });
const sign = (u) => jwt.sign({ sub: u.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

export function createUser({ name, email, password }) {
  const cleanName = String(name ?? '').trim();
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  const pw = String(password ?? '');
  if (cleanName.length < 2 || cleanName.length > 60) throw badRequest('Name must be 2–60 characters');
  if (!EMAIL_RE.test(cleanEmail)) throw badRequest('Please enter a valid email address');
  if (pw.length < 6) throw badRequest('Password must be at least 6 characters');
  if (db.users.some((u) => u.email === cleanEmail)) throw conflict('An account with this email already exists');
  const user = {
    id: newId(),
    name: cleanName,
    email: cleanEmail,
    passwordHash: bcrypt.hashSync(pw, 10),
    createdAt: now(),
  };
  db.users.push(user);
  save();
  return user;
}

export function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.users.find((u) => u.id === payload.sub);
    if (!user) return next(unauthorized('Account no longer exists'));
    req.user = user;
    next();
  } catch {
    next(unauthorized('Session expired, please log in again'));
  }
}

export const authRouter = express.Router();

authRouter.post(
  '/register',
  handle((req, res) => {
    const user = createUser(req.body ?? {});
    res.status(201).json({ token: sign(user), user: publicUser(user) });
  }),
);

authRouter.post(
  '/login',
  handle((req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!email || !password) throw badRequest('Email and password are required');
    const user = db.users.find((u) => u.email === email);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      throw unauthorized('Incorrect email or password');
    }
    res.json({ token: sign(user), user: publicUser(user) });
  }),
);

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
