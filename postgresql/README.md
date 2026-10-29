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

# Passwords come from 1Password (group_vars/postgres/secrets.yml): items postgres-easycabinets,
# postgres-workbench and postgres-patchwork in the homelab vault. See ../README.md.

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
psql -h 192.168.1.30 -U easycabinets easycabinets
psql -h 192.168.1.30 -U workbench workbench
```

Each app has its own role and database. `pg_hba.conf` only lets each role
connect to its own database.

## Notes

- Alpine uses musl, which has no locale support, so text sorting behaves like the `C` locale.
  The `initdb` defaults use ICU collations to compensate; use those for locale-aware sorting.
- Changing `listen_addresses`, `shared_buffers` or `max_connections` restarts PostgreSQL; `pg_hba`
  changes only reload it.
- Upgrading to a new major version is not automatic (Alpine's `postgresql-common` doesn't run
  `pg_upgrade` for you). Changing `postgresql_version` would initialise an empty new cluster.
- Backups: see below.

## Backups

The `postgresql_backup` role runs `/usr/local/bin/pg-backup` from cron every night at
09:30 UTC (02:30 Pacific). It writes one `pg_dump -Fc` per database plus `globals.sql`
(roles and their password hashes) to `<YYYY-MM-DD>/` on a TrueNAS NFS share mounted at
`/mnt/pg-backups`, and keeps 14 days (`roles/postgresql_backup/defaults/main.yml`). If the
share isn't mounted it fails instead of filling the VM's disk. Results go to syslog:
`grep pg-backup /var/log/messages`.

**One-time TrueNAS setup** (before running the playbook):

1. Datasets > `main` > Add Dataset: name `pg-backups`, defaults otherwise.
2. Shares > NFS > Add: path `/mnt/main/pg-backups`, Hosts `192.168.1.30`, and under
   Advanced, Maproot User = `root`, Maproot Group = `root` (the script writes as root).
3. Optional: Data Protection > Periodic Snapshot Task on `main/pg-backups` for history
   beyond 14 days.

It's a separate dataset from the Proxmox share so this VM can't reach the VM images.

Run a backup now: `ssh alpine@192.168.1.30 doas pg-backup`

Restore one database (drops and recreates its objects):

```bash
doas su postgres -s /bin/sh -c \
  'pg_restore --clean --if-exists -d easycabinets /mnt/pg-backups/2026-10-01/easycabinets.dump'
```

On a fresh server, load `globals.sql` with `psql -f` first so the owning roles exist.
