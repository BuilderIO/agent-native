import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockForward = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("../scripts/db/dev-migrate-proxy.js", () => ({
  tryForwardDbMigrateToDevServer: (...args: unknown[]) => mockForward(...args),
}));
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import { parseDbMigrateArgs, runDbMigrate } from "./db-migrate.js";

function fakeChild(exitCode: number) {
  const child = new EventEmitter();
  setTimeout(() => child.emit("exit", exitCode), 0);
  return child;
}

describe("parseDbMigrateArgs", () => {
  it("defaults the out dir and passes other args through", () => {
    expect(parseDbMigrateArgs(["--config", "x.ts"])).toEqual({
      out: "./drizzle/migrations",
      passthrough: ["--config", "x.ts"],
    });
  });

  it("reads --out in both forms and strips it from the passthrough", () => {
    expect(parseDbMigrateArgs(["--out", "db/m"])).toEqual({
      out: "db/m",
      passthrough: [],
    });
    expect(parseDbMigrateArgs(["--out=db/m", "--verbose"])).toEqual({
      out: "db/m",
      passthrough: ["--verbose"],
    });
  });
});

describe("runDbMigrate", () => {
  beforeEach(() => {
    mockForward.mockReset();
    mockSpawn.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("applies through the dev server and skips drizzle-kit when forwarded", async () => {
    mockForward.mockResolvedValue(true);
    await expect(runDbMigrate(["--out", "db/m"])).resolves.toBe(0);
    expect(mockForward).toHaveBeenCalledWith({ migrationsFolder: "db/m" });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("exits 1 with the error when the dev server reports a failure", async () => {
    mockForward.mockRejectedValue(new Error("boom"));
    await expect(runDbMigrate([])).resolves.toBe(1);
    expect(console.error).toHaveBeenCalledWith("boom");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("runs drizzle-kit migrate and returns its exit code when not forwarded", async () => {
    mockForward.mockResolvedValue(false);
    mockSpawn.mockImplementation(() => fakeChild(3));
    await expect(runDbMigrate(["--config", "x.ts"])).resolves.toBe(3);
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.stringContaining("drizzle-kit"),
      ["migrate", "--config", "x.ts"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });
});
