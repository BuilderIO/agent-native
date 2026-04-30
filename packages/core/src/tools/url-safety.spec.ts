import { describe, expect, it } from "vitest";
import { isBlockedToolUrl } from "./url-safety.js";

describe("isBlockedToolUrl", () => {
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
    expect(isBlockedToolUrl(url)).toBe(true);
  });

  it("allows ordinary public HTTP origins", () => {
    expect(isBlockedToolUrl("https://93.184.216.34/api")).toBe(false);
    expect(isBlockedToolUrl("https://example.com/api")).toBe(false);
  });
});
