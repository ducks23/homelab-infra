#!/bin/sh
# Installs Flux in a cluster and points it at clusters/<env> in this repo. Run once
# per cluster; after that, everything in the cluster comes from git.
#
# Two things can't come from git, so this puts them in first, from 1Password:
#   - the 1Password service account token External Secrets reads every other secret with
#   - a GitHub token for flux bootstrap, which uses it to add a deploy key to the repo
#
# Usage: scripts/flux-bootstrap.sh dev|prod [branch]
#   branch defaults to main; bootstrap dev from a feature branch to try changes there first.
set -eu
ctx=${1:?usage: $0 dev|prod [branch]}
case $ctx in dev|prod) ;; *) echo "usage: $0 dev|prod [branch]" >&2; exit 1 ;; esac
branch=${2:-main}
kubectl="kubectl --context $ctx"

token=$(op read op://homelab/external-secrets/token)
[ -n "$token" ] || { echo "empty 1Password service account token" >&2; exit 1; }
$kubectl create namespace external-secrets --dry-run=client -o yaml | $kubectl apply -f -
printf %s "$token" | $kubectl -n external-secrets create secret generic onepassword-sa-token \
  --from-file=token=/dev/stdin --dry-run=client -o yaml | $kubectl apply -f -

# --read-write-key: the image automation pushes tag bumps back to the repo.
GITHUB_TOKEN=$(op read op://homelab/flux-github/token) flux bootstrap github \
  --context="$ctx" \
  --owner=ducks23 \
  --repository=homelab-infra \
  --personal \
  --branch="$branch" \
  --path="clusters/$ctx" \
  --read-write-key \
  --components-extra=image-reflector-controller,image-automation-controller
