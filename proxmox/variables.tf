variable "proxmox_endpoint" {
  type        = string
  description = "Proxmox API URL, e.g. https://192.168.1.146:8006/"
  default     = "https://192.168.1.146:8006/"
}

variable "proxmox_api_token" {
  type        = string
  description = "API token in the form 'user@realm!tokenid=secret'"
  sensitive   = true
}

variable "proxmox_insecure" {
  type        = bool
  description = "Skip TLS verification (needed for Proxmox's default self-signed cert)"
  default     = true
}

variable "proxmox_ssh_username" {
  type        = string
  description = "SSH user on the Proxmox node (used for file uploads / disk imports)"
  default     = "root"
}

variable "node_name" {
  type        = string
  description = "Name of the Proxmox node to deploy to (see the 'nodes' output)"
  default     = "pve"
}

variable "iso_datastore_id" {
  type        = string
  description = "Datastore that holds ISOs/images (must allow the 'iso' content type)"
  default     = "local"
}

variable "vm_datastore_id" {
  type        = string
  description = "Datastore for VM disks and the cloud-init drive"
  default     = "local-lvm"
}

variable "network_bridge" {
  type        = string
  description = "Bridge the VMs attach to"
  default     = "vmbr0"
}

variable "ssh_public_key_path" {
  type        = string
  description = "Public key installed for the 'ubuntu' user on each node"
  default     = "~/.ssh/id_ed25519.pub"
}

variable "network_gateway" {
  type        = string
  description = "Default gateway for the static VMs"
  default     = "192.168.1.1"
}

variable "network_prefix_length" {
  type        = number
  description = "Subnet prefix length of the LAN"
  default     = 24
}

variable "dns_servers" {
  type        = list(string)
  description = "DNS servers for the static VMs"
  default     = ["192.168.1.1"]
}
