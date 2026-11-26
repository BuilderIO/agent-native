import { afterEach, describe, expect, it, vi } from "vitest";

const OWNER = "owner@acme.test";
const ctx = { userEmail: OWNER, orgId: null };

describe("integration keys on a real database (PGlite)", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
    Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessLocks",
    );
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessExitCleanupRegistered",
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load() {
    vi.stubEnv("DATABASE_URL", "pglite:memory");
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", "example-test-encryption-key-0001");
    const { appStateGet, appStatePut } =
      await import("@agent-native/core/application-state");
    const { getDbExec } = await import("@agent-native/core/db");
    const keys = await import("./integration-keys");
    return { appStateGet, appStatePut, getDbExec, keys };
  }

  it("saves a new key encrypted in settings and leaves application state empty", async () => {
    const { appStateGet, getDbExec, keys } = await load();

    await keys.saveIntegrationKey("apollo", "example-apollo-key", ctx);

    expect(await appStateGet(OWNER, "apollo")).toBeNull();
    const { rows } = await getDbExec().execute({
      sql: "SELECT key, value FROM settings WHERE key LIKE ?",
      args: ["%credential:APOLLO_API_KEY"],
    });
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.key)).toBe(`u:${OWNER}:credential:APOLLO_API_KEY`);
    expect(String(rows[0]?.value)).not.toContain("example-apollo-key");
    await expect(keys.readIntegrationKey("apollo", ctx)).resolves.toBe(
      "example-apollo-key",
    );
    await expect(keys.readIntegrationStatuses(ctx)).resolves.toEqual({
      apollo: true,
      hubspot: false,
      gong: false,
      pylon: false,
    });
  });

  it("keeps an existing connection working and does not touch its legacy row", async () => {
    const { appStateGet, appStatePut, getDbExec, keys } = await load();
    await appStatePut(OWNER, "gong", { apiKey: "example-legacy-gong-key" });

    await expect(keys.readIntegrationKey("gong", ctx)).resolves.toBe(
      "example-legacy-gong-key",
    );
    await expect(keys.readIntegrationStatuses(ctx)).resolves.toMatchObject({
      gong: true,
    });

    expect(await appStateGet(OWNER, "gong")).toEqual({
      apiKey: "example-legacy-gong-key",
    });
    const { rows } = await getDbExec().execute({
      sql: "SELECT key FROM settings WHERE key LIKE ?",
      args: ["%credential:%"],
    });
    expect(rows).toHaveLength(0);
  });

  it("answers with a newly saved key over a legacy row, without deleting the row", async () => {
    const { appStateGet, appStatePut, keys } = await load();
    await appStatePut(OWNER, "pylon", { apiKey: "example-old-pylon-key" });

    await keys.saveIntegrationKey("pylon", "example-new-pylon-key", ctx);

    await expect(keys.readIntegrationKey("pylon", ctx)).resolves.toBe(
      "example-new-pylon-key",
    );
    expect(await appStateGet(OWNER, "pylon")).toEqual({
      apiKey: "example-old-pylon-key",
    });
  });

  it("removes only the credential row on delete", async () => {
    const { keys } = await load();
    await keys.saveIntegrationKey("hubspot", "example-hubspot-key", ctx);

    await keys.deleteIntegrationKey("hubspot", ctx);

    await expect(keys.readIntegrationKey("hubspot", ctx)).resolves.toBe(
      undefined,
    );
  });
});
