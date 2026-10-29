# infrastructure/controllers

The controllers both clusters run, installed by Flux as Helm charts:

| File | What it is |
| ---- | ---------- |
| `cert-manager.yaml` | Let's Encrypt certificates, see `../configs/tls` |
| `external-secrets.yaml` | Copies secrets from 1Password into the clusters, see `../configs/onepassword-store.yaml` |
| `k8s-monitoring.yaml` | Metrics and logs to the monitoring VM, below |

To upgrade one, change its chart `version:` and push.

## k8s-monitoring

Grafana's [k8s-monitoring](https://github.com/grafana/k8s-monitoring-helm) chart, one copy per
k3s cluster. It runs [Alloy](https://grafana.com/docs/alloy/latest/) collectors plus
kube-state-metrics and node-exporter in the `monitoring` namespace, and pushes to the monitoring
VM (`../../monitoring`, 192.168.1.60):

- **Metrics** to Prometheus (remote-write): node CPU/memory/disk, pod and container usage,
  Kubernetes object state (deployments, pods, jobs, volumes).
- **Pod logs** and **Kubernetes events** to Loki.

Every series and log stream carries `cluster` and `env` labels (`dev` or `prod`). The alert rules
and dashboards that use them are in `../../monitoring`. Flux fills in the cluster name
(`${cluster}`) from `../../clusters/<env>/infrastructure.yaml`.

### Checking it

```bash
kubectl --context dev -n monitoring get pods
```

In Grafana, the *Homelab overview* dashboard's Kubernetes row should list all three nodes of
each cluster as ready. If a cluster stops sending for 5 minutes, the `ClusterNotReporting`
alert fires.
