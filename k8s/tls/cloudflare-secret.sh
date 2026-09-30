#!/bin/sh
# Puts cert-manager's Cloudflare API token (for DNS-01 challenges) into a cluster, from
# 1Password. The ClusterIssuers read secret cloudflare-api-token, key api-token.
# Usage: k8s/tls/cloudflare-secret.sh dev|prod
set -eu
ctx=${1:?usage: $0 dev|prod}
token=$(op read op://homelab/cloudflare-cert-manager/api-token)
[ -n "$token" ] || { echo "empty token" >&2; exit 1; }
printf %s "$token" | kubectl --context "$ctx" -n cert-manager create secret generic cloudflare-api-token \
  --from-file=api-token=/dev/stdin --dry-run=client -o yaml | kubectl --context "$ctx" apply -f -
