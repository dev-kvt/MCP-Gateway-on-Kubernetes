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


- `make cluster-status` — check cluster, storage classes, ingress classes
- `make build` — build all 5 container images
- `make deploy-local` — Helm install into `mcp-system` with `values-local.yaml`
