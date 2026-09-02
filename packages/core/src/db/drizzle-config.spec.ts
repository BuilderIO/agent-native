import { afterEach, describe, expect, it, vi } from "vitest";

type DialectGlobal = typeof globalThis & {
  __agentNativeDrizzleKitDialect?: "postgresql" | "sqlite" | "turso";
};

/** What `db/schema` reads at import time to pick pgTable over sqliteTable. */
function schemaDialect() {
  return (globalThis as DialectGlobal).__agentNativeDrizzleKitDialect;
}

describe("createDrizzleConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    delete (globalThis as DialectGlobal).__agentNativeDrizzleKitDialect;
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
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    expect(createDrizzleConfig()).toMatchObject({
      dialect: "postgresql",
      driver: "pglite",
      dbCredentials: { url: "memory://" },
    });
  });

  it("can pin migration generation to the primary Postgres dialect", async () => {
    vi.stubEnv("DATABASE_URL", "file:./data/app.db");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    expect(createDrizzleConfig({ dialect: "postgresql" })).toMatchObject({
      dialect: "postgresql",
      dbCredentials: { url: "postgres://localhost/app" },
    });
  });

  // Hosts that pool their DATABASE_URL cannot run DDL through it: a Neon
  // pooler is PgBouncer in transaction mode, so migrations need the direct
  // endpoint while the app keeps querying through the pooler.
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

  // `url: process.env.DATABASE_URL_UNPOOLED` has to stay correct on hosts that
  // set only DATABASE_URL, so a blank url is not an override.
  it("falls back to DATABASE_URL when the url option is unset or blank", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://pooler.neon.tech/app");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    for (const url of [undefined, "", "  "]) {
      expect(createDrizzleConfig({ url })).toMatchObject({
        dbCredentials: { url: "postgres://pooler.neon.tech/app" },
      });
    }
  });

  it("detects the dialect from an explicit url", async () => {
    vi.stubEnv("DATABASE_AUTH_TOKEN", "token");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    expect(createDrizzleConfig({ url: "libsql://db.turso.io" })).toMatchObject({
      dialect: "turso",
    });
  });

  // drizzle-kit imports the schema after this config, so a url that steers the
  // config dialect has to steer the schema too. Otherwise `db:generate` builds
  // tables with one dialect's helpers and writes them into the other's journal.
  it("aligns the schema dialect with an explicit url", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    createDrizzleConfig({ url: "postgres://direct.neon.tech/app" });

    expect(schemaDialect()).toBe("postgresql");
  });

  it("leaves the schema dialect alone when no option steers it", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://pooler.neon.tech/app");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    createDrizzleConfig();

    expect(schemaDialect()).toBeUndefined();
  });

  // The override is process-global, so a steering call must not leave the next
  // default call describing the wrong dialect.
  it("clears the schema dialect override for a later default call", async () => {
    vi.stubEnv("DATABASE_URL", "file:./data/app.db");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    createDrizzleConfig({ url: "postgres://direct.neon.tech/app" });
    expect(schemaDialect()).toBe("postgresql");

    expect(createDrizzleConfig()).toMatchObject({ dialect: "sqlite" });
    expect(schemaDialect()).toBeUndefined();
  });

  it("refuses drizzle-kit push against a Neon url passed as an option", async () => {
    vi.stubEnv("npm_lifecycle_script", "drizzle-kit push");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    expect(() =>
      createDrizzleConfig({ url: "postgres://direct.neon.tech/app" }),
    ).toThrow(/Refusing to run `drizzle-kit push`/);
  });
});
