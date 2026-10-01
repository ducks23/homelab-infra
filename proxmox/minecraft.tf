# Ubuntu VM that runs a Minecraft Java server in Docker (provisioned afterwards by ../minecraft,
# Ansible). Kept off the k3s clusters: Minecraft is a single stateful process that gains nothing
# from them, and a VM is easy to back up and snapshot whole.
#
# Static IP 192.168.1.40 (DHCP is 192.168.1.100-254, so 10-99 is ours to assign statically;
# .10-.13, .20-.23 and .30 are already taken). Reuses the Ubuntu cloud image from k3s-clusters.tf.

locals {
  minecraft_vm = {
    name        = "minecraft"
    vm_id       = 401
    ip          = "192.168.1.40"
    mac_address = "BC:24:11:A0:04:01"
    cpu_cores   = 4
    memory_mb   = 8192
    disk_gb     = 40
  }
}

resource "proxmox_virtual_environment_vm" "minecraft" {
  name        = local.minecraft_vm.name
  description = "Minecraft Java server (Docker). Managed by Terraform; configured by Ansible (../minecraft)."
  tags        = ["minecraft", "terraform"]
  node_name   = var.node_name
  vm_id       = local.minecraft_vm.vm_id

  machine       = "pc"
  scsi_hardware = "virtio-scsi-single"
  on_boot       = true

  cpu {
    cores = local.minecraft_vm.cpu_cores
    # Minecraft's main loop is single-threaded, so expose the host CPU's full instruction set.
    # Fine on a single Proxmox node (no live migration to worry about).
    type = "host"
  }

  memory {
    dedicated = local.minecraft_vm.memory_mb
  }

  disk {
    datastore_id = var.vm_datastore_id
    file_id      = proxmox_download_file.ubuntu_noble_cloudimg.id
    interface    = "scsi0"
    size         = local.minecraft_vm.disk_gb
    iothread     = true
    discard      = "on"
  }

  network_device {
    bridge      = var.network_bridge
    mac_address = local.minecraft_vm.mac_address
  }

  initialization {
    datastore_id = var.vm_datastore_id

    user_account {
      username = "ubuntu"
      keys     = [trimspace(file(pathexpand(var.ssh_public_key_path)))]
    }

    ip_config {
      ipv4 {
        address = "${local.minecraft_vm.ip}/${var.network_prefix_length}"
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
    # The image only seeds a new VM's disk. A newer image must not rebuild the server.
    ignore_changes = [disk[0].file_id]

    # Keep the static IP inside the range reserved for it (DHCP starts at .100).
    precondition {
      condition     = tonumber(split(".", local.minecraft_vm.ip)[3]) >= 10 && tonumber(split(".", local.minecraft_vm.ip)[3]) <= 99
      error_message = "${local.minecraft_vm.name}: ${local.minecraft_vm.ip} is outside the static range 192.168.1.10-99."
    }
  }
}
