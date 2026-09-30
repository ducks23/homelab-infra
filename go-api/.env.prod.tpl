# Prod settings for `make deploy-prod`. The 1Password reference is filled in from 1Password at run time (op inject);
# a local .env.prod, if present, wins.
PORT=8080
DB_HOST=192.168.1.30
DB_PORT=5432
DB_USER=app_prod
DB_PASSWORD=op://homelab/postgres-app-prod/password
DB_NAME=app_prod
DB_SSLMODE=disable
