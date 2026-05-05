import { describe, expect, it, vi } from "vitest";
import { isBlockedExtensionUrl, isBlockedExtensionUrlWithDns } from "./url-safety.js";

describe("isBlockedExtensionUrl", () => {
  it.each([
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/",
    "http://100.64.0.1/",
    "http://192.0.2.1/",
    "http://198.18.0.1/",
    "http://198.51.100.1/",
    "http://203.0.113.1/",
    "http://224.0.0.1/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[ff00::1]/",
    "http://[::ffff:7f00:1]/",
    "http://metadata.google.internal/",
  ])("blocks non-public target %s", (url) => {
    expect(isBlockedExtensionUrl(url)).toBe(true);
  });

  it("allows ordinary public HTTP origins", () => {
    expect(isBlockedExtensionUrl("https://93.184.216.34/api")).toBe(false);
    expect(isBlockedExtensionUrl("https://example.com/api")).toBe(false);
  });
});

describe("isBlockedExtensionUrlWithDns (DNS rebinding guard)", () => {
  it("blocks a public hostname that resolves to a private IP", async () => {
    // Mock node:dns/promises so this test doesn't hit the network.
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => [{ address: "169.254.169.254", family: 4 }],
    }));
    vi.resetModules();
    const mod = await import("./url-safety.js");
    expect(
      await mod.isBlockedExtensionUrlWithDns("https://attacker.example.com/"),
    ).toBe(true);
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });

  it("blocks even when one of multiple resolved IPs is private", async () => {
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    }));
    vi.resetModules();
    const mod = await import("./url-safety.js");
    expect(await mod.isBlockedExtensionUrlWithDns("https://example.com/")).toBe(
      true,
    );
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });

  it("allows a hostname that resolves to a public IP", async () => {
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    }));
    vi.resetModules();
    const mod = await import("./url-safety.js");
    expect(await mod.isBlockedExtensionUrlWithDns("https://example.com/")).toBe(
      false,
    );
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });
});
