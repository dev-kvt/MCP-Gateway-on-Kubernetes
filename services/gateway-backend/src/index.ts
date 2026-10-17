import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { createRoutes } from './routes.js';
import { mountMcpEndpoint } from './mcp-endpoint.js';
import { upstreamManager } from './upstream-manager.js';
import { hashPassword, generateApiKey, hashApiKey } from './auth.js';
import * as db from './db.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_KEY = process.env.ADMIN_INITIAL_KEY || '';

// ── Ensure data directory exists ────────────────────────────────────
const dataDir = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ── Express setup ───────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Mount REST API routes
const routes = createRoutes();
app.use(routes);

// Mount MCP SSE endpoint
mountMcpEndpoint(app);

// Serve frontend static files if they exist
const frontendPath = path.join(process.cwd(), 'public');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// ── Seed default upstream servers ───────────────────────────────────
function seedDefaults(): void {
  const existing = db.listUpstreamServers();

  // Register WooCommerce MCP if not present
  if (!existing.find((s: any) => s.slug === 'woo')) {
    const wooUrl = process.env.WOOCOMMERCE_MCP_URL || 'http://woocommerce-mcp.mcp-system.svc.cluster.local:8000';
    db.createUpstreamServer('WooCommerce', 'woo', wooUrl, 'none', '', '');
    console.log(`[Seed] Registered WooCommerce MCP at ${wooUrl}`);
  }

  // Register Mock CRM MCP if not present
  if (!existing.find((s: any) => s.slug === 'crm')) {
    const crmUrl = process.env.MOCK_CRM_MCP_URL || 'http://mock-crm-mcp.mcp-system.svc.cluster.local:8001';
    db.createUpstreamServer('Customer CRM', 'crm', crmUrl, 'none', '', '');
    console.log(`[Seed] Registered Mock CRM MCP at ${crmUrl}`);
  }

  // Register Mock Inventory MCP if not present
  if (!existing.find((s: any) => s.slug === 'inventory')) {
    const invUrl = process.env.MOCK_INVENTORY_MCP_URL || 'http://mock-inventory-mcp.mcp-system.svc.cluster.local:8002';
    db.createUpstreamServer('Inventory & Warehouse', 'inventory', invUrl, 'none', '', '');
    console.log(`[Seed] Registered Mock Inventory MCP at ${invUrl}`);
  }

  // Seed admin user + initial API key if configured
  if (ADMIN_KEY) {
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const existingAdmin = db.getUserByUsername(adminUsername);
    if (!existingAdmin) {
      const passwordHash = hashPassword(adminPassword);
      const result = db.createUser(adminUsername, passwordHash, 'admin');
      const userId = result.lastInsertRowid as number;

      // Create the pre-configured API key
      const presetHash = hashApiKey(ADMIN_KEY);
      db.createApiKey(userId, presetHash, ADMIN_KEY.substring(0, 16), 'Initial admin key');
      console.log(`[Seed] Created admin user "${adminUsername}" with pre-configured API key`);
    }
  }
}

// ── Startup ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Initialize database
  db.getDb();
  console.log('[Gateway] Database initialized');

  // Seed defaults
  seedDefaults();

  // Initialize upstream connections
  await upstreamManager.initialize();

  // Start HTTP server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Gateway] Server listening on port ${PORT}`);
    console.log(`[Gateway] REST API: http://0.0.0.0:${PORT}/api`);
    console.log(`[Gateway] MCP SSE endpoint: http://0.0.0.0:${PORT}/mcp/sse`);
    console.log(`[Gateway] Health check: http://0.0.0.0:${PORT}/health`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Gateway] Shutting down...');
    await upstreamManager.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[Gateway] Fatal error:', err);
  process.exit(1);
});
