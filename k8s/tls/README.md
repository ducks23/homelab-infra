# tls

Trusted HTTPS (Let's Encrypt) for everything in the lab, without exposing
anything to the internet. Certificates are validated with DNS-01 on Cloudflare,
which hosts `naboo.party`.

| Name                     | Points at                      | Certificate from                    |
| ------------------------ | ------------------------------ | ----------------------------------- |
| `home.naboo.party`       | UniFi gateway `192.168.1.1`    | UniFi itself (already set up)       |
| `pve.naboo.party`        | Proxmox `192.168.1.146`        | Proxmox's built-in ACME client      |
| `*.prod.naboo.party`     | prod Traefik VIP `192.168.1.10`| cert-manager, this directory        |
| `*.dev.naboo.party`      | dev Traefik VIP `192.168.1.20` | cert-manager, this directory        |

Proxmox gets its cert on its own rather than through Traefik. The clusters run
on Proxmox, so it has to stay reachable when they are broken.

In the clusters, cert-manager issues one wildcard cert per cluster into
`kube-system/wildcard-tls`, and a Traefik `TLSStore` makes it the default
certificate. An Ingress only needs the annotation
`traefik.ingress.kubernetes.io/router.tls: "true"` and a host under its cluster's
wildcard. A `HelmChartConfig` also redirects all HTTP to HTTPS.

## Setup

### 1. Cloudflare DNS records

In the Cloudflare dashboard for `naboo.party`, under DNS > Records, add these as
**DNS only** (grey cloud):

| Type | Name     | IPv4 address    |
| ---- | -------- | --------------- |
| A    | `pve`    | `192.168.1.146` |
| A    | `*.prod` | `192.168.1.10`  |
| A    | `*.dev`  | `192.168.1.20`  |

Check with `dig +short pve.naboo.party` and `dig +short anything.prod.naboo.party`.

### 2. Cloudflare API tokens

Create three tokens at My Profile > API Tokens > Create Token > "Edit zone DNS",
each with **Zone / DNS / Edit** and Zone Resources set to **Specific zone:
naboo.party**. Name them `proxmox`, `k3s-prod` and `k3s-dev`, so revoking one
never breaks the others (or UniFi's).

The cluster token lives in 1Password (item `cloudflare-cert-manager`, field `api-token`
in the homelab vault; see ../../README.md). Once cert-manager is installed (step 3), put it
in each cluster:

```bash
./cloudflare-secret.sh dev
./cloudflare-secret.sh prod
```

### 3. Install cert-manager (each cluster)

```bash
for ctx in prod dev; do
  kubectl --context $ctx apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml
  kubectl --context $ctx -n cert-manager rollout status deploy/cert-manager-webhook
done
```

### 4. Issue the wildcard certs, staging first

The Certificate starts on the `letsencrypt-staging` issuer, which has generous
rate limits. Production locks you out for a while after repeated failures.

```bash
kubectl --context dev  apply -k overlays/dev
kubectl --context prod apply -k overlays/prod

kubectl --context dev -n kube-system get certificate wildcard -w    # wait for READY=True, ~1-2 min
```

If it stays `False`, look at `kubectl --context dev -n kube-system describe
certificate wildcard`, then `kubectl --context dev get challenges -A` and
`describe` the challenge. It is usually the token's permissions or zone.

Once staging works on both clusters, switch to the real issuer: in
`base/certificate.yaml` change `name: letsencrypt-staging` to
`name: letsencrypt`, re-apply both overlays, and force a reissue:

```bash
for ctx in prod dev; do
  kubectl --context $ctx apply -k overlays/$ctx
  kubectl --context $ctx -n kube-system delete secret wildcard-tls
done
```

### 5. Move the apps onto the new hostnames

```bash
cd ../../go-api && make deploy && make deploy-prod
curl -I https://go-api.dev.naboo.party/     # expect no certificate error
```

The old `*.nip.io` URLs stop working after this step.

### 6. Proxmox

On the Proxmox host (`ssh root@192.168.1.146`), using the `proxmox` token:

```bash
pvenode acme account register default <your email> \
  --directory https://acme-v02.api.letsencrypt.org/directory   # answer y to the ToS
printf 'CF_Token=%s\nCF_Zone_ID=%s\n' '<token>' '<zone id>' > /root/cf.env   # zone id: Cloudflare zone Overview page
pvenode acme plugin add dns cloudflare --api cf --data /root/cf.env
rm /root/cf.env
pvenode config set --acmedomain0 pve.naboo.party,plugin=cloudflare
pvenode acme cert order
```

The web UI restarts with the new cert. Open <https://pve.naboo.party:8006>.
Proxmox renews it automatically. The same steps are in the UI under
Datacenter > ACME and then the node's System > Certificates.

To reach it at plain `https://pve.naboo.party` (no `:8006`), redirect 443 to
8006 on the host. Add under `iface vmbr0` in `/etc/network/interfaces` (the
`-d` keeps it from catching HTTPS bridged to VMs, like the k3s VIPs), then run
the post-up command once by hand to apply it without a reboot:

```
	post-up iptables -t nat -A PREROUTING -i vmbr0 -d 192.168.1.146/32 -p tcp --dport 443 -j REDIRECT --to-ports 8006
	post-down iptables -t nat -D PREROUTING -i vmbr0 -d 192.168.1.146/32 -p tcp --dport 443 -j REDIRECT --to-ports 8006 || true
```

Then make Terraform use the hostname and verify the cert. In
`../../proxmox/terraform.tfvars`:

```hcl
proxmox_endpoint = "https://pve.naboo.party:8006/"
proxmox_insecure = false
```

and check with `terraform plan`, which should show no changes.

## Renewal

All certs are 90-day Let's Encrypt certs, renewed automatically by
cert-manager, Proxmox and UniFi. See when the cluster certs expire with
`kubectl --context prod -n kube-system get certificate wildcard -o wide`.
