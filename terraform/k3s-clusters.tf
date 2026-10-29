# Two k3s clusters (prod, dev), three Ubuntu 24.04 nodes each, cloned from the official cloud image.
#
# IP plan (DHCP is 192.168.1.100-254, so 10-99 is ours to assign statically):
#   prod  VIP .10   nodes .11 .12 .13
#   dev   VIP .20   nodes .21 .22 .23
# The VIPs are for kube-vip; they aren't assigned to any VM here.

locals {
  clusters = {
    prod = {
      cpu_cores = 4
      memory_mb = 8192
      disk_gb   = 64
      vip       = "192.168.1.10"
      nodes = {
        "prod-node1" = { vm_id = 201, ip = "192.168.1.11", mac_address = "BC:24:11:A0:00:01" }
        "prod-node2" = { vm_id = 202, ip = "192.168.1.12", mac_address = "BC:24:11:A0:00:02" }
        "prod-node3" = { vm_id = 203, ip = "192.168.1.13", mac_address = "BC:24:11:A0:00:03" }
      }
    }
    dev = {
      cpu_cores = 2
      memory_mb = 4096
      disk_gb   = 32
      vip       = "192.168.1.20"
      nodes = {
        "dev-node1" = { vm_id = 211, ip = "192.168.1.21", mac_address = "BC:24:11:A0:01:01" }
        "dev-node2" = { vm_id = 212, ip = "192.168.1.22", mac_address = "BC:24:11:A0:01:02" }
        "dev-node3" = { vm_id = 213, ip = "192.168.1.23", mac_address = "BC:24:11:A0:01:03" }
      }
    }
  }

  # Flatten to one map of nodes, each carrying its cluster's sizing.
  nodes = merge([
    for cluster, cfg in local.clusters : {
      for name, node in cfg.nodes : name => merge(node, {
        cluster   = cluster
        cpu_cores = cfg.cpu_cores
        memory_mb = cfg.memory_mb
        disk_gb   = cfg.disk_gb
      })
    }
  ]...)
}

# Proxmox downloads the image itself; it lands next to your other ISOs.
# "current" is re-published whenever Ubuntu refreshes the image. overwrite = false stops the
# provider from comparing it with the upstream size on every plan; otherwise each refresh
# means a re-download, a new file_id, and every VM built from it being replaced. To take a
# newer image on purpose: terraform apply -replace=proxmox_download_file.ubuntu_noble_cloudimg
# (existing VMs keep their disks; see ignore_changes on the VMs).
resource "proxmox_download_file" "ubuntu_noble_cloudimg" {
  node_name    = var.node_name
  datastore_id = var.iso_datastore_id
  content_type = "iso"
  file_name    = "noble-server-cloudimg-amd64.img"
  url          = "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
  overwrite    = false
}

# Was `prod_node` before the dev cluster was added; keeps the existing prod VMs from being recreated.
moved {
  from = proxmox_virtual_environment_vm.prod_node
  to   = proxmox_virtual_environment_vm.node
}

resource "proxmox_virtual_environment_vm" "node" {
  for_each = local.nodes

  name        = each.key
  description = "${each.value.cluster} k3s node. Managed by Terraform."
  tags        = ["k3s", each.value.cluster, "terraform"]
  node_name   = var.node_name
  vm_id       = each.value.vm_id

  # Same settings as the original node1-3.
  machine       = "pc"
  scsi_hardware = "virtio-scsi-single"
  on_boot       = true

  cpu {
    cores = each.value.cpu_cores
    type  = "x86-64-v2-AES"
  }

  memory {
    dedicated = each.value.memory_mb
  }

  disk {
    datastore_id = var.vm_datastore_id
    file_id      = proxmox_download_file.ubuntu_noble_cloudimg.id
    interface    = "scsi0"
    size         = each.value.disk_gb
    iothread     = true
    discard      = "on"
  }

  network_device {
    bridge      = var.network_bridge
    mac_address = each.value.mac_address
  }

  initialization {
    datastore_id = var.vm_datastore_id

    user_account {
      username = "ubuntu"
      keys     = [trimspace(file(pathexpand(var.ssh_public_key_path)))]
    }

    ip_config {
      ipv4 {
        address = "${each.value.ip}/${var.network_prefix_length}"
        gateway = var.network_gateway
      }
    }

    dns {
      servers = var.dns_servers
    }
  }

  operating_system {
    type = "l26"
  }

  lifecycle {
    # The image only seeds a new VM's disk. A newer image must not rebuild running nodes.
    ignore_changes = [disk[0].file_id]

    # Keep static IPs inside the range reserved for them (DHCP starts at .100).
    precondition {
      condition     = tonumber(split(".", each.value.ip)[3]) >= 10 && tonumber(split(".", each.value.ip)[3]) <= 99
      error_message = "${each.key}: ${each.value.ip} is outside the static range 192.168.1.10-99."
    }
  }
}
