import { isAgentActionStopError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchOrgApps: vi.fn(),
  fetchOrgAppsResult: vi.fn(),
  getOrgDomain: vi.fn(),
  getAppConfig: vi.fn(),
  isFeatureFlagEnabled: vi.fn(),
  listLocalFeatureFlags: vi.fn(),
  setLocalFeatureFlag: vi.fn(),
  signA2AToken: vi.fn(),
}));

vi.mock("@agent-native/core/a2a", () => ({
  signA2AToken: mocks.signA2AToken,
}));
vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: mocks.isFeatureFlagEnabled,
}));
vi.mock("@agent-native/core/feature-flags/actions/list-feature-flags", () => ({
  default: { run: mocks.listLocalFeatureFlags },
}));
vi.mock("@agent-native/core/feature-flags/actions/set-feature-flag", () => ({
  default: { run: mocks.setLocalFeatureFlag },
}));
vi.mock("@agent-native/core/mcp", () => ({
  fetchOrgApps: mocks.fetchOrgApps,
  fetchOrgAppsResult: mocks.fetchOrgAppsResult,
}));
vi.mock("@agent-native/core/org", () => ({
  getOrgDomain: mocks.getOrgDomain,
}));
vi.mock("@agent-native/core/server", () => ({
  getAppConfig: mocks.getAppConfig,
}));

import {
  classifyWorkspaceFeatureFlagTargetFailure,
  classifyWorkspaceFeatureFlagList,
  getWorkspaceFlagTarget,
  listWorkspaceFeatureFlags,
  setWorkspaceFeatureFlag,
  validateWorkspaceFeatureFlagMutation,
  WorkspaceFeatureFlagFailure,
  workspaceFeatureFlagTargetInput,
} from "./workspace-feature-flags.js";
const app = {
  id: "mail",
  name: "Mail",
  url: "https://mail.example.com",
  a2aUrl: "https://mail.example.com",
};
const admin = {
  userEmail: "admin@example.test",
  orgId: "org-1",
  role: "admin" as const,
};

function response(status: number, body: unknown) {
  return {
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function responseWithBodyFailure(status: number, error: unknown) {
  return {
    status,
    json: vi.fn().mockRejectedValue(error),
  } as unknown as Response;
}

function mutationBody(rules: Record<string, unknown>) {
  return {
    contractVersion: 2,
    status: "ready",
    key: "new-editor",
    rules,
    scope: { orgId: "content-org", orgDomain: "example.test" },
  };
}

function localListBody(
  rules: Record<string, unknown> = {
    mode: "off",
    emails: [],
    orgIds: [],
    percentage: 0,
  },
) {
  return {
    contractVersion: 1,
    status: "ready",
    flags: [
      {
        key: "analytics.resilient-fleet-flag-directory",
        displayName: "Resilient fleet flag directory",
        defaultValue: false,
        rules,
        enabledForCurrentUser: rules.mode !== "off",
      },
    ],
    canManage: true,
  };
}

describe("verified fleet feature flag transaction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.fetchOrgApps.mockResolvedValue([app]);
    mocks.fetchOrgAppsResult.mockResolvedValue({
      status: "available",
      apps: [app],
    });
    mocks.getOrgDomain.mockResolvedValue("example.test");
    mocks.getAppConfig.mockReturnValue({
      app: { url: "https://analytics.example.com" },
    });
    mocks.isFeatureFlagEnabled.mockResolvedValue(true);
    mocks.listLocalFeatureFlags.mockResolvedValue(localListBody());
    mocks.signA2AToken.mockResolvedValue("example-delegated-token");
  });

  it("keeps Analytics ready when the peer directory is unavailable", async () => {
    mocks.fetchOrgAppsResult.mockResolvedValue({
      status: "unavailable",
      reason: "network",
    });
    const targetFetch = vi.spyOn(globalThis, "fetch");

    await expect(listWorkspaceFeatureFlags(admin)).resolves.toEqual({
      directoryStatus: "unavailable",
      apps: [
        expect.objectContaining({
          appId: "analytics",
          appName: "Analytics",
          appOrigin: "https://analytics.example.com",
          state: "ready",
          flags: [
            expect.objectContaining({
              key: "analytics.resilient-fleet-flag-directory",
            }),
          ],
        }),
      ],
    });
    expect(mocks.listLocalFeatureFlags).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        userEmail: admin.userEmail,
        orgId: admin.orgId,
        actionName: "list-feature-flags",
      }),
    );
    expect(targetFetch).not.toHaveBeenCalled();
  });

  it("prepends Analytics without changing directory-backed sibling listing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      response(200, {
        contractVersion: 1,
        status: "no-definitions",
        flags: [],
        canManage: true,
      }),
    );

    await expect(listWorkspaceFeatureFlags(admin)).resolves.toMatchObject({
      directoryStatus: "available",
      apps: [
        { appId: "analytics", state: "ready" },
        { appId: "mail", state: "no-definitions" },
      ],
    });
    expect(mocks.signA2AToken).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("keeps healthy peers visible when the local Analytics list fails", async () => {
    mocks.listLocalFeatureFlags.mockRejectedValueOnce(
      new Error("private local store detail"),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      response(200, {
        contractVersion: 1,
        status: "no-definitions",
        flags: [],
        canManage: true,
      }),
    );

    await expect(listWorkspaceFeatureFlags(admin)).resolves.toMatchObject({
      directoryStatus: "available",
      apps: [
        {
          appId: "analytics",
          state: "unreachable",
          reason: "target-execution",
        },
        { appId: "mail", state: "no-definitions" },
      ],
    });
  });

  it("mutates and verifies Analytics locally without directory or A2A", async () => {
    const targetFetch = vi.spyOn(globalThis, "fetch");
    const rules = {
      mode: "rules",
      emails: [admin.userEmail],
      orgIds: [],
      percentage: 0,
    };
    mocks.setLocalFeatureFlag.mockResolvedValue({
      contractVersion: 2,
      status: "ready",
      key: "analytics.resilient-fleet-flag-directory",
      rules,
      scope: { orgId: admin.orgId, orgDomain: "example.test" },
    });
    mocks.listLocalFeatureFlags.mockResolvedValue(localListBody(rules));

    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "analytics",
        key: "analytics.resilient-fleet-flag-directory",
        operation: "enable-for-current-user",
      }),
    ).resolves.toMatchObject({
      contractVersion: 3,
      status: "verified",
      enabledForCurrentUser: true,
      rules,
    });
    expect(mocks.setLocalFeatureFlag).toHaveBeenCalledOnce();
    expect(mocks.listLocalFeatureFlags).toHaveBeenCalledOnce();
    expect(mocks.fetchOrgApps).not.toHaveBeenCalled();
    expect(mocks.fetchOrgAppsResult).not.toHaveBeenCalled();
    expect(mocks.signA2AToken).not.toHaveBeenCalled();
    expect(targetFetch).not.toHaveBeenCalled();
  });

  it("preserves agent-run provenance for a local Analytics mutation", async () => {
    const rules = {
      mode: "off",
      emails: [],
      orgIds: [],
      percentage: 0,
    };
    mocks.setLocalFeatureFlag.mockResolvedValue({
      contractVersion: 2,
      status: "ready",
      key: "analytics.resilient-fleet-flag-directory",
      rules,
      scope: { orgId: admin.orgId, orgDomain: "example.test" },
    });
    mocks.listLocalFeatureFlags.mockResolvedValue(localListBody(rules));
    const sourceContext = {
      caller: "tool" as const,
      threadId: "thread-1",
      runId: "run-1",
      turnId: "turn-1",
    };

    await setWorkspaceFeatureFlag(
      admin,
      {
        appId: "analytics",
        key: "analytics.resilient-fleet-flag-directory",
        operation: "off",
      },
      sourceContext,
    );

    expect(mocks.setLocalFeatureFlag).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        caller: "tool",
        threadId: "thread-1",
        runId: "run-1",
        turnId: "turn-1",
        userEmail: admin.userEmail,
        orgId: admin.orgId,
        appId: "analytics",
        actionName: "set-feature-flag",
      }),
    );
  });

  it("classifies local readback authorization loss after persistence", async () => {
    const rules = {
      mode: "off",
      emails: [],
      orgIds: [],
      percentage: 0,
    };
    mocks.setLocalFeatureFlag.mockResolvedValue({
      contractVersion: 2,
      status: "ready",
      key: "analytics.resilient-fleet-flag-directory",
      rules,
      scope: { orgId: admin.orgId, orgDomain: "example.test" },
    });
    mocks.listLocalFeatureFlags.mockResolvedValue({
      contractVersion: 1,
      status: "forbidden",
      flags: [],
      canManage: false,
    });

    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "analytics",
        key: "analytics.resilient-fleet-flag-directory",
        operation: "off",
      }),
    ).rejects.toMatchObject({ phase: "authorization" });
  });

  it("classifies local readback store errors after persistence", async () => {
    const rules = {
      mode: "off",
      emails: [],
      orgIds: [],
      percentage: 0,
    };
    mocks.setLocalFeatureFlag.mockResolvedValue({
      contractVersion: 2,
      status: "ready",
      key: "analytics.resilient-fleet-flag-directory",
      rules,
      scope: { orgId: admin.orgId, orgDomain: "example.test" },
    });
    mocks.listLocalFeatureFlags.mockRejectedValue(
      new Error("private local store detail"),
    );

    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "analytics",
        key: "analytics.resilient-fleet-flag-directory",
        operation: "off",
      }),
    ).rejects.toMatchObject({ phase: "verification" });
  });

  it("reads Analytics target state locally without directory or A2A", async () => {
    await expect(
      getWorkspaceFlagTarget(admin, "analytics"),
    ).resolves.toMatchObject({ appId: "analytics", state: "ready" });
    expect(mocks.fetchOrgApps).not.toHaveBeenCalled();
    expect(mocks.signA2AToken).not.toHaveBeenCalled();
  });

  it("independently reads back Alice-targeted enablement", async () => {
    const mutationRules = {
      mode: "rules",
      emails: ["admin@example.test"],
      orgIds: [],
      percentage: 0,
      updatedAt: 1,
      updatedBy: "writer@example.test",
    };
    const readBackRules = {
      ...mutationRules,
      updatedAt: 2,
      updatedBy: "admin@example.test",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(200, mutationBody(mutationRules)))
      .mockResolvedValueOnce(
        response(200, {
          contractVersion: 1,
          status: "ready",
          flags: [
            {
              key: "new-editor",
              rules: readBackRules,
              enabledForCurrentUser: true,
            },
          ],
          canManage: true,
        }),
      );

    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "mail",
        key: "new-editor",
        operation: "enable-for-current-user",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        contractVersion: 3,
        status: "verified",
        rules: readBackRules,
        enabledForCurrentUser: true,
      }),
    );
    expect(mocks.signA2AToken).toHaveBeenCalledTimes(2);
  });

  it("independently reads back rollback as off", async () => {
    const rules = {
      mode: "off",
      emails: [],
      orgIds: [],
      percentage: 0,
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(200, mutationBody(rules)))
      .mockResolvedValueOnce(
        response(200, {
          contractVersion: 1,
          status: "ready",
          flags: [{ key: "new-editor", rules, enabledForCurrentUser: false }],
          canManage: true,
        }),
      );

    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "mail",
        key: "new-editor",
        operation: "off",
      }),
    ).resolves.toEqual(
      expect.objectContaining({ enabledForCurrentUser: false }),
    );
  });

  it("retries one unavailable directory lookup before sending one mutation", async () => {
    const rules = { mode: "off", emails: [], orgIds: [], percentage: 0 };
    mocks.fetchOrgAppsResult
      .mockResolvedValueOnce({ status: "unavailable", reason: "network" })
      .mockResolvedValueOnce({ status: "available", apps: [app] });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(200, mutationBody(rules)))
      .mockResolvedValueOnce(
        response(200, {
          contractVersion: 1,
          status: "ready",
          flags: [{ key: "new-editor", rules, enabledForCurrentUser: false }],
          canManage: true,
        }),
      );

    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "mail",
        key: "new-editor",
        operation: "off",
      }),
    ).resolves.toMatchObject({ status: "verified" });
    expect(mocks.fetchOrgAppsResult).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps resilient directory retries dormant while the rollout flag is off", async () => {
    mocks.isFeatureFlagEnabled.mockResolvedValue(false);
    mocks.fetchOrgApps.mockResolvedValue([app]);
    const rules = { mode: "off", emails: [], orgIds: [], percentage: 0 };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      response(200, mutationBody(rules)),
    );

    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "mail",
        key: "new-editor",
        operation: "off",
      }),
    ).resolves.toMatchObject({ contractVersion: 2, status: "ready" });
    expect(mocks.fetchOrgApps).toHaveBeenCalledOnce();
    expect(mocks.fetchOrgAppsResult).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("does not retry a successful directory response missing the target", async () => {
    mocks.fetchOrgAppsResult.mockResolvedValue({
      status: "available",
      apps: [],
    });
    const targetFetch = vi.spyOn(globalThis, "fetch");

    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "mail",
        key: "new-editor",
        operation: "off",
      }),
    ).rejects.toMatchObject({ phase: "directory" });
    expect(mocks.fetchOrgAppsResult).toHaveBeenCalledOnce();
    expect(targetFetch).not.toHaveBeenCalled();
  });

  it("preserves a persistent directory failure without sending a mutation", async () => {
    mocks.fetchOrgAppsResult.mockResolvedValue({
      status: "unavailable",
      reason: "timeout",
    });
    const targetFetch = vi.spyOn(globalThis, "fetch");

    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "mail",
        key: "new-editor",
        operation: "off",
      }),
    ).rejects.toMatchObject({ phase: "directory" });
    expect(mocks.fetchOrgAppsResult).toHaveBeenCalledTimes(2);
    expect(targetFetch).not.toHaveBeenCalled();
  });

  it.each([
    "not-configured",
    "authentication",
    "authorization",
    "invalid-response",
    "http-error",
  ] as const)(
    "does not retry non-transient directory reason %s",
    async (reason) => {
      mocks.fetchOrgAppsResult.mockResolvedValue({
        status: "unavailable",
        reason,
      });
      const targetFetch = vi.spyOn(globalThis, "fetch");

      await expect(
        setWorkspaceFeatureFlag(admin, {
          appId: "mail",
          key: "new-editor",
          operation: "off",
        }),
      ).rejects.toMatchObject({ phase: "directory" });
      expect(mocks.fetchOrgAppsResult).toHaveBeenCalledOnce();
      expect(targetFetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    Object.assign(new Error("private timeout"), { name: "TimeoutError" }),
    new Error("private network detail"),
  ])("retries one transient verification transport failure", async (error) => {
    const rules = {
      mode: "off",
      emails: [],
      orgIds: [],
      percentage: 0,
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(200, mutationBody(rules)))
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(
        response(200, {
          contractVersion: 1,
          status: "ready",
          flags: [{ key: "new-editor", rules, enabledForCurrentUser: false }],
          canManage: true,
        }),
      );

    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "mail",
        key: "new-editor",
        operation: "off",
      }),
    ).resolves.toMatchObject({
      contractVersion: 3,
      status: "verified",
      enabledForCurrentUser: false,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.signA2AToken).toHaveBeenCalledTimes(3);
  });

  it.each([
    Object.assign(new Error("private body timeout"), { name: "TimeoutError" }),
    new Error("private interrupted body detail"),
  ])(
    "retries one transient verification response-body failure",
    async (error) => {
      const rules = {
        mode: "off",
        emails: [],
        orgIds: [],
        percentage: 0,
      };
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(response(200, mutationBody(rules)))
        .mockResolvedValueOnce(responseWithBodyFailure(200, error))
        .mockResolvedValueOnce(
          response(200, {
            contractVersion: 1,
            status: "ready",
            flags: [{ key: "new-editor", rules, enabledForCurrentUser: false }],
            canManage: true,
          }),
        );
      mocks.signA2AToken
        .mockReset()
        .mockResolvedValueOnce("mutation-token")
        .mockResolvedValueOnce("verification-token-1")
        .mockResolvedValueOnce("verification-token-2");

      await expect(
        setWorkspaceFeatureFlag(admin, {
          appId: "mail",
          key: "new-editor",
          operation: "off",
        }),
      ).resolves.toMatchObject({
        contractVersion: 3,
        status: "verified",
        enabledForCurrentUser: false,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
        "https://mail.example.com/_agent-native/actions/set-feature-flag",
        "https://mail.example.com/_agent-native/actions/list-feature-flags",
        "https://mail.example.com/_agent-native/actions/list-feature-flags",
      ]);
      expect(
        fetchSpy.mock.calls.map(
          ([, options]) =>
            (options?.headers as Record<string, string>).Authorization,
        ),
      ).toEqual([
        "Bearer mutation-token",
        "Bearer verification-token-1",
        "Bearer verification-token-2",
      ]);
      expect(mocks.signA2AToken).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    [
      "verification-timeout",
      Object.assign(new Error("private body timeout"), {
        name: "TimeoutError",
      }),
    ],
    ["verification-network", new Error("private interrupted body detail")],
  ] as const)(
    "preserves %s after response-body verification retries are exhausted",
    async (phase, error) => {
      const rules = {
        mode: "off",
        emails: [],
        orgIds: [],
        percentage: 0,
      };
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(response(200, mutationBody(rules)))
        .mockResolvedValueOnce(responseWithBodyFailure(200, error))
        .mockResolvedValueOnce(responseWithBodyFailure(200, error));

      await expect(
        setWorkspaceFeatureFlag(admin, {
          appId: "mail",
          key: "new-editor",
          operation: "off",
        }),
      ).rejects.toMatchObject({ phase, agentNativeStop: true });
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    },
  );

  it("does not retry a mutation whose successful response body is interrupted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      responseWithBodyFailure(
        200,
        Object.assign(new Error("private body timeout"), {
          name: "TimeoutError",
        }),
      ),
    );

    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "mail",
        key: "new-editor",
        operation: "off",
      }),
    ).rejects.toMatchObject({ phase: "timeout", agentNativeStop: true });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("keeps invalid JSON and non-success statuses on their existing boundaries", async () => {
    const input = {
      appId: "mail",
      key: "new-editor",
      operation: "off" as const,
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        responseWithBodyFailure(200, {
          name: "SyntaxError",
          message: "private cross-realm invalid JSON",
        }),
      )
      .mockResolvedValueOnce(
        responseWithBodyFailure(403, new Error("private interrupted body")),
      );

    await expect(setWorkspaceFeatureFlag(admin, input)).rejects.toMatchObject({
      phase: "persistence",
    });
    await expect(setWorkspaceFeatureFlag(admin, input)).rejects.toMatchObject({
      phase: "authorization",
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "verification-timeout",
      "workspace_feature_flag_verification_timeout",
      Object.assign(new Error("private timeout"), { name: "TimeoutError" }),
    ],
    [
      "verification-network",
      "workspace_feature_flag_verification_network",
      new Error("private network detail"),
    ],
  ] as const)(
    "fails with the exact %s phase after verification retries are exhausted",
    async (phase, errorCode, error) => {
      const rules = {
        mode: "off",
        emails: [],
        orgIds: [],
        percentage: 0,
      };
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(response(200, mutationBody(rules)))
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error);

      await expect(
        setWorkspaceFeatureFlag(admin, {
          appId: "mail",
          key: "new-editor",
          operation: "off",
        }),
      ).rejects.toMatchObject({ phase, errorCode, agentNativeStop: true });
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    },
  );

  it("accepts replacement rules independently read back for another audience", async () => {
    const rules = {
      mode: "rules",
      emails: ["someone-else@example.test"],
      orgIds: [],
      percentage: 0,
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(200, mutationBody(rules)))
      .mockResolvedValueOnce(
        response(200, {
          contractVersion: 1,
          status: "ready",
          flags: [{ key: "new-editor", rules, enabledForCurrentUser: false }],
          canManage: true,
        }),
      );

    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "mail",
        key: "new-editor",
        operation: "replace-rules",
        rules,
      }),
    ).resolves.toMatchObject({ enabledForCurrentUser: false });
  });

  it.each([
    [
      "directory",
      async () =>
        mocks.fetchOrgAppsResult.mockResolvedValue({
          status: "unavailable",
          reason: "authorization",
        }),
    ],
    [
      "token-generation",
      async () => mocks.getOrgDomain.mockResolvedValue(null),
    ],
  ] as const)("preserves the %s failure boundary", async (phase, arrange) => {
    await arrange();
    const failure = setWorkspaceFeatureFlag(admin, {
      appId: "mail",
      key: "new-editor",
      operation: "off",
    });
    await expect(failure).rejects.toMatchObject({
      phase,
      errorCode: `workspace_feature_flag_${phase.replace("-", "_")}`,
      statusCode: 503,
    });
    await expect(failure).rejects.toSatisfy(
      (error: unknown) => !isAgentActionStopError(error),
    );
  });

  it("keeps mutation token-signing failures retryable before any request", async () => {
    mocks.signA2AToken.mockRejectedValue(new Error("private signing failure"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const failure = setWorkspaceFeatureFlag(admin, {
      appId: "mail",
      key: "new-editor",
      operation: "off",
    });

    await expect(failure).rejects.toMatchObject({
      phase: "token-generation",
      errorCode: "workspace_feature_flag_token_generation",
      statusCode: 503,
    });
    await expect(failure).rejects.toSatisfy(
      (error: unknown) => !isAgentActionStopError(error),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [401, "authorization"],
    [404, "unsupported-target"],
    [500, "target-action"],
  ] as const)("classifies target status %s as %s", async (status, phase) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(status, null));
    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "mail",
        key: "new-editor",
        operation: "off",
      }),
    ).rejects.toMatchObject({ phase });
  });

  it.each([
    [
      Object.assign(new Error("private timeout"), { name: "TimeoutError" }),
      "timeout",
    ],
    [new Error("private network detail"), "network"],
  ] as const)("preserves transport failure as %s", async (error, phase) => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(error);
    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "mail",
        key: "new-editor",
        operation: "off",
      }),
    ).rejects.toMatchObject({ phase });
  });

  it("keeps persistence distinct from independent verification", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(200, { unexpected: true }))
      .mockResolvedValueOnce(
        response(
          200,
          mutationBody({
            mode: "off",
            emails: [],
            orgIds: [],
            percentage: 0,
          }),
        ),
      )
      .mockResolvedValueOnce(
        response(200, {
          contractVersion: 1,
          status: "ready",
          flags: [],
          canManage: true,
        }),
      );
    const input = {
      appId: "mail",
      key: "new-editor",
      operation: "off" as const,
    };
    await expect(setWorkspaceFeatureFlag(admin, input)).rejects.toMatchObject({
      phase: "persistence",
    });
    await expect(setWorkspaceFeatureFlag(admin, input)).rejects.toMatchObject({
      phase: "verification",
    });
  });

  it.each([
    [403, null, "authorization"],
    [404, null, "unsupported-target"],
    [
      200,
      {
        contractVersion: 1,
        status: "forbidden",
        flags: [],
        canManage: false,
      },
      "authorization",
    ],
  ] as const)(
    "preserves read-back status %s as %s",
    async (status, body, phase) => {
      const rules = {
        mode: "off",
        emails: [],
        orgIds: [],
        percentage: 0,
      };
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(response(200, mutationBody(rules)))
        .mockResolvedValueOnce(response(status, body));

      await expect(
        setWorkspaceFeatureFlag(admin, {
          appId: "mail",
          key: "new-editor",
          operation: "off",
        }),
      ).rejects.toMatchObject({ phase });
    },
  );

  it("keeps the legacy response while the rollout gate is off", async () => {
    mocks.isFeatureFlagEnabled.mockResolvedValue(false);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        200,
        mutationBody({ mode: "rules", emails: ["admin@example.test"] }),
      ),
    );
    await expect(
      setWorkspaceFeatureFlag(admin, {
        appId: "mail",
        key: "new-editor",
        operation: "enable-for-current-user",
      }),
    ).resolves.toMatchObject({ contractVersion: 2, status: "ready" });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("uses safe phase messages without reflecting target details", () => {
    const error = new WorkspaceFeatureFlagFailure("network");
    expect(error.message).toBe(
      "[network] Analytics could not reach the target app.",
    );
    expect(isAgentActionStopError(error)).toBe(true);
    expect(error).toMatchObject({
      details: { phase: "network" },
      errorCode: "workspace_feature_flag_network",
      phase: "network",
    });
    expect(error.toolResult).not.toContain("private");
  });
});

describe("fleet feature flag contracts", () => {
  it("does not mistake no-definitions for forbidden", () =>
    expect(
      classifyWorkspaceFeatureFlagList(app, {
        status: 200,
        body: {
          contractVersion: 1,
          status: "no-definitions",
          flags: [],
          canManage: false,
        },
      }).state,
    ).toBe("no-definitions"));
  it("keeps successful legacy shapes unknown", () =>
    expect(
      classifyWorkspaceFeatureFlagList(app, {
        status: 200,
        body: { flags: [{ key: "x" }], canManage: true },
      }).state,
    ).toBe("unknown-legacy"));
  it("classifies permission and unsupported responses", () => {
    expect(
      classifyWorkspaceFeatureFlagList(app, { status: 403, body: null }).state,
    ).toBe("forbidden");
    expect(
      classifyWorkspaceFeatureFlagList(app, { status: 404, body: null }).state,
    ).toBe("unsupported");
  });
  it("exposes safe target failure classes without reflecting error text", () => {
    expect(
      classifyWorkspaceFeatureFlagTargetFailure(
        Object.assign(new Error("secret-bearing timeout"), {
          name: "TimeoutError",
        }),
      ),
    ).toBe("timeout");
    expect(
      classifyWorkspaceFeatureFlagTargetFailure(
        new Error("getaddrinfo ENOTFOUND private-host"),
      ),
    ).toBe("network");
    expect(
      classifyWorkspaceFeatureFlagList(app, { status: 500, body: null }),
    ).toMatchObject({ state: "unknown-legacy", reason: "target-execution" });
  });
  it("rejects legacy or mismatched mutation responses", () => {
    const expected = {
      key: "new-editor",
      orgDomain: "builder.io",
      rules: { percentage: 50 },
    };
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        { key: "new-editor", rules: expected.rules },
        expected,
      ),
    ).toThrow("unsupported or unverified");
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        {
          contractVersion: 2,
          status: "ready",
          key: "new-editor",
          rules: { percentage: 25 },
          scope: { orgDomain: "builder.io" },
        },
        expected,
      ),
    ).toThrow("did not persist");
  });
  it("accepts an exact versioned persisted mutation", () => {
    const rules = { percentage: 50 };
    expect(
      validateWorkspaceFeatureFlagMutation(
        {
          contractVersion: 2,
          status: "ready",
          key: "new-editor",
          rules,
          scope: { orgDomain: "builder.io" },
        },
        { key: "new-editor", orgDomain: "builder.io", rules },
      ),
    ).toMatchObject({ contractVersion: 2, key: "new-editor", rules });
  });

  it("accepts an explicit no-org target scope only when requested", () => {
    const body = {
      contractVersion: 2,
      status: "ready",
      key: "new-editor",
      rules: { mode: "rules", emails: ["admin@example.com"] },
      scope: { orgDomain: null },
    };

    expect(() =>
      validateWorkspaceFeatureFlagMutation(body, {
        key: "new-editor",
        orgDomain: "builder.io",
      }),
    ).toThrow("unsupported or unverified");

    expect(
      validateWorkspaceFeatureFlagMutation(body, {
        key: "new-editor",
        orgDomain: "builder.io",
        allowExplicitNoOrgTarget: true,
      }),
    ).toMatchObject({ key: "new-editor" });
  });
  it("verifies off and enable-for-operator persisted semantics", () => {
    const base = {
      contractVersion: 2 as const,
      status: "ready" as const,
      key: "new-editor",
      scope: { orgDomain: "builder.io" },
    };
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        { ...base, rules: { mode: "on", percentage: 100 } },
        {
          key: "new-editor",
          orgDomain: "builder.io",
          rules: { mode: "off", emails: [], orgIds: [], percentage: 0 },
        },
      ),
    ).toThrow("did not persist");
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        { ...base, rules: { mode: "off", percentage: 0 } },
        {
          key: "new-editor",
          orgDomain: "builder.io",
          rules: { mode: "off", emails: [], orgIds: [], percentage: 0 },
        },
      ),
    ).toThrow("did not persist");
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        { ...base, rules: { mode: "rules", emails: [] } },
        {
          key: "new-editor",
          orgDomain: "builder.io",
          enabledForEmail: "admin@example.com",
        },
      ),
    ).toThrow("did not enable");
    expect(
      validateWorkspaceFeatureFlagMutation(
        {
          ...base,
          rules: { mode: "rules", emails: ["ADMIN@EXAMPLE.COM"] },
        },
        {
          key: "new-editor",
          orgDomain: "builder.io",
          enabledForEmail: "admin@example.com",
        },
      ),
    ).toMatchObject({ key: "new-editor" });
  });
  it("compares canonicalized target arrays", () => {
    expect(
      validateWorkspaceFeatureFlagMutation(
        {
          contractVersion: 2,
          status: "ready",
          key: "new-editor",
          rules: {
            mode: "rules",
            emails: ["a@example.com", "B@example.com"],
            orgIds: ["org-a", "org-b"],
          },
          scope: { orgDomain: "builder.io" },
        },
        {
          key: "new-editor",
          orgDomain: "builder.io",
          rules: {
            mode: "rules",
            emails: ["b@example.com", "A@example.com"],
            orgIds: ["org-b", "org-a"],
          },
        },
      ),
    ).toMatchObject({ key: "new-editor" });
  });
  it("rejects stale targets from a percentage-only replacement", () => {
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        {
          contractVersion: 2,
          status: "ready",
          key: "new-editor",
          rules: {
            mode: "rules",
            emails: ["stale@example.com"],
            orgIds: [],
            percentage: 50,
          },
          scope: { orgDomain: "builder.io" },
        },
        {
          key: "new-editor",
          orgDomain: "builder.io",
          rules: {
            mode: "rules",
            emails: [],
            orgIds: [],
            percentage: 50,
          },
        },
      ),
    ).toThrow("did not persist");
  });
  it("rejects malformed targets instead of normalizing them away", () => {
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        {
          contractVersion: 2,
          status: "ready",
          key: "new-editor",
          rules: {
            mode: "rules",
            emails: [123],
            orgIds: [],
            percentage: 50,
          },
          scope: { orgDomain: "builder.io" },
        },
        {
          key: "new-editor",
          orgDomain: "builder.io",
          rules: {
            mode: "rules",
            emails: [],
            orgIds: [],
            percentage: 50,
          },
        },
      ),
    ).toThrow("did not persist");
  });
  it("sends explicit empty target lists for percentage replacements", () => {
    expect(
      workspaceFeatureFlagTargetInput({
        appId: "mail",
        key: "new-editor",
        operation: "replace-rules",
        rules: { mode: "rules", percentage: 50 },
      }),
    ).toEqual({
      key: "new-editor",
      operation: "replace-rules",
      rules: {
        mode: "rules",
        emails: [],
        orgIds: [],
        percentage: 50,
      },
    });
  });
});
