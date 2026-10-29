# monitoring (Ansible)

Metrics, logs and email alerts for the homelab, on the Ubuntu VM defined in
`../../terraform/monitoring.tf` (`monitoring`, 192.168.1.60, 2 vCPU / 4 GB / 60 GB). Everything runs in
Docker Compose:

| Service | Port | What it does |
| ------- | ---- | ------------ |
| Grafana | [3000](http://192.168.1.60:3000) | Dashboards and log search. Sign in as `admin` |
| Prometheus | [9090](http://192.168.1.60:9090) | Metrics database; evaluates the alert rules. Alloy on the k3s clusters pushes its metrics here (remote-write) |
| Alertmanager | [9093](http://192.168.1.60:9093) | Groups alerts and emails them to jesse1517@gmail.com through Gmail |
| Loki | 3100 | Log database; Alloy on the k3s clusters pushes pod logs and Kubernetes events here |
| blackbox exporter | | Pings hosts, checks TCP ports and HTTPS sites for Prometheus |
| pve-exporter | | Reads node, VM and storage status from the Proxmox API |
| node-exporter | 9100 | CPU, memory and disk of this VM |

It runs on its own VM, outside the k3s clusters, so it still alerts when a cluster is down.
Nothing has a login except Grafana, so keep these ports on the LAN.

Where the data comes from:

- **Proxmox host and VMs:** `node_exporter` on pve, alpine-postgres and devbox,
  installed by `node-exporter.yml` and scraped on :9100. On pve it also reports pending apt
  updates. The monitoring VM runs its own in Docker.
- **k3s clusters:** Grafana's k8s-monitoring chart (`../../infrastructure/controllers/k8s-monitoring.yaml`) runs Alloy,
  kube-state-metrics and node-exporter in each cluster and pushes metrics, pod logs and
  Kubernetes events here, labelled `cluster="prod"`/`"dev"`.
- **Everything else:** pve-exporter (Proxmox API) and blackbox probes, run from this VM.

## What it alerts on

Rules are in `roles/monitoring/files/rules/`. Each alert sends one email when it starts firing,
repeats every 4 hours while it lasts (once a day for `env: dev` targets), and sends one more when
it clears.

- **Proxmox:** node down, a VM with *Start at boot* stopped, storage over 85% or unavailable
  (including the TrueNAS NFS share).
- **Hosts:** pve, TrueNAS, every k3s node, alpine-postgres and devbox stop answering
  ping. While a host is unreachable, alerts about its services are muted.
- **Machines** (Proxmox host, VMs, k3s nodes): a disk over 85% full or on course to fill
  within a day, under 10% memory free, CPU over 90% for 30 minutes, an OOM kill, a failed
  systemd unit.
- **Kubernetes:** a cluster stops reporting, a node is NotReady, a pod is crash looping or
  can't pull its image, a pod isn't running for 15 minutes, a deployment is short of replicas,
  a job failed, a volume is over 85% full. The alert email names the cluster and pod, and
  includes the `kubectl logs` command to look at it.
- **Services:** Proxmox UI, TrueNAS NFS, both k3s API VIPs, PostgreSQL stop accepting
  connections.
- **Websites:** EasyCabinets and Workbench aren't returning 2xx over HTTPS, or their certificate
  expires within 14 days.
- **The pipeline itself:** Prometheus can't scrape a target, or Alertmanager can't send email.

To watch something else, add it to the target lists in `group_vars/monitoring/main.yml` and
re-run the playbook.

### Dead man's switch

If the Proxmox host dies, this VM dies with it, and nothing is left to send the email. The
always-firing `Watchdog` alert covers that: Alertmanager forwards it to
[Healthchecks.io](https://healthchecks.io) every minute, and Healthchecks.io emails you when the
pings stop. It's optional; until the 1Password item below exists, `Watchdog` goes nowhere.

## One-time setup

Create these in the 1Password **homelab** vault (titles and field labels must match exactly):

| Item | Field | Value |
| ---- | ----- | ----- |
| `alertmanager-smtp` | `password` | A Gmail [app password](https://myaccount.google.com/apppasswords) for jesse1517@gmail.com (needs 2-Step Verification on). Paste it without spaces |
| `grafana` | `admin-password` | `openssl rand -base64 24` |
| `proxmox-monitoring` | `token-secret` | The secret printed by the `pveum` commands below |
| `healthchecks` | `watchdog-url` | Optional. A Healthchecks.io check's ping URL; set the check's period to 1 minute and grace to 5 minutes |

A read-only Proxmox user and API token for pve-exporter, on the Proxmox host (as root):

```bash
pveum user add monitoring@pve --comment "Prometheus pve-exporter (read-only)"
pveum acl modify / --users monitoring@pve --roles PVEAuditor
pveum user token add monitoring@pve exporter --privsep 0   # prints the secret once
```

## Deploy

```bash
ansible-galaxy collection install -r requirements.yml
cd ../../terraform && ./tf apply      # creates the VM
cd ../ansible/monitoring && ansible-playbook site.yml
ansible-playbook node-exporter.yml       # node_exporter on the Proxmox host and VMs
```

Flux installs Alloy on the k3s clusters (`../../infrastructure/controllers`).

`site.yml` waits for cloud-init, installs Docker, writes the config under `/srv/monitoring`, puts
the secrets in `/srv/monitoring/secrets` (root only), downloads the dashboards and starts the
stack. Re-running is safe: changed config reloads or restarts only the service it belongs to.

To watch a new VM's CPU, memory and disk, add it to `[node_exporter]` in `inventory/hosts.ini`
and to `monitoring_node_targets` in `group_vars/monitoring/main.yml`, then run both playbooks.

**Test an email** once it's up (it fires, then resolves after 5 minutes):

```bash
ssh ubuntu@192.168.1.60 sudo docker exec alertmanager amtool alert add TestAlert \
  severity=warning instance=test --annotation=summary="Test alert from the homelab" \
  --alertmanager.url=http://localhost:9093
```

## Dashboards

The playbook sets up Grafana's data sources and these dashboards (Dashboards in the menu):

| Folder | Dashboard | Shows |
| ------ | --------- | ----- |
| Homelab | **Homelab overview** | Start here. Firing alerts, up/down for every host, service and website, certificate expiry, VM status, CPU/memory/disk for every machine, Proxmox storage, k3s nodes and recent container restarts |
| Homelab | **Kubernetes logs** | Search pod logs by cluster, namespace, pod and text, plus Kubernetes events |
| Machines | Node Exporter Full | Everything about one machine (pick it under *Host*) |
| Machines | Proxmox via Prometheus | Proxmox node, VM and storage usage |
| Kubernetes | Views / Global, Namespaces, Nodes, Pods | Cluster resource usage, down to one pod |

The two Homelab dashboards are generated JSON in `roles/monitoring/files/dashboards/`; the rest
are downloaded from grafana.com at the revisions pinned in `roles/monitoring/defaults/main.yml`.
Dashboards can be edited in Grafana, but a playbook re-run that changes the file overwrites the
edits, so use *Save as* for a copy you want to keep. For ad-hoc log searches (including
across clusters), use Explore or *Drilldown > Logs*.

## Operate

```bash
ssh ubuntu@192.168.1.60
cd /srv/monitoring
sudo docker compose ps                   # status of every service
sudo docker compose logs -f alertmanager # e.g. email delivery errors
```

Image versions are pinned in `roles/monitoring/defaults/main.yml`. To upgrade, change the tag and
re-run the playbook. Data lives in `/srv/monitoring/data`: 30 days (capped at 35 GB) of metrics and
14 days of logs.

## Not done yet

- `postgres_exporter` for PostgreSQL internals (connections, database sizes, slow queries).
- Logs from the VMs themselves (journald); only the k3s clusters send logs today.
- SMART/NVMe disk health for the Proxmox host. Debian 12's NVMe collector doesn't work with the
  installed nvme-cli, so the drive's wear and health aren't tracked.
