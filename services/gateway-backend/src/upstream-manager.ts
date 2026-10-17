import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { NamespacedTool } from './types.js';
import * as db from './db.js';

const UPSTREAM_TIMEOUT_MS = parseInt(process.env.UPSTREAM_TIMEOUT_MS || '8000', 10);
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '30000', 10);

interface UpstreamConnection {
  serverId: number;
  slug: string;
  name: string;
  url: string;
  client: Client | null;
  transport: SSEClientTransport | null;
  tools: NamespacedTool[];
  status: 'connected' | 'unreachable' | 'disabled' | 'connecting';
  lastChecked: number;
}

class UpstreamManager {
  private connections = new Map<string, UpstreamConnection>();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  // ── Initialization ────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const servers = db.listEnabledUpstreamServers();
    console.log(`[UpstreamManager] Initializing with ${servers.length} enabled upstream servers`);

    for (const server of servers) {
      await this.connectUpstream(server);
    }

    // Start periodic health checks
    this.healthCheckTimer = setInterval(() => this.healthCheckAll(), HEALTH_CHECK_INTERVAL_MS);
    console.log(`[UpstreamManager] Health check interval: ${HEALTH_CHECK_INTERVAL_MS}ms`);
  }

  // ── Connect to a single upstream ──────────────────────────────────

  async connectUpstream(server: any): Promise<void> {
    const conn: UpstreamConnection = {
      serverId: server.id,
      slug: server.slug,
      name: server.name,
      url: server.url,
      client: null,
      transport: null,
      tools: [],
      status: 'connecting',
      lastChecked: Date.now(),
    };

    this.connections.set(server.slug, conn);

    try {
      const sseUrl = new URL('/sse', server.url);
      const headers: Record<string, string> = {};

      if (server.auth_type === 'bearer' && server.auth_credential) {
        headers['Authorization'] = `Bearer ${server.auth_credential}`;
      } else if (server.auth_type === 'header' && server.auth_header_name && server.auth_credential) {
        headers[server.auth_header_name] = server.auth_credential;
      }

      const transport = new SSEClientTransport(sseUrl, {
        requestInit: { headers },
      });

      const client = new Client({ name: 'mcp-gateway', version: '1.0.0' });

      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), UPSTREAM_TIMEOUT_MS)),
      ]);

      conn.client = client;
      conn.transport = transport;
      conn.status = 'connected';
      conn.lastChecked = Date.now();

      // Fetch initial tool list
      await this.refreshToolsForUpstream(server.slug);

      db.updateUpstreamStatus(server.id, 'connected');
      console.log(`[UpstreamManager] Connected to ${server.slug} (${server.url}), ${conn.tools.length} tools`);
    } catch (err: any) {
      conn.status = 'unreachable';
      conn.lastChecked = Date.now();
      db.updateUpstreamStatus(server.id, 'unreachable');
      console.error(`[UpstreamManager] Failed to connect to ${server.slug}: ${err.message}`);
    }
  }

  // ── Disconnect from an upstream ───────────────────────────────────

  async disconnectUpstream(slug: string): Promise<void> {
    const conn = this.connections.get(slug);
    if (!conn) return;

    try {
      if (conn.transport) {
        await conn.transport.close();
      }
    } catch {
      // Ignore close errors
    }

    this.connections.delete(slug);
    console.log(`[UpstreamManager] Disconnected from ${slug}`);
  }

  // ── Refresh tools for a single upstream ───────────────────────────

  async refreshToolsForUpstream(slug: string): Promise<void> {
    const conn = this.connections.get(slug);
    if (!conn?.client || conn.status !== 'connected') return;

    try {
      const result = await Promise.race([
        conn.client.listTools(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Tool listing timeout')), UPSTREAM_TIMEOUT_MS)),
      ]);

      conn.tools = (result.tools || []).map((tool: any) => ({
        serverSlug: slug,
        originalName: tool.name,
        namespacedName: `${slug}__${tool.name}`,
        description: `[${conn.name}] ${tool.description || ''}`,
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
      }));
      conn.lastChecked = Date.now();
    } catch (err: any) {
      console.error(`[UpstreamManager] Failed to refresh tools for ${slug}: ${err.message}`);
      conn.status = 'unreachable';
      db.updateUpstreamStatus(conn.serverId, 'unreachable');
    }
  }

  // ── Get aggregated tool list from all connected upstreams ─────────

  getAggregatedTools(): NamespacedTool[] {
    const tools: NamespacedTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected') {
        tools.push(...conn.tools);
      }
    }
    return tools;
  }

  // ── Call a namespaced tool ────────────────────────────────────────

  async callTool(namespacedName: string, args: any): Promise<{ result: any; serverSlug: string; originalName: string }> {
    const parts = namespacedName.split('__');
    if (parts.length < 2) {
      throw new Error(`Invalid tool name format: "${namespacedName}". Expected "serverSlug__toolName".`);
    }

    const serverSlug = parts[0];
    const originalName = parts.slice(1).join('__');

    const conn = this.connections.get(serverSlug);
    if (!conn) {
      throw new Error(`Unknown upstream server: "${serverSlug}"`);
    }
    if (conn.status !== 'connected' || !conn.client) {
      throw new Error(`Upstream server "${serverSlug}" is ${conn.status}. Cannot call tools.`);
    }

    const result = await Promise.race([
      conn.client.callTool({ name: originalName, arguments: args }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Tool call timed out after ${UPSTREAM_TIMEOUT_MS}ms`)), UPSTREAM_TIMEOUT_MS)),
    ]);

    return { result, serverSlug, originalName };
  }

  // ── Health check all upstreams ────────────────────────────────────

  async healthCheckAll(): Promise<void> {
    const servers = db.listUpstreamServers();

    for (const server of servers) {
      if (!server.enabled) {
        const conn = this.connections.get(server.slug);
        if (conn) {
          await this.disconnectUpstream(server.slug);
        }
        continue;
      }

      const conn = this.connections.get(server.slug);

      if (!conn || conn.status === 'unreachable') {
        // Attempt reconnection
        await this.connectUpstream(server);
      } else if (conn.status === 'connected') {
        // Verify still alive by refreshing tools
        await this.refreshToolsForUpstream(server.slug);
      }
    }
  }

  // ── Get status of all upstreams ───────────────────────────────────

  getStatuses(): Array<{ slug: string; name: string; status: string; toolCount: number; lastChecked: number }> {
    const statuses: Array<{ slug: string; name: string; status: string; toolCount: number; lastChecked: number }> = [];
    const servers = db.listUpstreamServers();

    for (const server of servers) {
      const conn = this.connections.get(server.slug);
      statuses.push({
        slug: server.slug,
        name: server.name,
        status: !server.enabled ? 'disabled' : (conn?.status || 'unknown'),
        toolCount: conn?.tools.length || 0,
        lastChecked: conn?.lastChecked || 0,
      });
    }

    return statuses;
  }

  // ── Reload a specific upstream (after edit) ───────────────────────

  async reloadUpstream(slug: string): Promise<void> {
    await this.disconnectUpstream(slug);
    const server = db.getUpstreamServerBySlug(slug);
    if (server && server.enabled) {
      await this.connectUpstream(server);
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    for (const slug of this.connections.keys()) {
      await this.disconnectUpstream(slug);
    }
  }
}

export const upstreamManager = new UpstreamManager();
