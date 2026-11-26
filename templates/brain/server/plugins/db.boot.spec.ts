import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core/db")>();
  return {
    ...actual,
    getDbExec: vi.fn(actual.getDbExec),
    ensureAdditiveColumns: vi.fn(actual.ensureAdditiveColumns),
  };
});

import {
  closeDbExec,
  ensureAdditiveColumns,
  getDbExec,
} from "@agent-native/core/db";

import boot from "./db.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
let dataDir = "";

beforeEach(async () => {
  const actual = await vi.importActual<typeof import("@agent-native/core/db")>(
    "@agent-native/core/db",
  );
  vi.mocked(getDbExec).mockImplementation(actual.getDbExec);
  dataDir = mkdtempSync(path.join(tmpdir(), "brain-boot-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeDbExec();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  rmSync(dataDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("Brain server boot", () => {
  it("does no database work when a hosted release owns migrations", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NETLIFY_FUNCTION_NAME", "brain");
    vi.stubEnv("AGENT_NATIVE_RELEASE_MIGRATIONS", "1");
    vi.mocked(getDbExec).mockImplementation(() => {
      throw new Error("database access during release-owned hosted boot");
    });

    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(boot(null)).resolves.toBeUndefined();

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('Skipping "brain_migrations" migrations'),
    );
    expect(getDbExec).not.toHaveBeenCalled();
    expect(ensureAdditiveColumns).not.toHaveBeenCalled();
  });

  it("applies the migrations outside a release-owned runtime, and again without change", async () => {
    vi.stubEnv("DATABASE_URL", `pglite:${path.join(dataDir, "db")}`);
    const tables = async () => {
      const { rows } = await getDbExec().execute(
        "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'brain_%' ORDER BY table_name",
      );
      return rows.map((row) => String(row.table_name));
    };

    await boot(null);
    const first = await tables();
    expect(first).toEqual(
      expect.arrayContaining(["brain_knowledge", "brain_migrations_named"]),
    );

    await boot(null);
    expect(await tables()).toEqual(first);
  });
});
