import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listWorkspaceApps: vi.fn(),
}));

vi.mock("../server/lib/app-creation-store.js", () => ({
  listWorkspaceApps: mocks.listWorkspaceApps,
}));

import type { ActionRunContext } from "@agent-native/core/action";

import action from "./list-workspace-apps.js";

const input = {
  includeAgentCards: false,
  includeArchived: false,
  audience: "all" as const,
};

function context(userEmail: string, orgId: string | null): ActionRunContext {
  return {
    caller: "http",
    userEmail,
    orgId,
    appId: "dispatch",
  };
}

describe("list-workspace-apps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shares only a pending registry read for the same authorization context", async () => {
    mocks.listWorkspaceApps.mockResolvedValue([]);
    let resolve!: (apps: never[]) => void;
    mocks.listWorkspaceApps.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );

    const caller = context("member@example.com", "org-1");
    const first = action.run(input, caller);
    const concurrent = action.run(input, caller);
    await vi.waitFor(() =>
      expect(mocks.listWorkspaceApps).toHaveBeenCalledOnce(),
    );

    resolve([]);
    await expect(Promise.all([first, concurrent])).resolves.toEqual([[], []]);

    await action.run(input, caller);
    expect(mocks.listWorkspaceApps).toHaveBeenCalledTimes(2);
  });

  it("isolates users, organizations, app contexts, and list options", async () => {
    mocks.listWorkspaceApps.mockResolvedValue([]);

    await Promise.all([
      action.run(input, context("member@example.com", "org-1")),
      action.run(input, context("another@example.com", "org-1")),
      action.run(input, context("member@example.com", "org-2")),
      action.run(input, {
        ...context("member@example.com", "org-1"),
        appId: "other-dispatch",
      }),
      action.run(
        { ...input, includeArchived: true },
        context("member@example.com", "org-1"),
      ),
    ]);

    expect(mocks.listWorkspaceApps).toHaveBeenCalledTimes(5);
  });

  it("returns mounted workspace apps regardless of the built-in app config", async () => {
    vi.stubEnv(
      "AGENT_NATIVE_BUILTIN_AGENTS_JSON",
      JSON.stringify({ mode: "none" }),
    );
    const apps = [
      { id: "crm", name: "CRM", path: "/crm" },
      { id: "mail", name: "Our Mail", path: "/mail" },
    ];
    mocks.listWorkspaceApps.mockResolvedValue(apps);
    try {
      await expect(
        action.run(input, context("builtin-off@example.com", "org-3")),
      ).resolves.toEqual(apps);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
