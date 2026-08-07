import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  migrationPlugin: vi.fn(),
  ensureAdditiveColumns: vi.fn(async () => ({ errors: [] })),
  getDbExec: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  ensureAdditiveColumns: state.ensureAdditiveColumns,
  getDbExec: state.getDbExec,
  runMigrations: vi.fn(() => state.migrationPlugin),
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
    state.migrationPlugin.mockReset();
    state.ensureAdditiveColumns.mockClear();
    state.getDbExec.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("does not touch the database in a production serverless boot", async () => {
    const register = (await import("./db")).default;

    await register({});

    expect(state.migrationPlugin).not.toHaveBeenCalled();
    expect(state.ensureAdditiveColumns).not.toHaveBeenCalled();
    expect(state.getDbExec).not.toHaveBeenCalled();
  });

  it("keeps the migration path available to an explicitly long-lived runtime", async () => {
    process.env = { ...originalEnv, NODE_ENV: "production" };
    const register = (await import("./db")).default;

    await register({});

    expect(state.migrationPlugin).toHaveBeenCalledTimes(1);
    expect(state.ensureAdditiveColumns).toHaveBeenCalledTimes(1);
  });
});
