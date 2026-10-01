# Ubuntu dev box, reached remotely over Tailscale (installed on the VM itself, not managed here).
# A plain general-purpose machine: no Ansible role, set up by hand.
#
# Static IP 192.168.1.50 (DHCP is 192.168.1.100-254, so 10-99 is ours to assign statically;
# .10-.13, .20-.23, .30 and .40 are already taken). Reuses the Ubuntu cloud image from k3s-clusters.tf.

locals {
  devbox_vm = {
    name        = "devbox"
    vm_id       = 501
    ip          = "192.168.1.50"
    mac_address = "BC:24:11:A0:05:01"
    cpu_cores   = 4
    memory_mb   = 8192
    disk_gb     = 64
  }
}

resource "proxmox_virtual_environment_vm" "devbox" {
  name        = local.devbox_vm.name
  description = "Ubuntu dev box, accessed over Tailscale. Managed by Terraform."
  tags        = ["dev", "terraform"]
  node_name   = var.node_name
  vm_id       = local.devbox_vm.vm_id

  machine       = "pc"
  scsi_hardware = "virtio-scsi-single"
  on_boot       = true

  cpu {
    cores = local.devbox_vm.cpu_cores
    type  = "host"
  }

  memory {
    dedicated = local.devbox_vm.memory_mb
  }

  disk {
    datastore_id = var.vm_datastore_id
    file_id      = proxmox_download_file.ubuntu_noble_cloudimg.id
    interface    = "scsi0"
    size         = local.devbox_vm.disk_gb
    iothread     = true
    discard      = "on"
  }

  network_device {
    bridge      = var.network_bridge
    mac_address = local.devbox_vm.mac_address
  }

  initialization {
    datastore_id = var.vm_datastore_id

    user_account {
      username = "ubuntu"
      keys     = [trimspace(file(pathexpand(var.ssh_public_key_path)))]
    }

    ip_config {
      ipv4 {
        address = "${local.devbox_vm.ip}/${var.network_prefix_length}"
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
    # The image only seeds a new VM's disk. A newer image must not rebuild the box.
    ignore_changes = [disk[0].file_id]

    # Keep the static IP inside the range reserved for it (DHCP starts at .100).
    precondition {
      condition     = tonumber(split(".", local.devbox_vm.ip)[3]) >= 10 && tonumber(split(".", local.devbox_vm.ip)[3]) <= 99
      error_message = "${local.devbox_vm.name}: ${local.devbox_vm.ip} is outside the static range 192.168.1.10-99."
    }
  }
}
