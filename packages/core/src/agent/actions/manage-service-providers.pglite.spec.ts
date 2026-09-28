import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";

// Real PGlite behind getDbExec, so the org role read and the settings row
// write and read run their genuine SQL. Only credential lookups are stubbed.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/client.js")>()),
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const args = (input.args ?? []) as unknown[];
      if (/^\s*(SELECT|WITH)\b/i.test(input.sql)) {
        const rows = await pglite.prepare(input.sql).all(...args);
        return { rows, rowsAffected: 0 };
      }
      const { changes } = await pglite.prepare(input.sql).run(...args);
      return { rows: [], rowsAffected: changes };
    },
  }),
}));

vi.mock("../../server/credential-provider.js", () => ({
  prefetchSecrets: async () => undefined,
  resolveBuilderCredentialsDetailed: async () => ({
    privateKey: "bpk-test",
    publicKey: "pub-test",
    source: "org",
    lookupFailed: false,
  }),
}));

vi.mock("../../server/secret-key-aliases.js", () => ({
  secretKeyNames: (key: string) => [key],
  resolveSecretWithAliasesDetailed: async (key: string) =>
    key === "GROQ_API_KEY"
      ? { value: "gsk-test", lookupFailed: false, source: "org" }
      : { value: null, lookupFailed: false },
}));

vi.mock("../../audit/record.js", () => ({
  recordActionAudit: async () => {},
}));

const { default: action } = await import("./manage-service-providers.js");
const { readServiceProviderChoice } =
  await import("../../server/service-providers.js");

const ctx = (userEmail: string) => ({
  actionName: "manage-service-providers",
  caller: "frontend" as const,
  userEmail,
  orgId: "org-1",
});

beforeAll(async () => {
  pglite = await createTestPglite();
  await pglite.exec(`
    CREATE TABLE org_members (
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      federation_removal_pending_at BIGINT
    );
    INSERT INTO org_members (org_id, email, role) VALUES
      ('org-1', 'owner@example.com', 'owner'),
      ('org-1', 'member@example.com', 'member');
  `);
});

afterAll(async () => {
  await pglite?.close();
});

describe("manage-service-providers against a real settings table", () => {
  it("stores an owner's choice where the voice resolver reads it", async () => {
    await expect(
      action.run(
        { service: "voice", provider: "groq" },
        ctx("owner@example.com"),
      ),
    ).resolves.toMatchObject({ changed: true, canManage: true });

    await expect(
      readServiceProviderChoice("voice", { orgId: "org-1" }),
    ).resolves.toBe("groq");
    const { rows } = await pglite.query(
      "SELECT value FROM public.settings WHERE key = ?",
      ["o:org-1:service-providers"],
    );
    expect(JSON.parse(String(rows[0]?.value))).toMatchObject({
      voice: "groq",
      updatedBy: "owner@example.com",
    });

    const read = await action.run({}, ctx("member@example.com"));
    expect(read.canManage).toBe(false);
    expect(read.services.find((s) => s.service === "voice")).toMatchObject({
      provider: "groq",
      effectiveProvider: "groq",
    });
  });

  it("refuses a member's change and leaves the row as it was", async () => {
    await expect(
      action.run(
        { service: "voice", provider: "openai" },
        ctx("member@example.com"),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      readServiceProviderChoice("voice", { orgId: "org-1" }),
    ).resolves.toBe("groq");
  });
});
