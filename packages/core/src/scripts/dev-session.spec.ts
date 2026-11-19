import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
      .mockRejectedValue(new Error('relation "sessions" does not exist'));
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

describe("resolveDevOrgScope", () => {
  const dataDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    for (const dir of dataDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function mockOrgLookup(lookup: (email: string) => Promise<string | null>) {
    // The resolveDevUserEmail tests mock the database client; use the real one.
    vi.doUnmock("../db/client.js");
    // An existing local database, so the lookup runs.
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-dev-org-"));
    dataDirs.push(dataDir);
    vi.stubEnv("DATABASE_URL", `pglite:${dataDir}`);
    const resolveOrgIdForEmail = vi.fn(lookup);
    vi.doMock("../org/context.js", () => ({ resolveOrgIdForEmail }));
    return resolveOrgIdForEmail;
  }

  it("keeps an explicit org without looking up the user's", async () => {
    const lookup = mockOrgLookup(async () => "org_from_ui");

    const { resolveDevOrgScope } = await import("./dev-session.js");
    expect(
      await resolveDevOrgScope("alice@example.test", { orgId: "org_explicit" }),
    ).toEqual({ orgId: "org_explicit" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("keeps a personal scope even when an org is named", async () => {
    // A personal request's shell clears AGENT_ORG_ID, but the child's env
    // loading can put one back from `.env`.
    const lookup = mockOrgLookup(async () => "org_from_ui");

    const { resolveDevOrgScope } = await import("./dev-session.js");
    expect(
      await resolveDevOrgScope("alice@example.test", {
        orgId: "org_from_env_file",
        personal: true,
      }),
    ).toEqual({ orgScope: "personal" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("uses the org the signed-in app would use for the user", async () => {
    // The UI scopes reads to the user's active org (or first membership).
    // A CLI call with no AGENT_ORG_ID must see the same rows, not only the
    // user's personal ones.
    const lookup = mockOrgLookup(async () => "org_from_ui");

    const { resolveDevOrgScope } = await import("./dev-session.js");
    expect(await resolveDevOrgScope("alice@example.test", {})).toEqual({
      orgId: "org_from_ui",
    });
    expect(lookup).toHaveBeenCalledWith("alice@example.test");
  });

  it("stays personal when the user has no org or chose personal", async () => {
    mockOrgLookup(async () => null);

    const { resolveDevOrgScope } = await import("./dev-session.js");
    expect(await resolveDevOrgScope("alice@example.test", {})).toEqual({});
  });

  it("keeps a caller's personal scope instead of finding the user an org", async () => {
    // A personal agent request that runs `pnpm action` in its shell must not
    // reach the user's org data through the child process.
    const lookup = mockOrgLookup(async () => "org_from_ui");

    const { resolveDevOrgScope } = await import("./dev-session.js");
    expect(
      await resolveDevOrgScope("alice@example.test", { personal: true }),
    ).toEqual({ orgScope: "personal" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not create the local database just to look for an org", async () => {
    const lookup = mockOrgLookup(async () => "org_from_ui");
    const missing = path.join(os.tmpdir(), `an-dev-org-missing-${Date.now()}`);
    vi.stubEnv("DATABASE_URL", `pglite:${missing}`);

    const { resolveDevOrgScope } = await import("./dev-session.js");
    expect(await resolveDevOrgScope("alice@example.test", {})).toEqual({});
    expect(lookup).not.toHaveBeenCalled();
    expect(fs.existsSync(missing)).toBe(false);
  });

  it("has no org to look up without a user", async () => {
    const lookup = mockOrgLookup(async () => "org_from_ui");

    const { resolveDevOrgScope } = await import("./dev-session.js");
    expect(await resolveDevOrgScope(undefined, {})).toEqual({});
    expect(lookup).not.toHaveBeenCalled();
  });

  it("surfaces a lookup failure instead of acting without the org", async () => {
    mockOrgLookup(async () => {
      throw new Error("connection refused");
    });

    const { resolveDevOrgScope } = await import("./dev-session.js");
    await expect(resolveDevOrgScope("alice@example.test", {})).rejects.toThrow(
      "connection refused",
    );
  });
});

describe("devOrgChoiceFromEnv", () => {
  it("reads the named org and the personal marker", async () => {
    const { devOrgChoiceFromEnv } = await import("./dev-session.js");
    expect(
      devOrgChoiceFromEnv({
        AGENT_ORG_ID: "org_1",
        AGENT_ORG_SCOPE: "personal",
      }),
    ).toEqual({ orgId: "org_1", personal: true });
    expect(
      devOrgChoiceFromEnv({ AGENT_ORG_ID: "", AGENT_ORG_SCOPE: "org" }),
    ).toEqual({ orgId: undefined, personal: false });
  });
});
