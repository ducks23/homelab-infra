# homelab

Infrastructure and apps for a Proxmox-based homelab.

| Directory      | What it is                                                              |
| -------------- | ----------------------------------------------------------------------- |
| `proxmox/`     | Terraform: VMs for the k3s clusters and the Alpine PostgreSQL server    |
| `k3s-cluster/` | Ansible: installs k3s (prod and dev clusters) with a kube-vip API VIP   |
| `postgresql/`  | Ansible: PostgreSQL on the `alpine-postgres` VM                         |
| `go-api/`      | Go REST API, container image on GHCR, deployed to k3s with Kustomize    |
| `k8s/`         | Loose Kubernetes manifests                                              |
| `k8s/tls/`     | Let's Encrypt HTTPS: cert-manager + Traefik, Proxmox, DNS on Cloudflare |
| `writeups/`    | Notes on how things were built                                          |

Each directory has its own README with the details.

## Secrets

No secrets are committed. Every secret file is gitignored and has a committed
`*.example` next to it. After cloning, copy each example to its real name and
fill in the values:

```bash
cp proxmox/terraform.tfvars.example                     proxmox/terraform.tfvars
cp k3s-cluster/group_vars/prod/vault.yml.example        k3s-cluster/group_vars/prod/vault.yml
cp k3s-cluster/group_vars/dev/vault.yml.example         k3s-cluster/group_vars/dev/vault.yml
cp postgresql/group_vars/postgres/vault.yml.example     postgresql/group_vars/postgres/vault.yml
cp go-api/.env.example                                  go-api/.env
cp go-api/.env.example                                  go-api/.env.prod
cp k8s/tls/overlays/prod/.env.cloudflare.example         k8s/tls/overlays/prod/.env.cloudflare
cp k8s/tls/overlays/dev/.env.cloudflare.example          k8s/tls/overlays/dev/.env.cloudflare
```

| File | Values | Where to get them |
| ---- | ------ | ----------------- |
| `proxmox/terraform.tfvars` | `proxmox_api_token` | Proxmox UI: Datacenter > Permissions > API Tokens. Format `user@realm!tokenid=secret`. |
| `k3s-cluster/group_vars/prod/vault.yml` | `vault_k3s_token` | Join token for the prod cluster: `openssl rand -hex 32`. Must match the token the running cluster was installed with. |
| `k3s-cluster/group_vars/dev/vault.yml` | `vault_k3s_token` | Same, for the dev cluster. Use a different value from prod. |
| `postgresql/group_vars/postgres/vault.yml` | `vault_postgresql_app_password`, `vault_postgresql_app_prod_password` | Passwords for the `app` (dev) and prod database roles: `openssl rand -base64 24`. |
| `go-api/.env` | `DB_PASSWORD` (plus `DB_HOST`, etc.) | The dev `app` password from `postgresql/group_vars/postgres/vault.yml`. |
| `go-api/.env.prod` | `DB_*` | Same keys as `.env`, pointed at the production database and prod password. |
| `go-api/.ghcr-token` | GitHub PAT (or set `$GHCR_TOKEN`) | Classic token with `write:packages` at <https://github.com/settings/tokens/new>. `printf %s 'ghp_...' > go-api/.ghcr-token && chmod 600 go-api/.ghcr-token` |
| `k8s/tls/overlays/{prod,dev}/.env.cloudflare` | `api-token` | Cloudflare > My Profile > API Tokens, "Edit zone DNS" template limited to `naboo.party`. One token per cluster. See `k8s/tls/README.md`. |

Optional: encrypt the Ansible vault files with `ansible-vault encrypt <file>` and
put the vault password in a gitignored `.vault_pass`, then set
`vault_password_file = .vault_pass` in that project's `ansible.cfg`.

### Generated, never committed

These are created by the tools and are also gitignored:

- `proxmox/terraform.tfstate*`: Terraform state. It contains secrets, so back it up somewhere safe.
- `proxmox/.terraform/`: provider plugins, from `terraform init`.
- `k3s-cluster/fetched/kubeconfig-*.yaml`: cluster admin kubeconfigs fetched by the playbook.

Before committing, `git status` should never list any of the files above.
