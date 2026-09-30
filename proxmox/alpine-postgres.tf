# Alpine Linux VM that hosts PostgreSQL (provisioned afterwards by ../postgresql, Ansible).
#
# Static IP 192.168.1.30 (DHCP is 192.168.1.100-254, so 10-99 is ours to assign statically;
# .10-.13 and .20-.23 are already taken by the k3s clusters).
#
# Alpine publishes official cloud-init images, so this mirrors the Ubuntu nodes in
# k3s-clusters.tf: Proxmox downloads the image, the VM boots a disk imported from it, and
# cloud-init applies the user, SSH key and static IP.
#   - The default user on Alpine's image is "alpine" (passwordless doas), not "ubuntu".

locals {
  alpine_version = "3.24.1"
  # e.g. "3.24.1" -> "v3.24"
  alpine_release_dir = "v${join(".", slice(split(".", local.alpine_version), 0, 2))}"
  alpine_image       = "generic_alpine-${local.alpine_version}-x86_64-bios-cloudinit-r0.qcow2"

  postgres_vm = {
    name        = "alpine-postgres"
    vm_id       = 301
    ip          = "192.168.1.30"
    mac_address = "BC:24:11:A0:02:01"
    cpu_cores   = 2
    memory_mb   = 2048
    disk_gb     = 20
  }
}

# Proxmox only accepts .iso/.img for the "iso" content type, so the qcow2 is stored as .img
# (the disk import step detects the real format). Same trick as the Ubuntu cloud image.
resource "proxmox_download_file" "alpine_cloudimg" {
  node_name          = var.node_name
  datastore_id       = var.iso_datastore_id
  content_type       = "iso"
  file_name          = "alpine-${local.alpine_version}-x86_64-bios-cloudinit.img"
  url                = "https://dl-cdn.alpinelinux.org/alpine/${local.alpine_release_dir}/releases/cloud/${local.alpine_image}"
  checksum           = "8d756f6fc7653daa4fb4e2e213d8a66007bcb1e5a846e28891af62c47b90685c694486c2746099ad99e9e8f5278db76b69d11dfe1e9361aa4c8406df16929a9c"
  checksum_algorithm = "sha512"
}

resource "proxmox_virtual_environment_vm" "postgres" {
  name        = local.postgres_vm.name
  description = "Alpine Linux PostgreSQL server. Managed by Terraform; configured by Ansible (../postgresql)."
  tags        = ["alpine", "postgres", "terraform"]
  node_name   = var.node_name
  vm_id       = local.postgres_vm.vm_id

  machine       = "pc"
  scsi_hardware = "virtio-scsi-single"
  on_boot       = true

  cpu {
    cores = local.postgres_vm.cpu_cores
    type  = "x86-64-v2-AES"
  }

  memory {
    dedicated = local.postgres_vm.memory_mb
  }

  disk {
    datastore_id = var.vm_datastore_id
    file_id      = proxmox_download_file.alpine_cloudimg.id
    interface    = "scsi0"
    size         = local.postgres_vm.disk_gb
    iothread     = true
    discard      = "on"
  }

  network_device {
    bridge      = var.network_bridge
    mac_address = local.postgres_vm.mac_address
  }

  initialization {
    datastore_id = var.vm_datastore_id

    user_account {
      username = "alpine"
      keys     = [trimspace(file(pathexpand(var.ssh_public_key_path)))]
    }

    ip_config {
      ipv4 {
        address = "${local.postgres_vm.ip}/${var.network_prefix_length}"
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
    # The image only seeds a new VM's disk. Bumping alpine_version must not rebuild the database VM.
    ignore_changes = [disk[0].file_id]

    # Keep the static IP inside the range reserved for it (DHCP starts at .100).
    precondition {
      condition     = tonumber(split(".", local.postgres_vm.ip)[3]) >= 10 && tonumber(split(".", local.postgres_vm.ip)[3]) <= 99
      error_message = "${local.postgres_vm.name}: ${local.postgres_vm.ip} is outside the static range 192.168.1.10-99."
    }
  }
}
