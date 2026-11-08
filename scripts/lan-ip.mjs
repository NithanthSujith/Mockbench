// Prints this machine's most likely LAN IPv4 address (used by scripts/lan-smoke.sh and the README).
// Override with LAN_IP=<address>. Skips loopback, link-local, and virtual adapters (VMware, WSL,
// Hyper-V, Docker, VPN tunnels), preferring private ranges; falls back to any non-internal IPv4.
import { networkInterfaces } from 'node:os'

const VIRTUAL =
  /vmware|virtualbox|vethernet|hyper-v|wsl|docker|veth|br-|virbr|vboxnet|tailscale|zerotier|utun|tun\d|tap\d|loopback/i
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/

export function pickLanIp(ifaces = networkInterfaces(), env = process.env) {
  if (env.LAN_IP) return env.LAN_IP
  const all = []
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (a.address.startsWith('169.254.')) continue
      all.push({ name, address: a.address })
    }
  }
  const real = all.filter((a) => !VIRTUAL.test(a.name))
  return (
    real.find((a) => PRIVATE.test(a.address)) ??
    real[0] ??
    all.find((a) => PRIVATE.test(a.address)) ??
    all[0] ??
    null
  )?.address
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())
) {
  const ip = pickLanIp()
  if (!ip) {
    console.error('lan-ip: no non-loopback IPv4 address found (set LAN_IP=<address> to override)')
    process.exit(1)
  }
  console.log(ip)
}
