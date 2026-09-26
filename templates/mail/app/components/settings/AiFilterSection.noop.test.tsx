// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AutomationAction } from "@shared/types";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rules: [] as Array<Record<string, any>>,
  decisions: [] as Array<Record<string, any>>,
  jevAvailabilityError: false,
  jevConfigured: true,
  triageEnabled: true,
  updateAiFilterSettings: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  updateRuleAsync: vi.fn(),
  manageAiFilterBackfill: vi.fn(),
  backfillStatus: undefined as Record<string, any> | undefined,
  refetchBackfill: vi.fn(),
  deleteRule: vi.fn(),
  updatePreferences: vi.fn(),
  accounts: [] as Array<Record<string, any>>,
  sendToAgentChat: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) => String(error),
  useActionQuery: () => ({
    data: mocks.jevAvailabilityError
      ? undefined
      : { configured: mocks.jevConfigured },
    isLoading: false,
    isError: mocks.jevAvailabilityError,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: mocks.sendToAgentChat,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(mocks.toast, { error: vi.fn() }),
}));

vi.mock("@/components/onboarding/AiInboxSetup", () => ({
  AiInboxSetup: () => null,
}));

vi.mock("@/components/settings/JevConnectionPrompt", () => ({
  JevAvailabilityError: () => <div>mail.aiFilter.jevAvailabilityFailed</div>,
  JevConnectionPrompt: () => <div>mail.aiFilter.connectJev</div>,
}));

vi.mock("@/hooks/use-ai-filter", () => ({
  useAiFilter: () => ({
    data: {
      enabled: mocks.triageEnabled,
      autoFilter: true,
      autoFilterThreshold: 0.92,
      suggestionThreshold: 0.72,
      labelName: "agent-native-filtered",
      feedback: [],
      decisions: mocks.decisions,
    },
    isLoading: false,
  }),
  useManageAiFilter: () => ({ mutate: mocks.updateAiFilterSettings }),
  useManageAiFilterBackfill: () => ({
    mutateAsync: mocks.manageAiFilterBackfill,
  }),
  useRecentAiFilterBackfills: () => ({
    data: mocks.backfillStatus ? [mocks.backfillStatus] : [],
    isLoading: false,
    isError: false,
    refetch: mocks.refetchBackfill,
  }),
  latestAiFilterDecisions: (state: { decisions: Array<Record<string, any>> }) =>
    [...state.decisions].reverse(),
}));

vi.mock("@/hooks/use-automations", () => ({
  useAutomations: () => ({ data: mocks.rules, isLoading: false }),
  useCreateAutomation: () => ({ mutateAsync: mocks.createRule }),
  useUpdateAutomation: () => ({
    mutate: mocks.updateRule,
    mutateAsync: mocks.updateRuleAsync,
  }),
  useDeleteAutomation: () => ({ mutateAsync: mocks.deleteRule }),
}));

vi.mock("@/hooks/use-emails", () => ({
  useLabels: () => ({ data: [] }),
  useSettings: () => ({ data: { pinnedLabels: [] } }),
  useUpdateSettings: () => ({ mutateAsync: mocks.updatePreferences }),
}));

vi.mock("@/hooks/use-google-auth", () => ({
  useGoogleAuthStatus: () => ({ data: { accounts: mocks.accounts } }),
}));

import { AiFilterSection } from "./AiFilterSection";
import {
  aiFilterRuleLabelName,
  aiFilterRuleMode,
  normalizedAiFilterLabelId,
} from "@shared/ai-filter-rules";

const importantRule = () => ({
  id: "important-rule",
  ownerEmail: "mail-test@example.test",
  domain: "mail",
  kind: "ai-filter",
  name: "AI important",
  condition: "Human comments on GitHub matter",
  actions: [{ type: "label", labelName: "agent-native-important" }],
  enabled: true,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
});

function renderSection() {
  return render(<AiFilterSection />, { wrapper: MemoryRouter });
}

describe("AiFilterSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.rules = [];
    mocks.decisions = [];
    mocks.jevAvailabilityError = false;
    mocks.jevConfigured = true;
    mocks.triageEnabled = true;
    mocks.accounts = [];
    mocks.createRule.mockReset().mockResolvedValue({ id: "created-rule" });
    mocks.updateRule.mockReset();
    mocks.updateRuleAsync
      .mockReset()
      .mockResolvedValue({ id: "important-rule" });
    mocks.manageAiFilterBackfill
      .mockReset()
      .mockResolvedValue({ runId: "backfill-run", status: "queued" });
    mocks.backfillStatus = undefined;
    mocks.refetchBackfill.mockReset().mockResolvedValue(undefined);
    mocks.deleteRule.mockReset();
    mocks.updatePreferences.mockReset().mockResolvedValue(undefined);
    mocks.updateAiFilterSettings.mockReset();
    mocks.sendToAgentChat.mockReset();
  });

  it("shares rule classification and stable label normalization", () => {
    const ruleWith = (actions: AutomationAction[]) => ({ actions });

    expect(
      aiFilterRuleMode(
        ruleWith([
          { type: "label", labelName: "agent-native-filtered" },
          { type: "archive" },
        ]),
      ),
    ).toBe("filtered");
    expect(
      aiFilterRuleMode(
        ruleWith([{ type: "label", labelName: "agent-native-important" }]),
      ),
    ).toBe("important");
    expect(aiFilterRuleMode(ruleWith([{ type: "archive" }]))).toBe("archive");
    expect(
      aiFilterRuleLabelName(
        ruleWith([{ type: "label", labelName: "Receipts" }]),
      ),
    ).toBe("Receipts");
    expect(normalizedAiFilterLabelId("Work_Updates")).toBe("work updates");
  });

  it("groups important, tag, filtered, and auto-archive rules in one editor", () => {
    mocks.rules = [
      importantRule(),
      {
        ...importantRule(),
        id: "tag-rule",
        name: "AI tag: receipts",
        condition: "Receipts and order confirmations",
        actions: [{ type: "label", labelName: "Receipts" }],
      },
      {
        ...importantRule(),
        id: "filtered-rule",
        name: "AI spam",
        condition: "Promotional mail I did not ask for",
        actions: [
          { type: "label", labelName: "agent-native-filtered" },
          { type: "archive" },
        ],
      },
      {
        ...importantRule(),
        id: "archive-rule",
        name: "AI archive",
        condition: "Automated GitHub status updates",
        actions: [{ type: "archive" }],
      },
    ];

    renderSection();

    for (const key of [
      "mail.aiFilter.importantMode",
      "mail.aiFilter.aiTagsTitle",
      "mail.aiFilter.filteredMode",
      "mail.aiFilter.autoArchiveMode",
    ]) {
      expect(screen.getByText(key)).not.toBeNull();
    }
    expect(screen.getByText("Receipts")).not.toBeNull();
    expect(
      screen.getByRole("switch", {
        name: "mail.aiFilter.toggleInstruction Human comments on GitHub matter",
      }),
    ).not.toBeNull();
  });

  it("creates a rule from one sentence and a selected mode", async () => {
    mocks.createRule.mockResolvedValue({ id: "filtered-rule" });
    renderSection();

    fireEvent.click(
      screen.getByRole("button", { name: "mail.aiFilter.newRule" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.aiFilter.filteredMode" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "mail.aiFilter.instructionsTitle" }),
      { target: { value: "Clearly promotional mail" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.aiFilter.addInstruction" }),
    );

    await waitFor(() => {
      expect(mocks.createRule).toHaveBeenCalledWith({
        name: "AI spam: Clearly promotional mail",
        condition: "Clearly promotional mail",
        actions: [
          { type: "label", labelName: "agent-native-filtered" },
          { type: "archive" },
        ],
        kind: "ai-filter",
        domain: "mail",
      });
      expect(mocks.manageAiFilterBackfill).toHaveBeenCalledWith({
        operation: "start",
        ruleIds: ["filtered-rule"],
      });
    });
  });

  it("edits and enables a rule through the existing automation actions", async () => {
    mocks.rules = [importantRule()];
    renderSection();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "mail.toolbar.menu" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "settings.editRule" }),
    );
    const editor = screen.getByRole("textbox", {
      name: "mail.aiFilter.instructionsTitle",
    });
    fireEvent.change(editor, { target: { value: "Reply by today" } });
    fireEvent.click(screen.getByRole("button", { name: "settings.save" }));

    await waitFor(() => {
      expect(mocks.updateRuleAsync).toHaveBeenCalledWith({
        id: "important-rule",
        name: "AI important: Reply by today",
        condition: "Reply by today",
        actions: [{ type: "label", labelName: "agent-native-important" }],
      });
      expect(mocks.manageAiFilterBackfill).toHaveBeenCalledWith({
        operation: "start",
        ruleIds: ["important-rule"],
      });
    });

    fireEvent.click(
      screen.getByRole("switch", {
        name: "mail.aiFilter.toggleInstruction Human comments on GitHub matter",
      }),
    );
    expect(mocks.updateRule).toHaveBeenCalledWith(
      { id: "important-rule", enabled: false },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("stages a localized rule refinement prompt in the agent sidebar", async () => {
    mocks.rules = [importantRule()];
    renderSection();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "mail.toolbar.menu" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "mail.aiFilter.askJev" }),
    );

    expect(mocks.sendToAgentChat).toHaveBeenCalledWith({
      message: "mail.aiFilter.askJevPrompt Human comments on GitHub matter",
      context: JSON.stringify({
        ruleId: "important-rule",
        mode: "important",
        condition: "Human comments on GitHub matter",
      }),
      submit: false,
      openSidebar: true,
    });
  });

  it("does not backfill when a rule is saved without changes", async () => {
    mocks.rules = [{ ...importantRule(), enabled: false }];
    renderSection();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "mail.toolbar.menu" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "settings.editRule" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "settings.save" }));

    expect(mocks.updateRuleAsync).not.toHaveBeenCalled();
    expect(mocks.manageAiFilterBackfill).not.toHaveBeenCalled();
  });

  it("applies existing mail when an AI rule is enabled", async () => {
    mocks.rules = [{ ...importantRule(), enabled: false }];
    renderSection();

    fireEvent.click(
      screen.getByRole("switch", {
        name: "mail.aiFilter.toggleInstruction Human comments on GitHub matter",
      }),
    );
    expect(mocks.updateRule).toHaveBeenCalledWith(
      { id: "important-rule", enabled: true },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    mocks.updateRule.mock.calls[0][1].onSuccess();

    await waitFor(() => {
      expect(mocks.manageAiFilterBackfill).toHaveBeenCalledWith({
        operation: "start",
        ruleIds: ["important-rule"],
      });
    });
  });

  it("shows backfill matches and can undo the latest rule run", async () => {
    mocks.rules = [{ ...importantRule(), enabled: false }];
    mocks.backfillStatus = {
      runId: "backfill-run",
      status: "completed",
      totalThreads: 10,
      processedThreads: 10,
      matchedThreads: 2,
      appliedThreads: 2,
      failedThreads: 0,
      perRule: [
        {
          ruleId: "important-rule",
          name: "AI important",
          matchedCount: 2,
          appliedCount: 2,
          suggestedCount: 0,
          previews: [
            {
              id: "mail-1",
              from: "boss@example.test",
              subject: "Decision needed",
              labels: ["agent-native-important"],
              archived: false,
            },
          ],
        },
      ],
      undoToken: "undo-token",
    };
    renderSection();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "mail.toolbar.menu" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "settings.editRule" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "mail.aiFilter.instructionsTitle" }),
      { target: { value: "Messages from my manager" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "settings.save" }));

    expect(await screen.findByText("Decision needed")).not.toBeNull();
    expect(
      screen.getByText("mail.aiFilter.ruleBackfillMatches 2"),
    ).not.toBeNull();
    expect(
      (
        screen.getByRole("link", {
          name: "mail.aiFilter.ruleBackfillReview",
        }) as HTMLAnchorElement
      ).getAttribute("href"),
    ).toBe("/inbox?label=agent-native-important");

    fireEvent.click(screen.getByRole("button", { name: "mail.actions.undo" }));
    await waitFor(() => {
      expect(mocks.manageAiFilterBackfill).toHaveBeenNthCalledWith(2, {
        operation: "undo",
        runId: "backfill-run",
        undoToken: "undo-token",
      });
    });
    expect(mocks.refetchBackfill).toHaveBeenCalled();
  });

  it("shows a result toast with Review and Undo after the backfill completes", async () => {
    mocks.rules = [{ ...importantRule(), enabled: false }];
    const view = renderSection();

    fireEvent.click(
      screen.getByRole("switch", {
        name: "mail.aiFilter.toggleInstruction Human comments on GitHub matter",
      }),
    );
    mocks.updateRule.mock.calls[0][1].onSuccess();
    await waitFor(() => expect(mocks.refetchBackfill).toHaveBeenCalled());
    mocks.backfillStatus = {
      runId: "backfill-run",
      status: "completed",
      totalThreads: 5,
      processedThreads: 5,
      matchedThreads: 2,
      appliedThreads: 2,
      failedThreads: 0,
      perRule: [
        {
          ruleId: "important-rule",
          name: "AI important",
          matchedCount: 2,
          appliedCount: 2,
          suggestedCount: 0,
          previews: [],
        },
      ],
      undoToken: "undo-token",
    };
    view.rerender(<AiFilterSection />);

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        "mail.aiFilter.ruleBackfillMatches 2",
        expect.objectContaining({
          action: expect.objectContaining({
            label: "mail.aiFilter.ruleBackfillReview",
          }),
          cancel: expect.objectContaining({ label: "mail.actions.undo" }),
        }),
      );
    });
  });

  it("does not offer Review when a backfill has no matching mail", async () => {
    mocks.rules = [{ ...importantRule(), enabled: false }];
    const view = renderSection();

    fireEvent.click(
      screen.getByRole("switch", {
        name: "mail.aiFilter.toggleInstruction Human comments on GitHub matter",
      }),
    );
    mocks.updateRule.mock.calls[0][1].onSuccess();
    await waitFor(() => expect(mocks.refetchBackfill).toHaveBeenCalled());
    mocks.backfillStatus = {
      runId: "backfill-run",
      status: "completed",
      totalThreads: 5,
      processedThreads: 5,
      matchedThreads: 0,
      appliedThreads: 0,
      failedThreads: 0,
      perRule: [
        {
          ruleId: "important-rule",
          name: "AI important",
          matchedCount: 0,
          appliedCount: 0,
          suggestedCount: 0,
          previews: [],
        },
      ],
      undoToken: "undo-token",
    };
    view.rerender(<AiFilterSection />);

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        "mail.aiFilter.ruleBackfillNoMatches",
        expect.objectContaining({
          cancel: expect.objectContaining({ label: "mail.actions.undo" }),
        }),
      );
    });
    expect(
      mocks.toast.mock.calls[mocks.toast.mock.calls.length - 1]?.[1],
    ).not.toHaveProperty("action");
  });

  it("saves the auto-filter confidence threshold and links to filtered mail", async () => {
    mocks.decisions = [
      {
        id: "decision-1",
        messageId: "message-1",
        sender: "offers@example.test",
        subject: "An offer you did not ask for",
        disposition: "filtered",
        source: "automatic",
        confidence: 0.98,
        reason: "Matches your unwanted promotions rule.",
        createdAt: 1_759_000_000_000,
      },
    ];
    renderSection();

    fireEvent.click(screen.getByText("mail.aiFilter.manageSettings"));
    const threshold = screen.getByRole("spinbutton", {
      name: "mail.aiFilter.thresholdLabel",
    });
    fireEvent.change(threshold, { target: { value: "96" } });
    fireEvent.blur(threshold);

    expect(mocks.updateAiFilterSettings).toHaveBeenCalledWith(
      {
        mode: "settings",
        settings: { autoFilterThreshold: 0.96 },
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(screen.getByText("An offer you did not ask for")).not.toBeNull();
    expect(
      screen.getByText("Matches your unwanted promotions rule."),
    ).not.toBeNull();
    expect(
      (
        screen.getByRole("link", {
          name: "mail.aiFilter.reviewLabel",
        }) as HTMLAnchorElement
      ).getAttribute("href"),
    ).toBe("/inbox?label=agent-native-filtered");
  });

  it("allows turning triage off when Jev is unavailable", () => {
    mocks.jevConfigured = false;
    mocks.triageEnabled = true;
    renderSection();

    fireEvent.click(
      screen.getByRole("switch", { name: "mail.aiFilter.toggle" }),
    );

    expect(mocks.updateAiFilterSettings).toHaveBeenCalledWith(
      { mode: "settings", settings: { enabled: false } },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });
});
