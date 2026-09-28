// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRule: vi.fn(),
  updateRule: vi.fn(),
  automations: [] as Array<{
    id: string;
    domain: "mail";
    kind: "ai-filter";
    condition: string;
    actions: ({ type: "label"; labelName: string } | { type: "archive" })[];
    enabled: boolean;
  }>,
  rulesLoading: false,
  firstRunOnboardingGateOwnsSurface: false,
  onboardingPreview: false,
  startBackfill: vi.fn(),
  updateSettings: vi.fn(),
  settingsPending: false,
  canOfferGoogleOAuthSetup: false,
  sendToAgentChat: vi.fn(),
  navigate: vi.fn(),
  locationPath: "/inbox",
  backfillStatus: {
    data: undefined as
      | {
          runId: string;
          status: "completed" | "failed" | "undone" | "queued" | "running";
          totalThreads: number;
          processedThreads: number;
          matchedThreads: number;
          appliedThreads: number;
          failedThreads: number;
          restoredThreads?: number;
          perRule: {
            ruleId: string;
            name: string;
            matchedCount: number;
            appliedCount: number;
            suggestedCount: number;
            previews: {
              id: string;
              from: string;
              subject: string;
              labels: string[];
              archived: boolean;
            }[];
          }[];
          undoToken?: string;
        }
      | undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  },
  jevAvailability: {
    data: { configured: true } as { configured: boolean } | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  automationSettings: {
    data: undefined as { engine?: string; model?: string } | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  googleStatus: {
    data: {
      accounts: [{ email: "mail-test@example.test" }],
      configured: true,
    } as { accounts: { email: string }[]; configured?: boolean } | undefined,
    isSuccess: true,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (actionName: string) =>
    actionName === "get-automation-settings"
      ? mocks.automationSettings
      : mocks.jevAvailability,
}));

vi.mock("@agent-native/core/client/onboarding", () => ({
  ONBOARDING_PRIMARY_BUTTON_CLASS: "onboarding-primary-button",
  OnboardingStepLayout: ({
    title,
    description,
    header,
    children,
    footer,
  }: {
    title?: React.ReactNode;
    description?: React.ReactNode;
    header?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => (
    <section>
      {header ??
        (title !== undefined ? (
          <>
            <h1>{title}</h1>
            {description !== undefined ? <p>{description}</p> : null}
          </>
        ) : null)}
      <div>{children}</div>
      {footer ? <footer>{footer}</footer> : null}
    </section>
  ),
  useFirstRunOnboardingGateOwnsSurface: () =>
    mocks.firstRunOnboardingGateOwnsSurface,
  useOnboardingPreviewMode: () => mocks.onboardingPreview,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: mocks.sendToAgentChat,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { count?: number }) =>
    key === "mail.sort.aiSetupRuleCount"
      ? `Matched ${options?.count ?? ""}`
      : key === "mail.sort.aiSetupImportantBoss"
        ? "Messages from my boss, "
        : key === "mail.sort.aiSetupImportantBossChip"
          ? "Messages from my boss"
          : key,
}));

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: mocks.locationPath }),
}));

vi.mock("@/components/settings/JevConnectionPrompt", () => ({
  JevConnectionPrompt: () => <div data-testid="jev-connect" />,
  JevAvailabilityError: ({ onRetry }: { onRetry: () => void }) => (
    <div role="alert">
      <p>mail.aiFilter.jevAvailabilityFailed</p>
      <button type="button" onClick={onRetry}>
        mail.error.tryAgain
      </button>
    </div>
  ),
}));

vi.mock("@/components/GoogleConnectBanner", () => ({
  GoogleConnectBanner: ({ variant }: { variant?: string }) => (
    <div data-testid="gmail-connect" data-variant={variant} />
  ),
}));

vi.mock("@/lib/google-oauth-setup", () => ({
  shouldOfferGoogleOAuthSetup: () => mocks.canOfferGoogleOAuthSetup,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));

vi.mock("@/hooks/use-automations", () => ({
  useAutomations: () => ({
    data: mocks.automations,
    isLoading: mocks.rulesLoading,
  }),
  useCreateAutomation: () => ({ mutateAsync: mocks.createRule }),
  useUpdateAutomation: () => ({ mutateAsync: mocks.updateRule }),
}));

vi.mock("@/hooks/use-ai-filter", () => ({
  useManageAiFilterBackfill: () => ({
    mutateAsync: mocks.startBackfill,
    isPending: false,
  }),
  useAiFilterBackfillStatus: () => mocks.backfillStatus,
}));

vi.mock("@/hooks/use-emails", () => ({
  useSettings: () => ({ data: { aiSetupCompleted: false } }),
  useUpdateSettings: () => ({
    mutateAsync: mocks.updateSettings,
    isPending: mocks.settingsPending,
  }),
}));

vi.mock("@/hooks/use-google-auth", () => ({
  useGoogleAuthStatus: () => mocks.googleStatus,
}));

import { AI_IMPORTANT_LABEL } from "@shared/ai-priority";

import { AiInboxSetup } from "./AiInboxSetup";

describe("AiInboxSetup", () => {
  beforeEach(() => {
    let id = 0;
    window.sessionStorage.clear();
    mocks.automations = [];
    mocks.rulesLoading = false;
    mocks.firstRunOnboardingGateOwnsSurface = false;
    mocks.onboardingPreview = false;
    mocks.createRule.mockReset();
    mocks.createRule.mockImplementation(async (input) => ({
      id: `rule-${++id}`,
      ...input,
    }));
    mocks.updateRule.mockReset();
    mocks.startBackfill.mockReset();
    mocks.startBackfill.mockImplementation(async (input) =>
      input.operation === "undo"
        ? { runId: "run-1", restoredThreads: 1, status: "undone" }
        : { runId: "run-1", status: "queued" },
    );
    mocks.updateSettings.mockReset();
    mocks.updateSettings.mockResolvedValue(undefined);
    mocks.settingsPending = false;
    mocks.canOfferGoogleOAuthSetup = false;
    mocks.sendToAgentChat.mockReset();
    mocks.navigate.mockReset();
    mocks.locationPath = "/inbox";
    mocks.backfillStatus.data = undefined;
    mocks.backfillStatus.isLoading = false;
    mocks.backfillStatus.isFetching = false;
    mocks.backfillStatus.isError = false;
    mocks.backfillStatus.refetch.mockReset();
    mocks.jevAvailability.data = { configured: true };
    mocks.jevAvailability.isLoading = false;
    mocks.jevAvailability.isError = false;
    mocks.jevAvailability.isFetching = false;
    mocks.automationSettings.data = undefined;
    mocks.automationSettings.isLoading = false;
    mocks.automationSettings.isError = false;
    mocks.automationSettings.isFetching = false;
    mocks.automationSettings.refetch.mockReset();
    mocks.googleStatus.data = {
      accounts: [{ email: "mail-test@example.test" }],
      configured: true,
    };
    mocks.googleStatus.isLoading = false;
    mocks.googleStatus.isError = false;
    mocks.googleStatus.isSuccess = true;
    mocks.googleStatus.isFetching = false;
    mocks.googleStatus.refetch.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lets users save tab, importance, and archive rules before Builder setup", async () => {
    const onComplete = vi.fn();
    const onStepChange = vi.fn();
    mocks.googleStatus.data = { accounts: [], configured: false };
    mocks.jevAvailability.data = { configured: false };

    render(
      <AiInboxSetup
        embedded
        forceOpen
        firstRunStage="preferences"
        onStepChange={onStepChange}
        onComplete={onComplete}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "mail.sort.aiSetupTagsHeadline" }),
    ).not.toBeNull();
    expect(screen.getByText("mail.sort.aiSetupTagsDescription")).not.toBeNull();
    expect(
      screen
        .getAllByRole("switch")
        .map((item) => item.getAttribute("aria-checked")),
    ).toEqual(["true", "false", "true", "false", "false", "false"]);
    expect(
      screen.queryByRole("button", { name: "mail.sort.aiSetupSkipSetup" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupAddTab" }),
    );
    const customInputs = screen.getAllByRole("textbox");
    fireEvent.change(customInputs[0]!, { target: { value: "Personal" } });
    fireEvent.change(customInputs[1]!, {
      target: { value: "Mail from people I know" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );

    const important = await screen.findByRole("textbox", {
      name: "mail.sort.aiSetupImportantHeadline",
    });
    expect((important as HTMLTextAreaElement).tagName).toBe("TEXTAREA");
    expect((important as HTMLTextAreaElement).placeholder).toBe(
      "mail.sort.aiSetupImportantExample",
    );
    const bossSuggestion = screen.getByRole("button", {
      name: "Messages from my boss",
    });
    fireEvent.click(bossSuggestion);
    expect((important as HTMLTextAreaElement).value).toBe(
      "Messages from my boss, ",
    );
    await waitFor(() => expect(document.activeElement).toBe(important));
    expect((important as HTMLTextAreaElement).selectionStart).toBe(
      "Messages from my boss, ".length,
    );
    fireEvent.click(bossSuggestion);
    expect((important as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(important, {
      target: { value: "Messages from my manager" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );

    const archive = await screen.findByRole("textbox", {
      name: "mail.sort.aiSetupSkipInboxHeadline",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkipBots" }),
    );
    expect((archive as HTMLTextAreaElement).value).toBe(
      "mail.sort.aiSetupSkipBots",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(onStepChange).toHaveBeenCalledWith(1);
    expect(onStepChange).toHaveBeenCalledWith(2);
    expect(mocks.createRule).toHaveBeenCalledTimes(5);
    expect(mocks.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        condition: "Messages from my manager",
        actions: [{ type: "label", labelName: AI_IMPORTANT_LABEL }],
      }),
    );
    expect(mocks.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        condition: "mail.sort.aiSetupSkipBots",
        actions: [{ type: "archive" }],
      }),
    );
    expect(mocks.startBackfill).not.toHaveBeenCalled();
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      aiSetupCompleted: true,
    });
    expect(
      window.sessionStorage.getItem("mail.ai-setup.pending-rule-ids"),
    ).toBe(JSON.stringify(["rule-1", "rule-2", "rule-3", "rule-4", "rule-5"]));
  });

  it("starts a real-mail backfill for saved rule IDs after setup and shows review and undo", async () => {
    const onComplete = vi.fn();
    window.sessionStorage.setItem(
      "mail.ai-setup.pending-rule-ids",
      JSON.stringify(["rule-important"]),
    );
    mocks.automations = [
      {
        id: "rule-important",
        domain: "mail",
        kind: "ai-filter",
        condition: "Messages from my boss",
        actions: [{ type: "label", labelName: AI_IMPORTANT_LABEL }],
        enabled: true,
      },
      {
        id: "rule-unselected",
        domain: "mail",
        kind: "ai-filter",
        condition: "Messages from an unrelated sender",
        actions: [{ type: "archive" }],
        enabled: true,
      },
    ];
    mocks.backfillStatus.data = {
      runId: "run-1",
      status: "completed",
      totalThreads: 12,
      processedThreads: 12,
      matchedThreads: 1,
      appliedThreads: 1,
      failedThreads: 0,
      perRule: [
        {
          ruleId: "rule-important",
          name: "Important",
          matchedCount: 1,
          appliedCount: 1,
          suggestedCount: 0,
          previews: [
            {
              id: "message-1",
              from: "Priya <priya@example.test>",
              subject: "Budget review",
              labels: [AI_IMPORTANT_LABEL],
              archived: false,
            },
          ],
        },
      ],
      undoToken: "undo-1",
    };

    render(
      <AiInboxSetup
        embedded
        forceOpen
        firstRunStage="sorting"
        onComplete={onComplete}
      />,
    );

    await waitFor(() =>
      expect(mocks.startBackfill).toHaveBeenCalledWith({
        operation: "start",
        ruleIds: ["rule-important"],
      }),
    );
    expect(
      screen.getByRole("heading", {
        name: "mail.sort.aiSetupSortingHeadline",
      }),
    ).not.toBeNull();
    expect(screen.getByText("Budget review")).not.toBeNull();
    expect(screen.getByText("Matched 1")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: /Important.*Matched 1/ }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "mail.actions.undo" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "mail.sort.aiSetupAdjustRules" }),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "mail.actions.undo" }));
    await waitFor(() =>
      expect(mocks.startBackfill).toHaveBeenLastCalledWith({
        operation: "undo",
        runId: "run-1",
        undoToken: "undo-1",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupDone" }),
    );
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });

  it("does not save skipped tag or Important drafts", async () => {
    const onComplete = vi.fn();
    render(
      <AiInboxSetup
        embedded
        forceOpen
        firstRunStage="preferences"
        onComplete={onComplete}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    fireEvent.change(
      await screen.findByRole("textbox", {
        name: "mail.sort.aiSetupImportantHeadline",
      }),
      { target: { value: "Messages from my manager" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(mocks.createRule).not.toHaveBeenCalled();
    expect(mocks.startBackfill).not.toHaveBeenCalled();
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      aiSetupCompleted: true,
    });
    expect(
      window.sessionStorage.getItem("mail.ai-setup.pending-rule-ids"),
    ).toBe("[]");
  });

  it("keeps setup out of the preview modal and shows it inline when embedded", () => {
    mocks.firstRunOnboardingGateOwnsSurface = true;
    mocks.onboardingPreview = true;
    const view = render(<AiInboxSetup forceOpen />);

    expect(
      screen.queryByRole("heading", { name: "mail.sort.aiSetupTagsHeadline" }),
    ).toBeNull();

    view.rerender(
      <AiInboxSetup embedded forceOpen firstRunStage="preferences" />,
    );
    expect(
      screen.getByRole("heading", { name: "mail.sort.aiSetupTagsHeadline" }),
    ).not.toBeNull();
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("does not write rules or settings from onboarding preview", async () => {
    mocks.onboardingPreview = true;
    const onComplete = vi.fn();
    render(
      <AiInboxSetup
        embedded
        forceOpen
        firstRunStage="preferences"
        onComplete={onComplete}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(mocks.createRule).not.toHaveBeenCalled();
    expect(mocks.updateRule).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.startBackfill).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem("mail.ai-setup.pending-rule-ids"),
    ).toBeNull();
  });

  it("waits for initial rules before reusing a matching rule", async () => {
    const onComplete = vi.fn();
    mocks.rulesLoading = true;
    const existingRule = {
      id: "existing-receipts",
      domain: "mail" as const,
      kind: "ai-filter" as const,
      condition: "mail.sort.aiSetupPromptReceipts",
      actions: [
        { type: "label" as const, labelName: "mail.sort.aiSetupTagReceipts" },
      ],
      enabled: true,
    };
    const view = render(
      <AiInboxSetup
        embedded
        forceOpen
        firstRunStage="preferences"
        onComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getAllByRole("switch")[2]!);
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    expect(mocks.createRule).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();

    mocks.automations = [existingRule];
    mocks.rulesLoading = false;
    view.rerender(
      <AiInboxSetup
        embedded
        forceOpen
        firstRunStage="preferences"
        onComplete={onComplete}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(mocks.createRule).not.toHaveBeenCalled();
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      aiSetupCompleted: true,
    });
  });

  it("does not backfill or write settings from preview sorting", async () => {
    const onComplete = vi.fn();
    mocks.onboardingPreview = true;
    window.sessionStorage.setItem(
      "mail.ai-setup.pending-rule-ids",
      JSON.stringify(["rule-important"]),
    );
    mocks.automations = [
      {
        id: "rule-important",
        domain: "mail",
        kind: "ai-filter",
        condition: "Messages from my boss",
        actions: [{ type: "label", labelName: AI_IMPORTANT_LABEL }],
        enabled: true,
      },
    ];
    render(
      <AiInboxSetup
        embedded
        forceOpen
        firstRunStage="sorting"
        onComplete={onComplete}
      />,
    );

    expect(mocks.startBackfill).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupDone" }),
    );
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(mocks.startBackfill).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("does not expose provider connection actions in preview sorting", () => {
    mocks.onboardingPreview = true;
    mocks.googleStatus.data = { accounts: [], configured: true };
    mocks.jevAvailability.data = { configured: false };
    const view = render(
      <AiInboxSetup embedded forceOpen firstRunStage="sorting" />,
    );

    expect(screen.queryByTestId("gmail-connect")).toBeNull();
    expect(screen.queryByTestId("jev-connect")).toBeNull();

    mocks.googleStatus.data = {
      accounts: [{ email: "mail-test@example.test" }],
      configured: true,
    };
    view.rerender(<AiInboxSetup embedded forceOpen firstRunStage="sorting" />);

    expect(screen.queryByTestId("gmail-connect")).toBeNull();
    expect(screen.queryByTestId("jev-connect")).toBeNull();
  });

  it("clears pending rules without backfilling after custom setup opens Settings", async () => {
    mocks.locationPath = "/settings/model";
    window.sessionStorage.setItem(
      "mail.ai-setup.pending-rule-ids",
      JSON.stringify(["rule-custom"]),
    );
    mocks.automations = [
      {
        id: "rule-custom",
        domain: "mail",
        kind: "ai-filter",
        condition: "Important mail from my manager",
        actions: [{ type: "label", labelName: AI_IMPORTANT_LABEL }],
        enabled: true,
      },
    ];
    mocks.jevAvailability.data = { configured: false };
    mocks.automationSettings.data = {
      engine: "test-engine",
      model: "test-model",
    };
    render(<AiInboxSetup />);

    await waitFor(() =>
      expect(
        window.sessionStorage.getItem("mail.ai-setup.pending-rule-ids"),
      ).toBeNull(),
    );
    expect(mocks.startBackfill).not.toHaveBeenCalled();
  });

  it("re-enables a matching disabled rule before backfilling it", async () => {
    const disabledRule = {
      id: "disabled-receipts",
      domain: "mail" as const,
      kind: "ai-filter" as const,
      condition: "mail.sort.aiSetupPromptReceipts",
      actions: [
        { type: "label" as const, labelName: "mail.sort.aiSetupTagReceipts" },
      ],
      enabled: false,
    };
    mocks.automations = [disabledRule];
    mocks.updateRule.mockResolvedValue({ ...disabledRule, enabled: true });

    render(<AiInboxSetup forceOpen />);
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );

    await waitFor(() => {
      expect(mocks.updateRule).toHaveBeenCalledWith({
        id: "disabled-receipts",
        enabled: true,
      });
      expect(mocks.startBackfill).toHaveBeenCalledWith({
        operation: "start",
        ruleIds: ["disabled-receipts", "rule-1"],
      });
    });
  });

  it("shows a real no-match result without fabricating previews", async () => {
    window.sessionStorage.setItem(
      "mail.ai-setup.pending-rule-ids",
      JSON.stringify(["rule-receipts"]),
    );
    mocks.automations = [
      {
        id: "rule-receipts",
        domain: "mail",
        kind: "ai-filter",
        condition: "Receipts",
        actions: [{ type: "label", labelName: "Receipts" }],
        enabled: true,
      },
    ];
    mocks.backfillStatus.data = {
      runId: "run-1",
      status: "completed",
      totalThreads: 12,
      processedThreads: 12,
      matchedThreads: 0,
      appliedThreads: 0,
      failedThreads: 0,
      perRule: [
        {
          ruleId: "rule-receipts",
          name: "Receipts",
          matchedCount: 0,
          appliedCount: 0,
          suggestedCount: 0,
          previews: [],
        },
      ],
    };

    render(<AiInboxSetup embedded forceOpen firstRunStage="sorting" />);

    expect(
      await screen.findByText("mail.sort.aiSetupNoMatches"),
    ).not.toBeNull();
    expect(screen.queryByText("Fabricated preview")).toBeNull();
    expect(mocks.startBackfill).toHaveBeenCalledWith({
      operation: "start",
      ruleIds: ["rule-receipts"],
    });
  });

  it("does not call a failed backfill a no-match result", async () => {
    window.sessionStorage.setItem(
      "mail.ai-setup.pending-rule-ids",
      JSON.stringify(["rule-receipts"]),
    );
    mocks.backfillStatus.data = {
      runId: "run-1",
      status: "failed",
      totalThreads: 12,
      processedThreads: 0,
      matchedThreads: 0,
      appliedThreads: 0,
      failedThreads: 12,
      perRule: [
        {
          ruleId: "rule-receipts",
          name: "Receipts",
          matchedCount: 0,
          appliedCount: 0,
          suggestedCount: 0,
          previews: [],
        },
      ],
    };

    render(<AiInboxSetup embedded forceOpen firstRunStage="sorting" />);

    expect(
      await screen.findByText("mail.sort.aiSetupSortingFailed"),
    ).not.toBeNull();
    expect(screen.queryByText("mail.sort.aiSetupNoMatches")).toBeNull();
  });

  it("shows one refresh error while keeping cached backfill progress", async () => {
    window.sessionStorage.setItem(
      "mail.ai-setup.pending-rule-ids",
      JSON.stringify(["rule-receipts"]),
    );
    mocks.backfillStatus.data = {
      runId: "run-1",
      status: "running",
      totalThreads: 8,
      processedThreads: 3,
      matchedThreads: 2,
      appliedThreads: 2,
      failedThreads: 0,
      perRule: [
        {
          ruleId: "rule-receipts",
          name: "Receipts",
          matchedCount: 2,
          appliedCount: 2,
          suggestedCount: 0,
          previews: [],
        },
      ],
    };
    mocks.backfillStatus.isError = true;

    render(<AiInboxSetup embedded forceOpen firstRunStage="sorting" />);

    await waitFor(() =>
      expect(
        screen.getAllByText("mail.sort.aiSetupSortingFailed"),
      ).toHaveLength(1),
    );
    expect(screen.getByText("mail.sort.aiSetupSortingProgress")).not.toBeNull();
    expect(screen.getByText("Matched 2")).not.toBeNull();
  });

  it("retries backfill status without starting an overlapping run", async () => {
    window.sessionStorage.setItem(
      "mail.ai-setup.pending-rule-ids",
      JSON.stringify(["rule-receipts"]),
    );
    mocks.backfillStatus.data = {
      runId: "run-1",
      status: "running",
      totalThreads: 8,
      processedThreads: 3,
      matchedThreads: 2,
      appliedThreads: 2,
      failedThreads: 0,
      perRule: [],
    };
    mocks.backfillStatus.isError = true;

    render(<AiInboxSetup embedded forceOpen firstRunStage="sorting" />);
    await screen.findByText("mail.sort.aiSetupSortingFailed");
    const callsBeforeRetry = mocks.startBackfill.mock.calls.length;

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupRetry" }),
    );

    expect(mocks.backfillStatus.refetch).toHaveBeenCalledOnce();
    expect(mocks.startBackfill).toHaveBeenCalledTimes(callsBeforeRetry);
  });

  it("starts a new backfill after the active run reaches a failed state", async () => {
    window.sessionStorage.setItem(
      "mail.ai-setup.pending-rule-ids",
      JSON.stringify(["rule-receipts"]),
    );
    mocks.backfillStatus.data = {
      runId: "run-1",
      status: "failed",
      totalThreads: 8,
      processedThreads: 3,
      matchedThreads: 2,
      appliedThreads: 1,
      failedThreads: 1,
      perRule: [],
    };

    render(<AiInboxSetup embedded forceOpen firstRunStage="sorting" />);
    await screen.findByText("mail.sort.aiSetupSortingFailed");
    const callsBeforeRetry = mocks.startBackfill.mock.calls.length;

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupRetry" }),
    );

    await waitFor(() =>
      expect(mocks.startBackfill).toHaveBeenCalledTimes(callsBeforeRetry + 1),
    );
  });

  it("keeps setup hidden behind the Google and Jev loading gates", () => {
    mocks.googleStatus.isLoading = true;
    const firstRender = render(<AiInboxSetup forceOpen />);
    expect(
      screen.queryByRole("heading", { name: "mail.sort.aiSetupTagsHeadline" }),
    ).toBeNull();
    firstRender.unmount();

    mocks.googleStatus.isLoading = false;
    mocks.jevAvailability.isLoading = true;
    render(<AiInboxSetup forceOpen />);
    expect(
      screen.queryByRole("heading", { name: "mail.sort.aiSetupTagsHeadline" }),
    ).toBeNull();
  });

  it("runs the Settings dialog from rules through backfill results", async () => {
    const onOpenChange = vi.fn();
    mocks.backfillStatus.data = {
      runId: "run-1",
      status: "completed",
      totalThreads: 4,
      processedThreads: 4,
      matchedThreads: 1,
      appliedThreads: 1,
      failedThreads: 1,
      perRule: [
        {
          ruleId: "rule-1",
          name: "Receipts",
          matchedCount: 1,
          appliedCount: 1,
          suggestedCount: 0,
          previews: [
            {
              id: "mail-1",
              from: "Store <orders@example.test>",
              subject: "A real receipt",
              labels: ["Receipts"],
              archived: false,
            },
          ],
        },
      ],
    };

    render(<AiInboxSetup forceOpen onOpenChange={onOpenChange} />);
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "mail.sort.aiSetupSkipInboxHeadline",
      }),
      { target: { value: "Archive weekly newsletters" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSortInbox" }),
    );

    await waitFor(() =>
      expect(mocks.startBackfill).toHaveBeenCalledWith({
        operation: "start",
        ruleIds: ["rule-1", "rule-2", "rule-3"],
      }),
    );
    expect(await screen.findByText("A real receipt")).not.toBeNull();
    expect(screen.getByText("mail.sort.aiSetupPartialFailure")).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupDone" }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("lets the Settings dialog save and finish without Jev", async () => {
    mocks.jevAvailability.data = { configured: false };
    const onOpenChange = vi.fn();
    render(<AiInboxSetup forceOpen onOpenChange={onOpenChange} />);

    expect(
      screen.getAllByRole("heading", {
        name: "mail.sort.aiSetupTagsHeadline",
      }),
    ).toHaveLength(1);
    expect(screen.getByText("mail.sort.aiSetupTagsDescription")).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      aiSetupCompleted: true,
    });
    expect(mocks.createRule).toHaveBeenCalledTimes(2);
    expect(mocks.startBackfill).not.toHaveBeenCalled();
  });

  it("shows the Google connect handoff on the post-setup sorting screen", () => {
    mocks.googleStatus.data = { accounts: [], configured: true };
    render(<AiInboxSetup embedded forceOpen firstRunStage="sorting" />);

    expect(screen.getByTestId("gmail-connect")).not.toBeNull();
    expect(
      screen.getByTestId("gmail-connect").getAttribute("data-variant"),
    ).toBe("button");
    expect(
      screen.getByRole("heading", {
        name: "mail.sort.aiSetupConnectGmailHeadline",
      }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "mail.sort.aiSetupSortingHeadline",
      }),
    ).toBeNull();
    expect(screen.queryByText("mail.sort.aiSetupNoRules")).toBeNull();
  });

  it("waits for Gmail status before deciding whether to connect", () => {
    mocks.googleStatus.data = undefined;
    mocks.googleStatus.isLoading = true;
    mocks.googleStatus.isSuccess = false;

    render(<AiInboxSetup embedded forceOpen firstRunStage="sorting" />);

    expect(screen.queryByTestId("gmail-connect")).toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "mail.sort.aiSetupConnectGmailHeadline",
      }),
    ).toBeNull();
  });

  it("shows a retry instead of a Gmail connect prompt when status fails", () => {
    mocks.googleStatus.data = undefined;
    mocks.googleStatus.isError = true;
    mocks.googleStatus.isSuccess = false;

    render(<AiInboxSetup embedded forceOpen firstRunStage="sorting" />);

    expect(
      screen.getByText("mail.sort.aiSetupGmailStatusFailed"),
    ).not.toBeNull();
    expect(screen.queryByTestId("gmail-connect")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupRetry" }),
    );
    expect(mocks.googleStatus.refetch).toHaveBeenCalledOnce();
  });

  it("retries unknown model settings without prompting for Jev or claiming results", () => {
    mocks.jevAvailability.data = { configured: false };
    mocks.automationSettings.isError = true;

    render(<AiInboxSetup embedded forceOpen firstRunStage="sorting" />);

    expect(
      screen.getByText("mail.sort.aiSetupAutomationSettingsFailed"),
    ).not.toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "mail.sort.aiSetupConnectJevHeadline",
      }),
    ).toBeNull();
    expect(screen.queryByTestId("jev-connect")).toBeNull();
    expect(screen.queryByText("mail.sort.aiSetupNoMatches")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupRetry" }),
    );
    expect(mocks.automationSettings.refetch).toHaveBeenCalledOnce();
  });

  it("keeps the settings dialog open when model settings could not be checked", async () => {
    mocks.jevAvailability.data = { configured: false };
    mocks.automationSettings.isError = true;

    render(<AiInboxSetup forceOpen />);
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );

    expect(
      screen.getByText("mail.sort.aiSetupAutomationSettingsFailed"),
    ).not.toBeNull();
    expect(screen.queryByTestId("jev-connect")).toBeNull();
    expect(mocks.createRule).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "mail.sort.aiSetupSortInbox" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    ).toHaveProperty("disabled", true);
  });

  it("keeps a cached Gmail connection after a status refetch fails", () => {
    const view = render(
      <AiInboxSetup embedded forceOpen firstRunStage="sorting" />,
    );
    mocks.googleStatus.isError = true;
    mocks.googleStatus.isSuccess = false;
    view.rerender(<AiInboxSetup embedded forceOpen firstRunStage="sorting" />);

    expect(screen.queryByText("mail.sort.aiSetupGmailStatusFailed")).toBeNull();
    expect(screen.queryByTestId("gmail-connect")).toBeNull();
  });

  it("keeps an open setup dialog and its edits after a Gmail refetch fails", () => {
    const view = render(<AiInboxSetup forceOpen />);
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupAddTab" }),
    );
    const tabName = screen.getByRole("textbox", {
      name: "mail.sort.aiSetupCustomTabName",
    });
    fireEvent.change(tabName, { target: { value: "Personal" } });

    mocks.googleStatus.isError = true;
    mocks.googleStatus.isSuccess = false;
    view.rerender(<AiInboxSetup forceOpen />);

    expect(screen.getByTestId("dialog")).not.toBeNull();
    expect(
      screen.getByRole("textbox", {
        name: "mail.sort.aiSetupCustomTabName",
      }),
    ).toHaveProperty("value", "Personal");
    expect(screen.queryByText("mail.sort.aiSetupGmailStatusFailed")).toBeNull();
  });

  it("offers Skip for now while Gmail or Jev setup is still needed", () => {
    mocks.googleStatus.data = { accounts: [], configured: true };
    const onSkip = vi.fn();
    const view = render(
      <AiInboxSetup
        embedded
        forceOpen
        firstRunStage="sorting"
        onSkip={onSkip}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    expect(onSkip).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "mail.sort.aiSetupDone" }),
    ).toBeNull();

    mocks.googleStatus.data = {
      accounts: [{ email: "mail-test@example.test" }],
      configured: true,
    };
    mocks.jevAvailability.data = { configured: false };
    view.rerender(
      <AiInboxSetup
        embedded
        forceOpen
        firstRunStage="sorting"
        onSkip={onSkip}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "mail.sort.aiSetupConnectJevHeadline",
      }),
    ).not.toBeNull();
    expect(screen.getByTestId("jev-connect")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "mail.sort.aiSetupAdjustRules" }),
    ).toBeNull();
  });

  it("keeps cached results, review, and undo visible during a rules refresh", async () => {
    mocks.backfillStatus.data = {
      runId: "run-1",
      status: "completed",
      totalThreads: 4,
      processedThreads: 4,
      matchedThreads: 1,
      appliedThreads: 1,
      failedThreads: 0,
      perRule: [
        {
          ruleId: "rule-1",
          name: "Receipts",
          matchedCount: 1,
          appliedCount: 1,
          suggestedCount: 0,
          previews: [],
        },
      ],
      undoToken: "undo-1",
    };
    const view = render(<AiInboxSetup forceOpen />);
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSortInbox" }),
    );
    await screen.findByText("Matched 1");

    mocks.rulesLoading = true;
    view.rerender(<AiInboxSetup forceOpen />);

    expect(screen.getByText("Matched 1")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "mail.sort.aiSetupTagReceipts" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "mail.actions.undo" }),
    ).not.toBeNull();
  });
});
