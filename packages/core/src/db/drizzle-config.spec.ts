import { afterEach, describe, expect, it, vi } from "vitest";

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
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const { createDrizzleConfig } = await import("./drizzle-config.js");

    expect(createDrizzleConfig()).toMatchObject({
      dialect: "postgresql",
      driver: "pglite",
      dbCredentials: { url: "memory://" },
    });
  });
});
