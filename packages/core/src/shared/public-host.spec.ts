import { describe, expect, it } from "vitest";

import { isNonPublicHostname } from "./public-host.js";

describe("isNonPublicHostname", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "intranet",
    "127.0.0.1",
    "8.8.8.8",
    "[::1]",
    "::1",
    "2001:db8::1",
    "app.localhost",
    "printer.local",
    "service.internal",
    "wiki.intranet",
    "router.lan",
    "nas.home",
    "git.corp",
    "hub.home.arpa",
    "router.lan.",
  ])("rejects %s", (host) => {
    expect(isNonPublicHostname(host)).toBe(true);
  });

  it.each([
    "demo.ngrok-free.app",
    "example.com",
    "sub.trycloudflare.com",
    "example.com.",
    "lantern.io",
    "internals.dev",
    "1password.com",
    "preview.v2",
  ])("allows %s", (host) => {
    expect(isNonPublicHostname(host)).toBe(false);
  });
});
