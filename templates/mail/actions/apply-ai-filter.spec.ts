import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertMailJevEnabled: vi.fn(),
  getAiFilterState: vi.fn(),
  getRequestUserEmail: vi.fn(),
  saveAiFilterState: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/ai-filter.js", () => ({
  getAiFilterState: mocks.getAiFilterState,
  recordAiFilterFeedback: vi.fn(),
  saveAiFilterState: mocks.saveAiFilterState,
}));

vi.mock("../server/lib/automation-actions.js", () => ({
  buildLabelCache: vi.fn(),
  ensureGmailLabel: vi.fn(),
}));

vi.mock("../server/lib/automations.js", () => ({
  assertMailJevEnabled: mocks.assertMailJevEnabled,
  createAutomationRule: vi.fn(),
  listAutomationRules: vi.fn(),
}));

vi.mock("../server/lib/google-api.js", () => ({
  gmailGetMessage: vi.fn(),
  gmailModifyThread: vi.fn(),
}));

vi.mock("../server/lib/google-auth.js", () => ({ isConnected: vi.fn() }));
vi.mock("../server/lib/inbox-store-sync.js", () => ({
  syncInboxLabelDelta: vi.fn(),
}));
vi.mock("../server/lib/local-email-store.js", () => ({
  readLocalEmails: vi.fn(),
  withLocalEmailMutationLock: vi.fn(),
  writeLocalEmails: vi.fn(),
}));
vi.mock("./helpers.js", () => ({ getAccessTokens: vi.fn() }));

import action from "./apply-ai-filter.js";

describe("apply-ai-filter Jev gate", () => {
  it("only selects the result card when a filter changes messages", () => {
    expect(action.chatUI?.when?.({ mode: "filter" }, { changed: 0 })).toBe(
      false,
    );
    expect(action.chatUI?.when?.({ mode: "settings" }, { changed: 3 })).toBe(
      false,
    );
    expect(action.chatUI?.when?.({ mode: "keep" }, { changed: 1 })).toBe(true);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    mocks.getAiFilterState.mockResolvedValue({
      enabled: true,
      autoFilter: false,
      autoFilterThreshold: 0.92,
      suggestionThreshold: 0.72,
      labelName: "agent-native-filtered",
      feedback: [],
      decisions: [],
    });
    mocks.saveAiFilterState.mockImplementation(async (_owner, state) => state);
    mocks.writeAppState.mockResolvedValue(undefined);
    mocks.assertMailJevEnabled.mockRejectedValue(
      Object.assign(new Error("Jev is not enabled for this account."), {
        errorCode: "jev_not_enabled",
        statusCode: 403,
      }),
    );
  });

  it("allows turning triage off without Jev", async () => {
    const result = await action.run({
      mode: "settings",
      settings: { enabled: false },
    });

    expect(mocks.assertMailJevEnabled).not.toHaveBeenCalled();
    expect(mocks.saveAiFilterState).toHaveBeenCalledWith(
      "owner@example.test",
      expect.objectContaining({ enabled: false }),
    );
    expect(result.state.enabled).toBe(false);
  });

  it.each([
    ["automatic filtering", { autoFilter: true }],
    ["combined settings", { enabled: false, autoFilter: true }],
    ["thresholds", { suggestionThreshold: 0.8 }],
  ])("requires Jev to change %s", async (_name, settings) => {
    await expect(
      action.run({ mode: "settings", settings }),
    ).rejects.toMatchObject({ errorCode: "jev_not_enabled", statusCode: 403 });

    expect(mocks.assertMailJevEnabled).toHaveBeenCalledWith(
      "owner@example.test",
    );
    expect(mocks.saveAiFilterState).not.toHaveBeenCalled();
  });
});
