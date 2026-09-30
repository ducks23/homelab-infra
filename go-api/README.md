# go-api

Scaffolding for a Go HTTP API using [Echo](https://echo.labstack.com) and
[GORM](https://gorm.io) with PostgreSQL (the `alpine-postgres` VM from
`../postgresql`).

## Layout

```
cmd/server/main.go        entrypoint: load config, connect DB, start server, graceful shutdown
internal/config/          environment-based configuration
internal/database/        GORM connection + AutoMigrate (register new models here)
internal/models/          GORM models (Item is a placeholder)
internal/handlers/        Echo handlers
internal/server/          Echo setup, middleware and routes
```

## Run

```bash
# Settings come from .env.tpl, with DB_PASSWORD read from 1Password (homelab/postgres-app).
# Or: cp .env.example .env and set DB_PASSWORD; a local .env wins.
make run
```

The Postgres VM only accepts LAN connections (192.168.1.0/24), so run this from
your Mac or another host on that network.

```bash
curl localhost:8080/health
curl -X POST localhost:8080/api/v1/items -H 'Content-Type: application/json' -d '{"name":"first"}'
curl localhost:8080/api/v1/items
```

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `DB_HOST` | `192.168.1.30` | |
| `DB_PORT` | `5432` | |
| `DB_USER` | `app` | |
| `DB_PASSWORD` | none | required |
| `DB_NAME` | `app` | |
| `DB_SSLMODE` | `disable` | the VM isn't configured for TLS |

## Adding a model

1. Add a struct in `internal/models/`.
2. Add it to `AutoMigrate` in `internal/database/database.go`.
3. Add handlers and register routes in `internal/server/server.go`.

`AutoMigrate` only adds tables and columns. For production-grade schema changes
consider a migration tool such as golang-migrate or Atlas.

## Docker and deploying to the dev cluster

```bash
make docker-run     # build and run in a local container (uses .env)
make deploy         # build, push to ghcr.io/ducks23/go-api, roll out to the dev cluster
make help           # all targets
```

Manifests are Kustomize: `k8s/base` has what both clusters share, and
`k8s/overlays/dev` and `k8s/overlays/prod` set the replica count and ingress
host. Preview one with `make k8s-render OVERLAY=prod`, or apply it by hand with
`kubectl apply -k k8s/overlays/dev` (the image has no tag until `make` injects it).

Images are pushed to GitHub Container Registry as
`ghcr.io/ducks23/go-api:<timestamp>` and the nodes pull them, so new or rebuilt
nodes work with no extra steps. `make deploy` always targets the `dev` kubectl
context.

### One-time GHCR setup

1. Create a **classic** personal access token at
   <https://github.com/settings/tokens/new> with the `write:packages` scope
   (`read:packages` is included). Fine-grained tokens don't work with GHCR.
2. Save it where the Makefile finds it (gitignored and excluded from the image):

   ```bash
   printf %s 'ghp_yourtoken' > .ghcr-token && chmod 600 .ghcr-token
   ```

   or `export GHCR_TOKEN=...` instead.
3. `make deploy`. The first push creates the package as **private**; the same
   token is stored in the cluster as the `ghcr-pull` image pull secret.

To avoid the pull secret you can make the package public in GitHub
(Packages > go-api > Package settings). The image contains no secrets.
