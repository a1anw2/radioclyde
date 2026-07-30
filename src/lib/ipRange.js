// Minimal IPv4 CIDR matcher for a LAN allowlist -- this project has no other
// IP-range need, so a dependency isn't worth adding just for this.
function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// Node reports IPv4 clients as IPv4-mapped IPv6 (e.g. "::ffff:192.168.1.5")
// on some dual-stack listeners -- strip the prefix before comparing.
function normalize(ip) {
  return ip.replace(/^::ffff:/, '');
}

function isIpInCidr(ip, cidr) {
  const [rangeIp, prefixStr] = cidr.split('/');
  const prefix = prefixStr === undefined ? 32 : parseInt(prefixStr, 10);
  const ipInt = ipv4ToInt(normalize(ip));
  const rangeInt = ipv4ToInt(rangeIp);
  if (ipInt === null || rangeInt === null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

// Loopback is always trusted (curl/health-checks from the box itself, and --
// once a local reverse proxy/tunnel is added -- the one hop trustProxy is
// configured to trust for X-Forwarded-For).
export function isTrustedIp(ip, cidrs = []) {
  const normalized = normalize(ip);
  if (normalized === '127.0.0.1' || ip === '::1') return true;
  return cidrs.some((cidr) => isIpInCidr(ip, cidr));
}
