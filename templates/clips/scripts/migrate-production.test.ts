import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  closeDirect: vi.fn(),
  closeRuntime: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@agent-native/core/db", () => ({
  withMigrationRuntime: (run: () => Promise<void>) => run(),
  getDbExec: () => ({
    execute: () => {
      throw new Error("Concurrent index build reached the pooled connection");
    },
  }),
  getMigrationDatabaseUrl: () => "postgresql://direct.example.test/clips",
  createDbExec: mocks.create,
  closeDbExec: mocks.closeRuntime,
}));
vi.mock("@agent-native/core/scripts", () => ({ loadEnv: vi.fn() }));
vi.mock("@agent-native/core/server", () => ({
  runFrameworkReleaseMigrations: vi.fn(),
}));
vi.mock("../server/plugins/db.js", () => ({ migrations: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({ rows: [{ ready: true }] });
  mocks.create.mockResolvedValue({
    execute: mocks.execute,
    close: mocks.closeDirect,
  });
});

it("builds release indexes on the direct migration endpoint and closes it", async () => {
  await import("./migrate-production.js");
  expect(mocks.create).toHaveBeenCalledWith({
    url: "postgresql://direct.example.test/clips",
  });
  expect(mocks.execute).toHaveBeenCalledTimes(3);
  expect(mocks.closeDirect).toHaveBeenCalledOnce();
  expect(mocks.closeRuntime).toHaveBeenCalledOnce();
});

it("fails the release and closes both executors when index creation fails", async () => {
  mocks.execute.mockRejectedValue(new Error("Index creation failed"));
  await expect(import("./migrate-production.js")).rejects.toThrow(
    "Index creation failed",
  );
  expect(mocks.closeDirect).toHaveBeenCalledOnce();
  expect(mocks.closeRuntime).toHaveBeenCalledOnce();
});
