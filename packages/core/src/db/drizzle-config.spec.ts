import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createDrizzleConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("configures drizzle-kit to use the PGlite Postgres driver for pglite URLs", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:./data/pglite");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    expect(createDrizzleConfig()).toMatchObject({
      dialect: "postgresql",
      driver: "pglite",
      dbCredentials: { url: "./data/pglite" },
    });
  });

  it("passes memory PGlite URLs through as memory data dirs", async () => {
    const { createDrizzleConfig } = await import("./drizzle-config.js");

    for (const url of ["pglite:memory", "pglite:memory:", "pglite:/memory:"]) {
      vi.stubEnv("DATABASE_URL", url);
      expect(createDrizzleConfig()).toMatchObject({
        dialect: "postgresql",
        driver: "pglite",
        dbCredentials: { url: "memory://" },
      });
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ["test", ""],
    ["production", "true"],
    ["production", "1"],
  ])(
    "uses test PGlite with NODE_ENV=%s and VITEST=%s",
    async (nodeEnv, vitest) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("VITEST", vitest);
      vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_ID", "content");
      vi.stubEnv("DATABASE_URL", "pglite:memory");
      vi.stubEnv("CONTENT_DATABASE_URL", "postgres://app.example/db");

      const { createDrizzleConfig } = await import("./drizzle-config.js");

      expect(createDrizzleConfig()).toMatchObject({
        driver: "pglite",
        dbCredentials: { url: "memory://" },
      });
    },
  );

  it("preserves the app URL ahead of PGlite outside test processes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_ID", "content");
    vi.stubEnv("DATABASE_URL", "pglite:memory");
    vi.stubEnv("CONTENT_DATABASE_URL", "postgres://app.example/db");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    expect(createDrizzleConfig()).toMatchObject({
      dbCredentials: { url: "postgres://app.example/db" },
    });
  });

  it("prefers an explicit url over DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://pooler.neon.tech/app");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    expect(
      createDrizzleConfig({ url: "postgres://direct.neon.tech/app" }),
    ).toMatchObject({
      dialect: "postgresql",
      dbCredentials: { url: "postgres://direct.neon.tech/app" },
    });
  });

  it("prefers an explicit url over the app-scoped DATABASE_URL", async () => {
    vi.stubEnv("APP_NAME", "my-app");
    vi.stubEnv("MY_APP_DATABASE_URL", "postgres://pooler.neon.tech/app");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    expect(
      createDrizzleConfig({ url: "postgres://direct.neon.tech/app" }),
    ).toMatchObject({
      dbCredentials: { url: "postgres://direct.neon.tech/app" },
    });
  });

  it("uses the workspace app ID for app-scoped migration URLs", async () => {
    vi.stubEnv("APP_NAME", "");
    vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_ID", "account-expert");
    vi.stubEnv(
      "ACCOUNT_EXPERT_DATABASE_URL",
      "postgres://account-expert.example/db",
    );
    vi.stubEnv("DATABASE_URL", "postgres://workspace.example/db");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    expect(createDrizzleConfig()).toMatchObject({
      dbCredentials: { url: "postgres://account-expert.example/db" },
    });
  });

  it("falls back to DATABASE_URL when the url option is unset or blank", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://pooler.neon.tech/app");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    for (const url of [undefined, "", "  "]) {
      expect(createDrizzleConfig({ url })).toMatchObject({
        dbCredentials: { url: "postgres://pooler.neon.tech/app" },
      });
    }
  });

  it("refuses drizzle-kit push against a Neon url passed as an option", async () => {
    vi.stubEnv("npm_lifecycle_script", "drizzle-kit push");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    expect(() =>
      createDrizzleConfig({ url: "postgres://direct.neon.tech/app" }),
    ).toThrow(/Refusing to run `drizzle-kit push`/);
  });
});

describe("createDrizzleConfig PGlite dev-server guard", () => {
  let tmpDir: string;
  let dataDir: string;
  const originalArgv = process.argv;

  function writeLock(pid: number) {
    fs.writeFileSync(
      `${path.resolve(dataDir)}.agent-native-pglite.lock`,
      JSON.stringify({ pid, token: "t" }),
    );
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-drizzle-guard-"));
    dataDir = path.join(tmpDir, "pglite");
    vi.stubEnv("DATABASE_URL", `pglite:${dataDir}`);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each(["migrate", "push", "studio", "pull"])(
    "throws for drizzle-kit %s while a foreign live process holds the lock",
    async (subcommand) => {
      writeLock(process.ppid);
      vi.stubEnv("npm_lifecycle_script", `drizzle-kit ${subcommand}`);
      const { createDrizzleConfig } = await import("./drizzle-config.js");
      expect(() => createDrizzleConfig()).toThrow(
        new RegExp(
          `open in the running dev server \\(pid ${process.ppid}\\).*agent-native db-migrate`,
        ),
      );
    },
  );

  it("detects the subcommand from argv", async () => {
    writeLock(process.ppid);
    process.argv = ["node", "/app/node_modules/drizzle-kit/bin.cjs", "migrate"];
    const { createDrizzleConfig } = await import("./drizzle-config.js");
    expect(() => createDrizzleConfig()).toThrow(/running dev server/);
  });

  it("never blocks drizzle-kit generate", async () => {
    writeLock(process.ppid);
    vi.stubEnv("npm_lifecycle_script", "drizzle-kit generate");
    process.argv = [
      "node",
      "/app/node_modules/drizzle-kit/bin.cjs",
      "generate",
      "--name",
      "migrate",
    ];
    const { createDrizzleConfig } = await import("./drizzle-config.js");
    expect(() => createDrizzleConfig()).not.toThrow();
  });

  it("does not throw when the lock pid is dead", async () => {
    const deadPid = Number(
      execFileSync(process.execPath, [
        "-e",
        "process.stdout.write(String(process.pid))",
      ]),
    );
    writeLock(deadPid);
    vi.stubEnv("npm_lifecycle_script", "drizzle-kit migrate");
    const { createDrizzleConfig } = await import("./drizzle-config.js");
    expect(() => createDrizzleConfig()).not.toThrow();
  });

  it("does not throw when the lock belongs to this process", async () => {
    writeLock(process.pid);
    vi.stubEnv("npm_lifecycle_script", "drizzle-kit migrate");
    const { createDrizzleConfig } = await import("./drizzle-config.js");
    expect(() => createDrizzleConfig()).not.toThrow();
  });

  it("does not throw when there is no lock file", async () => {
    vi.stubEnv("npm_lifecycle_script", "drizzle-kit migrate");
    const { createDrizzleConfig } = await import("./drizzle-config.js");
    expect(() => createDrizzleConfig()).not.toThrow();
  });
});
