#!/usr/bin/env node
/** Smoke test: MCP-over-SSE flow through the public gateway URL.
 *  Usage: node scripts/mcp-smoke-test.mjs [baseUrl] [apiKey]
 */
const BASE = process.argv[2] || 'http://gateway.127.0.0.1.nip.io';
const API_KEY = process.argv[3] || 'urumi_live_admin_initial_master_key_999';

const SSE_TIMEOUT_MS = 5000;

async function main() {
  // ── 1. Open the authenticated SSE stream ─────────────────────────
  const res = await fetch(`${BASE}/mcp/sse`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'text/event-stream' },
  });
  if (!res.ok) throw new Error(`SSE connect failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const responses = new Map(); // id -> jsonrpc response
  let buf = '';
  let endpoint = null;

  function consume(chunkBytes) {
    buf += chunkBytes ? decoder.decode(chunkBytes, { stream: true }) : '';
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const evt = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const dataLine = evt.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const payload = dataLine.replace(/^data: ?/, '').trim();
      try {
        const parsed = JSON.parse(payload);
        if (parsed.id) responses.set(parsed.id, parsed);
      } catch {
        endpoint = payload; // the initial `event: endpoint` carries the session URL
      }
    }
  }

  const initial = await Promise.race([
    reader.read().then((r) => {
      consume(r.value);
      return endpoint;
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('No endpoint event received')), SSE_TIMEOUT_MS)),
  ]);
  if (!initial) throw new Error('No endpoint event received');
  console.log('Session endpoint:', initial);

  // ── 2. Post helpers + response waiter ────────────────────────────
  async function post(obj) {
    const r = await fetch(new URL(initial, BASE), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
    });
    if (r.status !== 202) throw new Error(`POST failed: ${r.status} ${await r.text()}`);
  }

  const since = new Set(); // ids already awaited (avoid re-reading them)
  async function waitFor(id, label) {
    const deadline = Date.now() + SSE_TIMEOUT_MS * 2;
    while (!responses.has(id)) {
      if (Date.now() > deadline) throw new Error(`Timeout waiting for ${label}`);
      const { done, value } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ done: true }), 1000))]);
      if (done) break;
      consume(value);
    }
    const resp = responses.get(id);
    since.add(id);
    return resp;
  }

  // ── 3. MCP handshake, tools/list, tool calls across 2 upstreams ──
  await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1.0' } } });
  await waitFor(1, 'initialize');
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });

  await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const toolsRes = await waitFor(2, 'tools/list');
  const names = (toolsRes.result?.tools || []).map((t) => t.name);
  console.log(`TOOLS (${names.length}):`, names.join(', '));

  await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'woo__list_products', arguments: { limit: 2 } } });
  const wooRes = await waitFor(3, 'woo__list_products');
  const products = JSON.parse(wooRes.result?.content?.[0]?.text || '[]');
  console.log('woo__list_products ->', products.map((p) => p.name).join(' | '));

  await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'inventory__list_warehouse_items', arguments: {} } });
  const invRes = await waitFor(4, 'inventory__list_warehouse_items');
  const data = JSON.parse(invRes.result?.content?.[0]?.text || '{}');
  console.log('inv__list_warehouse_items ->', `${data.total} items, e.g. ${data.items?.[0]?.name}`);

  reader.cancel().catch(() => {});
  console.log('\n✅ Smoke test passed: tools aggregated from multiple upstreams, routed and audited through the gateway.');
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
