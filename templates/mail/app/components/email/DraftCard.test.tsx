// @vitest-environment happy-dom

import type { ComposeState, EmailMessage } from "@shared/types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { forwardRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ComposeSendProgress } from "./ComposeModal";

const mockCompose = vi.hoisted(() => ({
  drafts: [] as ComposeState[],
  isLoading: false,
  isError: false,
  discard: vi.fn(),
  update: vi.fn(),
  stageForSend: vi.fn(),
  restoreAfterSend: vi.fn(),
  flush: vi.fn(),
  refetch: vi.fn(),
}));
const mockThread = vi.hoisted(() => ({
  data: undefined as EmailMessage[] | undefined,
  isLoading: false,
}));
const mockUseThreadMessages = vi.hoisted(() => vi.fn());
const mockUseEmail = vi.hoisted(() => vi.fn());
const mockEnsureThread = vi.hoisted(() => vi.fn());
const mockUpdateModelContext = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => ({ error: vi.fn() }));
const mockAccounts = vi.hoisted(() => ({
  current: [{ email: "agent@example.com" }] as Array<{ email: string }>,
}));
const composeProps = vi.hoisted(() => ({
  current: null as null | {
    activeDraft: ComposeState | null;
    onDiscard: (id: string) => void;
    onSendProgress: (progress: ComposeSendProgress) => void;
    sendDisabled?: boolean;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
  useFormatters: () => ({
    formatDate: (date: Date) => date.toISOString(),
  }),
}));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("@agent-native/core/client/mcp-app-host", () => ({
  updateMcpAppModelContext: mockUpdateModelContext,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));
vi.mock("@/hooks/use-compose-state", () => ({
  DRAFT_DELETE_FAILED_EVENT: "mail:draft-delete-failed",
  DRAFT_SAVE_FAILED_EVENT: "mail:draft-save-failed",
  useComposeState: () => mockCompose,
}));
vi.mock("@/hooks/use-emails", () => ({
  useEmail: mockUseEmail,
  useThreadMessages: mockUseThreadMessages,
}));
vi.mock("@/hooks/use-google-auth", () => ({
  useGoogleAuthStatus: () => ({ data: { accounts: mockAccounts.current } }),
}));
vi.mock("@/lib/thread-cache", () => ({ ensureThread: mockEnsureThread }));
vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

vi.mock("./ComposeModal", async () => {
  const { useAccountFilter } = await vi.importActual<
    typeof import("@/hooks/use-account-filter")
  >("@/hooks/use-account-filter");
  return {
    ComposeModal: (props: any) => {
      composeProps.current = props;
      const { allAccounts } = useAccountFilter();
      return (
        <div
          data-testid="composer"
          data-accounts={allAccounts.map((account) => account.email).join(",")}
        >
          <button type="button" onClick={() => props.onDiscard(props.activeId)}>
            discard
          </button>
        </div>
      );
    },
  };
});
vi.mock("./EmailThread", () => ({
  ExpandedMessageCard: forwardRef<HTMLDivElement, any>(
    ({ email, onCollapse }, ref) => (
      <div ref={ref} data-message={email.id} data-expanded="true">
        <button type="button" onClick={onCollapse}>
          collapse {email.id}
        </button>
      </div>
    ),
  ),
  CollapsedMessageRow: forwardRef<HTMLDivElement, any>(
    ({ email, onClick }, ref) => (
      <div ref={ref} data-message={email.id} data-expanded="false">
        <button type="button" onClick={onClick}>
          expand {email.id}
        </button>
      </div>
    ),
  ),
}));

import {
  DRAFT_DELETE_FAILED_EVENT,
  DRAFT_SAVE_FAILED_EVENT,
} from "@/hooks/use-compose-state";

import { DraftCard } from "./DraftCard";

const newDraft: ComposeState = {
  id: "new-draft",
  to: "sam@example.com",
  subject: "Lunch",
  body: "Free Friday?",
  mode: "compose",
};
const replyDraft: ComposeState = {
  id: "reply-draft",
  to: "sam@example.com",
  subject: "Re: Launch plan",
  body: "Sounds good.",
  mode: "reply",
  replyToId: "message-6",
  replyToThreadId: "thread-1",
  accountEmail: "agent@example.com",
};

function message(id: string, extra: Partial<EmailMessage> = {}) {
  return { id, threadId: "thread-1", subject: "Launch plan", ...extra };
}

function progress(update: ComposeSendProgress) {
  act(() => composeProps.current!.onSendProgress(update));
}

function shownMessages(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-message]")).map(
    (node) =>
      `${node.getAttribute("data-message")}:${node.getAttribute("data-expanded")}`,
  );
}

describe("DraftCard", () => {
  beforeEach(() => {
    mockCompose.drafts = [];
    mockCompose.isLoading = false;
    mockCompose.isError = false;
    mockCompose.discard.mockReset();
    mockCompose.discard.mockResolvedValue(true);
    mockToast.error.mockReset();
    mockCompose.refetch.mockReset();
    mockThread.data = undefined;
    mockThread.isLoading = false;
    mockUseThreadMessages.mockReset();
    mockUseThreadMessages.mockImplementation(() => mockThread);
    mockUseEmail.mockReset();
    mockUseEmail.mockReturnValue({ data: undefined, isError: false });
    mockEnsureThread.mockReset();
    mockEnsureThread.mockResolvedValue(undefined);
    mockUpdateModelContext.mockReset();
    mockAccounts.current = [{ email: "agent@example.com" }];
    composeProps.current = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("says when the draft is gone", () => {
    const { getByText, queryByTestId } = render(
      <DraftCard draftId="missing" />,
    );

    expect(getByText("mail.draftCard.notFoundTitle")).toBeTruthy();
    expect(queryByTestId("composer")).toBeNull();
  });

  it("offers a retry when drafts fail to load", () => {
    mockCompose.isError = true;
    const { getByRole } = render(<DraftCard draftId="reply-draft" />);

    fireEvent.click(getByRole("button", { name: "mail.error.tryAgain" }));
    expect(mockCompose.refetch).toHaveBeenCalled();
  });

  it("shows only the draft for a new email", () => {
    mockCompose.drafts = [newDraft];
    const { getByText, container } = render(<DraftCard draftId="new-draft" />);

    expect(getByText("mail.compose.newMessage")).toBeTruthy();
    expect(shownMessages(container)).toEqual([]);
    expect(mockUseThreadMessages).toHaveBeenLastCalledWith(
      undefined,
      "agent@example.com",
    );
  });

  it("folds a long thread and opens only the latest message", () => {
    mockCompose.drafts = [replyDraft];
    mockThread.data = [
      ...[1, 2, 3, 4, 5, 6].map((n) => message(`message-${n}`)),
      message("saved-draft", { isDraft: true }),
    ] as EmailMessage[];
    const { getByRole, getByText, container } = render(
      <DraftCard draftId="reply-draft" />,
    );

    expect(getByText("Re: Launch plan")).toBeTruthy();
    expect(shownMessages(container)).toEqual([
      "message-4:false",
      "message-5:false",
      "message-6:true",
    ]);

    fireEvent.click(getByRole("button", { name: "expand message-5" }));
    fireEvent.click(getByRole("button", { name: "collapse message-6" }));
    expect(shownMessages(container)).toEqual([
      "message-4:false",
      "message-5:true",
      "message-6:false",
    ]);

    fireEvent.click(
      getByRole("button", { name: "mail.draftCard.earlierMessages:3" }),
    );
    expect(shownMessages(container)).toHaveLength(6);
  });

  it("offers the composer every connected account", () => {
    mockAccounts.current = [
      { email: "agent@example.com" },
      { email: "agent@work.example.com" },
    ];
    mockCompose.drafts = [newDraft];
    const { getByTestId } = render(<DraftCard draftId="new-draft" />);

    // The composer shows its From picker when there is more than one.
    expect(getByTestId("composer").getAttribute("data-accounts")).toBe(
      "agent@example.com,agent@work.example.com",
    );
  });

  it("finds the thread from the message a draft answers", () => {
    mockCompose.drafts = [{ ...replyDraft, replyToThreadId: undefined }];
    mockUseEmail.mockReturnValue({
      data: { threadId: "thread-1" },
      isError: false,
    });
    render(<DraftCard draftId="reply-draft" />);

    expect(mockUseEmail).toHaveBeenLastCalledWith(
      "message-6",
      "agent@example.com",
    );
    expect(mockUseThreadMessages).toHaveBeenLastCalledWith(
      "thread-1",
      "agent@example.com",
    );
    expect(composeProps.current?.activeDraft?.replyToThreadId).toBe("thread-1");
    expect(composeProps.current?.sendDisabled).toBe(false);
  });

  it("holds Send until it knows the reply's thread", () => {
    mockCompose.drafts = [{ ...replyDraft, replyToThreadId: undefined }];
    const { rerender } = render(<DraftCard draftId="reply-draft" />);

    // A reply scheduled now would go out without its thread.
    expect(composeProps.current?.sendDisabled).toBe(true);
    expect(mockUseThreadMessages).toHaveBeenLastCalledWith(
      undefined,
      "agent@example.com",
    );

    mockUseEmail.mockReturnValue({
      data: { threadId: "thread-1" },
      isError: false,
    });
    rerender(<DraftCard draftId="reply-draft" />);

    expect(composeProps.current?.sendDisabled).toBe(false);
    expect(composeProps.current?.activeDraft?.replyToThreadId).toBe("thread-1");
  });

  it("stops asking for a thread it can't read", async () => {
    mockCompose.drafts = [replyDraft];
    mockEnsureThread.mockRejectedValue(new Error("Not found"));
    const { findByText } = render(<DraftCard draftId="reply-draft" />);

    expect(await findByText("mail.draftCard.threadUnavailable")).toBeTruthy();
    expect(mockUseThreadMessages).toHaveBeenLastCalledWith(
      undefined,
      "agent@example.com",
    );
    expect(mockEnsureThread).toHaveBeenCalledTimes(1);
  });

  it("shows the send in the card and tells the model once it's sent", async () => {
    mockCompose.drafts = [replyDraft];
    mockThread.data = [message("message-6")] as EmailMessage[];
    const undo = vi.fn();
    const { getByRole, getByText, queryByText, rerender } = render(
      <DraftCard draftId="reply-draft" />,
    );

    progress({ status: "queued", undo });
    // The composer stages the draft, which takes it out of compose state.
    mockCompose.drafts = [];
    rerender(<DraftCard draftId="reply-draft" />);
    expect(getByText("mail.compose.sending")).toBeTruthy();
    expect(getByText("Re: Launch plan")).toBeTruthy();

    fireEvent.click(getByRole("button", { name: "mail.actions.undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(queryByText("mail.compose.sending")).toBeNull();

    mockCompose.drafts = [replyDraft];
    rerender(<DraftCard draftId="reply-draft" />);
    progress({ status: "queued", undo });
    progress({ status: "sending" });
    expect(queryByText("mail.actions.undo", { selector: "button" })).toBeNull();

    progress({ status: "sent" });
    // Sending discards the draft too; that isn't the reader deleting it.
    act(() => composeProps.current!.onDiscard("reply-draft"));
    mockCompose.drafts = [];
    rerender(<DraftCard draftId="reply-draft" />);

    expect(getByText("mail.toasts.messageSent")).toBeTruthy();
    expect(queryByText("mail.draftCard.deleted")).toBeNull();
    await waitFor(() =>
      expect(mockUpdateModelContext).toHaveBeenCalledWith(
        expect.objectContaining({
          structuredContent: { draftId: "reply-draft", status: "sent" },
        }),
      ),
    );
    expect(mockUpdateModelContext).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft editable after a failed send", () => {
    mockCompose.drafts = [newDraft];
    const { getByRole, queryByText } = render(
      <DraftCard draftId="new-draft" />,
    );

    progress({ status: "queued", undo: vi.fn() });
    progress({ status: "sending" });
    progress({ status: "failed" });

    expect(getByRole("alert").textContent).toContain(
      "mail.toasts.failedToSendEmail",
    );
    expect(queryByText("mail.compose.sending")).toBeNull();
  });

  it("confirms a scheduled send and tells the model when it goes out", async () => {
    mockCompose.drafts = [newDraft];
    const runAt = Date.UTC(2026, 9, 22, 13, 0);
    const { getByText, queryByText, rerender } = render(
      <DraftCard draftId="new-draft" />,
    );

    progress({ status: "scheduled", runAt });
    act(() => composeProps.current!.onDiscard("new-draft"));
    mockCompose.drafts = [];
    rerender(<DraftCard draftId="new-draft" />);

    expect(getByText("mail.sendLater.scheduledFor")).toBeTruthy();
    expect(queryByText("mail.draftCard.deleted")).toBeNull();
    await waitFor(() =>
      expect(mockUpdateModelContext).toHaveBeenCalledWith(
        expect.objectContaining({
          structuredContent: {
            draftId: "new-draft",
            status: "scheduled",
            runAt: "2026-10-22T13:00:00.000Z",
          },
        }),
      ),
    );
    expect(mockUpdateModelContext).toHaveBeenCalledTimes(1);
  });

  it("logs a report the chat couldn't take", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockUpdateModelContext.mockImplementation(() =>
      Promise.reject(new Error("host gone")),
    );
    mockCompose.drafts = [newDraft];
    const { getByText, rerender } = render(<DraftCard draftId="new-draft" />);

    progress({ status: "sent" });
    act(() => composeProps.current!.onDiscard("new-draft"));
    mockCompose.drafts = [];
    rerender(<DraftCard draftId="new-draft" />);

    expect(getByText("mail.toasts.messageSent")).toBeTruthy();
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "Couldn't tell the chat about draft new-draft:",
        expect.any(Error),
      ),
    );
    warn.mockRestore();
  });

  it("holds Send after a failed lookup until a retry finds the thread", () => {
    mockCompose.drafts = [{ ...replyDraft, replyToThreadId: undefined }];
    const refetch = vi.fn();
    mockUseEmail.mockReturnValue({ data: undefined, isError: true, refetch });
    const { getByRole, queryByRole, rerender } = render(
      <DraftCard draftId="reply-draft" />,
    );

    // The message ID is only a guess at the thread, good for showing it.
    expect(mockUseThreadMessages).toHaveBeenLastCalledWith(
      "message-6",
      "agent@example.com",
    );
    expect(composeProps.current?.activeDraft?.replyToThreadId).toBeUndefined();
    expect(composeProps.current?.sendDisabled).toBe(true);
    expect(getByRole("alert").textContent).toContain(
      "mail.draftCard.threadLookupFailed",
    );

    fireEvent.click(getByRole("button", { name: "mail.error.tryAgain" }));
    expect(refetch).toHaveBeenCalledTimes(1);

    mockUseEmail.mockReturnValue({
      data: { threadId: "thread-1" },
      isError: false,
      refetch,
    });
    rerender(<DraftCard draftId="reply-draft" />);
    expect(composeProps.current?.activeDraft?.replyToThreadId).toBe("thread-1");
    expect(composeProps.current?.sendDisabled).toBe(false);
    expect(queryByRole("alert")).toBeNull();

    // The answer sticks, so a reply that may be scheduled keeps its thread.
    mockUseEmail.mockReturnValue({ data: undefined, isError: true, refetch });
    rerender(<DraftCard draftId="reply-draft" />);
    expect(composeProps.current?.activeDraft?.replyToThreadId).toBe("thread-1");
    expect(composeProps.current?.sendDisabled).toBe(false);
  });

  it("says so when a delete doesn't stick, without telling the model", async () => {
    let finishDelete!: (ok: boolean) => void;
    mockCompose.discard.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishDelete = resolve;
      }),
    );
    mockCompose.drafts = [newDraft];
    const { getByRole, getByText, findByText, rerender } = render(
      <DraftCard draftId="new-draft" />,
    );

    fireEvent.click(getByRole("button", { name: "discard" }));
    mockCompose.drafts = [];
    rerender(<DraftCard draftId="new-draft" />);
    expect(getByText("mail.draftCard.deleted")).toBeTruthy();
    // The card shows its own failure, not a toast on top of it.
    act(() => {
      window.dispatchEvent(new Event(DRAFT_DELETE_FAILED_EVENT));
    });
    await act(async () => finishDelete(false));

    expect(await findByText("mail.toasts.failedToDeleteDraft")).toBeTruthy();
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockUpdateModelContext).not.toHaveBeenCalled();
  });

  it("warns when an edit to this draft doesn't save", () => {
    mockCompose.drafts = [newDraft];
    render(<DraftCard draftId="new-draft" />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(DRAFT_SAVE_FAILED_EVENT, {
          detail: { draftId: "other-draft" },
        }),
      );
    });
    expect(mockToast.error).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(DRAFT_SAVE_FAILED_EVENT, {
          detail: { draftId: "new-draft" },
        }),
      );
    });
    expect(mockToast.error).toHaveBeenCalledWith(
      "mail.toasts.failedToSaveDraft",
    );
  });

  it("confirms a deleted draft", async () => {
    mockCompose.drafts = [newDraft];
    const { getByRole, getByText, rerender } = render(
      <DraftCard draftId="new-draft" />,
    );

    fireEvent.click(getByRole("button", { name: "discard" }));
    mockCompose.drafts = [];
    rerender(<DraftCard draftId="new-draft" />);

    expect(mockCompose.discard).toHaveBeenCalledWith("new-draft");
    expect(getByText("mail.draftCard.deleted")).toBeTruthy();
    await waitFor(() =>
      expect(mockUpdateModelContext).toHaveBeenCalledWith(
        expect.objectContaining({
          structuredContent: { draftId: "new-draft", status: "deleted" },
        }),
      ),
    );
  });
});
