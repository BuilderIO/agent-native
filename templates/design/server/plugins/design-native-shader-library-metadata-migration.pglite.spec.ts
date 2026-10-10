import {
  closeDbExec,
  getDbExec,
  runMigrations,
  withMigrationRuntime,
} from "@agent-native/core/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { designNativeShaderLibraryMetadataMigration } from "./db.js";

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");
  await getDbExec().execute(`CREATE TABLE design_native_shader_library (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    definition_json TEXT NOT NULL
  )`);
  await getDbExec().execute(`INSERT INTO design_native_shader_library
    (id, name, definition_json) VALUES ('older', 'Earlier entry', '{}')`);
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("native Shader Library metadata forward migration", () => {
  it("adds missing columns without replacing existing rows or inventing metadata", async () => {
    const migrate = runMigrations(
      [designNativeShaderLibraryMetadataMigration],
      { table: "native_shader_library_metadata_migrations" },
    );
    await withMigrationRuntime(async () => {
      await migrate({});
    });
    await withMigrationRuntime(async () => {
      await migrate({});
    });
    const { rows } = await getDbExec().execute({
      sql: `SELECT id, name, kind, placements, preset_placement,
        property_count, pass_count FROM design_native_shader_library`,
    });
    expect(rows).toEqual([
      {
        id: "older",
        name: "Earlier entry",
        kind: null,
        placements: null,
        preset_placement: null,
        property_count: null,
        pass_count: null,
      },
    ]);
  });
});
