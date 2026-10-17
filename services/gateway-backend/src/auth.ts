import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedRequest } from './types.js';
import { getApiKeyByHash } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
const SALT_ROUNDS = 10;

// ── Password hashing ─────────────────────────────────────────────────

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

// ── JWT tokens ────────────────────────────────────────────────────────

export function generateJwt(userId: number, username: string, role: string): string {
  return jwt.sign({ userId, username, role }, JWT_SECRET, { expiresIn: '24h' });
}

export function verifyJwt(token: string): { userId: number; username: string; role: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    return null;
  }
}

// ── API key generation & hashing ──────────────────────────────────────

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `urumi_live_${uuidv4().replace(/-/g, '')}`;
  const hash = hashApiKey(raw);
  const prefix = raw.substring(0, 16);
  return { raw, hash, prefix };
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ── JWT auth middleware (for dashboard REST API) ──────────────────────

export function jwtAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyJwt(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.user = {
    id: payload.userId,
    username: payload.username,
    role: payload.role as 'admin' | 'member',
  };
  next();
}

// ── Admin-only middleware ─────────────────────────────────────────────

export function adminOnly(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// ── API key auth (for MCP endpoint and external clients) ─────────────

export function apiKeyAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing API key. Use: Authorization: Bearer <your-api-key>' });
    return;
  }

  const rawKey = authHeader.slice(7);

  // Check if it's a JWT (dashboard chat uses JWT)
  const jwtPayload = verifyJwt(rawKey);
  if (jwtPayload) {
    req.user = {
      id: jwtPayload.userId,
      username: jwtPayload.username,
      role: jwtPayload.role as 'admin' | 'member',
    };
    next();
    return;
  }

  // Otherwise treat as API key
  const keyHash = hashApiKey(rawKey);
  const keyRecord = getApiKeyByHash(keyHash);
  if (!keyRecord) {
    res.status(401).json({ error: 'Invalid or revoked API key' });
    return;
  }

  req.user = {
    id: keyRecord.user_id,
    username: keyRecord.username,
    role: keyRecord.role,
  };
  next();
}
