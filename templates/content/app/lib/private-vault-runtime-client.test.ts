import { afterEach, describe, expect, it, vi } from "vitest";

import { getPrivateVaultBrowserStatus } from "./private-vault-runtime-client";

afterEach(() => vi.unstubAllGlobals());

describe("Private Vault browser status client", () => {
  it("returns only content-free active status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              version: 1,
              suite: "anc/v1",
              state: "active",
              vaultId: "11".repeat(16),
              head: { sequence: 8, hash: "22".repeat(32) },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    await expect(getPrivateVaultBrowserStatus()).resolves.toEqual({
      state: "active",
      vaultId: "11".repeat(16),
      sequence: 8,
    });
  });

  it("distinguishes no vault and rejects extra hosted fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    await expect(getPrivateVaultBrowserStatus()).resolves.toEqual({
      state: "absent",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              version: 1,
              suite: "anc/v1",
              state: "active",
              vaultId: "11".repeat(16),
              head: { sequence: 8, hash: "22".repeat(32) },
              title: "must never be hosted",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    await expect(getPrivateVaultBrowserStatus()).rejects.toThrow();
  });
});
