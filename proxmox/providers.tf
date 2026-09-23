provider "proxmox" {
  endpoint  = var.proxmox_endpoint
  api_token = var.proxmox_api_token

  # Proxmox ships with a self-signed cert. Set to false once you install a trusted one.
  insecure = var.proxmox_insecure

  # The API alone can't do everything (uploading snippets, importing disk images).
  # Those operations use SSH to the node.
  ssh {
    agent    = true
    username = var.proxmox_ssh_username
  }
}
