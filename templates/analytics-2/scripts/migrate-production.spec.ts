import { beforeEach, describe, expect, it, vi } from "vitest";

const { migrate, close, framework } = vi.hoisted(() => ({
  migrate: vi.fn(),
  close: vi.fn(),
  framework: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  withMigrationRuntime: (run: () => Promise<void>) => run(),
  closeDbExec: close,
}));
vi.mock("@agent-native/core/scripts", () => ({ loadEnv: vi.fn() }));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  runFrameworkReleaseMigrations: framework,
}));
vi.mock("../server/model/database.js", () => ({
  ensureAnalyticsDatabase: migrate,
}));

describe("report A2-LOCAL-MIGRATION-HANG-1121: production migration command", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    framework.mockResolvedValue(undefined);
    close.mockResolvedValue(undefined);
  });

  it("waits for app migrations before closing the database", async () => {
    let resolve = () => {};
    migrate.mockReturnValue(
      new Promise<void>((finish) => {
        resolve = finish;
      }),
    );
    const command = import("./migrate-production.js");
    await vi.waitFor(() => expect(migrate).toHaveBeenCalled(), {
      timeout: 60000,
    });
    expect(close).not.toHaveBeenCalled();
    resolve();
    await command;
    expect(close).toHaveBeenCalledOnce();
  }, 70000);

  it("propagates app migration failures and closes the database", async () => {
    migrate.mockRejectedValue(new Error("app migration failed"));
    await expect(import("./migrate-production.js")).rejects.toThrow(
      "app migration failed",
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
