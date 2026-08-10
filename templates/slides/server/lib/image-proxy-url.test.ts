import { describe, expect, it } from "vitest";

import { isPrivateAddress, parseProxyableImageUrl } from "./image-proxy-url.js";

describe("parseProxyableImageUrl", () => {
  it("accepts a public https image URL", () => {
    const url = parseProxyableImageUrl(
      "https://nouveauraw.com/wp-content/uploads/2020/01/ZZ-Plant-800.png",
    );
    expect(url?.hostname).toBe("nouveauraw.com");
  });

  it("accepts plain http", () => {
    expect(parseProxyableImageUrl("http://example.com/a.png")).not.toBeNull();
  });

  it("refuses non-http protocols", () => {
    expect(parseProxyableImageUrl("file:///etc/passwd")).toBeNull();
    expect(parseProxyableImageUrl("data:image/png;base64,AAA")).toBeNull();
    expect(parseProxyableImageUrl("gopher://example.com/")).toBeNull();
  });

  it("refuses loopback and internal hostnames", () => {
    expect(parseProxyableImageUrl("http://localhost/a.png")).toBeNull();
    expect(parseProxyableImageUrl("http://foo.localhost/a.png")).toBeNull();
    expect(parseProxyableImageUrl("http://printer.local/a.png")).toBeNull();
    expect(parseProxyableImageUrl("http://vault.internal/a.png")).toBeNull();
    expect(
      parseProxyableImageUrl("http://metadata.google.internal/token"),
    ).toBeNull();
  });

  it("refuses private and link-local IP literals", () => {
    expect(parseProxyableImageUrl("http://127.0.0.1/a.png")).toBeNull();
    expect(parseProxyableImageUrl("http://10.0.0.5/a.png")).toBeNull();
    expect(parseProxyableImageUrl("http://192.168.1.10/a.png")).toBeNull();
    expect(parseProxyableImageUrl("http://172.16.4.4/a.png")).toBeNull();
    expect(parseProxyableImageUrl("http://169.254.169.254/latest")).toBeNull();
    expect(parseProxyableImageUrl("http://[::1]/a.png")).toBeNull();
  });

  it("refuses embedded credentials so they are not replayed server-side", () => {
    expect(
      parseProxyableImageUrl("https://user:pass@example.com/a.png"),
    ).toBeNull();
  });

  it("refuses unparseable input", () => {
    expect(parseProxyableImageUrl("")).toBeNull();
    expect(parseProxyableImageUrl("not a url")).toBeNull();
  });

  it("refuses a trailing-dot loopback spelling", () => {
    expect(parseProxyableImageUrl("http://localhost./a.png")).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it("treats public addresses as public", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("treats RFC1918, loopback, and CGNAT as private", () => {
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("192.168.0.1")).toBe(true);
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
  });

  it("treats IPv6 loopback, unique-local, and link-local as private", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
  });

  it("unwraps IPv4-mapped IPv6 before deciding", () => {
    expect(isPrivateAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("treats anything unparseable as private", () => {
    expect(isPrivateAddress("nonsense")).toBe(true);
  });
});
