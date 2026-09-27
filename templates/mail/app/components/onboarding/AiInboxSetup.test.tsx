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
  startBackfill: vi.fn(),
  updateSettings: vi.fn(),
  settingsPending: false,
  canOfferGoogleOAuthSetup: false,
  sendToAgentChat: vi.fn(),
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
  googleStatus: {
    data: {
      accounts: [{ email: "mail-test@example.test" }],
      configured: true,
    } as { accounts: { email: string }[]; configured?: boolean } | undefined,
    isLoading: false,
    isError: false,
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => mocks.jevAvailability,
}));

vi.mock("@agent-native/core/client/onboarding", () => ({
  useFirstRunOnboardingGateOwnsSurface: () =>
    mocks.firstRunOnboardingGateOwnsSurface,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: mocks.sendToAgentChat,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { count?: number }) =>
    key === "mail.sort.aiSetupRuleCount"
      ? `Matched ${options?.count ?? ""}`
      : key,
}));

vi.mock("@/components/settings/JevConnectionPrompt", () => ({
  JevConnectionPrompt: () => null,
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
  GoogleConnectBanner: () => <div data-testid="gmail-connect" />,
}));

vi.mock("@/lib/google-oauth-setup", () => ({
  shouldOfferGoogleOAuthSetup: () => mocks.canOfferGoogleOAuthSetup,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
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

import { AI_FILTER_LABEL } from "@shared/ai-filter";
import { AI_IMPORTANT_LABEL } from "@shared/ai-priority";

import { labelTabHref } from "@/lib/inbox-tabs";

import { AiInboxSetup } from "./AiInboxSetup";

describe("AiInboxSetup", () => {
  beforeEach(() => {
    let id = 0;
    mocks.automations = [];
    mocks.rulesLoading = false;
    mocks.firstRunOnboardingGateOwnsSurface = false;
    mocks.updateRule.mockReset();
    mocks.createRule.mockImplementation(async (input) => ({
      id: `rule-${++id}`,
      ...input,
    }));
    mocks.startBackfill.mockResolvedValue({ runId: "run-1", status: "queued" });
    mocks.updateSettings.mockResolvedValue(undefined);
    mocks.settingsPending = false;
    mocks.canOfferGoogleOAuthSetup = false;
    mocks.backfillStatus.data = undefined;
    mocks.backfillStatus.isLoading = false;
    mocks.backfillStatus.isFetching = false;
    mocks.backfillStatus.isError = false;
    mocks.jevAvailability.data = { configured: true };
    mocks.jevAvailability.isLoading = false;
    mocks.jevAvailability.isError = false;
    mocks.googleStatus.data = {
      accounts: [{ email: "mail-test@example.test" }],
      configured: true,
    };
    mocks.googleStatus.isLoading = false;
    mocks.googleStatus.isError = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("defers inbox setup while first-run onboarding owns the surface", () => {
    mocks.firstRunOnboardingGateOwnsSurface = true;

    render(<AiInboxSetup forceOpen />);

    expect(
      screen.queryByRole("heading", {
        name: "mail.sort.aiSetupTagsHeadline",
      }),
    ).toBeNull();
  });

  it("requires text or an explicit skip on the importance step", () => {
    render(<AiInboxSetup forceOpen />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );

    expect(
      (
        screen.getByRole("button", {
          name: "mail.sort.aiSetupContinue",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );

    expect(screen.getByText("mail.aiFilter.skipInboxMode")).not.toBeNull();
  });

  it("starts with a real inbox decision and a one-line importance example", async () => {
    render(<AiInboxSetup forceOpen />);

    expect(
      screen.getByRole("heading", { name: "mail.sort.aiSetupTagsHeadline" }),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "mail.sort.aiSetupTagReceipts" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    const important = await screen.findByRole("textbox", {
      name: "mail.sort.aiSetupImportantHeadline",
    });
    expect((important as HTMLInputElement).tagName).toBe("INPUT");
    expect((important as HTMLInputElement).placeholder).toBe(
      "mail.sort.aiSetupImportantExample",
    );
  });

  it("runs inline in first-run onboarding and skips without changing mail", async () => {
    const onComplete = vi.fn();
    const onSkipSetup = vi.fn();
    render(
      <AiInboxSetup
        forceOpen
        embedded
        onComplete={onComplete}
        onSkipSetup={onSkipSetup}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "mail.sort.aiSetupTagsHeadline" }),
    ).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkipSetup" }),
    );

    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        aiSetupCompleted: true,
      }),
    );
    expect(onSkipSetup).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.createRule).not.toHaveBeenCalled();
    expect(mocks.startBackfill).not.toHaveBeenCalled();
  });

  it("offers the shared Gmail setup when first-run has no connected account", async () => {
    const onSkipSetup = vi.fn();
    mocks.googleStatus.data = { accounts: [], configured: true };

    render(
      <AiInboxSetup
        forceOpen
        embedded
        onComplete={vi.fn()}
        onSkipSetup={onSkipSetup}
      />,
    );

    expect(screen.getByTestId("gmail-connect")).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkipSetup" }),
    );

    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        aiSetupCompleted: true,
      }),
    );
    expect(onSkipSetup).toHaveBeenCalledOnce();
  });

  it("explains when Gmail setup is unavailable and persists Skip", async () => {
    const onSkipSetup = vi.fn();
    mocks.googleStatus.data = { accounts: [], configured: false };

    render(
      <AiInboxSetup
        forceOpen
        embedded
        onComplete={vi.fn()}
        onSkipSetup={onSkipSetup}
      />,
    );

    expect(
      screen.getByText("mail.googleConnect.connectionNotConfigured"),
    ).not.toBeNull();
    expect(screen.queryByTestId("gmail-connect")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkipSetup" }),
    );

    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        aiSetupCompleted: true,
      }),
    );
    expect(onSkipSetup).toHaveBeenCalledOnce();
  });

  it("disables first-run Skip while rules are saving", async () => {
    const onSkipSetup = vi.fn();
    let finishBackfill: ((result: { runId: string }) => void) | undefined;
    mocks.startBackfill.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishBackfill = resolve;
        }),
    );
    render(<AiInboxSetup forceOpen embedded onSkipSetup={onSkipSetup} />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.change(
      await screen.findByRole("textbox", {
        name: "mail.sort.aiSetupImportantHeadline",
      }),
      { target: { value: "Anything from my finance team" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "mail.sort.aiSetupSortInbox",
      }),
    );

    const skipButton = screen.getByRole("button", {
      name: "mail.sort.aiSetupSkipSetup",
    }) as HTMLButtonElement;
    await waitFor(() => expect(skipButton.disabled).toBe(true));
    fireEvent.click(skipButton);
    expect(onSkipSetup).not.toHaveBeenCalled();

    finishBackfill?.({ runId: "run-1" });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "mail.sort.aiSetupSkipSetup" }),
      ).toBeNull(),
    );
  });

  it("uses the shared Skip inbox label on the cleanup step", () => {
    render(<AiInboxSetup forceOpen />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );

    expect(screen.getByText("mail.aiFilter.skipInboxMode")).not.toBeNull();
    expect(screen.queryByText("mail.aiFilter.autoArchiveMode")).toBeNull();
  });

  it("does not save the cleanup examples as archive or spam rules", async () => {
    render(<AiInboxSetup forceOpen />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );

    const archiveInput = screen.getByRole("textbox", {
      name: "mail.aiFilter.skipInboxMode",
    }) as HTMLInputElement;
    const spamInput = screen.getByRole("textbox", {
      name: "mail.aiFilter.filteredMode",
    }) as HTMLInputElement;
    expect(archiveInput.value).toBe("mail.sort.aiSetupArchiveExample");
    expect(spamInput.value).toBe("mail.sort.aiSetupFilteredExample");
    expect(
      screen
        .getAllByRole("switch")
        .map((toggle) => toggle.getAttribute("aria-checked")),
    ).toEqual(["false", "false"]);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSortInbox" }),
    );

    await screen.findByRole("heading", {
      name: "mail.sort.aiSetupSortingHeadline",
    });
    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        aiSetupCompleted: true,
      }),
    );
    await waitFor(() => expect(mocks.startBackfill).toHaveBeenCalledOnce());
    expect(mocks.createRule).not.toHaveBeenCalledWith(
      expect.objectContaining({
        actions: expect.arrayContaining([{ type: "archive" }]),
      }),
    );
    expect(mocks.createRule).not.toHaveBeenCalledWith(
      expect.objectContaining({
        actions: expect.arrayContaining([
          { type: "label", labelName: AI_FILTER_LABEL },
        ]),
      }),
    );
  });

  it("keeps cleanup rules off when their prompt is cleared and rewritten", async () => {
    render(<AiInboxSetup forceOpen />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );

    const [archiveSwitch, spamSwitch] = screen.getAllByRole("switch");
    const archiveInput = screen.getByRole("textbox", {
      name: "mail.aiFilter.skipInboxMode",
    });
    const spamInput = screen.getByRole("textbox", {
      name: "mail.aiFilter.filteredMode",
    });

    fireEvent.change(archiveInput, {
      target: { value: "Archive newsletters" },
    });
    fireEvent.change(spamInput, {
      target: { value: "Skip bot notifications" },
    });
    expect(archiveSwitch?.getAttribute("aria-checked")).toBe("true");
    expect(spamSwitch?.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(archiveSwitch!);
    fireEvent.click(spamSwitch!);
    fireEvent.change(archiveInput, { target: { value: "" } });
    fireEvent.change(spamInput, { target: { value: "" } });
    fireEvent.change(archiveInput, {
      target: { value: "Archive vendor newsletters" },
    });
    fireEvent.change(spamInput, {
      target: { value: "Skip automated bot notifications" },
    });

    expect(archiveSwitch?.getAttribute("aria-checked")).toBe("false");
    expect(spamSwitch?.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSortInbox" }),
    );
    await screen.findByRole("heading", {
      name: "mail.sort.aiSetupSortingHeadline",
    });
    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        aiSetupCompleted: true,
      }),
    );

    expect(mocks.createRule).not.toHaveBeenCalled();
    expect(mocks.startBackfill).not.toHaveBeenCalled();
  });

  it("resets cleanup opt-outs when setup is reopened", async () => {
    mocks.automations = [
      {
        id: "existing-rule",
        domain: "mail",
        kind: "ai-filter",
        condition: "Existing important rule",
        actions: [{ type: "label", labelName: AI_IMPORTANT_LABEL }],
        enabled: true,
      },
    ];
    const { rerender } = render(<AiInboxSetup forceOpen />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    const archiveInput = screen.getByRole("textbox", {
      name: "mail.aiFilter.skipInboxMode",
    });
    const spamInput = screen.getByRole("textbox", {
      name: "mail.aiFilter.filteredMode",
    });
    const [archiveSwitch, spamSwitch] = screen.getAllByRole("switch");

    fireEvent.change(archiveInput, {
      target: { value: "Archive older newsletters" },
    });
    fireEvent.change(spamInput, {
      target: { value: "Skip older bot alerts" },
    });
    fireEvent.click(archiveSwitch!);
    fireEvent.click(spamSwitch!);

    rerender(<AiInboxSetup forceOpen={false} />);
    rerender(<AiInboxSetup forceOpen />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    const reopenedArchiveInput = screen.getByRole("textbox", {
      name: "mail.aiFilter.skipInboxMode",
    });
    const reopenedSpamInput = screen.getByRole("textbox", {
      name: "mail.aiFilter.filteredMode",
    });
    const [reopenedArchiveSwitch, reopenedSpamSwitch] =
      screen.getAllByRole("switch");
    fireEvent.change(reopenedArchiveInput, {
      target: { value: "Archive new newsletters" },
    });
    fireEvent.change(reopenedSpamInput, {
      target: { value: "Skip new bot alerts" },
    });

    expect(reopenedArchiveSwitch?.getAttribute("aria-checked")).toBe("true");
    expect(reopenedSpamSwitch?.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSortInbox" }),
    );
    await screen.findByRole("heading", {
      name: "mail.sort.aiSetupSortingHeadline",
    });
    await waitFor(() =>
      expect(mocks.startBackfill).toHaveBeenCalledWith({
        operation: "start",
        ruleIds: ["rule-1", "rule-2"],
      }),
    );
    expect(mocks.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        condition: "Archive new newsletters",
        actions: [{ type: "archive" }],
      }),
    );
    expect(mocks.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        condition: "Skip new bot alerts",
        actions: [
          { type: "label", labelName: AI_FILTER_LABEL },
          { type: "archive" },
        ],
      }),
    );
  });

  it("keeps account and Jev loading gates when setup is force-opened", () => {
    const { rerender } = render(<AiInboxSetup forceOpen />);
    mocks.googleStatus.isLoading = true;
    rerender(<AiInboxSetup forceOpen />);
    expect(
      screen.queryByRole("heading", {
        name: "mail.sort.aiSetupTagsHeadline",
      }),
    ).toBeNull();

    mocks.googleStatus.isLoading = false;
    mocks.jevAvailability.isLoading = true;
    rerender(<AiInboxSetup forceOpen />);
    expect(
      screen.queryByRole("heading", {
        name: "mail.sort.aiSetupTagsHeadline",
      }),
    ).toBeNull();

    mocks.jevAvailability.isLoading = false;
    mocks.googleStatus.data = { accounts: [] };
    rerender(<AiInboxSetup forceOpen />);
    expect(
      screen.queryByRole("heading", {
        name: "mail.sort.aiSetupTagsHeadline",
      }),
    ).toBeNull();

    mocks.googleStatus.data = {
      accounts: [{ email: "mail-test@example.test" }],
    };
    rerender(<AiInboxSetup forceOpen />);
    expect(
      screen.getByRole("heading", {
        name: "mail.sort.aiSetupTagsHeadline",
      }),
    ).not.toBeNull();
  });

  it("shows a skeleton in first-run while Jev availability loads", () => {
    mocks.jevAvailability.isLoading = true;
    const { container } = render(<AiInboxSetup forceOpen embedded />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "mail.sort.aiSetupTagsHeadline",
      }),
    ).toBeNull();
  });

  it("advances through setup before completing from the final step", async () => {
    const onOpenChange = vi.fn();
    mocks.jevAvailability.data = undefined;
    mocks.jevAvailability.isError = true;

    render(<AiInboxSetup forceOpen onOpenChange={onOpenChange} />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    expect(screen.getByRole("progressbar", { name: "2/4" })).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    expect(screen.getByRole("progressbar", { name: "3/4" })).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    expect(screen.getByRole("progressbar", { name: "4/4" })).not.toBeNull();
    expect(
      screen.getByRole("heading", {
        name: "mail.sort.aiSetupSortingHeadline",
      }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "mail.thread.back" }),
    ).toBeNull();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupDone" }),
    );

    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        aiSetupCompleted: true,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("waits for the initial rules load before applying setup rules", async () => {
    mocks.rulesLoading = true;
    const { rerender } = render(<AiInboxSetup forceOpen />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    const sortInbox = screen.getByRole("button", {
      name: "mail.sort.aiSetupSortInbox",
    });
    expect((sortInbox as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sortInbox);
    expect(mocks.startBackfill).not.toHaveBeenCalled();
    expect(mocks.createRule).not.toHaveBeenCalled();

    mocks.rulesLoading = false;
    rerender(<AiInboxSetup forceOpen />);
    expect(
      (
        screen.getByRole("button", {
          name: "mail.sort.aiSetupSortInbox",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("keeps live result counts, review, and undo visible during a rules refresh", async () => {
    mocks.startBackfill.mockImplementation(async () => {
      mocks.rulesLoading = true;
      return { runId: "run-1", status: "queued" };
    });
    mocks.backfillStatus.data = {
      runId: "run-1",
      status: "completed",
      totalThreads: 1,
      processedThreads: 1,
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
          previews: [
            {
              id: "thread-1",
              from: "sender@example.test",
              subject: "An exact-pair message",
              labels: ["Receipts"],
              archived: false,
            },
          ],
        },
      ],
      undoToken: "undo-1",
    };

    render(<AiInboxSetup forceOpen />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSortInbox" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "mail.sort.aiSetupSortingHeadline",
        }),
      ).not.toBeNull(),
    );
    expect(screen.getByText("Matched 1")).not.toBeNull();
    expect(screen.getByText("An exact-pair message")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "mail.sort.aiSetupTagReceipts" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "mail.sort.aiSetupDone" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "mail.thread.back" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "mail.actions.undo" }),
    ).not.toBeNull();
  });

  it("does not backfill default tags after skipping the tag step", async () => {
    render(<AiInboxSetup forceOpen />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "mail.thread.back" }));
    expect(
      screen
        .getByRole("button", { name: "mail.sort.aiSetupTagReceipts" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "mail.sort.aiSetupTagGitHub" })
        .getAttribute("aria-pressed"),
    ).toBe("false");

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSortInbox" }),
    );

    await screen.findByRole("heading", {
      name: "mail.sort.aiSetupSortingHeadline",
    });
    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        aiSetupCompleted: true,
      }),
    );
    expect(mocks.startBackfill).not.toHaveBeenCalled();
    expect(mocks.createRule).not.toHaveBeenCalled();
  });

  it("does not save or backfill a draft Important rule after skipping that step", async () => {
    render(<AiInboxSetup forceOpen />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.change(
      await screen.findByRole("textbox", {
        name: "mail.sort.aiSetupImportantHeadline",
      }),
      { target: { value: "Anything from my manager" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );

    await waitFor(() =>
      expect(mocks.startBackfill).toHaveBeenCalledWith({
        operation: "start",
        ruleIds: ["rule-1", "rule-2"],
      }),
    );
    expect(mocks.createRule).toHaveBeenCalledTimes(2);
    expect(mocks.createRule).not.toHaveBeenCalledWith(
      expect.objectContaining({
        condition: "Anything from my manager",
        actions: [{ type: "label", labelName: AI_IMPORTANT_LABEL }],
      }),
    );
  });

  it("saves tags and Important when skipping optional cleanup", async () => {
    render(<AiInboxSetup forceOpen />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "mail.sort.aiSetupImportantHeadline",
      }),
      { target: { value: "Anything from my manager" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );

    await waitFor(() =>
      expect(mocks.startBackfill).toHaveBeenCalledWith({
        operation: "start",
        ruleIds: ["rule-1", "rule-2", "rule-3"],
      }),
    );
    expect(mocks.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        condition: "mail.sort.aiSetupPromptReceipts",
      }),
    );
    expect(mocks.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        condition: "mail.sort.aiSetupPromptGitHub",
      }),
    );
    expect(mocks.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        condition: "Anything from my manager",
        actions: [{ type: "label", labelName: AI_IMPORTANT_LABEL }],
      }),
    );
    expect(mocks.createRule).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("progressbar", { name: "4/4" })).not.toBeNull();
  });

  it("enables a matching disabled rule before including it in the backfill", async () => {
    const disabledRule = {
      id: "disabled-receipts",
      domain: "mail" as const,
      kind: "ai-filter" as const,
      condition: "mail.sort.aiSetupPromptReceipts",
      actions: [
        {
          type: "label" as const,
          labelName: "mail.sort.aiSetupTagReceipts",
        },
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
      screen.getByRole("button", { name: "mail.sort.aiSetupSortInbox" }),
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

  it("applies the chosen rules to recent mail and shows real results with Review and Undo", async () => {
    mocks.backfillStatus.data = {
      runId: "run-1",
      status: "completed",
      totalThreads: 12,
      processedThreads: 12,
      matchedThreads: 4,
      appliedThreads: 4,
      failedThreads: 0,
      perRule: [
        {
          ruleId: "rule-1",
          name: "Receipts",
          matchedCount: 2,
          appliedCount: 2,
          suggestedCount: 0,
          previews: [
            {
              id: "thread-1",
              from: "Shop <orders@shop.example.test>",
              subject: "Your receipt",
              labels: ["Receipts"],
              archived: false,
            },
          ],
        },
        {
          ruleId: "rule-3",
          name: "Important",
          matchedCount: 1,
          appliedCount: 1,
          suggestedCount: 0,
          previews: [
            {
              id: "thread-2",
              from: "Manager <manager@example.test>",
              subject: "Needs a reply",
              labels: [AI_IMPORTANT_LABEL],
              archived: false,
            },
          ],
        },
        {
          ruleId: "rule-4",
          name: "Archive newsletters",
          matchedCount: 1,
          appliedCount: 1,
          suggestedCount: 0,
          previews: [
            {
              id: "thread-3",
              from: "News <newsletter@example.test>",
              subject: "Weekly news",
              labels: [],
              archived: true,
            },
          ],
        },
        {
          ruleId: "rule-5",
          name: "Skip bot notifications",
          matchedCount: 1,
          appliedCount: 1,
          suggestedCount: 0,
          previews: [
            {
              id: "thread-4",
              from: "GitHub <notifications@github.example.test>",
              subject: "Build complete",
              labels: [AI_FILTER_LABEL],
              archived: true,
            },
          ],
        },
      ],
      undoToken: "undo-1",
    };

    render(<AiInboxSetup forceOpen />);
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.change(
      await screen.findByRole("textbox", {
        name: "mail.sort.aiSetupImportantHeadline",
      }),
      { target: { value: "Anything from my manager, Priya" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "mail.aiFilter.skipInboxMode",
      }),
      { target: { value: "Archive newsletters" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "mail.aiFilter.filteredMode",
      }),
      { target: { value: "Skip bot notifications" } },
    );
    expect(
      screen
        .getAllByRole("switch")
        .map((toggle) => toggle.getAttribute("aria-checked")),
    ).toEqual(["true", "true"]);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "mail.sort.aiSetupSortInbox",
      }),
    );

    await waitFor(() => expect(mocks.startBackfill).toHaveBeenCalledOnce());
    expect(mocks.startBackfill).toHaveBeenCalledWith({
      operation: "start",
      ruleIds: ["rule-1", "rule-2", "rule-3", "rule-4", "rule-5"],
    });
    expect(mocks.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        condition: "Anything from my manager, Priya",
        actions: [{ type: "label", labelName: AI_IMPORTANT_LABEL }],
      }),
    );
    expect(await screen.findByText("Your receipt")).not.toBeNull();
    expect(screen.getByText("Build complete")).not.toBeNull();
    expect(screen.getAllByText("Receipts").length).toBeGreaterThan(1);
    expect(
      screen
        .getByRole("link", { name: "mail.sort.aiSetupTagReceipts" })
        .getAttribute("href"),
    ).toBe(labelTabHref("mail.sort.aiSetupTagReceipts"));
    expect(
      screen
        .getByRole("link", { name: "mail.aiFilter.importantMode" })
        .getAttribute("href"),
    ).toBe(labelTabHref(AI_IMPORTANT_LABEL));
    expect(
      screen
        .getByRole("link", { name: "mail.aiFilter.skipInboxMode" })
        .getAttribute("href"),
    ).toBe("/archive");
    expect(
      screen
        .getByRole("link", { name: "mail.aiFilter.filteredMode" })
        .getAttribute("href"),
    ).toBe(labelTabHref(AI_FILTER_LABEL));
    expect(
      screen.getByRole("button", { name: "mail.actions.undo" }),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "mail.actions.undo" }));
    await waitFor(() =>
      expect(mocks.startBackfill).toHaveBeenLastCalledWith({
        operation: "undo",
        runId: "run-1",
        undoToken: "undo-1",
      }),
    );
  });

  it("shows no fabricated previews for zero matches and lets the user teach Jev in chat", async () => {
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
          ruleId: "rule-1",
          name: "Receipts",
          matchedCount: 0,
          appliedCount: 0,
          suggestedCount: 0,
          previews: [],
        },
      ],
    };

    render(<AiInboxSetup forceOpen />);
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "mail.sort.aiSetupSkip",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "mail.sort.aiSetupSortInbox",
      }),
    );

    expect(
      await screen.findByText("mail.sort.aiSetupNoMatches"),
    ).not.toBeNull();
    expect(screen.queryByText("Your receipt")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupChatPrompt" }),
    );
    expect(mocks.sendToAgentChat).toHaveBeenCalledWith({
      message: "mail.sort.aiSetupChatPrompt",
      submit: false,
      openSidebar: true,
    });
  });

  it("does not report no matches when a backfill failed before evaluation", async () => {
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
          ruleId: "rule-1",
          name: "Receipts",
          matchedCount: 0,
          appliedCount: 0,
          suggestedCount: 0,
          previews: [],
        },
      ],
    };

    render(<AiInboxSetup forceOpen />);
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "mail.sort.aiSetupSkip",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "mail.sort.aiSetupSortInbox",
      }),
    );

    expect(await screen.findByText("mail.sort.aiSetupSortingFailed"));
    expect(screen.queryByText("mail.sort.aiSetupNoMatches")).toBeNull();
  });

  it("shows the status refresh error once while preserving cached progress", async () => {
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
          ruleId: "rule-1",
          name: "Receipts",
          matchedCount: 2,
          appliedCount: 2,
          suggestedCount: 0,
          previews: [],
        },
      ],
    };
    mocks.backfillStatus.isError = true;

    render(<AiInboxSetup forceOpen />);
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSortInbox" }),
    );

    await waitFor(() =>
      expect(
        screen.getAllByText("mail.sort.aiSetupSortingFailed"),
      ).toHaveLength(1),
    );
    expect(screen.getByText("mail.sort.aiSetupSortingProgress")).not.toBeNull();
    expect(screen.getByText("Matched 2")).not.toBeNull();
  });

  it("shows an indeterminate finding state until the backfill total is known", async () => {
    mocks.backfillStatus.isLoading = true;

    render(<AiInboxSetup forceOpen />);
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSkip" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupSortInbox" }),
    );

    expect(
      await screen.findByText("mail.sort.aiSetupFindingRecentMail"),
    ).not.toBeNull();
    expect(screen.queryByText("Sorting recent mail: 0 of 0")).toBeNull();
  });
});
