.PHONY: help cluster-status build deploy-local test-dod clean

help:
	@echo "Available commands:"
	@echo "  make cluster-status - Check status of local Kubernetes cluster & ingress"
	@echo "  make build          - Build all container images"
	@echo "  make deploy-local   - Deploy the platform using Helm (values-local.yaml)"
	@echo "  make test-dod       - Run the automated Definition-of-Done test suite"

cluster-status:
	@kubectl cluster-info
	@echo "\n--- Nodes ---"
	@kubectl get nodes -o wide
	@echo "\n--- Storage Classes ---"
	@kubectl get sc
	@echo "\n--- Ingress Classes ---"
	@kubectl get ingressclass
	@echo "\n--- Ingress Controller Pods ---"
	@kubectl get pods -n ingress-nginx 2>/dev/null || kubectl get pods -n kube-system -l rbac.traefik 2>/dev/null

build:
	@docker build -t mcp-gateway:latest services/gateway-backend
	@docker build -t mcp-woocommerce:latest services/woocommerce-mcp
	@docker build -t mcp-mock-crm:latest services/mock-crm-mcp
	@docker build -t mcp-mock-inventory:latest services/mock-inventory-mcp
	@docker build -t mcp-dashboard:latest frontend

deploy-local:
	./scripts/startup.sh
