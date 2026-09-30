# Dev settings for `make run`, `make docker-run` and `make deploy`. The 1Password references are
# filled in from 1Password at run time (op inject); a local .env, if present, wins.
PORT=8080
DB_HOST=192.168.1.30
DB_PORT=5432
DB_USER=app
DB_PASSWORD=op://homelab/postgres-app/password
DB_NAME=app
DB_SSLMODE=disable
