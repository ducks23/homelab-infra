output "nodes" {
  description = "Nodes visible to the API token (use one of these for var.node_name)"
  value       = data.proxmox_virtual_environment_nodes.available.names
}

output "postgres" {
  description = "Alpine PostgreSQL VM (SSH as 'alpine'; configure with ../ansible/postgresql)"
  value = {
    name = local.postgres_vm.name
    ip   = local.postgres_vm.ip
  }
}

output "clusters" {
  description = "Static IPs and kube-vip address for each cluster"
  value = {
    for cluster, cfg in local.clusters : cluster => {
      vip   = cfg.vip
      nodes = { for name, node in cfg.nodes : name => node.ip }
    }
  }
}

output "devbox" {
  description = "Ubuntu dev box (SSH as 'ubuntu'; remote access over Tailscale)"
  value = {
    name = local.devbox_vm.name
    ip   = local.devbox_vm.ip
  }
}

output "monitoring" {
  description = "Monitoring VM (SSH as 'ubuntu'; configure with ../ansible/monitoring)"
  value = {
    name = local.monitoring_vm.name
    ip   = local.monitoring_vm.ip
  }
}
