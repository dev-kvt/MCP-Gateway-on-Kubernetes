import express, { Router } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { apiKeyAuth, hashApiKey } from './auth.js';
import { getApiKeyByHash, writeAuditLog } from './db.js';
import { upstreamManager } from './upstream-manager.js';
import { AuthenticatedRequest } from './types.js';

// Active MCP transport sessions keyed by sessionId
const transports = new Map<string, SSEServerTransport>();

// Store user info per session for audit logging
const sessionUsers = new Map<string, { id: number; username: string; role: string }>();

function resolveUserFromRequest(req: express.Request): { id: number; username: string; role: string } | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const rawKey = authHeader.slice(7);

  // Try JWT first
  const jwt = require('jsonwebtoken');
  try {
    const payload = jwt.verify(rawKey, process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production');
    if (payload && payload.userId) {
      return { id: payload.userId, username: payload.username, role: payload.role };
    }
  } catch {}

  // Try API key
  const keyHash = hashApiKey(rawKey);
  const keyRecord = getApiKeyByHash(keyHash);
  if (keyRecord) {
    return { id: keyRecord.user_id, username: keyRecord.username, role: keyRecord.role };
  }

  return null;
}

function createGatewayMcpServer(userInfo: { id: number; username: string; role: string }): Server {
  const server = new Server(
    { name: 'mcp-gateway', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Handle tools/list
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const aggregatedTools = upstreamManager.getAggregatedTools();
    return {
      tools: aggregatedTools.map((t) => ({
        name: t.namespacedName,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  // Handle tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = request.params.arguments || {};
    const start = Date.now();

    try {
      const { result, serverSlug, originalName } = await upstreamManager.callTool(toolName, args);
      const durationMs = Date.now() - start;

      // Audit log
      writeAuditLog(userInfo.id, userInfo.username, serverSlug, originalName, durationMs, true, '');

      return result;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const parts = toolName.split('__');
      const serverSlug = parts[0] || 'unknown';
      const originalName = parts.slice(1).join('__') || toolName;

      writeAuditLog(userInfo.id, userInfo.username, serverSlug, originalName, durationMs, false, err.message);

      return {
        isError: true,
        content: [{ type: 'text', text: `Tool call failed: ${err.message}` }],
      };
    }
  });

  return server;
}

export function mountMcpEndpoint(router: Router): void {
  // SSE endpoint — downstream clients connect here
  router.get('/mcp/sse', (req, res) => {
    const userInfo = resolveUserFromRequest(req);
    if (!userInfo) {
      res.status(401).json({ error: 'Authentication required. Use: Authorization: Bearer <api-key>' });
      return;
    }

    console.log(`[MCP Endpoint] New SSE connection from user "${userInfo.username}"`);

    const server = createGatewayMcpServer(userInfo);
    const transport = new SSEServerTransport('/mcp/messages', res);

    transports.set(transport.sessionId, transport);
    sessionUsers.set(transport.sessionId, userInfo);

    transport.onclose = () => {
      console.log(`[MCP Endpoint] SSE closed: ${transport.sessionId}`);
      transports.delete(transport.sessionId);
      sessionUsers.delete(transport.sessionId);
    };

    server.connect(transport).catch((err) => {
      console.error(`[MCP Endpoint] Connection error: ${err.message}`);
    });
  });

  // POST messages endpoint
  router.post('/mcp/messages', express.json(), async (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).send('Missing sessionId query parameter');
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).send('Session not found or expired');
      return;
    }

    await transport.handlePostMessage(req, res, req.body);
  });
}
