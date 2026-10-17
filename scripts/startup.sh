#!/usr/bin/env bash
#
# startup.sh — One-command startup for the Urumi MCP Gateway platform
#
# What it does:
#   1. Verifies prerequisites (kubectl, helm, docker, cluster)
#   2. Ensures the OrbStack Kubernetes cluster is running
#   3. Builds all 5 container images locally
#   4. Deploys/upgrades the Helm chart (values-local.yaml)
#   5. Waits for all workloads to be Ready
#   6. Prints URLs, credentials, and next steps
#
# Safe to re-run — every step is idempotent.
#
# Usage: ./scripts/startup.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_DIR}"

# ── Colours ─────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m' # no colour
log()  { echo -e "${BLUE}[startup]${NC} $*"; }
ok()   { echo -e "${GREEN}[startup]${NC} $*"; }
warn() { echo -e "${YELLOW}[startup]${NC} $*"; }
err()  { echo -e "${RED}[startup]${NC} $*" >&2; }

# ── Prerequisites ───────────────────────────────────────────────────
log "Checking prerequisites…"
for cmd in kubectl helm docker orbctl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Missing required command: $cmd"
    exit 1
  fi
done
ok "Prerequisites present: kubectl, helm, docker, orbctl"

# ── Ensure OrbStack Kubernetes is running ───────────────────────────
log "Checking OrbStack Kubernetes engine…"
K8S_ENABLED="$(orbctl config get k8s.enable 2>/dev/null || echo "false")"
if [[ "$K8S_ENABLED" != "true" ]]; then
  warn "Kubernetes is disabled in OrbStack — enabling it now (requires restart)…"
  orbctl config set k8s.enable true >/dev/null 2>&1 || true
  orbctl stop >/dev/null 2>&1 || true
  orbctl start >/dev/null 2>&1 || true
  warn "Please wait for OrbStack to restart, then re-run this script."
  exit 0
fi

# Wait for the API server to become reachable
log "Waiting for Kubernetes API server…"
for i in $(seq 1 60); do
  if kubectl --context orbstack cluster-info >/dev/null 2>&1; then
    ok "Kubernetes API server is reachable"
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    err "Kubernetes API server not reachable after 60 attempts"
    exit 1
  fi
  sleep 2
done

kubectl config use-context orbstack >/dev/null 2>&1 || true

# ── Default storage class / ingress class check ─────────────────────
SC="$(kubectl get sc -o jsonpath='{.items[?(@.storageclass.kubernetes.io/is-default-class=="true")].metadata.name}' 2>/dev/null || true)"
if [[ -z "$SC" ]]; then
  warn "No default StorageClass found — local-path volumes may fail to bind."
fi
IC="$(kubectl get ingressclass -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "traefik")"
log "Using Ingress class: ${IC}"

# ── Build container images ──────────────────────────────────────────
log "Building container images (this may take a few minutes)…"
docker build -t mcp-woocommerce:latest services/woocommerce-mcp >/tmp/build-woo.log 2>&1
docker build -t mcp-mock-crm:latest services/mock-crm-mcp >/tmp/build-crm.log 2>&1
docker build -t mcp-mock-inventory:latest services/mock-inventory-mcp >/tmp/build-inv.log 2>&1
docker build -t mcp-gateway:latest services/gateway-backend >/tmp/build-gw.log 2>&1
docker build -t mcp-dashboard:latest frontend >/tmp/build-dash.log 2>&1
ok "All 5 images built"

# ── Deploy / upgrade Helm ───────────────────────────────────────────
log "Deploying Helm chart into namespace 'mcp-system'…"
helm upgrade --install mcp-gateway charts/mcp-gateway \
  --namespace mcp-system --create-namespace \
  -f charts/mcp-gateway/values-local.yaml >/tmp/helm-deploy.log 2>&1
ok "Helm release deployed"

# ── Wait for workloads ──────────────────────────────────────────────
log "Waiting for all workloads to become Ready…"
kubectl -n mcp-system rollout status deploy/wordpress --timeout=300s >/dev/null 2>&1 || true
kubectl -n mcp-system rollout status deploy/mariadb --timeout=300s >/dev/null 2>&1 || true
kubectl -n mcp-system rollout status deploy/woocommerce-mcp --timeout=300s >/dev/null 2>&1
kubectl -n mcp-system rollout status deploy/mock-crm-mcp --timeout=300s >/dev/null 2>&1
kubectl -n mcp-system rollout status deploy/mock-inventory-mcp --timeout=300s >/dev/null 2>&1
kubectl -n mcp-system rollout status deploy/gateway-backend --timeout=300s >/dev/null 2>&1
kubectl -n mcp-system rollout status deploy/mcp-dashboard --timeout=300s >/dev/null 2>&1
ok "All workloads are Ready"

# ── Summary ─────────────────────────────────────────────────────────
echo
echo "============================================================"
ok "Urumi MCP Gateway is running"
echo "============================================================"
echo
echo "URLs (local, via Traefik Ingress):"
echo "  Store front:   http://store.127.0.0.1.nip.io"
echo "  Dashboard:     http://gateway.127.0.0.1.nip.io"
echo "  MCP endpoint:  http://gateway.127.0.0.1.nip.io/mcp/sse"
echo "  Health check:  http://gateway.127.0.0.1.nip.io/health"
echo
echo "Credentials:"
echo "  Dashboard admin:  admin / admin123"
echo "  Dashboard member: member / member123"
echo "  WordPress admin:  admin / AdminPassword123!"
echo "  Admin API key:    urumi_live_admin_initial_master_key_999"
echo
echo "Next steps:"
echo "  1. Open http://gateway.127.0.0.1.nip.io and log in as admin"
echo "  2. Generate an API key at /keys for your external MCP client"
echo "  3. Connect Claude Code / Cursor / MCP Inspector to:"
echo "     http://gateway.127.0.0.1.nip.io/mcp/sse"
echo "     Header: Authorization: Bearer <your-api-key>"
echo "  4. Use the Chat Agent at /chat"
echo
echo "Quick smoke test:"
echo "  node scripts/mcp-smoke-test.mjs"
echo
echo "Logs / debug:"
echo "  kubectl -n mcp-system get pods"
echo "  kubectl -n mcp-system logs deploy/gateway-backend"
echo "============================================================"
