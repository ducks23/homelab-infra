# minecraft (Ansible)

Minecraft Java Edition server ([Paper](https://papermc.io)) on the Ubuntu VM defined in
`../proxmox/minecraft.tf` (`minecraft`, 192.168.1.40, 4 vCPU / 8 GB). It runs in Docker using the
[itzg/minecraft-server](https://docker-minecraft-server.readthedocs.io) image, which downloads the
server jar, applies the settings below and restarts the server if it crashes.

Join at **`mc.naboo.party`** (Cloudflare A record to 192.168.1.40, DNS only) from the home network.
Nothing is port-forwarded.

Friends elsewhere join over [Tailscale](https://tailscale.com): the VM is a Tailscale node
(`minecraft`, `minecraft.taile83a2d.ts.net`, 100.104.59.8). It shares only itself, not the LAN.

- **Log the VM in (one time):** after the playbook installs Tailscale, run
  `sudo tailscale up --hostname=minecraft` on the VM and open the URL it prints. Then in the admin
  console, disable key expiry for `minecraft` so it doesn't drop off after 180 days.
- **Add a friend:** admin console > Machines > `minecraft` > Share, and send them the link. They
  install Tailscale, accept, and join `minecraft.taile83a2d.ts.net` in Minecraft.

Running the playbook accepts the [Minecraft EULA](https://www.minecraft.net/en-us/eula) on
your behalf (`EULA=TRUE`).

## Deploy

```bash
cd ../proxmox && terraform apply     # creates the VM
cd ../minecraft && ansible-playbook site.yml
```

`site.yml` waits for cloud-init, installs Docker from Ubuntu's repos, writes
`/srv/minecraft/compose.yaml` and starts the container. World data lives in
`/srv/minecraft/data` on the VM. Re-running is safe: the container is recreated only when the
settings changed.

## Configuration

Edit `group_vars/minecraft_server/main.yml` (MOTD, difficulty, whitelist, ops) and re-run the
playbook. Every other option (server type, game version, memory, view distance) and its default
is in `roles/minecraft/defaults/main.yml`.

While `minecraft_whitelist` is empty, anyone who can reach the server can join. Add usernames to
lock it down to just those players.

## Operate

```bash
ssh ubuntu@192.168.1.40
sudo docker logs -f minecraft            # server log
sudo docker exec minecraft rcon-cli      # admin console (e.g. "list", "op <name>", "save-all")
sudo docker compose -f /srv/minecraft/compose.yaml pull && \
  sudo docker compose -f /srv/minecraft/compose.yaml up -d   # update the image
```

The game version is pinned (`minecraft_version` in `group_vars/minecraft_server/main.yml`,
currently 26.2). Players need that exact version to join. To upgrade, change it and re-run the
playbook; the existing world is converted on first start, so back it up first.

## Backups

The world is only in `/srv/minecraft/data`. The simplest backup is a scheduled Proxmox backup of
VM 401 (Datacenter > Backup).
