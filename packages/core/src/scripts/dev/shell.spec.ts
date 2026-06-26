import { afterEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../../server/request-context.js";

const execSyncMock = vi.hoisted(() => vi.fn(() => "ok"));

vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
}));

describe("dev shell tool", () => {
  afterEach(() => {
    execSyncMock.mockClear();
    delete process.env.AGENT_USER_EMAIL;
    delete process.env.AGENT_USER_NAME;
    delete process.env.AGENT_ORG_ID;
    delete process.env.AGENT_USER_TIMEZONE;
  });

  it("passes the active request identity to child pnpm action commands", async () => {
    process.env.AGENT_USER_EMAIL = "stale@example.com";
    process.env.AGENT_USER_NAME = "Stale User";
    process.env.AGENT_ORG_ID = "stale-org";
    process.env.AGENT_USER_TIMEZONE = "UTC";

    const { run } = await import("./shell.js");

    await runWithRequestContext(
      {
        userEmail: "madison@example.com",
        userName: "Madison Dickson",
        orgId: "builder",
        timezone: "America/Los_Angeles",
      },
      () => run({ command: "pnpm action navigate --view=list" }),
    );

    expect(execSyncMock).toHaveBeenCalledWith(
      "pnpm action navigate --view=list",
      expect.objectContaining({
        env: expect.objectContaining({
          AGENT_USER_EMAIL: "madison@example.com",
          AGENT_USER_NAME: "Madison Dickson",
          AGENT_ORG_ID: "builder",
          AGENT_USER_TIMEZONE: "America/Los_Angeles",
        }),
      }),
    );
    expect(process.env.AGENT_USER_EMAIL).toBe("stale@example.com");
  });

  it("does not leak stale process identity into anonymous request contexts", async () => {
    process.env.AGENT_USER_EMAIL = "stale@example.com";
    process.env.AGENT_ORG_ID = "stale-org";

    const { run } = await import("./shell.js");

    await runWithRequestContext({}, () => run({ command: "echo hi" }));

    const env = execSyncMock.mock.calls[0]?.[1]?.env;
    expect(env.AGENT_USER_EMAIL).toBeUndefined();
    expect(env.AGENT_ORG_ID).toBeUndefined();
    expect(process.env.AGENT_USER_EMAIL).toBe("stale@example.com");
  });
});
