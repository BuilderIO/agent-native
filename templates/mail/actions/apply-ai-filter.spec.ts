import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertMailJevEnabled: vi.fn(),
  createAutomationRule: vi.fn(),
  getAiFilterState: vi.fn(),
  getUserSetting: vi.fn(),
  getRequestUserEmail: vi.fn(),
  isConnected: vi.fn(),
  listAutomationRules: vi.fn(),
  readLocalEmails: vi.fn(),
  recordAiFilterFeedback: vi.fn(),
  saveAiFilterState: vi.fn(),
  withLocalEmailMutationLock: vi.fn(),
  writeLocalEmails: vi.fn(),
  writeAppState: vi.fn(),
  putUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  putUserSetting: mocks.putUserSetting,
}));

vi.mock("../server/lib/ai-filter.js", () => ({
  getAiFilterState: mocks.getAiFilterState,
  recordAiFilterFeedback: mocks.recordAiFilterFeedback,
  saveAiFilterState: mocks.saveAiFilterState,
}));

vi.mock("../server/lib/automation-actions.js", () => ({
  buildLabelCache: vi.fn(),
  ensureGmailLabel: vi.fn(),
}));

vi.mock("../server/lib/automations.js", () => ({
  assertMailJevEnabled: mocks.assertMailJevEnabled,
  createAutomationRule: mocks.createAutomationRule,
  listAutomationRules: mocks.listAutomationRules,
}));

vi.mock("../server/lib/google-api.js", () => ({
  gmailGetMessage: vi.fn(),
  gmailModifyThread: vi.fn(),
}));

vi.mock("../server/lib/google-auth.js", () => ({
  isConnected: mocks.isConnected,
}));
vi.mock("../server/lib/inbox-store-sync.js", () => ({
  syncInboxLabelDelta: vi.fn(),
}));
vi.mock("../server/lib/local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
  withLocalEmailMutationLock: mocks.withLocalEmailMutationLock,
  writeLocalEmails: mocks.writeLocalEmails,
}));
vi.mock("./helpers.js", () => ({ getAccessTokens: vi.fn() }));

import action from "./apply-ai-filter.js";

describe("apply-ai-filter Jev gate", () => {
  it("does not register a Mail-specific chat renderer", () => {
    expect(action.chatUI).toBeUndefined();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    mocks.saveAiFilterState.mockResolvedValue({
      enabled: false,
      autoFilter: true,
      autoFilterThreshold: 0.92,
      suggestionThreshold: 0.72,
      labelName: "agent-native-filtered",
      feedback: [],
      decisions: [],
    });
    mocks.writeAppState.mockResolvedValue(undefined);
    mocks.getUserSetting.mockResolvedValue({
      labels: [
        {
          id: "agent-native-filtered",
          name: "agent-native-filtered",
          type: "user",
        },
      ],
    });
    mocks.putUserSetting.mockResolvedValue(undefined);
    mocks.recordAiFilterFeedback.mockResolvedValue(undefined);
    mocks.createAutomationRule.mockResolvedValue(undefined);
    mocks.listAutomationRules.mockResolvedValue([]);
    mocks.isConnected.mockResolvedValue(false);
    mocks.readLocalEmails.mockResolvedValue([]);
    mocks.withLocalEmailMutationLock.mockImplementation(
      (_ownerEmail: string, mutate: () => Promise<unknown>) => mutate(),
    );
    mocks.writeLocalEmails.mockResolvedValue(undefined);
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
    expect(mocks.saveAiFilterState).toHaveBeenCalledWith("owner@example.test", {
      enabled: false,
    });
    expect(result.state.enabled).toBe(false);
  });

  it("reads settings without writing when no patch is provided", async () => {
    const currentState = {
      enabled: true,
      autoFilter: false,
      autoFilterThreshold: 0.92,
      suggestionThreshold: 0.72,
      labelName: "agent-native-filtered",
      feedback: [],
      decisions: [],
    };
    mocks.getAiFilterState.mockResolvedValue(currentState);

    const result = await action.run({ mode: "settings" });

    expect(mocks.getAiFilterState).toHaveBeenCalledWith("owner@example.test");
    expect(mocks.saveAiFilterState).not.toHaveBeenCalled();
    expect(mocks.writeAppState).not.toHaveBeenCalled();
    expect(result.state).toEqual(currentState);
    expect(result).not.toHaveProperty("change");
  });

  it.each(["filter", "keep"] as const)(
    "returns a change for successful %s updates without exposing subjects",
    async (mode) => {
      mocks.assertMailJevEnabled.mockResolvedValue(undefined);
      mocks.readLocalEmails.mockResolvedValue([
        {
          id: "message-1",
          threadId: "thread-1",
          from: "bot@example.test",
          subject: "Private subject",
          labelIds: ["INBOX"],
          isArchived: false,
        },
      ]);
      mocks.listAutomationRules.mockResolvedValue([
        { kind: "ai-filter", name: "AI filter learned examples" },
      ]);
      mocks.getAiFilterState.mockResolvedValue({ enabled: true });

      const result = await action.run({
        mode,
        targets: [{ id: "message-1" }],
      });

      expect(result.changed).toBe(1);
      expect(result.change).toEqual({
        verb: "updated",
        kind: "mail-filter",
        title: "AI filter learned examples",
        detail: "1",
      });
      expect(JSON.stringify(result.change)).not.toContain("Private subject");
    },
  );

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
