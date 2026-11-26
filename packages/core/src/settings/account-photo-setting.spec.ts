import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

// the profile photo could not be saved. The write path is the
// shared avatar route, which stores `avatar:<email>` in the settings row; the
// settings store refuses inline image bytes, so every upload answered 500. These
// cases pin both halves: the general setting still refuses an image, and the
// avatar key's explicit exemption stores one and reads it back.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let originalEnv: NodeJS.ProcessEnv;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return { ...actual, getDbExec: () => rawClient };
});

const { getSetting, putSetting, mutateSetting } = await import("./store.js");

const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==";

beforeEach(async () => {
  originalEnv = { ...process.env };
  process.env.NODE_ENV = "test";
  delete process.env.NETLIFY_FUNCTION_NAME;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.LAMBDA_TASK_ROOT;
  delete process.env.VERCEL_FUNCTION_ID;
  delete process.env.VERCEL_REGION;
  pglite = await createTestPglite({ reuseEmptyBootstrap: true });
  await pglite.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
});

afterEach(async () => {
  process.env = originalEnv;
  await pglite.close();
  vi.clearAllMocks();
});

describe("the account photo setting", () => {
  it("still refuses an inline image on any other setting", async () => {
    await expect(putSetting("theme", { image: PHOTO })).rejects.toThrow(
      /stores inline/,
    );
  });

  it("stores the photo when the writer asks for the exemption", async () => {
    await putSetting(
      "avatar:analyst@example.test",
      { image: PHOTO },
      { allowInlineImageBytes: true },
    );
    await expect(getSetting("avatar:analyst@example.test")).resolves.toEqual({
      image: PHOTO,
    });
  });

  it("keeps the refusal on the mutating write unless the writer asks", async () => {
    await expect(
      mutateSetting("avatar:analyst@example.test", () => ({ image: PHOTO })),
    ).rejects.toThrow(/stores inline/);
    await expect(
      mutateSetting("avatar:analyst@example.test", () => ({ image: PHOTO }), {
        allowInlineImageBytes: true,
      }),
    ).resolves.toEqual({ image: PHOTO });
  });
});
