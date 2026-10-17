import { Router } from 'express';
import { AuthenticatedRequest } from './types.js';
import { jwtAuth, adminOnly, hashPassword, verifyPassword, generateJwt, generateApiKey } from './auth.js';
import { handleChatRequest } from './chat.js';
import { upstreamManager } from './upstream-manager.js';
import * as db from './db.js';

export function createRoutes(): Router {
  const router = Router();

  // ── Auth routes (public) ──────────────────────────────────────────

  router.post('/api/auth/register', async (req: AuthenticatedRequest, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: 'Username and password required' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters' });
        return;
      }

      const existing = db.getUserByUsername(username);
      if (existing) {
        res.status(409).json({ error: 'Username already taken' });
        return;
      }

      // First user is admin
      const userCount = db.getUserCount();
      const role = userCount === 0 ? 'admin' : 'member';

      const passwordHash = hashPassword(password);
      const result = db.createUser(username, passwordHash, role);
      const token = generateJwt(result.lastInsertRowid as number, username, role);

      res.status(201).json({
        token,
        user: { id: result.lastInsertRowid, username, role },
        message: userCount === 0 ? 'Admin account created (first user)' : 'Account created',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/auth/login', async (req: AuthenticatedRequest, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: 'Username and password required' });
        return;
      }

      const user = db.getUserByUsername(username);
      if (!user || !verifyPassword(password, user.password_hash)) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const token = generateJwt(user.id, user.username, user.role);
      res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── User info ─────────────────────────────────────────────────────

  router.get('/api/me', jwtAuth as any, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  // ── User management (admin only) ─────────────────────────────────

  router.get('/api/users', jwtAuth as any, adminOnly as any, (_req: AuthenticatedRequest, res) => {
    try {
      const users = db.listUsers();
      res.json({ users });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/users/invite', jwtAuth as any, adminOnly as any, (req: AuthenticatedRequest, res) => {
    try {
      const { username, password, role } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: 'Username and password required' });
        return;
      }

      const existing = db.getUserByUsername(username);
      if (existing) {
        res.status(409).json({ error: 'Username already taken' });
        return;
      }

      const userRole = role === 'admin' ? 'admin' : 'member';
      const passwordHash = hashPassword(password);
      const result = db.createUser(username, passwordHash, userRole);

      res.status(201).json({
        user: { id: result.lastInsertRowid, username, role: userRole },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/api/users/:id', jwtAuth as any, adminOnly as any, (req: AuthenticatedRequest, res) => {
    try {
      const userId = parseInt(req.params.id, 10);
      if (userId === req.user?.id) {
        res.status(400).json({ error: 'Cannot delete your own account' });
        return;
      }
      db.deleteUser(userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API key management ────────────────────────────────────────────

  router.get('/api/keys', jwtAuth as any, (req: AuthenticatedRequest, res) => {
    try {
      const keys = db.listApiKeysByUser(req.user!.id);
      res.json({ keys });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/keys', jwtAuth as any, (req: AuthenticatedRequest, res) => {
    try {
      const label = req.body.label || '';
      const { raw, hash, prefix } = generateApiKey();
      db.createApiKey(req.user!.id, hash, prefix, label);

      // Return raw key ONCE — it cannot be retrieved again
      res.status(201).json({
        key: raw,
        prefix,
        label,
        message: 'Save this key now — it cannot be shown again.',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/api/keys/:id', jwtAuth as any, (req: AuthenticatedRequest, res) => {
    try {
      const keyId = parseInt(req.params.id, 10);
      const isAdmin = req.user!.role === 'admin';
      db.revokeApiKey(keyId, req.user!.id, isAdmin);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Upstream server management ────────────────────────────────────

  router.get('/api/servers', jwtAuth as any, (req: AuthenticatedRequest, res) => {
    try {
      const servers = db.listUpstreamServers().map((s: any) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        url: s.url,
        auth_type: s.auth_type,
        auth_header_name: s.auth_header_name,
        // Never expose credentials to frontend
        has_credential: !!s.auth_credential,
        enabled: !!s.enabled,
        status: s.status,
        created_at: s.created_at,
      }));

      // Merge live connection statuses
      const statuses = upstreamManager.getStatuses();
      for (const server of servers) {
        const liveStatus = statuses.find((s) => s.slug === server.slug);
        if (liveStatus) {
          server.status = liveStatus.status;
        }
      }

      // Get tools for each server
      const allTools = upstreamManager.getAggregatedTools();
      const serversWithTools = servers.map((s: any) => ({
        ...s,
        tools: allTools.filter((t) => t.serverSlug === s.slug).map((t) => ({
          name: t.namespacedName,
          originalName: t.originalName,
          description: t.description,
        })),
      }));

      res.json({ servers: serversWithTools });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/servers', jwtAuth as any, adminOnly as any, async (req: AuthenticatedRequest, res) => {
    try {
      const { name, slug, url, auth_type, auth_header_name, auth_credential } = req.body;
      if (!name || !slug || !url) {
        res.status(400).json({ error: 'Name, slug, and URL are required' });
        return;
      }

      // Validate slug format
      if (!/^[a-z][a-z0-9_-]*$/.test(slug)) {
        res.status(400).json({ error: 'Slug must start with a letter and contain only lowercase letters, numbers, hyphens, and underscores' });
        return;
      }

      const existing = db.getUpstreamServerBySlug(slug);
      if (existing) {
        res.status(409).json({ error: 'A server with this slug already exists' });
        return;
      }

      db.createUpstreamServer(name, slug, url, auth_type || 'none', auth_header_name || '', auth_credential || '');

      // Connect to the new upstream
      const server = db.getUpstreamServerBySlug(slug);
      if (server) {
        await upstreamManager.connectUpstream(server);
      }

      res.status(201).json({ success: true, server: { ...server, auth_credential: undefined } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/servers/:id', jwtAuth as any, adminOnly as any, async (req: AuthenticatedRequest, res) => {
    try {
      const serverId = parseInt(req.params.id, 10);
      const existing = db.getUpstreamServer(serverId);
      if (!existing) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }

      const {
        name = existing.name,
        url = existing.url,
        auth_type = existing.auth_type,
        auth_header_name = existing.auth_header_name,
        auth_credential,
      } = req.body;

      // If auth_credential is not provided, keep existing
      const credential = auth_credential !== undefined ? auth_credential : existing.auth_credential;

      db.updateUpstreamServer(serverId, name, url, auth_type, auth_header_name, credential);

      // Reconnect
      await upstreamManager.reloadUpstream(existing.slug);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/api/servers/:id/toggle', jwtAuth as any, adminOnly as any, async (req: AuthenticatedRequest, res) => {
    try {
      const serverId = parseInt(req.params.id, 10);
      const existing = db.getUpstreamServer(serverId);
      if (!existing) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }

      const newEnabled = !existing.enabled;
      db.toggleUpstreamServer(serverId, newEnabled);

      if (newEnabled) {
        const updated = db.getUpstreamServer(serverId);
        await upstreamManager.connectUpstream(updated);
      } else {
        await upstreamManager.disconnectUpstream(existing.slug);
      }

      res.json({ success: true, enabled: newEnabled });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/api/servers/:id', jwtAuth as any, adminOnly as any, async (req: AuthenticatedRequest, res) => {
    try {
      const serverId = parseInt(req.params.id, 10);
      const existing = db.getUpstreamServer(serverId);
      if (!existing) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }

      await upstreamManager.disconnectUpstream(existing.slug);
      db.deleteUpstreamServer(serverId);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Audit log ─────────────────────────────────────────────────────

  router.get('/api/audit', jwtAuth as any, (req: AuthenticatedRequest, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const offset = parseInt(req.query.offset as string) || 0;
      const entries = db.listAuditLog(limit, offset);
      const total = db.countAuditLog();
      res.json({ entries, total, limit, offset });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Chat agent ────────────────────────────────────────────────────

  router.post('/api/chat', jwtAuth as any, async (req: AuthenticatedRequest, res) => {
    try {
      const { message, history } = req.body;
      if (!message) {
        res.status(400).json({ error: 'Message is required' });
        return;
      }

      const result = await handleChatRequest(
        message,
        history || [],
        { id: req.user!.id, username: req.user!.username, role: req.user!.role }
      );

      res.json(result);
    } catch (err: any) {
      console.error('[Chat] Error:', err);
      res.status(500).json({ error: `Chat error: ${err.message}` });
    }
  });

  // ── Health check ──────────────────────────────────────────────────

  router.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      service: 'mcp-gateway',
      timestamp: new Date().toISOString(),
      upstreams: upstreamManager.getStatuses(),
    });
  });

  return router;
}
