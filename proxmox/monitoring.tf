# Ubuntu VM that runs the monitoring stack (Prometheus, Alertmanager, Grafana, Loki) in Docker
# (provisioned afterwards by ../monitoring, Ansible). Kept off the k3s clusters on purpose: it
# has to keep running, and keep emailing, when a cluster is the thing that's down.
#
# The disk stays on local-lvm, not the TrueNAS NFS share: Prometheus doesn't support its
# database on NFS.
#
# Static IP 192.168.1.60 (DHCP is 192.168.1.100-254, so 10-99 is ours to assign statically;
# .10-.13, .20-.23, .30, .40 and .50 are already taken). Reuses the Ubuntu cloud image from k3s-clusters.tf.

locals {
  monitoring_vm = {
    name        = "monitoring"
    vm_id       = 601
    ip          = "192.168.1.60"
    mac_address = "BC:24:11:A0:06:01"
    cpu_cores   = 2
    memory_mb   = 4096
    disk_gb     = 60
  }
}

resource "proxmox_virtual_environment_vm" "monitoring" {
  name        = local.monitoring_vm.name
  description = "Monitoring stack (Prometheus, Alertmanager, Grafana, Loki). Managed by Terraform; configured by Ansible (../monitoring)."
  tags        = ["monitoring", "terraform"]
  node_name   = var.node_name
  vm_id       = local.monitoring_vm.vm_id

  machine       = "pc"
  scsi_hardware = "virtio-scsi-single"
  on_boot       = true

  cpu {
    cores = local.monitoring_vm.cpu_cores
    type  = "x86-64-v2-AES"
  }

  memory {
    dedicated = local.monitoring_vm.memory_mb
  }

  disk {
    datastore_id = var.vm_datastore_id
    file_id      = proxmox_download_file.ubuntu_noble_cloudimg.id
    interface    = "scsi0"
    size         = local.monitoring_vm.disk_gb
    iothread     = true
    discard      = "on"
  }

  network_device {
    bridge      = var.network_bridge
    mac_address = local.monitoring_vm.mac_address
  }

  initialization {
    datastore_id = var.vm_datastore_id

    user_account {
      username = "ubuntu"
      keys     = [trimspace(file(pathexpand(var.ssh_public_key_path)))]
    }

    ip_config {
      ipv4 {
        address = "${local.monitoring_vm.ip}/${var.network_prefix_length}"
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
      condition     = tonumber(split(".", local.monitoring_vm.ip)[3]) >= 10 && tonumber(split(".", local.monitoring_vm.ip)[3]) <= 99
      error_message = "${local.monitoring_vm.name}: ${local.monitoring_vm.ip} is outside the static range 192.168.1.10-99."
    }
  }
}
