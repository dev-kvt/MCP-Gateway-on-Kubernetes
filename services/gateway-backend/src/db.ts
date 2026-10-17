import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'gateway.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema(): void {
  const d = db;

  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      label TEXT DEFAULT '',
      revoked INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS upstream_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      auth_type TEXT DEFAULT 'none' CHECK(auth_type IN ('none', 'bearer', 'header')),
      auth_header_name TEXT DEFAULT '',
      auth_credential TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      status TEXT DEFAULT 'unknown',
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      server_slug TEXT,
      tool_name TEXT,
      duration_ms INTEGER DEFAULT 0,
      success INTEGER DEFAULT 1,
      error_message TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
  `);
}

// ── User operations ───────────────────────────────────────────────────

export function createUser(username: string, passwordHash: string, role: 'admin' | 'member') {
  const stmt = getDb().prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  return stmt.run(username, passwordHash, role);
}

export function getUserByUsername(username: string) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
}

export function getUserById(id: number) {
  return getDb().prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id) as any;
}

export function listUsers() {
  return getDb().prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC').all() as any[];
}

export function deleteUser(id: number) {
  return getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function getUserCount() {
  return (getDb().prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
}

// ── API key operations ────────────────────────────────────────────────

export function createApiKey(userId: number, keyHash: string, keyPrefix: string, label: string) {
  const stmt = getDb().prepare('INSERT INTO api_keys (user_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?)');
  return stmt.run(userId, keyHash, keyPrefix, label);
}

export function getApiKeyByHash(keyHash: string) {
  return getDb().prepare(`
    SELECT ak.*, u.username, u.role
    FROM api_keys ak
    JOIN users u ON u.id = ak.user_id
    WHERE ak.key_hash = ? AND ak.revoked = 0
  `).get(keyHash) as any;
}

export function listApiKeysByUser(userId: number) {
  return getDb().prepare('SELECT id, key_prefix, label, revoked, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[];
}

export function revokeApiKey(keyId: number, userId: number, isAdmin: boolean) {
  if (isAdmin) {
    return getDb().prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').run(keyId);
  }
  return getDb().prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?').run(keyId, userId);
}

// ── Upstream server operations ────────────────────────────────────────

export function createUpstreamServer(name: string, slug: string, url: string, authType: string, authHeaderName: string, authCredential: string) {
  const stmt = getDb().prepare('INSERT INTO upstream_servers (name, slug, url, auth_type, auth_header_name, auth_credential) VALUES (?, ?, ?, ?, ?, ?)');
  return stmt.run(name, slug, url, authType, authHeaderName, authCredential);
}

export function getUpstreamServer(id: number) {
  return getDb().prepare('SELECT * FROM upstream_servers WHERE id = ?').get(id) as any;
}

export function getUpstreamServerBySlug(slug: string) {
  return getDb().prepare('SELECT * FROM upstream_servers WHERE slug = ?').get(slug) as any;
}

export function listUpstreamServers() {
  return getDb().prepare('SELECT * FROM upstream_servers ORDER BY created_at ASC').all() as any[];
}

export function listEnabledUpstreamServers() {
  return getDb().prepare('SELECT * FROM upstream_servers WHERE enabled = 1 ORDER BY created_at ASC').all() as any[];
}

export function updateUpstreamServer(id: number, name: string, url: string, authType: string, authHeaderName: string, authCredential: string) {
  const stmt = getDb().prepare('UPDATE upstream_servers SET name = ?, url = ?, auth_type = ?, auth_header_name = ?, auth_credential = ? WHERE id = ?');
  return stmt.run(name, url, authType, authHeaderName, authCredential, id);
}

export function toggleUpstreamServer(id: number, enabled: boolean) {
  return getDb().prepare('UPDATE upstream_servers SET enabled = ?, status = ? WHERE id = ?').run(enabled ? 1 : 0, enabled ? 'unknown' : 'disabled', id);
}

export function updateUpstreamStatus(id: number, status: string) {
  return getDb().prepare('UPDATE upstream_servers SET status = ? WHERE id = ?').run(status, id);
}

export function deleteUpstreamServer(id: number) {
  return getDb().prepare('DELETE FROM upstream_servers WHERE id = ?').run(id);
}

// ── Audit log operations ──────────────────────────────────────────────

export function writeAuditLog(userId: number, username: string, serverSlug: string, toolName: string, durationMs: number, success: boolean, errorMessage: string) {
  const stmt = getDb().prepare('INSERT INTO audit_log (user_id, username, server_slug, tool_name, duration_ms, success, error_message) VALUES (?, ?, ?, ?, ?, ?, ?)');
  return stmt.run(userId, username, serverSlug, toolName, durationMs, success ? 1 : 0, errorMessage);
}

export function listAuditLog(limit: number = 100, offset: number = 0) {
  return getDb().prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as any[];
}

export function countAuditLog() {
  return (getDb().prepare('SELECT COUNT(*) as count FROM audit_log').get() as any).count;
}
