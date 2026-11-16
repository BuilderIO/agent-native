import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ownerEmail = "owner+link-token-audit@example.test";
const orgId = "org_link_token_audit";

const originalEnv = {
  APP_NAME: process.env.APP_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
  DISPATCH_DATABASE_URL: process.env.DISPATCH_DATABASE_URL,
};

let tempDir: string | null = null;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-link-token-"));
  process.env.DATABASE_URL = `pglite:${tempDir}`;
  delete process.env.APP_NAME;
  delete process.env.DISPATCH_DATABASE_URL;
  vi.resetModules();

  const [{ runMigrations }, { dispatchMigrations }] = await Promise.all([
    import("@agent-native/core/db"),
    import("../../db/migrations.js"),
  ]);
  await runMigrations(dispatchMigrations, {
    table: "dispatch_migrations",
  })({});
  await (await import("@agent-native/core/db")).closeDbExec();
});

afterEach(async () => {
  try {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
  } catch {}
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("createLinkToken audit trail", () => {
  it("records that a link token was created without recording the token", async () => {
    const [{ runWithRequestContext }, { getDbExec }, dispatchStore] =
      await Promise.all([
        import("@agent-native/core/server"),
        import("@agent-native/core/db"),
        import("./dispatch-store.js"),
      ]);

    const created = await runWithRequestContext(
      { userEmail: ownerEmail, orgId },
      () => dispatchStore.createLinkToken("slack"),
    );

    expect(created.token).toMatch(/^[0-9a-f]{32}$/);
    expect(created.command).toBe(`/link ${created.token}`);

    const exec = getDbExec();
    const audit = await exec.execute({
      sql: "SELECT action, target_id, summary, metadata FROM dispatch_audit_events WHERE action = ?",
      args: ["identity.link-token-created"],
    });
    expect(audit.rows).toHaveLength(1);
    const row = audit.rows[0] as Record<string, unknown>;
    expect(JSON.parse(String(row.metadata))).toEqual({ platform: "slack" });
    expect(JSON.stringify(row)).not.toContain(created.token);

    const stored = await exec.execute({
      sql: "SELECT id, token FROM dispatch_link_tokens WHERE id = ?",
      args: [row.target_id],
    });
    expect(stored.rows[0]).toMatchObject({ token: created.token });
  });
});
