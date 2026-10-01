import { beforeEach, describe, expect, it, vi } from "vitest";

const deployEnvironmentMock = vi.hoisted(() => vi.fn(() => "local"));

vi.mock("../server/deploy-environment.js", () => ({
  resolveDeployEnvironment: deployEnvironmentMock,
}));

import {
  applyAutomationFailure,
  automationOwnerKind,
  classifyAutomationFailure,
  hasStalePause,
  isPausedByFramework,
  isPseudoOwner,
  isReservedIdentityBlocked,
  isReservedTestIdentity,
  pauseNow,
  PRECONDITION_PAUSE_AFTER,
  RUNTIME_PAUSE_AFTER,
  runtimeFailureNextRun,
  withDeliveryNote,
  type AutomationFailure,
} from "./automation-outcome.js";

const NOW = new Date("2026-10-01T12:00:00.000Z");

function codedError(message: string, errorCode: string): Error {
  return Object.assign(new Error(message), { errorCode });
}

const missingCredentials: AutomationFailure = {
  code: "missing_credentials",
  message: "No LLM provider is connected.",
  precondition: true,
};

describe("classifyAutomationFailure", () => {
  it.each([
    ["missing_credentials", "missing_credentials", true],
    ["missing_tools", "missing_tools", true],
    ["config_invalid", "config_invalid", true],
    ["owner_missing", "owner_missing", true],
    // The pre-typed runner code is read as the typed one.
    ["background_automation_mcp_tools_unavailable", "missing_tools", true],
    // A rejected or unpermitted credential needs a person; a bare HTTP status
    // or a spent quota is not read as one.
    ["builder_auth_error", "builder_auth_error", true],
    [
      "personal_provider_keys_restricted",
      "personal_provider_keys_restricted",
      true,
    ],
    ["http_401", "http_401", false],
    ["credits-limit-daily", "credits-limit-daily", false],
    ["http_502", "http_502", false],
    [
      "background_automation_hard_timeout",
      "background_automation_hard_timeout",
      false,
    ],
  ])("types %s as %s", (errorCode, code, precondition) => {
    expect(classifyAutomationFailure(codedError("boom", errorCode))).toEqual({
      code,
      message: "boom",
      precondition,
    });
  });

  it("types the app tool supplier's untyped missing-tools error", () => {
    expect(
      classifyAutomationFailure(
        new Error(
          "Configured MCP tools are unavailable in this run: mcp__codex_apps__github_create_pr. Reconnect the MCP server or update the automation's capability list.",
        ),
      ),
    ).toMatchObject({ code: "missing_tools", precondition: true });
  });

  it("keeps the real cause for a generic run ending", () => {
    const failure = classifyAutomationFailure(
      codedError("Gateway returned 502", "background_automation_errored"),
    );
    expect(failure).toMatchObject({
      code: "background_automation_errored",
      message: "Gateway returned 502",
      precondition: false,
    });
  });

  it("reads a missing LLM provider out of an untyped message", () => {
    expect(
      classifyAutomationFailure(
        codedError(
          "No LLM provider is connected. Connect one.",
          "background_automation_errored",
        ),
      ),
    ).toMatchObject({ code: "missing_credentials", precondition: true });
    expect(
      classifyAutomationFailure(new Error("socket hang up")),
    ).toMatchObject({
      code: "background_automation_failed",
      precondition: false,
    });
  });

  it("does not call an unreadable credential store a missing credential", () => {
    expect(
      classifyAutomationFailure(
        codedError("store unreadable", "credential_store_unavailable"),
      ),
    ).toMatchObject({
      code: "credential_store_unavailable",
      precondition: false,
    });
  });
});

describe("applyAutomationFailure", () => {
  const fresh = { enabled: true } as const;

  it("records the real cause and code on the first failure without pausing", () => {
    const transition = applyAutomationFailure(fresh, missingCredentials, NOW);
    expect(transition).toMatchObject({ consecutiveFailures: 1, pause: false });
    expect(transition.patch).toMatchObject({
      lastStatus: "error",
      lastErrorCode: "missing_credentials",
      consecutiveFailures: 1,
    });
    expect(transition.patch.lastError).toContain("No LLM provider");
    expect(transition.patch.lastError).not.toContain("ended with status");
    expect(transition.patch.enabled).toBeUndefined();
  });

  it("pauses on the third identical precondition failure and records why", () => {
    let meta: Parameters<typeof applyAutomationFailure>[0] = { ...fresh };
    let last = applyAutomationFailure(meta, missingCredentials, NOW);
    for (let i = 1; i < PRECONDITION_PAUSE_AFTER; i += 1) {
      expect(last.pause).toBe(false);
      meta = {
        enabled: true,
        lastErrorCode: String(last.patch.lastErrorCode),
        consecutiveFailures: Number(last.patch.consecutiveFailures),
      };
      last = applyAutomationFailure(meta, missingCredentials, NOW);
    }
    expect(last.pause).toBe(true);
    expect(last.patch).toMatchObject({
      enabled: false,
      lastStatus: "paused",
      pausedReason: "missing_credentials",
      pausedAt: NOW.toISOString(),
      consecutiveFailures: 3,
    });
    expect(last.patch.lastError).toContain("Paused after 3 consecutive");
    expect(last.patch.lastError).toContain("No LLM provider is connected");
  });

  it("gives ordinary runtime errors more attempts before pausing", () => {
    const runtime: AutomationFailure = {
      code: "http_502",
      message: "bad gateway",
      precondition: false,
    };
    const atThree = applyAutomationFailure(
      { enabled: true, lastErrorCode: "http_502", consecutiveFailures: 2 },
      runtime,
      NOW,
    );
    expect(atThree.pause).toBe(false);
    const atFive = applyAutomationFailure(
      {
        enabled: true,
        lastErrorCode: "http_502",
        consecutiveFailures: RUNTIME_PAUSE_AFTER - 1,
      },
      runtime,
      NOW,
    );
    expect(atFive.pause).toBe(true);
    expect(atFive.patch.pausedReason).toBe("http_502");
  });

  it("restarts the streak when the failure changes or a success intervened", () => {
    const transition = applyAutomationFailure(
      {
        enabled: true,
        lastErrorCode: "http_502",
        consecutiveFailures: 4,
      },
      missingCredentials,
      NOW,
    );
    expect(transition).toMatchObject({ consecutiveFailures: 1, pause: false });
  });

  it("ignores the streak behind a pause the owner already lifted", () => {
    const meta = {
      enabled: true,
      lastErrorCode: "missing_credentials",
      consecutiveFailures: 3,
      pausedReason: "missing_credentials",
    };
    expect(hasStalePause(meta)).toBe(true);
    expect(isPausedByFramework(meta)).toBe(false);
    expect(applyAutomationFailure(meta, missingCredentials, NOW)).toMatchObject(
      { consecutiveFailures: 1, pause: false },
    );
  });

  it("records a manual run's cause without moving the streak", () => {
    const transition = applyAutomationFailure(
      {
        enabled: true,
        lastErrorCode: "missing_credentials",
        consecutiveFailures: 2,
      },
      missingCredentials,
      NOW,
      { countTowardPause: false },
    );
    expect(transition.pause).toBe(false);
    expect(transition.patch).toMatchObject({
      lastStatus: "error",
      lastErrorCode: "missing_credentials",
    });
    expect(transition.patch).not.toHaveProperty("consecutiveFailures");
  });
});

describe("pauseNow", () => {
  it("disables on first observation with the typed reason", () => {
    const transition = pauseNow(
      {
        code: "owner_missing",
        message: 'user "ghost@example.com" no longer exists',
        precondition: true,
      },
      NOW,
    );
    expect(transition.pause).toBe(true);
    expect(transition.patch).toMatchObject({
      enabled: false,
      lastStatus: "paused",
      pausedReason: "owner_missing",
      lastErrorCode: "owner_missing",
    });
  });
});

describe("reserved test identities", () => {
  beforeEach(() => deployEnvironmentMock.mockReturnValue("local"));

  it.each([
    "qa-bot@local.test",
    "dev@agent-native.test",
    "x@something.invalid",
    "x@host.example",
    "a@example.com",
    "a@Example.ORG",
    "a@mail.example.net",
  ])("treats %s as reserved", (email) => {
    expect(isReservedTestIdentity(email)).toBe(true);
  });

  it.each([
    "steve@builder.io",
    "someone@notexample.com",
    "a@testing.dev",
    "__shared__",
    "__organization__:acme",
    "",
  ])("treats %s as a real identity", (email) => {
    expect(isReservedTestIdentity(email)).toBe(false);
  });

  it("only blocks them in production", () => {
    expect(isReservedIdentityBlocked("qa-bot@local.test")).toBe(false);
    deployEnvironmentMock.mockReturnValue("beta");
    expect(isReservedIdentityBlocked("qa-bot@local.test")).toBe(false);
    deployEnvironmentMock.mockReturnValue("production");
    expect(isReservedIdentityBlocked("qa-bot@local.test")).toBe(true);
    expect(isReservedIdentityBlocked("steve@builder.io")).toBe(false);
  });

  it("does not read the deploy environment for a real identity", () => {
    deployEnvironmentMock.mockClear();
    isReservedIdentityBlocked("steve@builder.io");
    expect(deployEnvironmentMock).not.toHaveBeenCalled();
  });
});

describe("owner kinds", () => {
  it("separates people from organization and shared scopes", () => {
    expect(automationOwnerKind("steve@builder.io")).toBe("user");
    expect(automationOwnerKind("__shared__")).toBe("shared");
    expect(automationOwnerKind("__organization__:builder_io")).toBe(
      "organization",
    );
    expect(isPseudoOwner("__organization__:builder_io")).toBe(true);
    expect(isPseudoOwner("steve@builder.io")).toBe(false);
  });
});

describe("runtimeFailureNextRun", () => {
  const cronNext = new Date(NOW.getTime() + 15 * 60_000);

  it("keeps the cron time while it is later than the backoff", () => {
    expect(runtimeFailureNextRun(cronNext, NOW, 1)).toEqual(cronNext);
  });

  it("widens the interval after repeated failures", () => {
    const second = runtimeFailureNextRun(cronNext, NOW, 2);
    const fourth = runtimeFailureNextRun(cronNext, NOW, 4);
    expect(second.getTime() - NOW.getTime()).toBe(30 * 60_000);
    expect(fourth.getTime() - NOW.getTime()).toBe(120 * 60_000);
  });

  it("caps the backoff", () => {
    expect(runtimeFailureNextRun(cronNext, NOW, 40).getTime()).toBe(
      NOW.getTime() + 6 * 60 * 60_000,
    );
  });
});

describe("withDeliveryNote", () => {
  it("puts the cause first and does not double the period", () => {
    expect(withDeliveryNote("Gateway returned 502.")).toBe(
      "Gateway returned 502. No delivery was confirmed.",
    );
    expect(withDeliveryNote("Gateway returned 502")).toBe(
      "Gateway returned 502. No delivery was confirmed.",
    );
  });
});
