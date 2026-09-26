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
  startBackfill: vi.fn(),
  updateSettings: vi.fn(),
  sendToAgentChat: vi.fn(),
  backfillStatus: {
    data: undefined as
      | {
          runId: string;
          status: "completed" | "failed" | "undone";
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
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => mocks.jevAvailability,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: mocks.sendToAgentChat,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
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
  useAutomations: () => ({ data: mocks.automations, isLoading: false }),
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
  useUpdateSettings: () => ({ mutateAsync: mocks.updateSettings }),
}));

vi.mock("@/hooks/use-google-auth", () => ({
  useGoogleAuthStatus: () => ({
    data: { accounts: [{ email: "mail-test@example.test" }] },
    isLoading: false,
  }),
}));

import { AI_FILTER_LABEL } from "@shared/ai-filter";
import { AI_IMPORTANT_LABEL } from "@shared/ai-priority";

import { labelTabHref } from "@/lib/inbox-tabs";

import { AiInboxSetup } from "./AiInboxSetup";

describe("AiInboxSetup", () => {
  beforeEach(() => {
    let id = 0;
    mocks.automations = [];
    mocks.updateRule.mockReset();
    mocks.createRule.mockImplementation(async (input) => ({
      id: `rule-${++id}`,
      ...input,
    }));
    mocks.startBackfill.mockResolvedValue({ runId: "run-1", status: "queued" });
    mocks.updateSettings.mockResolvedValue(undefined);
    mocks.backfillStatus.data = undefined;
    mocks.backfillStatus.isLoading = false;
    mocks.backfillStatus.isFetching = false;
    mocks.backfillStatus.isError = false;
    mocks.jevAvailability.data = { configured: true };
    mocks.jevAvailability.isLoading = false;
    mocks.jevAvailability.isError = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
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
        ruleIds: ["disabled-receipts", "rule-1", "rule-2", "rule-3"],
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
        .getByRole("link", { name: "mail.aiFilter.autoArchiveMode" })
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
      await screen.findByRole("button", {
        name: "mail.sort.aiSetupContinue",
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
});
