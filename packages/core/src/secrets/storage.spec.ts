import { afterEach, describe, expect, it, vi } from "vitest";

describe("secrets storage bootstrap", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../db/client.js");
  });

  it("retries table bootstrap after a transient failure", async () => {
    const execute = vi.fn(async () => ({ rows: [] as unknown[] }));
    execute.mockRejectedValueOnce(new Error("transient DDL failure"));

    vi.doMock("../db/client.js", () => ({
      getDialect: () => "sqlite",
      getDbExec: () => ({ execute }),
      isPostgres: () => false,
    }));

    const { readAppSecret } = await import("./storage.js");
    const ref = {
      key: "BUILDER_PRIVATE_KEY",
      scope: "user" as const,
      scopeId: "steve@example.test",
    };

    await expect(readAppSecret(ref)).rejects.toThrow("transient DDL failure");
    await expect(readAppSecret(ref)).resolves.toBeNull();

    expect(String(execute.mock.calls[0]?.[0])).toContain(
      "CREATE TABLE IF NOT EXISTS app_secrets",
    );
    expect(String(execute.mock.calls[1]?.[0])).toContain(
      "CREATE TABLE IF NOT EXISTS app_secrets",
    );
  });
});
