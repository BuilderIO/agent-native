// @vitest-environment happy-dom

import type { ComposeState } from "@shared/types";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockScheduleEmail = vi.hoisted(() => vi.fn());
const mockSendEmailAsync = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }),
);

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useAgentChatGenerating: () => [false, vi.fn()],
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("sonner", () => ({ toast: mockToast }));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <>{children}</>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <>{children}</>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children }: any) => <>{children}</>,
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/hooks/use-account-filter", () => ({
  useAccountFilter: () => ({ allAccounts: [] }),
}));
vi.mock("@/hooks/use-aliases", () => ({
  useAliases: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-draft-queue", () => ({
  useUpdateQueuedDraft: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-emails", () => ({
  useAddOptimisticReply: () => vi.fn(),
  useSendEmail: () => ({
    isPending: false,
    mutateAsync: mockSendEmailAsync,
  }),
  useSettings: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-scheduled-jobs", () => ({
  useScheduleEmail: () => ({
    isPending: false,
    mutateAsync: mockScheduleEmail,
  }),
}));
vi.mock("@/lib/agent-generate", () => ({ canUseAgentGenerate: vi.fn() }));
vi.mock("@/lib/alias-utils", () => ({
  expandAliasTokens: (value: string) => value,
}));
vi.mock("@/lib/upload", () => ({
  openFilePicker: vi.fn(),
  uploadFile: vi.fn(),
  uploadFiles: vi.fn(),
}));
vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

vi.mock("./AttachmentStrip", () => ({ AttachmentStrip: () => null }));
vi.mock("./ComposeEditor", () => ({
  ComposeEditor: () => <div data-testid="compose-editor" />,
}));
vi.mock("./RecipientInput", () => ({ RecipientInput: () => null }));
vi.mock("./SendLaterButton", () => ({
  SendLaterButton: ({
    onSend,
    onSendLater,
  }: {
    onSend: () => void;
    onSendLater: (runAt: number) => void;
  }) => (
    <>
      <button onClick={onSend}>mail.compose.send</button>
      <button onClick={() => onSendLater(Date.now() + 60_000)}>Schedule</button>
    </>
  ),
}));

import { ComposeModal } from "./ComposeModal";

const draft: ComposeState = {
  id: "draft-1",
  to: "recipient@example.com",
  subject: "Subject",
  body: "Body",
  mode: "compose",
};

describe("ComposeModal scheduling", () => {
  beforeEach(() => {
    mockScheduleEmail.mockReset();
    mockSendEmailAsync.mockReset();
    mockToast.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("opens a new-message draft expanded in the main workspace", () => {
    const { getByRole } = render(
      <ComposeModal
        drafts={[draft]}
        activeId={draft.id}
        activeDraft={draft}
        onSetActiveId={vi.fn()}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        onCloseAll={vi.fn()}
        onDiscard={vi.fn()}
        onStageForSend={vi.fn()}
        onRestoreAfterSend={vi.fn()}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );

    expect(
      getByRole("button", {
        name: "mail.compose.restoreComposeSize",
      }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps reply drafts in their current compact compose mode", () => {
    const replyDraft: ComposeState = { ...draft, mode: "reply" };
    const { getByRole } = render(
      <ComposeModal
        drafts={[replyDraft]}
        activeId={replyDraft.id}
        activeDraft={replyDraft}
        onSetActiveId={vi.fn()}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        onCloseAll={vi.fn()}
        onDiscard={vi.fn()}
        onStageForSend={vi.fn()}
        onRestoreAfterSend={vi.fn()}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );

    expect(
      getByRole("button", {
        name: "mail.compose.fullScreenCompose",
      }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("schedules only once when the send-later handler is invoked twice", async () => {
    let resolveSchedule!: (value: unknown) => void;
    mockScheduleEmail.mockReturnValue(
      new Promise((resolve) => {
        resolveSchedule = resolve;
      }),
    );

    const onDiscard = vi.fn();
    const { getByRole } = render(
      <ComposeModal
        drafts={[draft]}
        activeId={draft.id}
        activeDraft={draft}
        onSetActiveId={vi.fn()}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        onCloseAll={vi.fn()}
        onDiscard={onDiscard}
        onStageForSend={vi.fn()}
        onRestoreAfterSend={vi.fn()}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );

    const scheduleButton = getByRole("button", { name: "Schedule" });
    fireEvent.click(scheduleButton);
    fireEvent.click(scheduleButton);

    expect(mockScheduleEmail).toHaveBeenCalledOnce();

    resolveSchedule({});
    await vi.waitFor(() => expect(onDiscard).toHaveBeenCalledOnce());
  });

  it("keeps undo available until dispatch and reports success only after the provider resolves", async () => {
    vi.useFakeTimers();
    let resolveSend!: (result: { id: string }) => void;
    mockSendEmailAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );
    const onDiscard = vi.fn();
    const onStageForSend = vi.fn();
    const onRestoreAfterSend = vi.fn();
    const { getByRole } = render(
      <ComposeModal
        drafts={[draft]}
        activeId={draft.id}
        activeDraft={draft}
        onSetActiveId={vi.fn()}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        onCloseAll={vi.fn()}
        onDiscard={onDiscard}
        onStageForSend={onStageForSend}
        onRestoreAfterSend={onRestoreAfterSend}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );

    fireEvent.click(getByRole("button", { name: "mail.compose.send" }));
    const undoToast = mockToast.mock.calls.find(
      ([message, options]) =>
        message === "mail.compose.sending" && options?.action,
    );
    if (!undoToast) throw new Error("Undo toast was not shown");
    const undo = (undoToast[1] as { action: { onClick: () => void } }).action
      .onClick;

    expect(onStageForSend).toHaveBeenCalledWith(draft.id);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(mockSendEmailAsync).not.toHaveBeenCalled();
    expect(
      mockToast.mock.calls.some(
        ([message]) => message === "mail.toasts.messageSent",
      ),
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(mockSendEmailAsync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(mockSendEmailAsync).toHaveBeenCalledOnce();
    undo();
    expect(onRestoreAfterSend).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(
      mockToast.mock.calls.some(
        ([message]) => message === "mail.toasts.messageSent",
      ),
    ).toBe(false);

    await act(async () => {
      resolveSend({ id: "sent-1" });
      await Promise.resolve();
    });

    expect(onDiscard).toHaveBeenCalledWith(draft.id);
    expect(mockToast).toHaveBeenCalledWith(
      "mail.toasts.messageSent",
      expect.objectContaining({ duration: 3_000 }),
    );
  });

  it("reports provider failure and reopens the draft after the popout unmounts", async () => {
    vi.useFakeTimers();
    let rejectSend!: (error: Error) => void;
    mockSendEmailAsync.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSend = reject;
      }),
    );
    const onStageForSend = vi.fn();
    const onRestoreAfterSend = vi.fn();
    const onDiscard = vi.fn();
    const { getByRole, unmount } = render(
      <ComposeModal
        drafts={[draft]}
        activeId={draft.id}
        activeDraft={draft}
        onSetActiveId={vi.fn()}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        onCloseAll={vi.fn()}
        onDiscard={onDiscard}
        onStageForSend={onStageForSend}
        onRestoreAfterSend={onRestoreAfterSend}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );

    fireEvent.click(getByRole("button", { name: "mail.compose.send" }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockSendEmailAsync).toHaveBeenCalledOnce();

    unmount();
    await act(async () => {
      rejectSend(new Error("Provider rejected send"));
      await Promise.resolve();
    });

    expect(mockToast.dismiss).toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      "mail.toasts.failedToSendEmail",
    );
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onRestoreAfterSend).toHaveBeenCalledWith(draft.id);
  });

  it("cancels a deferred send and restores its draft when Undo is selected", async () => {
    vi.useFakeTimers();
    const onDiscard = vi.fn();
    const onStageForSend = vi.fn();
    const onRestoreAfterSend = vi.fn();
    const { getByRole } = render(
      <ComposeModal
        drafts={[draft]}
        activeId={draft.id}
        activeDraft={draft}
        onSetActiveId={vi.fn()}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        onCloseAll={vi.fn()}
        onDiscard={onDiscard}
        onStageForSend={onStageForSend}
        onRestoreAfterSend={onRestoreAfterSend}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );

    fireEvent.click(getByRole("button", { name: "mail.compose.send" }));
    const undoCall = mockToast.mock.calls.find(
      ([message]) => message === "mail.compose.sending",
    );
    if (!undoCall) throw new Error("Undo toast was not shown");
    const undo = (undoCall[1] as { action: { onClick: () => void } }).action
      .onClick;
    undo();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockSendEmailAsync).not.toHaveBeenCalled();
    expect(onStageForSend).toHaveBeenCalledWith(draft.id);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onRestoreAfterSend).toHaveBeenCalledWith(draft.id);
  });
});
