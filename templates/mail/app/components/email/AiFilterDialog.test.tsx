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
  apply: vi.fn(),
  refine: vi.fn(),
  backfill: vi.fn(),
  statusForRun: vi.fn(),
  statusRefetch: vi.fn(),
  refetchAutomations: vi.fn(),
  toast: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/hooks/use-ai-filter", () => ({
  useManageAiFilter: () => ({ isPending: false, mutateAsync: mocks.apply }),
  useManageAiFilterBackfill: () => ({
    isPending: false,
    mutateAsync: mocks.backfill,
  }),
  useAiFilterBackfillStatus: (runId: string | null) => ({
    data: runId ? mocks.statusForRun(runId) : undefined,
    isLoading: false,
    refetch: mocks.statusRefetch,
  }),
  useRefineAiFilter: () => ({ isPending: false, mutateAsync: mocks.refine }),
}));

vi.mock("@/hooks/use-automations", () => ({
  useAutomations: () => ({ refetch: mocks.refetchAutomations }),
}));

vi.mock("@/hooks/use-account-filter", () => ({
  useAccountFilter: () => ({ activeAccounts: new Set<string>() }),
}));

vi.mock("@/hooks/use-emails", () => ({
  useLabels: () => ({
    data: [{ id: "agent-native-filtered", name: "Agent Native Filtered" }],
  }),
}));

vi.mock("react-router", () => ({
  Link: ({
    to,
    children,
    onClick,
  }: React.PropsWithChildren<{
    to: string;
    onClick?: () => void;
  }>) => (
    <a href={to} onClick={onClick}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(mocks.toast, { error: mocks.toastError }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: React.PropsWithChildren<{ open: boolean }>) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: React.PropsWithChildren) => (
    <div role="dialog">{children}</div>
  ),
  DialogDescription: ({ children }: React.PropsWithChildren) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: React.PropsWithChildren) => (
    <footer>{children}</footer>
  ),
  DialogHeader: ({ children }: React.PropsWithChildren) => (
    <header>{children}</header>
  ),
  DialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
}));

import { AiFilterDialog } from "./AiFilterDialog";

const target = {
  id: "message-1",
  threadId: "thread-1",
  sender: "Taylor <taylor@example.test>",
  subject: "Plan update",
  snippet: "The latest plan is attached.",
};

function renderDialog(action: "filter" | "keep") {
  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <AiFilterDialog
      open
      onOpenChange={onOpenChange}
      action={action}
      targets={[target]}
      onComplete={onComplete}
    />,
  );
  return { onComplete, onOpenChange };
}

describe("AiFilterDialog", () => {
  beforeEach(() => {
    mocks.apply.mockResolvedValue(undefined);
    mocks.refine.mockResolvedValue({
      rule: { id: "learned-rule" },
      backfillRunId: "backfill-1",
      backfillStatus: "queued",
    });
    mocks.backfill.mockImplementation((input) =>
      input.operation === "start"
        ? { runId: "backfill-1", status: "queued" }
        : { runId: input.runId, status: "undoing" },
    );
    mocks.statusForRun.mockReturnValue({
      runId: "backfill-1",
      status: "completed",
      totalThreads: 1,
      processedThreads: 1,
      matchedThreads: 1,
      appliedThreads: 1,
      failedThreads: 0,
      perRule: [
        {
          ruleId: "learned-rule",
          name: "AI filter learned examples",
          matchedCount: 1,
          appliedCount: 1,
          suggestedCount: 0,
          previews: [
            {
              id: "matched-message",
              from: "News <news@example.test>",
              subject: "A recent match",
              labels: ["agent-native-filtered"],
              archived: true,
            },
            {
              id: "matched-message-2",
              from: "Store <store@example.test>",
              subject: "A second recent match",
              labels: [],
              archived: true,
            },
            {
              id: "matched-message-3",
              from: "Forum <forum@example.test>",
              subject: "A third recent match",
              labels: ["agent-native-filtered"],
              archived: false,
            },
          ],
        },
      ],
      undoToken: "undo-1",
    });
    mocks.statusRefetch.mockResolvedValue(undefined);
    mocks.refetchAutomations.mockResolvedValue({
      data: [
        {
          id: "learned-rule",
          domain: "mail",
          kind: "ai-filter",
          name: "AI filter learned examples",
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the filter effect and Gmail Spam distinction, then applies and reviews real matches", async () => {
    const { onComplete, onOpenChange } = renderDialog("filter");

    expect(screen.getByText("mail.aiFilter.filterDescription")).toBeTruthy();
    expect(screen.getByText("mail.aiFilter.labelHelp")).toBeTruthy();
    expect(screen.getByText("mail.aiFilter.commentHint")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "mail.aiFilter.filterButton" }),
    );

    await waitFor(() => {
      expect(mocks.apply).toHaveBeenCalledWith({
        mode: "filter",
        targets: [
          {
            id: "message-1",
            threadId: "thread-1",
            accountEmail: undefined,
            sender: "Taylor <taylor@example.test>",
            subject: "Plan update",
          },
        ],
      });
      expect(mocks.refine).toHaveBeenCalledWith({
        ruleId: "learned-rule",
        corrections: [
          {
            emailId: "message-1",
            sender: "Taylor <taylor@example.test>",
            subject: "Plan update",
            snippet: "The latest plan is attached.",
            expectedMatch: true,
          },
        ],
      });
      expect(mocks.backfill).not.toHaveBeenCalled();
    });
    expect(screen.getByText("A recent match")).toBeTruthy();
    expect(screen.getByText("A second recent match")).toBeTruthy();
    expect(screen.getByText("A third recent match")).toBeTruthy();
    expect(screen.getAllByText("agent native fil…")).toHaveLength(2);
    expect(
      screen
        .getByRole("link", { name: "mail.aiFilter.reviewLabel" })
        .getAttribute("href"),
    ).toBe("/all?label=agent-native-filtered");
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "mail.actions.undo" }));
    await waitFor(() =>
      expect(mocks.backfill).toHaveBeenLastCalledWith({
        operation: "undo",
        runId: "backfill-1",
        undoToken: "undo-1",
      }),
    );
    await waitFor(() => expect(mocks.statusRefetch).toHaveBeenCalledOnce());

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupDone" }),
    );
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the keep effect and refines a correction as not a match", async () => {
    renderDialog("keep");

    expect(screen.getByText("mail.aiFilter.keepDescription")).toBeTruthy();
    expect(screen.getByText("mail.aiFilter.labelHelp")).toBeTruthy();
    expect(screen.getByText("mail.aiFilter.learningNote")).toBeTruthy();
    fireEvent.change(
      screen.getByPlaceholderText("mail.aiFilter.correctPlaceholder"),
      {
        target: { value: "This is a customer message." },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.aiFilter.keepButton" }),
    );

    await waitFor(() =>
      expect(mocks.refine).toHaveBeenCalledWith({
        ruleId: "learned-rule",
        corrections: [
          {
            emailId: "message-1",
            sender: "Taylor <taylor@example.test>",
            subject: "Plan update",
            snippet: "The latest plan is attached.",
            expectedMatch: false,
          },
        ],
        comment: "This is a customer message.",
      }),
    );
    expect(mocks.backfill).not.toHaveBeenCalled();
  });
});
