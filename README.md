# WooCommerce Hosting with Team MCP Gateway on Kubernetes

A production-ready platform featuring a WooCommerce store hosted on Kubernetes, paired with a multi-tenant Team Model Context Protocol (MCP) Gateway.

## Architecture Highlights
- **WooCommerce Store**: WordPress + WooCommerce on MariaDB with automated configuration and Persistent Volumes.
- **WooCommerce MCP Server**: Custom-built MCP server speaking Streamable HTTP / SSE, querying the store via WooCommerce REST API v3.
- **Team MCP Gateway**: Centralized proxy aggregating multiple upstream MCP servers (`WooCommerce`, `Mock CRM`, `Inventory`) behind a single authenticated endpoint.
- **Multi-Tenant Security**: Role-based access control (Admin & Member), hashed API keys, and instantaneous revocation.
- **Audit Logging**: Comprehensive trace of all tool invocations (timestamp, user, server, tool, duration, and status).
- **Dashboard & Chat Agent**: Modern React UI with real-time server health badges, key management, audit viewer, and an in-app AI assistant calling tools through the gateway.
- **Helm-Native Deployment**: Identical Helm charts supporting both local dev (`values-local.yaml`) and production VPS (`values-prod.yaml`).

## Project Layout
```text
├── charts/
│   └── mcp-gateway/       # Production & Local Helm charts
├── services/
│   ├── woocommerce-mcp/   # Custom WooCommerce MCP server
│   ├── gateway-backend/   # Central MCP Gateway & Auth engine
│   ├── mock-crm-mcp/      # Upstream #2 (Mock CRM MCP)
│   └── mock-inventory-mcp/# Upstream #3 (Inventory & Policies MCP)
├── frontend/              # React Dashboard & In-App Chat Agent
├── scripts/               # Setup & test automation scripts
└── Makefile               # Developer workflow commands
```

## One-command startup

```bash
make deploy-local
```

This runs `scripts/startup.sh`, which:
1. Verifies prerequisites (kubectl, helm, docker, orbctl)
2. Ensures the OrbStack Kubernetes cluster is running
3. Builds all 5 container images locally
4. Deploys/upgrades the Helm chart (`values-local.yaml`)
5. Waits for all workloads to be Ready
6. Prints URLs and credentials

Safe to re-run — every step is idempotent.

## URLs (local)

| Service     | URL                                    | Notes |
|-------------|----------------------------------------|-------|
| Store front | http://store.127.0.0.1.nip.io          | WooCommerce, COD enabled |
| Dashboard   | http://gateway.127.0.0.1.nip.io        | Login + MCP servers + keys + audit + chat |
| Gateway MCP | http://gateway.127.0.0.1.nip.io/mcp/sse | MCP endpoint, `Authorization: Bearer <api-key>` |
| Health      | http://gateway.127.0.0.1.nip.io/health  | Upstream statuses |

Stable local domains use `nip.io` so `*.127.0.0.1.nip.io` resolves to the cluster ingress IP without DNS changes.

## Credentials

| What | Username | Password | Notes |
|------|----------|----------|-------|
| Dashboard admin (User A) | `admin` | `admin123` | Pre-seeded admin |
| Dashboard member (User B) | `member` | `member123` | Registered via dashboard |
| WordPress admin | `admin` | `AdminPassword123!` | http://store.127.0.0.1.nip.io/wp-admin |
| Admin API key | — | `urumi_live_admin_initial_master_key_999` | From `gateway.adminKey` |
| Member API key | — | `urumi_live_ae07a2b2415147afb2769983fad426ac` | Generate fresh at `/keys` |

⚠️ These are demo values committed for local development. Rotate them in `values-prod.yaml` before any production-like deployment — never commit real secrets.

## Using the system

### 1. Storefront (WooCommerce)
Open http://store.127.0.0.1.nip.io, browse products, add one to cart, and check out with Cash on Delivery. Orders appear in WooCommerce admin at http://store.127.0.0.1.nip.io/wp-admin.

### 2. Chat agent (User A or B)
1. Log into the dashboard at http://gateway.127.0.0.1.nip.io
2. Open **Chat Agent** from the sidebar
3. Ask: *"What products do we have?"*, *"Show me today's orders"*, *"Check stock for HOODIE-BLK-M"*, *"Create a product called Test Widget priced 19.99"*
4. Expand tool-call blocks to see which upstream handled each call, with arguments, duration, and result

The chat agent needs an LLM key — see **Chat agent LLM configuration** below. Without one it shows a clear warning and the Send button is disabled.

### 3. External MCP client (User B)
Add the gateway as an MCP server in Cursor / Claude Code / MCP Inspector:

- **URL:** `http://gateway.127.0.0.1.nip.io/mcp/sse`
- **Header:** `Authorization: Bearer <member-api-key>`

All enabled upstream tools appear namespaced (e.g. `woo__list_products`, `crm__search_customers`, `inventory__check_stock`). No upstream credentials are needed on the client side.

### 4. Smoke test (no client needed)
```bash
node scripts/mcp-smoke-test.mjs                                    # public URL + admin key
node scripts/mcp-smoke-test.mjs http://gateway.127.0.0.1.nip.io <key>   # custom instance
```
Lists all aggregated tools and calls WooCommerce + Inventory tools through one gateway session.

## Definition of Done — demo flows

| Flow | How to demonstrate |
|------|-------------------|
| Store order + COD checkout | Storefront → cart → COD checkout → verify order in WP admin |
| Chat creates product + order query | Chat: *"Create product Test Widget 19.99"* → storefront → chat: *"orders today"* |
| External client | Connect Claude Code/Cursor to gateway URL + member API key → list tools → call `woo__list_orders` |
| Multi-server prompt | Ask a question needing both WooCommerce and Inventory tools |
| Revoke key | Dashboard `/keys` → Revoke → client's next call rejected with 401 |
| Disable server | Dashboard `/servers` → Disable WooCommerce → its tools disappear from chat + client |
| Kill pod | `kubectl delete pod woocommerce-mcp` → dashboard shows `unreachable`, other servers keep working |
| Audit log | Dashboard `/audit` → every call attributed to the right user |

## Chat agent LLM configuration

The gateway chat agent uses an OpenAI-compatible API. Configure via Helm values (`charts/mcp-gateway/values-local.yaml`):

```yaml
chat:
  llmApiKey: ""                                # required to enable chat
  llmBaseUrl: "https://api.openai.com/v1"      # OpenAI
  llmModel: "gpt-4o-mini"
```

For **Groq**:

```yaml
chat:
  llmApiKey: "<groq key>"
  llmBaseUrl: "https://api.groq.com/openai/v1"
  llmModel: "llama-3.3-70b-versatile"
```

Apply: `helm upgrade --install mcp-gateway charts/mcp-gateway -n mcp-system -f charts/mcp-gateway/values-local.yaml`. Without a key the chat agent degrades gracefully with a clear message.

## Production (VPS / k3s)

```bash
helm upgrade --install mcp-gateway charts/mcp-gateway \
  --namespace mcp-system --create-namespace \
  -f charts/mcp-gateway/values-prod.yaml \
  --set store.hostname=store.<your-domain> \
  --set gateway.hostname=dashboard.<your-domain>
```

Same Helm chart for local and production; only values change:

| Dimension | Local | Production |
|-----------|-------|------------|
| DNS / hostnames | `*.127.0.0.1.nip.io` | custom domain |
| Ingress & TLS | plain HTTP | cert-manager + Let's Encrypt |
| Storage class | `local-path` | cloud CSI (e.g. `hcloud-volumes`, EBS) |
| Secrets | demo values in `values-local.yaml` | injected via `--set` / External Secrets |



## Makefile targets

- `make cluster-status` — check cluster, storage classes, ingress classes
- `make build` — build all 5 container images
- `make deploy-local` — Helm install into `mcp-system` with `values-local.yaml`
