# k8s/monitoring

Grafana's [k8s-monitoring](https://github.com/grafana/k8s-monitoring-helm) chart, one copy per
k3s cluster. It runs [Alloy](https://grafana.com/docs/alloy/latest/) collectors plus
kube-state-metrics and node-exporter in the `monitoring` namespace, and pushes to the monitoring
VM (`../../monitoring`, 192.168.1.60):

- **Metrics** to Prometheus (remote-write): node CPU/memory/disk, pod and container usage,
  Kubernetes object state (deployments, pods, jobs, volumes).
- **Pod logs** and **Kubernetes events** to Loki.

Every series and log stream carries `cluster` and `env` labels (`dev` or `prod`). The alert rules
and dashboards that use them are in `../../monitoring`.

## Deploy

```bash
k8s/monitoring/deploy.sh dev
k8s/monitoring/deploy.sh prod
```

`deploy.sh` fills in the cluster name in `k8s-monitoring.yaml` and applies it as a k3s
`HelmChart`, so k3s' built-in Helm controller installs the chart; no local `helm` is needed.
Watch the install with `kubectl --context dev -n kube-system logs -f job/helm-install-k8s-monitoring`.

To upgrade, change `version:` in `k8s-monitoring.yaml` and re-run `deploy.sh` for both clusters.
To remove it, `kubectl --context dev -n kube-system delete helmchart k8s-monitoring`.

## Checking it

```bash
kubectl --context dev -n monitoring get pods
```

In Grafana, the *Homelab overview* dashboard's Kubernetes row should list all three nodes of
each cluster as ready. If a cluster stops sending for 5 minutes, the `ClusterNotReporting`
alert fires.
