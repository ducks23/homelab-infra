# monitoring (Ansible)

Metrics, logs and email alerts for the homelab, on the Ubuntu VM defined in
`../proxmox/monitoring.tf` (`monitoring`, 192.168.1.60, 2 vCPU / 4 GB / 60 GB). Everything runs in
Docker Compose:

| Service | Port | What it does |
| ------- | ---- | ------------ |
| Grafana | [3000](http://192.168.1.60:3000) | Dashboards and log search. Sign in as `admin` |
| Prometheus | [9090](http://192.168.1.60:9090) | Metrics database; evaluates the alert rules. Also accepts remote-write (for Alloy on the clusters) |
| Alertmanager | [9093](http://192.168.1.60:9093) | Groups alerts and emails them to jesse1517@gmail.com through Gmail |
| Loki | 3100 | Log database (for Alloy on the clusters; nothing sends logs yet) |
| blackbox exporter | | Pings hosts, checks TCP ports and HTTPS sites for Prometheus |
| pve-exporter | | Reads node, VM and storage status from the Proxmox API |
| node-exporter | 9100 | CPU, memory and disk of this VM |

It runs on its own VM, outside the k3s clusters, so it still alerts when a cluster is down.
Nothing has a login except Grafana, so keep these ports on the LAN.

## What it alerts on

Rules are in `roles/monitoring/files/rules/`. Each alert sends one email when it starts firing,
repeats every 4 hours while it lasts (once a day for `env: dev` targets), and sends one more when
it clears.

- **Proxmox:** node down, a VM with *Start at boot* stopped, storage over 85% or unavailable
  (including the TrueNAS NFS share).
- **Hosts:** pve, TrueNAS, every k3s node, alpine-postgres, minecraft and devbox stop answering
  ping. While a host is unreachable, alerts about its services are muted.
- **Services:** Proxmox UI, TrueNAS NFS, both k3s API VIPs, PostgreSQL, Minecraft stop accepting
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
cd ../proxmox && ./tf apply              # creates the VM
cd ../monitoring && ansible-playbook site.yml
```

`site.yml` waits for cloud-init, installs Docker, writes the config under `/srv/monitoring`, puts
the secrets in `/srv/monitoring/secrets` (root only) and starts the stack. Re-running is safe:
changed config reloads or restarts only the service it belongs to.

**Test an email** once it's up (it fires, then resolves after 5 minutes):

```bash
ssh ubuntu@192.168.1.60 sudo docker exec alertmanager amtool alert add TestAlert \
  severity=warning instance=test --annotation=summary="Test alert from the homelab" \
  --alertmanager.url=http://localhost:9093
```

## Dashboards

Grafana comes with the Prometheus, Loki and Alertmanager data sources already set up. Import
these from grafana.com (Dashboards > New > Import, enter the ID, pick *Prometheus*):

- **10347** Proxmox via Prometheus
- **1860** Node Exporter Full
- **7587** Prometheus Blackbox Exporter

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

- `node_exporter` on the other VMs and the Proxmox host (add them to `monitoring_node_targets`).
- Grafana Alloy on the k3s clusters, sending cluster metrics and pod logs here.
- `postgres_exporter` for PostgreSQL internals.
