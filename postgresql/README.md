# postgresql (Ansible)

Provisions PostgreSQL 18 on the Alpine Linux VM defined in `../proxmox/alpine-postgres.tf`
(`alpine-postgres`, 192.168.1.30). Separate from `../k3s-cluster`; nothing is shared.

## 1. Create the VM

```bash
cd ../proxmox
terraform apply        # adds the Alpine cloud image download + the alpine-postgres VM
```

The VM boots from Alpine's official cloud-init image (checksum-verified). cloud-init sets the
static IP and installs your SSH key for the `alpine` user (passwordless `doas`).

## 2. Provision PostgreSQL

```bash
ansible-galaxy collection install -r requirements.yml

cp group_vars/postgres/vault.yml.example group_vars/postgres/vault.yml
$EDITOR group_vars/postgres/vault.yml          # set a real password (openssl rand -base64 24)
ansible-vault encrypt group_vars/postgres/vault.yml   # recommended; then add --ask-vault-pass below

ansible-playbook site.yml
```

`site.yml` does two things:

1. **Bootstrap**: waits for SSH, writes `/etc/resolv.conf` (Alpine's image has no `openresolv`, so
   cloud-init's DNS setting never becomes a resolver and `apk` can't resolve names), then installs
   `python3` with `raw` if it's missing.
2. **`postgresql` role**: installs `postgresql18` + client/contrib/openrc + `py3-psycopg2`, runs
   `rc-service postgresql setup` (initdb), writes config, enables and starts the OpenRC service,
   then creates the roles and databases you list.

Re-running is safe; every step is idempotent.

## Configuration

- `group_vars/postgres/main.yml`: which roles/databases to create and who may connect.
- `roles/postgresql/defaults/main.yml`: every knob and its default (version, memory settings,
  extra `postgresql.conf` settings, `pg_hba` rules).
- Config lands in `/etc/postgresql`: our settings go in `conf.d/10-ansible.conf`, and
  `pg_hba.conf` is fully managed (local `postgres` = peer, everything else scram-sha-256).

## Connect

```bash
psql -h 192.168.1.30 -U app app             # dev
psql -h 192.168.1.30 -U app_prod app_prod   # prod
```

Dev and prod use separate roles and databases. `pg_hba.conf` only lets each role
connect to its own database, so the dev credentials can't reach prod data.

## Notes

- Alpine uses musl, which has no locale support, so text sorting behaves like the `C` locale.
  The `initdb` defaults use ICU collations to compensate; use those for locale-aware sorting.
- Changing `listen_addresses`, `shared_buffers` or `max_connections` restarts PostgreSQL; `pg_hba`
  changes only reload it.
- Upgrading to a new major version is not automatic (Alpine's `postgresql-common` doesn't run
  `pg_upgrade` for you). Changing `postgresql_version` would initialise an empty new cluster.
- No backups are configured. Data lives on the VM's 20 GB disk; add `pg_dump` or Proxmox
  backups before storing anything you can't rebuild.
