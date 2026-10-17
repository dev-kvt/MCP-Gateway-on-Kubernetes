import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const PORT = parseInt(process.env.PORT || '8001', 10);

interface Customer {
  id: string;
  name: string;
  email: string;
  tier: 'Standard' | 'VIP' | 'Enterprise';
  orders_count: number;
  total_spent: number;
  notes: string[];
}

const customers: Customer[] = [
  {
    id: 'cust_01',
    name: 'John Doe',
    email: 'john.doe@example.com',
    tier: 'VIP',
    orders_count: 5,
    total_spent: 349.95,
    notes: ['Prefers express delivery', 'Requested invoice via email'],
  },
  {
    id: 'cust_02',
    name: 'Jane Smith',
    email: 'jane.smith@example.com',
    tier: 'Enterprise',
    orders_count: 14,
    total_spent: 1820.50,
    notes: ['Key contact for bulk hoodie orders', 'Eligible for 10% loyalty discount'],
  },
  {
    id: 'cust_03',
    name: 'Alice Johnson',
    email: 'alice.j@example.com',
    tier: 'Standard',
    orders_count: 1,
    total_spent: 49.99,
    notes: ['First order placed today'],
  },
];

const app = express();
app.use(cors());

const transports = new Map<string, SSEServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'mock-crm-mcp',
    version: '1.0.0',
  });

  server.tool(
    'search_customers',
    'Search the CRM directory for customer profiles by name, email, or tier.',
    {
      query: z.string().describe('Search query string (matches name, email, or tier)'),
    },
    async (args) => {
      const q = args.query.toLowerCase();
      const matched = customers.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.tier.toLowerCase().includes(q)
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(matched, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'get_customer',
    'Retrieve full details and support history of a customer by customer ID.',
    {
      customer_id: z.string().describe('Customer ID (e.g. "cust_01")'),
    },
    async (args) => {
      const found = customers.find((c) => c.id === args.customer_id);
      if (!found) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Customer with ID "${args.customer_id}" not found.` }],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(found, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'add_customer_note',
    'Add an internal support note to a customer account in the CRM.',
    {
      customer_id: z.string().describe('Customer ID to add note to'),
      note: z.string().min(1).describe('The note content to append'),
    },
    async (args) => {
      const found = customers.find((c) => c.id === args.customer_id);
      if (!found) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Customer with ID "${args.customer_id}" not found.` }],
        };
      }
      found.notes.push(`[${new Date().toISOString()}] ${args.note}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, customer: found }, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'mock-crm-mcp', timestamp: new Date().toISOString() });
});

app.get('/sse', async (req, res) => {
  console.log('[mock-crm-mcp] New SSE connection');
  const server = createMcpServer();
  const transport = new SSEServerTransport('/messages', res);

  transports.set(transport.sessionId, transport);
  transport.onclose = () => {
    transports.delete(transport.sessionId);
  };

  await server.connect(transport);
});

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
  console.log(`[mock-crm-mcp] Server listening on port ${PORT}`);
});
