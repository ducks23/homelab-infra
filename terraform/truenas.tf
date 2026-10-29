# TrueNAS NFS share as Proxmox storage.
#
# The share is the "proxmox" dataset on TrueNAS (192.168.1.218), exported over NFS to the
# Proxmox host only, with Maproot User/Group = root (Proxmox writes as root; without maproot
# every write fails with "Permission denied").
#
# Disks on NFS are slower than local-lvm (writes especially, since TrueNAS makes NFS writes
# synchronous), so this is meant for backups and bulk data, not VM disks.

locals {
  truenas = {
    server = "192.168.1.218"
    export = "/mnt/main/proxmox"
  }
}

# Created by hand first (pvesm add nfs truenas ...); this adopts it into state.
import {
  to = proxmox_storage_nfs.truenas
  id = "truenas"
}

resource "proxmox_storage_nfs" "truenas" {
  id      = "truenas"
  server  = local.truenas.server
  export  = local.truenas.export
  content = ["images", "backup"]
  options = "vers=4.2"
}
