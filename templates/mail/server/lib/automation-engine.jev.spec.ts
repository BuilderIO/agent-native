import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJevContextCredentials: vi.fn(),
  isJevEnabled: vi.fn(),
  readDeployCredentialEnv: vi.fn(),
  requestJevThroughBuilder: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => undefined,
  getJevContextCredentials: mocks.getJevContextCredentials,
  isJevEnabled: mocks.isJevEnabled,
  readDeployCredentialEnv: mocks.readDeployCredentialEnv,
  requestJevThroughBuilder: mocks.requestJevThroughBuilder,
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
}));
vi.mock("../db/index.js", () => ({ db: {}, schema: {} }));
vi.mock("./ai-filter.js", () => ({
  getAiFilterState: vi.fn(),
  recordAiFilterDecisions: vi.fn(),
}));
vi.mock("./automation-actions.js", () => ({
  buildLabelCache: vi.fn(),
  executeActions: vi.fn(),
}));
vi.mock("./automation-model.js", () => ({
  resolveAutomationModelSettings: vi
    .fn()
    .mockResolvedValue({ engine: "typesafe", model: "jev-latest" }),
  resolveTextAutomationModelSettings: vi.fn(),
  TYPESAFE_AUTOMATION_ENGINE: "typesafe",
  TYPESAFE_AUTOMATION_MODEL: "jev-latest",
}));
vi.mock("./google-api.js", () => ({}));
vi.mock("./google-auth.js", () => ({}));

import { previewAutomationRules } from "./automation-engine.js";

const builderAuth = { authorization: "Bearer builder-test-token" };
const email = {
  id: "email-1",
  threadId: "thread-1",
  accountEmail: "owner@example.com",
  from: "sender@example.test",
  to: "owner@example.com",
  subject: "Synthetic email",
  snippet: "Synthetic content",
  labelIds: ["INBOX"],
  date: "2026-09-22T00:00:00.000Z",
  isArchived: false,
  isTrashed: false,
};

describe("Mail Jev automation routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth,
    });
    mocks.isJevEnabled.mockResolvedValue(true);
    mocks.readDeployCredentialEnv.mockReturnValue(undefined);
    mocks.requestJevThroughBuilder.mockResolvedValue({
      answers: { q_0_0: { noul: 0.91 } },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("evaluates Mail AI filters through Builder without a user key", async () => {
    const result = await previewAutomationRules(
      [email],
      [
        {
          id: "rule-1",
          name: "Important",
          condition: "Work from the finance team",
          actions: [],
        },
      ],
      "owner@example.com",
      {} as never,
    );

    expect(result.matches.get("email-1")).toEqual([
      expect.objectContaining({ ruleId: "rule-1", confidence: 0.91 }),
    ]);
    expect(mocks.requestJevThroughBuilder).toHaveBeenCalledWith(
      builderAuth,
      expect.objectContaining({ model: "jev-latest" }),
      { timeoutMs: 12_000 },
    );
  });

  it("does not use a deployment key as direct fallback", async () => {
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: "deployment-jev-key",
      personalApiKey: undefined,
      builderAuth,
    });
    mocks.requestJevThroughBuilder.mockRejectedValue(
      new Error("Builder proxy unavailable"),
    );
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      previewAutomationRules(
        [email],
        [
          {
            id: "rule-1",
            name: "Important",
            condition: "Work from the finance team",
            actions: [],
          },
        ],
        "owner@example.com",
        {} as never,
      ),
    ).rejects.toThrow("Builder proxy unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps using the legacy Typesafe deployment key for saved automation settings", async () => {
    mocks.isJevEnabled.mockResolvedValue(false);
    mocks.readDeployCredentialEnv.mockReturnValue("legacy-typesafe-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ answers: { q_0_0: { noul: 0.91 } } }), {
          status: 200,
        }),
      ),
    );

    const result = await previewAutomationRules(
      [email],
      [
        {
          id: "rule-1",
          name: "Important",
          condition: "Work from the finance team",
          actions: [],
        },
      ],
      "owner@example.com",
      {} as never,
    );

    expect(result.matches.get("email-1")).toEqual([
      expect.objectContaining({ ruleId: "rule-1", confidence: 0.91 }),
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.typesafe.ai/v1/systemone",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer legacy-typesafe-key",
        }),
      }),
    );
    expect(mocks.requestJevThroughBuilder).not.toHaveBeenCalled();
  });

  it("surfaces entitlement lookup failures rather than reporting Jev disabled", async () => {
    mocks.isJevEnabled.mockRejectedValue(
      new Error("Could not check Jev credentials or Builder entitlement."),
    );

    await expect(
      previewAutomationRules(
        [email],
        [
          {
            id: "rule-1",
            name: "Important",
            condition: "Work from the finance team",
            actions: [],
          },
        ],
        "owner@example.com",
        {} as never,
      ),
    ).rejects.toThrow(
      "Could not check Jev credentials or Builder entitlement.",
    );
  });
});
