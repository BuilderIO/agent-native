import { afterEach, describe, expect, it, vi } from "vitest";

describe("resolveDevUserEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns AGENT_USER_EMAIL when explicitly set, without touching the DB", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "explicit@test.com");
    const execute = vi.fn();
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
    }));

    const { resolveDevUserEmail } = await import("./dev-session.js");
    expect(await resolveDevUserEmail()).toBe("explicit@test.com");
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns undefined in production regardless of sessions table", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "");
    vi.stubEnv("NODE_ENV", "production");
    const execute = vi.fn();
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
    }));

    const { resolveDevUserEmail } = await import("./dev-session.js");
    expect(await resolveDevUserEmail()).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns undefined when AUTH_MODE is set to a non-local mode", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_MODE", "google");
    const execute = vi.fn();
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
    }));

    const { resolveDevUserEmail } = await import("./dev-session.js");
    expect(await resolveDevUserEmail()).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns the sole sessions.email owner in dev with AUTH_MODE unset", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "");
    vi.stubEnv("NODE_ENV", "development");
    const execute = vi.fn().mockResolvedValue({
      rows: [{ email: "matthew@builder.io" }],
    });
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
    }));

    const { resolveDevUserEmail } = await import("./dev-session.js");
    expect(await resolveDevUserEmail()).toBe("matthew@builder.io");
    expect(execute).toHaveBeenCalledOnce();
    const call = execute.mock.calls[0][0];
    expect(call.sql).toContain("FROM sessions");
    expect(call.sql).toContain("GROUP BY TRIM(email)");
    expect(call.sql).toContain("LIMIT 2");
    // Sentinel must be excluded from the result set
    expect(call.args).toEqual(["local@localhost"]);
  });

  it("returns the sole sessions.email owner when AUTH_MODE === 'local'", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_MODE", "local");
    const execute = vi.fn().mockResolvedValue({
      rows: [{ email: "alice@local" }],
    });
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
    }));

    const { resolveDevUserEmail } = await import("./dev-session.js");
    expect(await resolveDevUserEmail()).toBe("alice@local");
  });

  it("refuses to guess when multiple session owners exist", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "");
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const execute = vi.fn().mockResolvedValue({
      rows: [{ email: "emma@builder.io" }, { email: "tim@builder.io" }],
    });
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
    }));

    const { resolveDevUserEmail } = await import("./dev-session.js");
    expect(await resolveDevUserEmail()).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[dev-session] multiple session owners found (emma@builder.io, tim@builder.io); set AGENT_USER_EMAIL=<email> to choose one",
    );
  });

  it("returns undefined when sessions table is empty", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "");
    vi.stubEnv("NODE_ENV", "development");
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
    }));

    const { resolveDevUserEmail } = await import("./dev-session.js");
    expect(await resolveDevUserEmail()).toBeUndefined();
  });

  it("returns undefined when sessions table is missing (DB throws)", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "");
    vi.stubEnv("NODE_ENV", "development");
    const execute = vi
      .fn()
      .mockRejectedValue(new Error("no such table: sessions"));
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
    }));

    const { resolveDevUserEmail } = await import("./dev-session.js");
    expect(await resolveDevUserEmail()).toBeUndefined();
  });

  it("ignores blank emails in the sessions row", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "");
    vi.stubEnv("NODE_ENV", "development");
    const execute = vi.fn().mockResolvedValue({ rows: [{ email: "   " }] });
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
    }));

    const { resolveDevUserEmail } = await import("./dev-session.js");
    expect(await resolveDevUserEmail()).toBeUndefined();
  });
});
