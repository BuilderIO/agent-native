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

describe("resolveDevOrgId", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns AGENT_ORG_ID when explicitly set without resolving memberships", async () => {
    vi.stubEnv("AGENT_ORG_ID", "org-explicit");
    const resolveOrgIdForEmail = vi.fn();
    vi.doMock("../org/context.js", () => ({ resolveOrgIdForEmail }));

    const { resolveDevOrgId } = await import("./dev-session.js");
    expect(await resolveDevOrgId("owner@example.com")).toBe("org-explicit");
    expect(resolveOrgIdForEmail).not.toHaveBeenCalled();
  });

  it("resolves the active organization for the local dev user", async () => {
    vi.stubEnv("AGENT_ORG_ID", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_MODE", "local");
    const resolveOrgIdForEmail = vi.fn().mockResolvedValue("org-active");
    vi.doMock("../org/context.js", () => ({ resolveOrgIdForEmail }));

    const { resolveDevOrgId } = await import("./dev-session.js");
    expect(await resolveDevOrgId("owner@example.com")).toBe("org-active");
    expect(resolveOrgIdForEmail).toHaveBeenCalledWith("owner@example.com");
  });

  it("does not infer an organization in production or non-local auth modes", async () => {
    const resolveOrgIdForEmail = vi.fn().mockResolvedValue("org-active");
    vi.doMock("../org/context.js", () => ({ resolveOrgIdForEmail }));
    const { resolveDevOrgId } = await import("./dev-session.js");

    vi.stubEnv("NODE_ENV", "production");
    expect(await resolveDevOrgId("owner@example.com")).toBeUndefined();

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_MODE", "google");
    expect(await resolveDevOrgId("owner@example.com")).toBeUndefined();
    expect(resolveOrgIdForEmail).not.toHaveBeenCalled();
  });

  it("returns undefined when no user or membership can be resolved", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_MODE", "local");
    const resolveOrgIdForEmail = vi.fn().mockResolvedValue(null);
    vi.doMock("../org/context.js", () => ({ resolveOrgIdForEmail }));

    const { resolveDevOrgId } = await import("./dev-session.js");
    expect(await resolveDevOrgId(undefined)).toBeUndefined();
    expect(await resolveDevOrgId("owner@example.com")).toBeUndefined();
    expect(resolveOrgIdForEmail).toHaveBeenCalledOnce();
  });
});
