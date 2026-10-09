import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockForward = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("../scripts/db/dev-migrate-proxy.js", () => ({
  tryForwardDbMigrateToDevServer: (...args: unknown[]) => mockForward(...args),
}));
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import { parseDbMigrateConfigArg, runDbMigrate } from "./db-migrate.js";

function fakeChild(exitCode: number) {
  const child = new EventEmitter();
  setTimeout(() => child.emit("exit", exitCode), 0);
  return child;
}

const PGLITE_CONFIG = `export default {
  out: "./server/db/migrations",
  driver: "pglite",
  dbCredentials: { url: "./data/pglite" },
};`;

describe("parseDbMigrateConfigArg", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-db-migrate-parse-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds the default config in drizzle-kit's order with no args", () => {
    fs.writeFileSync(path.join(tmpDir, "drizzle.config.json"), "{}");
    expect(parseDbMigrateConfigArg([])).toEqual({
      config: "drizzle.config.json",
    });
    fs.writeFileSync(path.join(tmpDir, "drizzle.config.js"), "");
    expect(parseDbMigrateConfigArg([])).toEqual({
      config: "drizzle.config.js",
    });
    fs.writeFileSync(path.join(tmpDir, "drizzle.config.ts"), "");
    expect(parseDbMigrateConfigArg([])).toEqual({
      config: "drizzle.config.ts",
    });
  });

  it("returns null with no args and no default config", () => {
    expect(parseDbMigrateConfigArg([])).toBeNull();
  });

  it("reads --config in both forms", () => {
    expect(parseDbMigrateConfigArg(["--config", "x.ts"])).toEqual({
      config: "x.ts",
    });
    expect(parseDbMigrateConfigArg(["--config=x.ts"])).toEqual({
      config: "x.ts",
    });
  });

  it("returns null when any other arg is present", () => {
    expect(parseDbMigrateConfigArg(["--verbose"])).toBeNull();
    expect(
      parseDbMigrateConfigArg(["--config", "x.ts", "--verbose"]),
    ).toBeNull();
    expect(parseDbMigrateConfigArg(["--config"])).toBeNull();
  });
});

describe("runDbMigrate", () => {
  let tmpDir: string;

  function writeConfig(name: string, body: string) {
    fs.writeFileSync(path.join(tmpDir, name), body);
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-db-migrate-cli-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    mockForward.mockReset();
    mockSpawn.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("forwards the config's out folder, table, and schema for a PGlite config", async () => {
    writeConfig(
      "drizzle.config.ts",
      `export default {
        out: "./server/db/migrations",
        driver: "pglite",
        dbCredentials: { url: "./data/pglite" },
        migrations: { table: "t", schema: "s" },
      };`,
    );
    mockForward.mockResolvedValue(true);
    await expect(runDbMigrate([])).resolves.toBe(0);
    expect(mockForward).toHaveBeenCalledWith({
      dataDir: path.join(tmpDir, "data/pglite"),
      migrationsFolder: "./server/db/migrations",
      migrationsTable: "t",
      migrationsSchema: "s",
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("loads the config named by --config", async () => {
    writeConfig(
      "other.config.ts",
      `export default {
        out: "db/m",
        driver: "pglite",
        dbCredentials: { url: "./data/pglite" },
      };`,
    );
    mockForward.mockResolvedValue(true);
    await expect(runDbMigrate(["--config=other.config.ts"])).resolves.toBe(0);
    expect(mockForward).toHaveBeenCalledWith({
      dataDir: path.join(tmpDir, "data/pglite"),
      migrationsFolder: "db/m",
    });
  });

  it("skips forwarding and passes all args through when non-config args are present", async () => {
    mockSpawn.mockImplementation(() => fakeChild(0));
    await expect(runDbMigrate(["--config", "x.ts", "--verbose"])).resolves.toBe(
      0,
    );
    expect(mockForward).not.toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.stringContaining("drizzle-kit"),
      ["migrate", "--config", "x.ts", "--verbose"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("does not forward a non-PGlite config", async () => {
    writeConfig(
      "drizzle.config.ts",
      `export default {
        out: "./m",
        dbCredentials: { url: "postgres://localhost/db" },
      };`,
    );
    mockSpawn.mockImplementation(() => fakeChild(0));
    await expect(runDbMigrate([])).resolves.toBe(0);
    expect(mockForward).not.toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalled();
  });

  it("forwards an in-memory PGlite URL without resolving it as a path", async () => {
    writeConfig(
      "drizzle.config.ts",
      `export default {
        out: "./m",
        driver: "pglite",
        dbCredentials: { url: "memory://" },
      };`,
    );
    mockForward.mockResolvedValue(true);
    await expect(runDbMigrate([])).resolves.toBe(0);
    expect(mockForward).toHaveBeenCalledWith({
      dataDir: "memory://",
      migrationsFolder: "./m",
    });
  });

  it("passes through to drizzle-kit when no default config exists", async () => {
    mockSpawn.mockImplementation(() => fakeChild(1));
    await expect(runDbMigrate([])).resolves.toBe(1);
    expect(mockForward).not.toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.stringContaining("drizzle-kit"),
      ["migrate"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("exits 1 with the error when the config cannot be loaded", async () => {
    writeConfig("drizzle.config.ts", "export default {");
    await expect(runDbMigrate([])).resolves.toBe(1);
    expect(console.error).toHaveBeenCalled();
    expect(mockForward).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("exits 1 with the error when the dev server reports a failure", async () => {
    writeConfig("drizzle.config.ts", PGLITE_CONFIG);
    mockForward.mockRejectedValue(new Error("boom"));
    await expect(runDbMigrate([])).resolves.toBe(1);
    expect(console.error).toHaveBeenCalledWith("boom");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("runs drizzle-kit migrate and returns its exit code when not forwarded", async () => {
    writeConfig("drizzle.config.ts", PGLITE_CONFIG);
    mockForward.mockResolvedValue(false);
    mockSpawn.mockImplementation(() => fakeChild(3));
    await expect(runDbMigrate([])).resolves.toBe(3);
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.stringContaining("drizzle-kit"),
      ["migrate"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });
});
