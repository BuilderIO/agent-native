import { describe, expect, it } from "vitest";
import { validateRemoteUrl } from "./remote-store.js";

describe("validateRemoteUrl", () => {
  it("rejects bracketed IPv6 loopback and private hosts", () => {
    for (const url of [
      "https://[::1]/mcp",
      "https://[fd00::1]/mcp",
      "https://[fc00::1]/mcp",
      "https://[fe80::1]/mcp",
      "https://[::ffff:127.0.0.1]/mcp",
    ]) {
      expect(validateRemoteUrl(url), url).toMatchObject({ ok: false });
    }
  });

  it("continues to allow localhost over plain http for local development", () => {
    expect(validateRemoteUrl("http://localhost:3000/mcp")).toMatchObject({
      ok: true,
    });
    expect(validateRemoteUrl("http://127.0.0.1:3000/mcp")).toMatchObject({
      ok: true,
    });
  });

  it("rejects private IPv4 and non-local plain http URLs", () => {
    expect(validateRemoteUrl("https://10.0.0.5/mcp")).toMatchObject({
      ok: false,
    });
    expect(validateRemoteUrl("http://example.com/mcp")).toMatchObject({
      ok: false,
    });
  });
});
