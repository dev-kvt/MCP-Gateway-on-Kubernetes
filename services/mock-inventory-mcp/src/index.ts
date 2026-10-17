import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const PORT = parseInt(process.env.PORT || '8002', 10);

// ── In-memory warehouse data ──────────────────────────────────────────
interface WarehouseItem {
  sku: string;
  name: string;
  quantity: number;
  location: string;
  reorderPoint: number;
  lastRestocked: string;
}

const warehouse: WarehouseItem[] = [
  { sku: 'HOODIE-BLK-M', name: 'Developer Hoodie (Black, M)', quantity: 42, location: 'A-12', reorderPoint: 10, lastRestocked: '2025-01-10' },
  { sku: 'HOODIE-BLK-L', name: 'Developer Hoodie (Black, L)', quantity: 38, location: 'A-13', reorderPoint: 10, lastRestocked: '2025-01-10' },
  { sku: 'HOODIE-GRY-M', name: 'Developer Hoodie (Grey, M)', quantity: 15, location: 'A-14', reorderPoint: 10, lastRestocked: '2025-01-05' },
  { sku: 'TSHIRT-WHT-S', name: 'Code T-Shirt (White, S)', quantity: 100, location: 'B-01', reorderPoint: 20, lastRestocked: '2025-01-12' },
  { sku: 'TSHIRT-WHT-M', name: 'Code T-Shirt (White, M)', quantity: 85, location: 'B-02', reorderPoint: 20, lastRestocked: '2025-01-12' },
  { sku: 'MUG-COFFEE', name: 'Coffee Mug "Works on My Machine"', quantity: 75, location: 'C-05', reorderPoint: 15, lastRestocked: '2025-01-08' },
  { sku: 'STICKER-PACK', name: 'Developer Sticker Pack (10pc)', quantity: 200, location: 'D-01', reorderPoint: 50, lastRestocked: '2025-01-15' },
  { sku: 'LAPTOP-STAND', name: 'Ergonomic Laptop Stand', quantity: 8, location: 'E-03', reorderPoint: 5, lastRestocked: '2024-12-20' },
];

const shippingZones: Record<string, { days: number; cost: number; label: string }> = {
  domestic: { days: 3, cost: 5.99, label: 'Standard Domestic' },
  express: { days: 1, cost: 14.99, label: 'Express (Next Day)' },
  international: { days: 10, cost: 24.99, label: 'International Standard' },
  'international-express': { days: 4, cost: 49.99, label: 'International Express' },
};

// ── MCP Server factory ────────────────────────────────────────────────
const app = express();
app.use(cors());

const transports = new Map<string, SSEServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'mock-inventory-mcp',
    version: '1.0.0',
  });

  server.tool(
    'check_stock',
    'Check the current stock level for a product by its SKU code.',
    {
      sku: z.string().describe('The product SKU code (e.g. "HOODIE-BLK-M")'),
    },
    async (args) => {
      const item = warehouse.find((w) => w.sku.toLowerCase() === args.sku.toLowerCase());
      if (!item) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ found: false, message: `No item found with SKU "${args.sku}". Use list_warehouse_items to see available SKUs.` }, null, 2) }],
        };
      }
      const needsReorder = item.quantity <= item.reorderPoint;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            found: true,
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            location: item.location,
            reorderPoint: item.reorderPoint,
            needsReorder,
            lastRestocked: item.lastRestocked,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'list_warehouse_items',
    'List all items currently tracked in the warehouse inventory system.',
    {
      low_stock_only: z.boolean().optional().describe('If true, only return items at or below reorder point'),
    },
    async (args) => {
      let items = warehouse;
      if (args.low_stock_only) {
        items = warehouse.filter((w) => w.quantity <= w.reorderPoint);
      }
      const summary = items.map((w) => ({
        sku: w.sku,
        name: w.name,
        quantity: w.quantity,
        location: w.location,
        needsReorder: w.quantity <= w.reorderPoint,
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify({ total: summary.length, items: summary }, null, 2) }],
      };
    }
  );

  server.tool(
    'update_stock',
    'Update the stock quantity for a warehouse item. Use positive delta to add stock, negative to remove.',
    {
      sku: z.string().describe('The product SKU code'),
      delta: z.number().int().describe('Quantity change: positive to add, negative to remove'),
      reason: z.string().optional().describe('Reason for stock adjustment'),
    },
    async (args) => {
      const item = warehouse.find((w) => w.sku.toLowerCase() === args.sku.toLowerCase());
      if (!item) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Item with SKU "${args.sku}" not found in warehouse.` }],
        };
      }
      const previousQty = item.quantity;
      item.quantity = Math.max(0, item.quantity + args.delta);
      if (args.delta > 0) {
        item.lastRestocked = new Date().toISOString().split('T')[0];
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            sku: item.sku,
            previousQuantity: previousQty,
            newQuantity: item.quantity,
            delta: args.delta,
            reason: args.reason || 'Manual adjustment',
            needsReorder: item.quantity <= item.reorderPoint,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'get_shipping_estimate',
    'Get estimated shipping time and cost for a destination zone.',
    {
      zone: z.enum(['domestic', 'express', 'international', 'international-express']).describe('Shipping zone'),
      weight_kg: z.number().positive().optional().describe('Package weight in kg (affects cost for heavy items)'),
    },
    async (args) => {
      const zoneInfo = shippingZones[args.zone];
      let adjustedCost = zoneInfo.cost;
      if (args.weight_kg && args.weight_kg > 2) {
        adjustedCost += (args.weight_kg - 2) * 3.50; // $3.50 per kg over 2kg
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            zone: args.zone,
            label: zoneInfo.label,
            estimatedDays: zoneInfo.days,
            baseCost: zoneInfo.cost,
            totalCost: Math.round(adjustedCost * 100) / 100,
            weightSurcharge: args.weight_kg && args.weight_kg > 2 ? Math.round((adjustedCost - zoneInfo.cost) * 100) / 100 : 0,
          }, null, 2),
        }],
      };
    }
  );

  return server;
}

// ── Health check ──────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'mock-inventory-mcp', timestamp: new Date().toISOString() });
});

// ── SSE endpoint ──────────────────────────────────────────────────────
app.get('/sse', async (_req, res) => {
  console.log('[mock-inventory-mcp] New SSE connection');
  const server = createMcpServer();
  const transport = new SSEServerTransport('/messages', res);

  transports.set(transport.sessionId, transport);
  transport.onclose = () => {
    console.log(`[mock-inventory-mcp] SSE connection closed: ${transport.sessionId}`);
    transports.delete(transport.sessionId);
  };

  await server.connect(transport);
});

// ── POST messages endpoint ────────────────────────────────────────────
app.post('/messages', express.json(), async (req, res) => {
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock-inventory-mcp] Server listening on port ${PORT}`);
});
