# k3s-cluster (Ansible)

Deploys two independent, highly-available k3s Kubernetes clusters, **prod** and
**dev**, on the Ubuntu VMs defined in `../proxmox/k3s-clusters.tf`. Each cluster
has 3 k3s **server** nodes with embedded etcd (survives any single node going
down), its own join token, and its own floating virtual IP (via
[kube-vip](https://kube-vip.io)) so the API stays reachable at one address.

```
prod   VIP 192.168.1.10   prod-node1 .11 (cluster-init) · prod-node2 .12 · prod-node3 .13
dev    VIP 192.168.1.20   dev-node1  .21 (cluster-init) · dev-node2  .22 · dev-node3  .23
```

## Prerequisites

- The 6 VMs provisioned by Terraform (`cd ../proxmox && terraform apply`),
  reachable over SSH as `ubuntu` with your key installed (cloud-init does this).
- Ansible >= 2.14 on your control machine, plus the collections in
  `requirements.yml`:

  ```bash
  ansible-galaxy collection install -r requirements.yml
  ```

## Configuration

- `inventory/hosts.ini` — hosts grouped as `prod_server`/`dev_server`
  (plus empty `*_agent` groups for optional workers).
- `group_vars/prod/main.yml`, `group_vars/dev/main.yml` — per-cluster `k3s_cluster_name`,
  `k3s_token` and `kube_vip_address`. Generate a new token with
  `openssl rand -hex 32`; for anything beyond a lab, encrypt with
  `ansible-vault encrypt_string`.
- `group_vars/all.yml` — shared settings (k3s channel, disabled components,
  kube-vip version and NIC name `eth0`, firewall).

## Deploy

```bash
ansible-playbook site.yml                # both clusters
ansible-playbook site.yml --limit prod   # just prod
ansible-playbook site.yml --limit dev    # just dev
```

Per cluster this will, in order:

1. Prep the nodes (`k3s_common`): swap off, kernel modules, sysctls, ufw rules.
2. Install k3s on node1 with `--cluster-init`, then join node2 and node3.
3. Deploy kube-vip so the API is reachable at `<VIP>:6443`.
4. Fetch a kubeconfig to `fetched/kubeconfig-<cluster>.yaml`, pointed at the
   VIP, with the context/cluster/user renamed from `default` to the cluster
   name so the two files merge cleanly.

## Use the clusters

```bash
export KUBECONFIG=$(pwd)/fetched/kubeconfig-prod.yaml
kubectl get nodes -o wide

# or both at once, switching with contexts:
export KUBECONFIG=$(pwd)/fetched/kubeconfig-prod.yaml:$(pwd)/fetched/kubeconfig-dev.yaml
kubectl config use-context dev
```

## Adding worker-only nodes later

Add hosts under `[prod_agent]` or `[dev_agent]` in `inventory/hosts.ini` and re-run
`ansible-playbook site.yml --limit <cluster>` — only the new hosts will be touched (existing
nodes' install tasks are idempotent via `creates:` guards).

## Tearing it down

```bash
ansible-playbook playbooks/reset.yml
```

Runs the official `k3s-uninstall.sh` / `k3s-agent-uninstall.sh` scripts on
every node. Destructive. Add `--limit prod` or `--limit dev` to reset only one cluster.

## Notes / troubleshooting

- Logs: `journalctl -u k3s -f` (server nodes) or `journalctl -u k3s-agent -f`
  (agent nodes).
- If nodes never go `Ready`, check that ports 6443/tcp, 2379-2380/tcp,
  8472/udp and 10250/tcp are open between all nodes of a cluster (see
  `roles/k3s_common/tasks/main.yml` for the full list the playbook opens
  automatically when ufw is active).
- kube-vip uses ARP/Layer 2 mode, which is the simplest option for a flat
  home LAN. It requires all nodes to be on the same L2 segment as the VIP.
- Re-running `site.yml` is safe — the k3s install tasks use `creates:` so
  they won't reinstall on nodes that already have it.
