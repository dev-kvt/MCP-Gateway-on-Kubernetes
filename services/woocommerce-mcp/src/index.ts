import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { WooCommerceClient } from './client.js';

const PORT = parseInt(process.env.PORT || '8000', 10);
const client = new WooCommerceClient();

const app = express();
app.use(cors());

// Map of active transports keyed by session ID
const transports = new Map<string, SSEServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'woocommerce-mcp',
    version: '1.0.0',
  });

  server.tool(
    'list_products',
    'List products from the WooCommerce store with optional filtering by limit, page, and status.',
    {
      limit: z.number().int().min(1).max(100).optional().describe('Number of products to return (default: 10)'),
      page: z.number().int().min(1).optional().describe('Page number for pagination'),
      status: z.enum(['any', 'draft', 'pending', 'private', 'publish']).optional().describe('Product status filter'),
    },
    async (args) => {
      try {
        const products = await client.listProducts(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(products, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list products: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    'create_product',
    'Create a new product in the WooCommerce store.',
    {
      name: z.string().min(1).describe('The name of the product'),
      regular_price: z.string().describe('The regular price of the product (e.g. "49.99")'),
      description: z.string().optional().describe('Full description of the product'),
      categories: z.array(z.object({ id: z.number().optional(), name: z.string().optional() })).optional().describe('Product categories'),
    },
    async (args) => {
      try {
        const product = await client.createProduct(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(product, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to create product: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    'list_orders',
    'List orders from the WooCommerce store with optional status and pagination filters.',
    {
      status: z.enum(['any', 'pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed', 'trash']).optional().describe('Filter orders by status'),
      limit: z.number().int().min(1).max(100).optional().describe('Number of orders to return'),
      page: z.number().int().min(1).optional().describe('Page number'),
    },
    async (args) => {
      try {
        const orders = await client.listOrders(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(orders, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list orders: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    'get_order',
    'Retrieve details of a specific WooCommerce order by order ID.',
    {
      order_id: z.union([z.number(), z.string()]).describe('The WooCommerce order ID'),
    },
    async (args) => {
      try {
        const order = await client.getOrder(args.order_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(order, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to get order #${args.order_id}: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    'update_order_status',
    'Update the status of an existing WooCommerce order.',
    {
      order_id: z.union([z.number(), z.string()]).describe('The WooCommerce order ID'),
      status: z.enum(['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed']).describe('New status for the order'),
    },
    async (args) => {
      try {
        const updated = await client.updateOrderStatus(args.order_id, args.status);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(updated, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to update order #${args.order_id}: ${err.message}` }],
        };
      }
    }
  );

  return server;
}

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'woocommerce-mcp', timestamp: new Date().toISOString() });
});

// SSE endpoint
app.get('/sse', async (req, res) => {
  console.log('[woocommerce-mcp] New incoming SSE connection');
  const server = createMcpServer();
  const transport = new SSEServerTransport('/messages', res);

  transports.set(transport.sessionId, transport);

  transport.onclose = () => {
    console.log(`[woocommerce-mcp] SSE connection closed: ${transport.sessionId}`);
    transports.delete(transport.sessionId);
  };

  await server.connect(transport);
});

// Post messages endpoint
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
  console.log(`[woocommerce-mcp] Server listening on port ${PORT}`);
});
