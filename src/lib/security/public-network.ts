import { BlockList, isIP } from "node:net";

// Conservative superset of the IANA IPv4/IPv6 special-purpose registries.
// Some ranges contain narrowly globally reachable anycast assignments; they
// remain blocked because provider credentials never need to reach them.
const NON_GLOBAL_IPV4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.31.196.0", 24],
  ["192.52.193.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["192.175.48.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
];

const NON_GLOBAL_IPV6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8]
];

const blockedIpv4Addresses = new BlockList();
for (const [network, prefix] of NON_GLOBAL_IPV4) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}
const blockedIpv6Addresses = new BlockList();
for (const [network, prefix] of NON_GLOBAL_IPV6) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

/** True only for an IP outside the conservative special-purpose denylist. */
export function isGloballyReachableIpAddress(address: string): boolean {
  const kind = isIP(address);
  try {
    if (kind === 4) return !blockedIpv4Addresses.check(address, "ipv4");
    if (kind === 6) return !blockedIpv6Addresses.check(address, "ipv6");
  } catch {
    return false;
  }
  return false;
}
