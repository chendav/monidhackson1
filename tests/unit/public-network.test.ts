import { describe, expect, it } from "vitest";
import { isGloballyReachableIpAddress } from "@/lib/security/public-network";

describe("provider credential network boundary", () => {
  it.each([
    "0.0.0.1",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "192.0.0.8",
    "192.0.0.170",
    "198.51.100.1",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b:1::1",
    "100::1",
    "2001:2::1",
    "2001:10::1",
    "2001:db8::1",
    "fc00::1",
    "fe80::1"
  ])("rejects special-use address %s", (address) => {
    expect(isGloballyReachableIpAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "2606:4700:4700::1111"])(
    "accepts ordinary globally reachable address %s",
    (address) => {
      expect(isGloballyReachableIpAddress(address)).toBe(true);
    }
  );
});
