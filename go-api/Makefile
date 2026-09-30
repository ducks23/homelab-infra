.PHONY: help run build test tidy \
        docker-build docker-run docker-stop docker-logs \
        registry-login k8s-build k8s-push k8s-render _rollout \
        deploy deploy-prod promote-prod confirm-prod \
        undeploy k8s-status k8s-logs

IMAGE        ?= go-api
HOST_PORT    ?= 8080
NAMESPACE    ?= go-api

# Kubernetes. Every kubectl call passes --context explicitly, so a stray
# `kubectl config use-context` can never send a deploy to the wrong cluster.
# k8s-status / k8s-logs / undeploy default to dev; add KUBE_CONTEXT=prod for prod.
KUBE_CONTEXT ?= dev
KUBECTL       = kubectl --context $(KUBE_CONTEXT)

# Per-environment settings (replicas, ingress host) live in k8s/overlays/<env>.
# Prod reads its own env file so it can point at a different database than dev.
PROD_ENV_FILE ?= .env.prod

# Secrets: an env file if you have one, else its committed .tpl twin with the
# op:// references filled in by 1Password (op inject). Nothing is written to disk.
ENV_CMD        = if [ -f $(1) ]; then cat $(1); elif [ -f $(1).tpl ]; then op inject -i $(1).tpl; \
                 else echo "Missing $(1) (and $(1).tpl)" >&2; exit 1; fi

# Container registry (GitHub Container Registry). The token is a classic personal
# access token with the write:packages scope, read from $$GHCR_TOKEN, the
# gitignored .ghcr-token file or 1Password. It is never printed or baked into the image.
GH_USER       ?= ducks23
REGISTRY      ?= ghcr.io
REMOTE_IMAGE   = $(REGISTRY)/$(GH_USER)/$(IMAGE)
TOKEN_CMD      = if [ -n "$$GHCR_TOKEN" ]; then printf %s "$$GHCR_TOKEN"; elif [ -s .ghcr-token ]; then cat .ghcr-token; \
                 else op read op://homelab/ghcr/token; fi

# Remember whether TAG was given explicitly (promote-prod requires it), then
# evaluate the default once (`:=`) so build, push and deploy all use the same tag.
TAG_GIVEN     := $(filter command line environment,$(origin TAG))
TAG           ?= $(shell date +%Y%m%d%H%M%S)
TAG           := $(TAG)

help:
	@echo "Local:"
	@echo "  make run            run with go run (no Docker)"
	@echo "  make docker-run     build the image and run it in a local container"
	@echo "  make docker-stop    stop and remove the local container"
	@echo "  make docker-logs    follow the local container's logs"
	@echo "Dev cluster:"
	@echo "  make deploy         build, push to ghcr.io, and roll out to dev"
	@echo "Prod cluster (asks you to type 'prod'; CONFIRM=yes skips the prompt):"
	@echo "  make deploy-prod    build, push, and roll out to prod (uses $(PROD_ENV_FILE))"
	@echo "  make promote-prod TAG=<tag>   roll out an image already pushed (e.g. one tested on dev)"
	@echo "Either cluster (default dev; add KUBE_CONTEXT=prod):"
	@echo "  make k8s-render OVERLAY=dev|prod   preview the manifests an overlay produces"
	@echo "  make k8s-status     show pods, service and ingress"
	@echo "  make k8s-logs       follow the pods' logs"
	@echo "  make undeploy       delete the app and its namespace"

# --- Go ----------------------------------------------------------------------

# Uses .env if there is one (the app loads it), else runs under op run with .env.tpl.
run:
	@if [ -f .env ]; then go run ./cmd/server; else op run --env-file=.env.tpl -- go run ./cmd/server; fi

build:
	go build -o bin/server ./cmd/server

test:
	go test ./...

tidy:
	go mod tidy

# --- Local Docker ------------------------------------------------------------

docker-build:
	docker build -t $(IMAGE):local .

# PORT is forced to 8080 after --env-file so the port mapping always matches.
docker-run: docker-build
	-@docker rm -f $(IMAGE) >/dev/null 2>&1
	@env="$$($(call ENV_CMD,.env))" || exit 1; \
		printf '%s\n' "$$env" | docker run -d --name $(IMAGE) --env-file /dev/stdin -e PORT=8080 -p $(HOST_PORT):8080 $(IMAGE):local
	@echo "Running at http://localhost:$(HOST_PORT)  (logs: make docker-logs, stop: make docker-stop)"

docker-stop:
	-docker rm -f $(IMAGE)

docker-logs:
	docker logs -f $(IMAGE)

# --- Registry ----------------------------------------------------------------

registry-login:
	@token="$$($(TOKEN_CMD))" && [ -n "$$token" ] || { \
		echo "No GitHub token: set GHCR_TOKEN, save it to .ghcr-token, or store it in 1Password as homelab/ghcr/token (see README)." >&2; exit 1; }; \
		printf %s "$$token" | docker login $(REGISTRY) -u $(GH_USER) --password-stdin

# The k3s nodes are amd64; build for that regardless of the host CPU.
k8s-build:
	docker build --platform linux/amd64 -t $(REMOTE_IMAGE):$(TAG) .

k8s-push: registry-login k8s-build
	docker push $(REMOTE_IMAGE):$(TAG)

# --- Deploying ---------------------------------------------------------------

# Preview what an overlay produces: make k8s-render OVERLAY=prod
OVERLAY ?= dev
k8s-render:
	@kubectl kustomize k8s/overlays/$(OVERLAY)

# Shared rollout step. Not meant to be run directly: `deploy` and `deploy-prod`
# call it with KUBE_CONTEXT, OVERLAY, ENV_FILE and TAG set. The image tag is
# injected through a throwaway overlay in a temp dir, so nothing in k8s/ is
# rewritten on each deploy.
_rollout:
	@echo "Deploying $(REMOTE_IMAGE):$(TAG) to context '$(KUBE_CONTEXT)' (overlay: $(OVERLAY))"
	$(KUBECTL) create namespace $(NAMESPACE) --dry-run=client -o yaml | $(KUBECTL) apply -f -
	@echo "Secret go-api-env from $(ENV_FILE)"
	@env="$$($(call ENV_CMD,$(ENV_FILE)))" || exit 1; \
		printf '%s\n' "$$env" | $(KUBECTL) -n $(NAMESPACE) create secret generic go-api-env --from-env-file=/dev/stdin --dry-run=client -o yaml | $(KUBECTL) apply -f -
	@token="$$($(TOKEN_CMD))" && [ -n "$$token" ] || exit 1; \
		$(KUBECTL) -n $(NAMESPACE) create secret docker-registry ghcr-pull --docker-server=$(REGISTRY) \
		--docker-username=$(GH_USER) --docker-password="$$token" --dry-run=client -o yaml | $(KUBECTL) apply -f -
	@tmp=$$(cd "$$(mktemp -d)" && pwd -P) && trap 'rm -rf "$$tmp"' EXIT && \
		rel=$$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$(CURDIR)/k8s/overlays/$(OVERLAY)" "$$tmp") && \
		printf 'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - %s\nimages:\n  - name: %s\n    newTag: "%s"\n' \
			"$$rel" "$(REMOTE_IMAGE)" "$(TAG)" > "$$tmp/kustomization.yaml" && \
		echo "kubectl apply -k <overlay $(OVERLAY), image $(REMOTE_IMAGE):$(TAG)>" && \
		$(KUBECTL) apply -k "$$tmp"
	$(KUBECTL) -n $(NAMESPACE) rollout status deployment/go-api --timeout=120s
	@echo "Deployed: http://$$($(KUBECTL) -n $(NAMESPACE) get ingress go-api -o jsonpath='{.spec.rules[0].host}')/health"

deploy: k8s-push
	@$(MAKE) --no-print-directory _rollout KUBE_CONTEXT=dev OVERLAY=dev ENV_FILE=.env TAG=$(TAG)

confirm-prod:
	@if [ "$(CONFIRM)" != "yes" ]; then \
		printf "This deploys to the PROD cluster (context 'prod'). Type 'prod' to continue: "; \
		read answer; [ "$$answer" = "prod" ] || { echo "Aborted."; exit 1; }; \
	fi

deploy-prod: confirm-prod k8s-push
	@$(MAKE) --no-print-directory _rollout KUBE_CONTEXT=prod OVERLAY=prod ENV_FILE=$(PROD_ENV_FILE) TAG=$(TAG)

# Roll out an image that's already in the registry, e.g. the exact tag you just
# tested on dev, without rebuilding it.
promote-prod: confirm-prod registry-login
	@[ -n "$(TAG_GIVEN)" ] || { echo "Set the image tag to promote: make promote-prod TAG=<tag>" >&2; exit 1; }
	@docker buildx imagetools inspect $(REMOTE_IMAGE):$(TAG) >/dev/null 2>&1 || { echo "$(REMOTE_IMAGE):$(TAG) not found in the registry" >&2; exit 1; }
	@$(MAKE) --no-print-directory _rollout KUBE_CONTEXT=prod OVERLAY=prod ENV_FILE=$(PROD_ENV_FILE) TAG=$(TAG)

undeploy:
	$(KUBECTL) delete namespace $(NAMESPACE) --ignore-not-found

k8s-status:
	$(KUBECTL) -n $(NAMESPACE) get pods,svc,ingress -o wide

k8s-logs:
	$(KUBECTL) -n $(NAMESPACE) logs -f deployment/go-api --all-pods=true
