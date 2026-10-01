#!/bin/sh
# Installs (or updates) k8s-monitoring in a cluster, labelled with the cluster's name.
# k3s' Helm controller does the install; follow it with
#   kubectl --context <ctx> -n kube-system logs -f job/helm-install-k8s-monitoring
# Usage: k8s/monitoring/deploy.sh dev|prod
set -eu
ctx=${1:?usage: $0 dev|prod}
case $ctx in dev|prod) ;; *) echo "usage: $0 dev|prod" >&2; exit 1 ;; esac
sed "s/CLUSTER/$ctx/g" "$(dirname "$0")/k8s-monitoring.yaml" | kubectl --context "$ctx" apply -f -
