import { afterEach, describe, expect, it, vi } from "vitest";

describe("extension capability persistence", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("loads only an active grant for the current normalized manifest hash", async () => {
    const manifest = JSON.stringify({
      version: 1,
      externalFetch: [{ origin: "https://api.example.com", methods: ["GET"] }],
    });
    const execute = vi.fn(async (input: { sql: string; args: unknown[] }) => {
      if (/SELECT capability_manifest_version/.test(input.sql)) {
        return {
          rows: [
            { capability_manifest_version: 1, capability_manifest: manifest },
          ],
        };
      }
      if (/FROM tool_consents/.test(input.sql)) {
        return {
          rows: [
            {
              grants_json: manifest,
            },
          ],
        };
      }
      return { rows: [] };
    });
    mockCapabilityDependencies(execute);

    const { getExtensionCapabilityBinding } = await import("./capabilities.js");
    const binding = await getExtensionCapabilityBinding("extension-1");

    expect(binding.consented).toBe(true);
    expect(binding.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(execute.mock.calls[1]?.[0].args).toEqual([
      "viewer@example.com",
      "extension-1",
      binding.manifestHash,
    ]);
  });

  it("rejects a stale acceptance hash and never writes a grant", async () => {
    const execute = vi.fn(async (input: { sql: string }) => {
      if (/SELECT capability_manifest_version/.test(input.sql)) {
        return {
          rows: [
            {
              capability_manifest_version: 1,
              capability_manifest: JSON.stringify({
                version: 1,
                appActions: ["list-notes"],
              }),
            },
          ],
        };
      }
      return { rows: [] };
    });
    mockCapabilityDependencies(execute);

    const { acceptExtensionCapabilities } = await import("./capabilities.js");
    await expect(
      acceptExtensionCapabilities("extension-1", "stale-hash", {
        version: 1,
        appActions: ["list-notes"],
      }),
    ).rejects.toThrow(/capabilities changed/);
    expect(
      execute.mock.calls.some(([input]) =>
        /INSERT INTO tool_consents/.test(input.sql),
      ),
    ).toBe(false);
  });

  it("revokes all active grants for the current viewer and extension", async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    mockCapabilityDependencies(execute);

    const { revokeExtensionCapabilities } = await import("./capabilities.js");
    await revokeExtensionCapabilities("extension-1");

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringMatching(/UPDATE tool_consents SET revoked_at/),
        args: [expect.any(String), "viewer@example.com", "extension-1"],
      }),
    );
  });
});

function mockCapabilityDependencies(execute: ReturnType<typeof vi.fn>): void {
  vi.doMock("../db/client.js", () => ({
    getDbExec: () => ({ execute }),
    isPostgres: () => false,
  }));
  vi.doMock("../server/request-context.js", () => ({
    getRequestUserEmail: () => "viewer@example.com",
  }));
  vi.doMock("../sharing/access.js", () => ({
    assertAccess: vi.fn(async () => undefined),
    resolveAccess: vi.fn(async () => ({
      role: "editor",
      resource: { id: "extension-1" },
    })),
  }));
  vi.doMock("./store.js", () => ({
    ensureExtensionsTables: vi.fn(async () => undefined),
  }));
}
