# homelab

Infrastructure and apps for a Proxmox-based homelab.

| Directory      | What it is                                                              |
| -------------- | ----------------------------------------------------------------------- |
| `proxmox/`     | Terraform: VMs for the k3s clusters, PostgreSQL and monitoring          |
| `k3s-cluster/` | Ansible: installs k3s (prod and dev clusters) with a kube-vip API VIP   |
| `postgresql/`  | Ansible: PostgreSQL on the `alpine-postgres` VM, nightly dumps to TrueNAS |
| `monitoring/`  | Ansible: Prometheus, Grafana, Loki and email alerts on the `monitoring` VM, node_exporter on the others |
| `clusters/`    | Flux: the entry point for each cluster (`dev`, `prod`), see below       |
| `infrastructure/` | Flux: cert-manager + Let's Encrypt (`configs/tls`), External Secrets, Alloy for monitoring |
| `apps/`        | Flux: EasyCabinets, Workbench and Patchwork Planner (dev only), `base/` plus a `dev/` overlay each |
| `scripts/`     | `flux-bootstrap.sh`: installs Flux in a cluster                         |

Each directory has its own README with the details.

## GitOps with Flux

Terraform and Ansible build the VMs and the k3s clusters. Everything inside the
clusters comes from this repo through [Flux](https://fluxcd.io): each cluster's Flux
syncs `clusters/<env>`, which applies, in order,

1. `infrastructure/controllers`: cert-manager, External Secrets, k8s-monitoring (Helm charts)
2. `infrastructure/configs`: the 1Password secret store, Let's Encrypt issuers, wildcard cert, Traefik config
3. `apps/<env>`: the apps

Each step waits for the one before it to be healthy. `${cluster}` in `infrastructure/`
becomes `dev` or `prod`. Nothing is applied by hand; a change is a commit.

### Image updates

Nobody edits image tags. CI builds the images and Flux picks the tag. For an app:

- `apps/base/image-repos/<app>.yaml`: an `ImageRepository`, so Flux scans the app's
  ghcr.io package for new tags.
- `apps/<env>/image-policies.yaml`: an `ImagePolicy` per cluster saying which tag to
  run. Dev takes the newest build (tags like `20261029153000`, newest number wins);
  prod takes the newest release (only `1.2.3`-style tags).
- `apps/<env>/<app>/kustomization.yaml`: the tag, on a line ending in
  `# {"$imagepolicy": "flux-system:<app>-<env>:tag"}`.

The `ImageUpdateAutomation` in `clusters/<env>` rewrites that line when the policy
picks a new tag and commits it as `fluxcdbot`, and Flux rolls it out. So every deploy
is a commit, and reverting one is a `git revert`. Pull before you push, since Flux
commits to `main` too.

### Bootstrapping a cluster

Needs the `flux` CLI (`brew install fluxcd/tap/flux`) and the 1Password items
`external-secrets` and `flux-github` (below). Then, once per cluster:

```bash
flux check --pre --context dev
scripts/flux-bootstrap.sh dev            # or: scripts/flux-bootstrap.sh dev flux, to try a branch
flux --context dev get kustomizations --watch
```

The script stores the 1Password service account token in the cluster (the one secret
that can't come from git) and runs `flux bootstrap github`, which installs Flux,
commits its own manifests to `clusters/<env>/flux-system/`, and adds a deploy key
to the repo with write access, for the image updates.

**First time only, moving off the hand-applied setup.** Flux can't take over
what was installed outside Helm or by k3s' Helm controller, so before bootstrapping
a cluster remove those (the wildcard cert secret stays, so HTTPS keeps working;
metrics and logs pause until Flux reinstalls k8s-monitoring):

```bash
kubectl --context dev -n kube-system delete helmchart k8s-monitoring
kubectl --context dev delete -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml
```

## Secrets

No secrets are committed. They live in 1Password, in a vault named **homelab**, and
the repo holds only `op://` references to them. The tools read them at run time, so
the values never land on disk:

| Where | How it reads 1Password |
| ----- | ---------------------- |
| `proxmox/` | `./tf plan`, `./tf apply`: runs Terraform under `op run` with `op.env` |
| `k3s-cluster/`, `postgresql/`, `monitoring/` | `group_vars/*/secrets.yml` use the `community.general.onepassword` lookup |
| `infrastructure/`, `apps/` | External Secrets reads items through a 1Password service account (`infrastructure/configs/onepassword-store.yaml`); each `ExternalSecret` names an item and field |
| `scripts/flux-bootstrap.sh` | `op read` for the service account token and the GitHub token |
| GHCR token | the Makefiles fall back to `op read op://homelab/ghcr/token` |

**One-time setup:** in the 1Password app, turn on Settings > Developer > *Integrate with
1Password CLI* (the CLI then signs in with Touch ID), then create these items in the
homelab vault. Item titles and field labels must match exactly.

| Item | Field | Value |
| ---- | ----- | ----- |
| `proxmox-terraform` | `api-token` | Proxmox API token, `user@realm!tokenid=secret` (Datacenter > Permissions > API Tokens) |
| `k3s-dev` | `token` | dev cluster join token; must match the running cluster |
| `k3s-prod` | `token` | prod cluster join token; must match the running cluster |
| `postgres-easycabinets` | `password` | `easycabinets` role |
| `ghcr` | `token` | GitHub classic PAT with `write:packages` |
| `cloudflare-cert-manager` | `api-token` | Cloudflare API token with Zone:DNS:Edit, for DNS-01 challenges |
| `external-secrets` | `token` | 1Password service account token, read-only access to the homelab vault (1Password.com > Developer > Service Accounts) |
| `flux-github` | `token` | GitHub personal access token for `flux bootstrap`: classic with `repo`, or fine-grained with Administration and Contents read/write on homelab-infra |
| `easycabinets-google` | `client-id`, `client-secret` | Google OAuth client for EasyCabinets |
| `easycabinets` | `admin-emails` | Comma-separated emails of EasyCabinets admins (kept out of the public repo) |
| `postgres-workbench` | `password` | `workbench` role (Workbench planner) |
| `workbench` | `password`, `session-secret` | Workbench sign-in password, and a random cookie-signing key (`openssl rand -hex 32`) |
| `patchwork` | `password`, `secret-key` | Patchwork Planner sign-in password, and Django's `SECRET_KEY` (`openssl rand -hex 32`) |
| `alertmanager-smtp` | `password` | Gmail app password that alert emails are sent with |
| `grafana` | `admin-password` | Grafana `admin` password |
| `proxmox-monitoring` | `token-secret` | Secret of the read-only `monitoring@pve!exporter` Proxmox API token (see monitoring/README.md) |
| `healthchecks` | `watchdog-url` | Optional: Healthchecks.io ping URL for the alerting dead man's switch |

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
