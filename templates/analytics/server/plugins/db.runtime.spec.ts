import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  migrationPlugin: vi.fn(),
  ensureAdditiveColumns: vi.fn(async () => ({ errors: [] })),
  getDbExec: vi.fn(),
  withMigrationRuntime: vi.fn(async (run: () => Promise<unknown>) => run()),
}));

declare global {
  var __AGENT_NATIVE_ANALYTICS_ROLLUP_BACKFILL_SCHEDULED_RUNTIME__:
    | boolean
    | undefined;
}

vi.mock("@agent-native/core/db", () => ({
  ensureAdditiveColumns: state.ensureAdditiveColumns,
  getDbExec: state.getDbExec,
  runMigrations: vi.fn(() => state.migrationPlugin),
  withMigrationRuntime: state.withMigrationRuntime,
}));

vi.mock("@agent-native/core/server", () => ({
  isInBackgroundFunctionRuntime: vi.fn(() => false),
}));

vi.mock("../db/index.js", () => ({}));
vi.mock("../db/schema.js", () => ({}));

const originalEnv = { ...process.env };

describe("Analytics database plugin boot contract", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "production", NETLIFY: "true" };
    globalThis.__AGENT_NATIVE_ANALYTICS_ROLLUP_BACKFILL_SCHEDULED_RUNTIME__ =
      undefined;
    state.migrationPlugin.mockReset();
    state.ensureAdditiveColumns.mockClear();
    state.getDbExec.mockReset();
    state.withMigrationRuntime.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.__AGENT_NATIVE_ANALYTICS_ROLLUP_BACKFILL_SCHEDULED_RUNTIME__ =
      undefined;
  });

  it("does not touch the database in a production serverless boot", async () => {
    const register = (await import("./db")).default;

    await register({});

    expect(state.migrationPlugin).not.toHaveBeenCalled();
    expect(state.ensureAdditiveColumns).not.toHaveBeenCalled();
    expect(state.getDbExec).not.toHaveBeenCalled();
  });

  it("runs migrations in the designated scheduled rollup worker", async () => {
    globalThis.__AGENT_NATIVE_ANALYTICS_ROLLUP_BACKFILL_SCHEDULED_RUNTIME__ = true;
    const register = (await import("./db")).default;

    await register({});

    expect(state.migrationPlugin).toHaveBeenCalledTimes(1);
    expect(state.withMigrationRuntime).toHaveBeenCalledTimes(1);
    expect(state.ensureAdditiveColumns).toHaveBeenCalledTimes(1);
  });

  it("keeps the migration path available to an explicitly long-lived runtime", async () => {
    process.env = { ...originalEnv, NODE_ENV: "production" };
    const register = (await import("./db")).default;

    await register({});

    expect(state.migrationPlugin).toHaveBeenCalledTimes(1);
    expect(state.ensureAdditiveColumns).toHaveBeenCalledTimes(1);
  });
});
