import { describe, expect, it } from "vitest";

import { fetchRemoteImage, publicOnlyLookup } from "./fetch-remote-image.js";

function lookupResult(
  hostname: string,
  options: Record<string, unknown> = {},
): Promise<{ err: NodeJS.ErrnoException | null; address: unknown }> {
  return new Promise((resolve) => {
    (
      publicOnlyLookup as unknown as (
        host: string,
        opts: Record<string, unknown>,
        cb: (err: NodeJS.ErrnoException | null, address: unknown) => void,
      ) => void
    )(hostname, options, (err, address) => resolve({ err, address }));
  });
}

describe("publicOnlyLookup", () => {
  it("refuses a hostname that resolves to loopback", async () => {
    // The socket asks for the address at connect time, so this is the check
    // a DNS-rebinding host would otherwise slip past. `localhost` resolves
    // from the hosts file, so no network is needed.
    const { err } = await lookupResult("localhost");
    expect(err?.code).toBe("EBLOCKED");
  });

  it("refuses loopback even when all addresses are requested", async () => {
    const { err } = await lookupResult("localhost", { all: true });
    expect(err?.code).toBe("EBLOCKED");
  });
});

describe("fetchRemoteImage", () => {
  it("refuses a loopback literal before opening a socket", async () => {
    const result = await fetchRemoteImage("http://127.0.0.1:9/secret.png");
    expect(result).toEqual({ ok: false, reason: "unsupported-url" });
  });

  it("refuses the cloud metadata address", async () => {
    const result = await fetchRemoteImage(
      "http://169.254.169.254/latest/meta-data/",
    );
    expect(result).toEqual({ ok: false, reason: "unsupported-url" });
  });

  it("refuses a non-http scheme", async () => {
    const result = await fetchRemoteImage("file:///etc/passwd");
    expect(result).toEqual({ ok: false, reason: "unsupported-url" });
  });

  it("refuses a hostname whose only addresses are private", async () => {
    // Reaches the socket layer, where publicOnlyLookup rejects it.
    const result = await fetchRemoteImage("http://localhost.localdomain/a.png");
    expect(result.ok).toBe(false);
  });
});
