# homelab

Infrastructure and apps for a Proxmox-based homelab.

| Directory      | What it is                                                              |
| -------------- | ----------------------------------------------------------------------- |
| `proxmox/`     | Terraform: VMs for the k3s clusters, PostgreSQL and Minecraft           |
| `k3s-cluster/` | Ansible: installs k3s (prod and dev clusters) with a kube-vip API VIP   |
| `postgresql/`  | Ansible: PostgreSQL on the `alpine-postgres` VM, nightly dumps to TrueNAS |
| `minecraft/`   | Ansible: Minecraft Java server (Docker) on the `minecraft` VM           |
| `go-api/`      | Go REST API, container image on GHCR, deployed to k3s with Kustomize    |
| `k8s/`         | Loose Kubernetes manifests                                              |
| `writeups/`    | Notes on how things were built                                          |

Each directory has its own README with the details.

## Secrets

No secrets are committed. They live in 1Password, in a vault named **homelab**, and
the repo holds only `op://` references to them. The tools read them at run time, so
the values never land on disk:

| Where | How it reads 1Password |
| ----- | ---------------------- |
| `proxmox/` | `./tf plan`, `./tf apply`: runs Terraform under `op run` with `op.env` |
| `k3s-cluster/`, `postgresql/` | `group_vars/*/secrets.yml` use the `community.general.onepassword` lookup |
| `go-api/`, `../easycabinets`, `../workbench` | `make deploy` fills in `.env.tpl` (`.env.prod.tpl` for prod) with `op inject` and pipes it into the Kubernetes secret |
| `k8s/tls/` | `k8s/tls/cloudflare-secret.sh dev\|prod` puts cert-manager's Cloudflare token in the cluster |
| GHCR token | both Makefiles fall back to `op read op://homelab/ghcr/token` |

**One-time setup:** in the 1Password app, turn on Settings > Developer > *Integrate with
1Password CLI* (the CLI then signs in with Touch ID), then create these items in the
homelab vault. Item titles and field labels must match exactly.

| Item | Field | Value |
| ---- | ----- | ----- |
| `proxmox-terraform` | `api-token` | Proxmox API token, `user@realm!tokenid=secret` (Datacenter > Permissions > API Tokens) |
| `k3s-dev` | `token` | dev cluster join token; must match the running cluster |
| `k3s-prod` | `token` | prod cluster join token; must match the running cluster |
| `postgres-app` | `password` | `app` role (dev databases) |
| `postgres-app-prod` | `password` | `app_prod` role |
| `postgres-easycabinets` | `password` | `easycabinets` role |
| `ghcr` | `token` | GitHub classic PAT with `write:packages` |
| `cloudflare-cert-manager` | `api-token` | Cloudflare API token with Zone:DNS:Edit, for DNS-01 challenges |
| `easycabinets-google` | `client-id`, `client-secret` | Google OAuth client for EasyCabinets |
| `postgres-workbench` | `password` | `workbench` role (Workbench planner) |
| `postgres-patchwork` | `password` | `patchwork` role (Patchwork Planner) |
| `patchwork` | `password`, `secret-key` | Patchwork Planner sign-in password, and Django's `SECRET_KEY` (`openssl rand -hex 32`) |
| `workbench` | `password`, `session-secret` | Workbench sign-in password, and a random cookie-signing key (`openssl rand -hex 32`) |

New secrets: `openssl rand -hex 32` (k3s tokens) or `openssl rand -base64 24` (passwords).
Existing ones must be copied over unchanged, or rotated on the server at the same time.

**Local overrides:** if one of the old gitignored files exists, it still wins over
1Password: `terraform.tfvars` (a `proxmox_api_token` line), `group_vars/*/vault.yml`,
`.env` / `.env.prod`, `.ghcr-token`. The `*.example` files show their format. Normally
none of them exist.

### Generated, never committed

These are created by the tools and are also gitignored:

- `proxmox/terraform.tfstate*`: Terraform state. It contains secrets, so back it up somewhere safe.
- `proxmox/.terraform/`: provider plugins, from `terraform init`.
- `k3s-cluster/fetched/kubeconfig-*.yaml`: cluster admin kubeconfigs fetched by the playbook.

Before committing, `git status` should never list any of the files above.
