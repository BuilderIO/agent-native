// @vitest-environment happy-dom

import type { ComposeState } from "@shared/types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockScheduleEmail = vi.hoisted(() => vi.fn());
const mockSendEmailAsync = vi.hoisted(() => vi.fn());
const mockArchiveEmail = vi.hoisted(() => vi.fn());
const mockSettings = vi.hoisted(() => ({ sendAndArchive: false }));
const mockAccounts = vi.hoisted(
  () => [] as Array<{ email: string; displayName?: string }>,
);
const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }),
);

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useAgentChatGenerating: () => [false, vi.fn()],
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({
    formatDate: (date: Date) => date.toISOString(),
  }),
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
  useAccountFilter: () => ({ allAccounts: mockAccounts }),
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
  useArchiveEmail: () => ({ mutate: mockArchiveEmail }),
  useSettings: () => ({ data: mockSettings }),
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
  ComposeEditor: ({ onSend }: { onSend: (markDone?: boolean) => void }) => (
    <div data-testid="compose-editor">
      <button type="button" onClick={() => onSend(true)}>
        Send + Mark Done
      </button>
    </div>
  ),
}));
vi.mock("./RecipientInput", () => ({
  RecipientInput: ({
    field,
    value = "",
    onChange,
  }: {
    field: string;
    value?: string;
    onChange?: (value: string) => void;
  }) => (
    <>
      <input
        data-recipient-field={field}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <input
        data-mail-recipient-input
        data-recipient-field={field}
        data-pending-recipient-field={field}
        defaultValue=""
      />
    </>
  ),
}));
vi.mock("./SendLaterButton", () => ({
  SendLaterButton: ({
    onSend,
    onSendLater,
    open,
    onOpenChange,
    disabled,
  }: {
    onSend: () => void;
    onSendLater: (runAt: number) => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    disabled?: boolean;
  }) => (
    <>
      <button disabled={disabled} onClick={onSend}>
        mail.compose.send
      </button>
      <button
        disabled={disabled}
        aria-label="Schedule send"
        onClick={() => onOpenChange?.(!open)}
      >
        Schedule
      </button>
      {open && (
        <button
          disabled={disabled}
          onClick={() => onSendLater(Date.now() + 60_000)}
        >
          Schedule later
        </button>
      )}
      <output data-testid="schedule-open">{String(open ?? false)}</output>
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
const replyDraft: ComposeState = {
  ...draft,
  id: "reply-draft-1",
  mode: "reply",
  replyToId: "source-message",
  replyToThreadId: "source-thread",
  accountEmail: "steve@builder.io",
};

describe("ComposeModal scheduling", () => {
  beforeEach(() => {
    mockScheduleEmail.mockReset();
    mockSendEmailAsync.mockReset();
    mockArchiveEmail.mockReset();
    mockSettings.sendAndArchive = false;
    mockToast.mockClear();
    mockToast.error.mockClear();
    mockAccounts.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("opens a new-message draft in the roomy workspace card", () => {
    const { container, getByRole } = render(
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

    const compose = container.querySelector<HTMLElement>("[data-mail-compose]");
    expect(compose?.className).toContain("bottom-0");
    expect(compose?.className).not.toContain("sm:top-14");
    expect(compose?.className).not.toContain("sm:bottom-auto");
    expect(compose?.className).toContain(
      "sm:h-[min(540px,_calc(100dvh_-_2rem))]",
    );
    expect(compose?.className).toContain(
      "md:w-[min(490px,_calc(100vw_-_var(--compose-right)_-_1rem))]",
    );
    expect(compose?.className).toContain("sm:rounded-xl");
    expect(
      getByRole("button", {
        name: "mail.compose.fullScreenCompose",
      }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("focuses the initial unsaved draft when the modal mounts", async () => {
    const { container } = render(
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

    await waitFor(() => {
      expect(document.activeElement).toBe(
        container.querySelector(
          '[data-mail-recipient-input][data-recipient-field="to"]',
        ),
      );
    });
  });

  it("focuses the To field after a new draft is added", async () => {
    const secondDraft: ComposeState = {
      ...draft,
      id: "draft-2",
      to: "",
      subject: "",
      body: "",
    };
    const props = {
      drafts: [draft],
      activeId: draft.id,
      activeDraft: draft,
      onSetActiveId: vi.fn(),
      onUpdate: vi.fn(),
      onClose: vi.fn(),
      onCloseAll: vi.fn(),
      onDiscard: vi.fn(),
      onStageForSend: vi.fn(),
      onRestoreAfterSend: vi.fn(),
      onNewDraft: vi.fn(),
      onFlush: vi.fn(),
    };
    const { container, getByTestId, rerender } = render(
      <>
        <button data-testid="compose-opener" type="button">
          Compose
        </button>
        <ComposeModal {...props} />
      </>,
    );
    getByTestId("compose-opener").focus();

    rerender(
      <>
        <button data-testid="compose-opener" type="button">
          Compose
        </button>
        <ComposeModal
          {...props}
          drafts={[draft, secondDraft]}
          activeId={secondDraft.id}
          activeDraft={secondDraft}
        />
      </>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(
        container.querySelector(
          '[data-mail-recipient-input][data-recipient-field="to"]',
        ),
      );
    });
  });

  it.each([
    ["saved", { savedDraftId: "gmail-draft-2" }],
    ["queued", { queuedDraftId: "queued-draft-2" }],
  ])(
    "does not focus a %s draft that arrives after mount",
    async (_, metadata) => {
      const existingDraft: ComposeState = {
        ...draft,
        id: "existing-draft",
      };
      const reopenedDraft: ComposeState = {
        ...draft,
        id: "reopened-draft",
        to: "",
        subject: "",
        body: "",
        ...metadata,
      };
      const props = {
        drafts: [existingDraft],
        activeId: existingDraft.id,
        activeDraft: existingDraft,
        onSetActiveId: vi.fn(),
        onUpdate: vi.fn(),
        onClose: vi.fn(),
        onCloseAll: vi.fn(),
        onDiscard: vi.fn(),
        onStageForSend: vi.fn(),
        onRestoreAfterSend: vi.fn(),
        onNewDraft: vi.fn(),
        onFlush: vi.fn(),
      };
      const { getByTestId, rerender } = render(
        <>
          <button data-testid="compose-opener" type="button">
            Compose
          </button>
          <ComposeModal {...props} />
        </>,
      );
      getByTestId("compose-opener").focus();

      rerender(
        <>
          <button data-testid="compose-opener" type="button">
            Compose
          </button>
          <ComposeModal
            {...props}
            drafts={[existingDraft, reopenedDraft]}
            activeId={reopenedDraft.id}
            activeDraft={reopenedDraft}
          />
        </>,
      );

      await waitFor(() => {
        expect(document.activeElement).toBe(getByTestId("compose-opener"));
      });
    },
  );

  it("honors an explicit fullscreen compose request", () => {
    const { getByRole } = render(
      <ComposeModal
        drafts={[draft]}
        activeId={draft.id}
        activeDraft={draft}
        initialExpanded
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

  it("reopens a saved new-message draft in compact mode", () => {
    const savedDraft: ComposeState = {
      ...draft,
      savedDraftId: "gmail-draft-1",
    };
    const { getByRole } = render(
      <ComposeModal
        drafts={[savedDraft]}
        activeId={savedDraft.id}
        activeDraft={savedDraft}
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

  it("validates an empty recipient through enabled send and schedule controls", () => {
    const emptyRecipientDraft = { ...draft, to: "" };
    const onStageForSend = vi.fn();
    const { getByRole } = render(
      <ComposeModal
        drafts={[emptyRecipientDraft]}
        activeId={emptyRecipientDraft.id}
        activeDraft={emptyRecipientDraft}
        onSetActiveId={vi.fn()}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        onCloseAll={vi.fn()}
        onDiscard={vi.fn()}
        onStageForSend={onStageForSend}
        onRestoreAfterSend={vi.fn()}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );

    const sendButton = getByRole("button", { name: "mail.compose.send" });
    const scheduleButton = getByRole("button", { name: "Schedule send" });
    expect(sendButton.hasAttribute("disabled")).toBe(false);
    expect(scheduleButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(sendButton);
    fireEvent.click(scheduleButton);
    fireEvent.click(getByRole("button", { name: "Schedule later" }));

    expect(mockToast.error).toHaveBeenNthCalledWith(
      1,
      "mail.toasts.pleaseAddRecipient",
    );
    expect(mockToast.error).toHaveBeenNthCalledWith(
      2,
      "mail.toasts.pleaseAddRecipient",
    );
    expect(onStageForSend).not.toHaveBeenCalled();
    expect(mockSendEmailAsync).not.toHaveBeenCalled();
    expect(mockScheduleEmail).not.toHaveBeenCalled();
  });

  it("registers compose commands only while the composer is expanded", async () => {
    const onRegisterComposeCommands = vi.fn();
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
        onDiscard={vi.fn()}
        onStageForSend={onStageForSend}
        onRestoreAfterSend={onRestoreAfterSend}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
        onRegisterComposeCommands={onRegisterComposeCommands}
      />,
    );

    await waitFor(() =>
      expect(onRegisterComposeCommands).toHaveBeenLastCalledWith(
        expect.objectContaining({
          send: expect.any(Function),
          sendLater: expect.any(Function),
          sendAndMarkDone: expect.any(Function),
        }),
      ),
    );
    const commands = onRegisterComposeCommands.mock.lastCall?.[0];
    act(() => commands?.send());

    expect(onStageForSend).toHaveBeenCalledWith(draft.id);
    expect(mockSendEmailAsync).not.toHaveBeenCalled();
    const undoToast = mockToast.mock.calls.find(
      ([message]) => message === "mail.compose.sending",
    );
    act(() => undoToast?.[1]?.action?.onClick());
    expect(onRestoreAfterSend).toHaveBeenCalledWith(draft.id);

    fireEvent.click(
      getByRole("button", { name: "mail.compose.minimizeCompose" }),
    );
    await waitFor(() =>
      expect(onRegisterComposeCommands).toHaveBeenLastCalledWith(null),
    );
    expect(mockSendEmailAsync).not.toHaveBeenCalled();
  });

  it("opens the existing schedule picker from the compose command", async () => {
    const onRegisterComposeCommands = vi.fn();
    const { getByTestId } = render(
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
        onRegisterComposeCommands={onRegisterComposeCommands}
      />,
    );

    await waitFor(() =>
      expect(onRegisterComposeCommands.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({ sendLater: expect.any(Function) }),
      ),
    );
    const commands = onRegisterComposeCommands.mock.lastCall?.[0];
    act(() => commands?.sendLater());

    expect(getByTestId("schedule-open").textContent).toBe("true");
    expect(mockScheduleEmail).not.toHaveBeenCalled();
  });

  it("passes the complete draft through the canonical scheduled-send action", async () => {
    mockScheduleEmail.mockResolvedValue({});
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

    fireEvent.click(getByRole("button", { name: "Schedule send" }));
    fireEvent.click(getByRole("button", { name: "Schedule later" }));

    await waitFor(() => expect(mockScheduleEmail).toHaveBeenCalledOnce());
    const [request] = mockScheduleEmail.mock.calls[0];
    expect(request).toEqual(
      expect.objectContaining({
        runAt: expect.any(Number),
        payload: expect.objectContaining({
          to: draft.to,
          subject: draft.subject,
          body: draft.body,
        }),
      }),
    );
    expect(request).not.toHaveProperty("to");
    expect(request).not.toHaveProperty("subject");
    expect(request).not.toHaveProperty("body");
  });

  it.each([
    { label: "Command", metaKey: true, ctrlKey: false },
    { label: "Control", metaKey: false, ctrlKey: true },
  ])("opens Send Later with $label+Shift+L", ({ metaKey, ctrlKey }) => {
    const { getByRole, getByTestId } = render(
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

    fireEvent.keyDown(getByRole("button", { name: "mail.compose.send" }), {
      key: "l",
      metaKey,
      ctrlKey,
      shiftKey: true,
    });

    expect(getByTestId("schedule-open").textContent).toBe("true");
    expect(mockScheduleEmail).not.toHaveBeenCalled();
  });

  it.each(["to", "cc", "bcc"] as const)(
    "blocks send and scheduling while %s contains uncommitted text",
    (field) => {
      const onStageForSend = vi.fn();
      const currentDraft =
        field === "to" ? draft : { ...draft, cc: "", bcc: "" };
      const { container, getByRole } = render(
        <ComposeModal
          drafts={[currentDraft]}
          activeId={currentDraft.id}
          activeDraft={currentDraft}
          onSetActiveId={vi.fn()}
          onUpdate={vi.fn()}
          onClose={vi.fn()}
          onCloseAll={vi.fn()}
          onDiscard={vi.fn()}
          onStageForSend={onStageForSend}
          onRestoreAfterSend={vi.fn()}
          onNewDraft={vi.fn()}
          onFlush={vi.fn()}
        />,
      );

      if (field !== "to") {
        fireEvent.click(
          getByRole("button", {
            name: "mail.draftQueue.cc / mail.draftQueue.bcc",
          }),
        );
      }

      const recipientInput = container.querySelector<HTMLInputElement>(
        `[data-pending-recipient-field="${field}"]`,
      );
      if (!recipientInput) throw new Error(`Missing ${field} recipient input`);
      fireEvent.change(recipientInput, {
        target: { value: "unfinished recipient" },
      });
      fireEvent.blur(recipientInput);

      fireEvent.click(getByRole("button", { name: "mail.compose.send" }));
      expect(mockToast.error).toHaveBeenNthCalledWith(
        1,
        "mail.toasts.finishRecipientInput",
      );
      expect(onStageForSend).not.toHaveBeenCalled();
      expect(mockSendEmailAsync).not.toHaveBeenCalled();

      fireEvent.click(getByRole("button", { name: "Schedule send" }));
      fireEvent.click(getByRole("button", { name: "Schedule later" }));
      expect(mockToast.error).toHaveBeenNthCalledWith(
        2,
        "mail.toasts.finishRecipientInput",
      );
      expect(mockScheduleEmail).not.toHaveBeenCalled();
    },
  );

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

  it("reveals a newly opened draft without revealing existing drafts", async () => {
    const secondDraft: ComposeState = {
      ...draft,
      id: "draft-2",
      to: "second@example.com",
    };
    const props = {
      drafts: [draft],
      activeId: draft.id,
      activeDraft: draft,
      onSetActiveId: vi.fn(),
      onUpdate: vi.fn(),
      onClose: vi.fn(),
      onCloseAll: vi.fn(),
      onDiscard: vi.fn(),
      onStageForSend: vi.fn(),
      onRestoreAfterSend: vi.fn(),
      onNewDraft: vi.fn(),
      onFlush: vi.fn(),
    };
    const { container, getByRole, rerender } = render(
      <ComposeModal {...props} />,
    );

    fireEvent.click(
      getByRole("button", { name: "mail.compose.minimizeCompose" }),
    );
    expect(
      getByRole("button", { name: "mail.compose.restoreCompose" }),
    ).toBeTruthy();

    rerender(
      <ComposeModal
        {...props}
        drafts={[draft, secondDraft]}
        activeId={draft.id}
        activeDraft={draft}
      />,
    );
    expect(
      getByRole("button", { name: "mail.compose.restoreCompose" }),
    ).toBeTruthy();

    rerender(
      <ComposeModal
        {...props}
        drafts={[draft, secondDraft]}
        activeId={secondDraft.id}
        activeDraft={secondDraft}
      />,
    );

    await waitFor(() => {
      expect(
        getByRole("button", {
          name: "mail.compose.fullScreenCompose",
        }).getAttribute("aria-pressed"),
      ).toBe("false");
      expect(
        container.querySelector<HTMLInputElement>('[data-recipient-field="to"]')
          ?.value,
      ).toBe(secondDraft.to);
    });

    fireEvent.click(
      getByRole("button", { name: "mail.compose.minimizeCompose" }),
    );
    rerender(
      <ComposeModal
        {...props}
        drafts={[draft, secondDraft]}
        activeId={draft.id}
        activeDraft={draft}
      />,
    );

    expect(
      getByRole("button", { name: "mail.compose.restoreCompose" }),
    ).toBeTruthy();
    expect(container.querySelector('[data-recipient-field="to"]')).toBeNull();
  });

  it("preserves explicit fullscreen mode when switching draft tabs", async () => {
    const savedDraft: ComposeState = {
      ...draft,
      id: "saved-draft",
      savedDraftId: "gmail-draft-1",
    };
    const newDraft: ComposeState = {
      ...draft,
      id: "new-draft",
    };
    const props = {
      drafts: [newDraft, savedDraft],
      activeId: newDraft.id,
      activeDraft: newDraft,
      onSetActiveId: vi.fn(),
      onUpdate: vi.fn(),
      onClose: vi.fn(),
      onCloseAll: vi.fn(),
      onDiscard: vi.fn(),
      onStageForSend: vi.fn(),
      onRestoreAfterSend: vi.fn(),
      onNewDraft: vi.fn(),
      onFlush: vi.fn(),
    };
    const { getByRole, rerender } = render(<ComposeModal {...props} />);

    fireEvent.click(
      getByRole("button", { name: "mail.compose.fullScreenCompose" }),
    );
    expect(
      getByRole("button", {
        name: "mail.compose.restoreComposeSize",
      }).getAttribute("aria-pressed"),
    ).toBe("true");

    rerender(
      <ComposeModal
        {...props}
        activeId={savedDraft.id}
        activeDraft={savedDraft}
      />,
    );

    await waitFor(() =>
      expect(
        getByRole("button", {
          name: "mail.compose.restoreComposeSize",
        }).getAttribute("aria-pressed"),
      ).toBe("true"),
    );
  });

  it("preserves explicit fullscreen mode when opening a new draft", async () => {
    const secondDraft: ComposeState = {
      ...draft,
      id: "second-draft",
      to: "second@example.com",
    };
    const props = {
      drafts: [draft],
      activeId: draft.id,
      activeDraft: draft,
      onSetActiveId: vi.fn(),
      onUpdate: vi.fn(),
      onClose: vi.fn(),
      onCloseAll: vi.fn(),
      onDiscard: vi.fn(),
      onStageForSend: vi.fn(),
      onRestoreAfterSend: vi.fn(),
      onNewDraft: vi.fn(),
      onFlush: vi.fn(),
    };
    const { getByRole, rerender } = render(<ComposeModal {...props} />);

    fireEvent.click(
      getByRole("button", { name: "mail.compose.fullScreenCompose" }),
    );
    expect(
      getByRole("button", {
        name: "mail.compose.restoreComposeSize",
      }).getAttribute("aria-pressed"),
    ).toBe("true");

    rerender(
      <ComposeModal
        {...props}
        drafts={[draft, secondDraft]}
        activeId={secondDraft.id}
        activeDraft={secondDraft}
      />,
    );

    await waitFor(() =>
      expect(
        getByRole("button", {
          name: "mail.compose.restoreComposeSize",
        }).getAttribute("aria-pressed"),
      ).toBe("true"),
    );
  });

  it("reveals and focuses Bcc with the compose keyboard shortcut", async () => {
    const onUpdate = vi.fn();
    const { container } = render(
      <ComposeModal
        drafts={[draft]}
        activeId={draft.id}
        activeDraft={draft}
        onSetActiveId={vi.fn()}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        onCloseAll={vi.fn()}
        onDiscard={vi.fn()}
        onStageForSend={vi.fn()}
        onRestoreAfterSend={vi.fn()}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );
    const toInput = container.querySelector<HTMLInputElement>(
      '[data-recipient-field="to"]',
    );
    expect(toInput).not.toBeNull();

    fireEvent.keyDown(toInput!, {
      key: "b",
      metaKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      const bccInput = container.querySelector<HTMLInputElement>(
        '[data-recipient-field="bcc"]',
      );
      expect(bccInput).not.toBeNull();
      expect(document.activeElement).toBe(bccInput);
    });
    expect(onUpdate).toHaveBeenCalledWith(draft.id, { cc: "", bcc: "" });
    expect(toInput?.value).toBe(draft.to);

    toInput?.focus();
    fireEvent.keyDown(toInput!, {
      key: "B",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(document.activeElement).toBe(
      container.querySelector('[data-recipient-field="bcc"]'),
    );
  });

  it("preserves existing copy recipients and focuses Bcc on the Windows shortcut", async () => {
    const populatedDraft: ComposeState = {
      ...draft,
      cc: "copy@example.com",
      bcc: "blind@example.com",
    };
    const onUpdate = vi.fn();
    const { container } = render(
      <ComposeModal
        drafts={[populatedDraft]}
        activeId={populatedDraft.id}
        activeDraft={populatedDraft}
        onSetActiveId={vi.fn()}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        onCloseAll={vi.fn()}
        onDiscard={vi.fn()}
        onStageForSend={vi.fn()}
        onRestoreAfterSend={vi.fn()}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );
    const toInput = container.querySelector<HTMLInputElement>(
      '[data-recipient-field="to"]',
    );

    fireEvent.keyDown(toInput!, {
      key: "b",
      ctrlKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(
        container.querySelector('[data-recipient-field="bcc"]'),
      );
    });
    expect(
      container.querySelector<HTMLInputElement>('[data-recipient-field="cc"]')
        ?.value,
    ).toBe(populatedDraft.cc);
    expect(
      container.querySelector<HTMLInputElement>('[data-recipient-field="bcc"]')
        ?.value,
    ).toBe(populatedDraft.bcc);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("assigns the sole connected account to a new compose draft", async () => {
    mockAccounts.push({ email: "owner@example.com" });
    const onUpdate = vi.fn();

    render(
      <ComposeModal
        drafts={[draft]}
        activeId={draft.id}
        activeDraft={draft}
        onSetActiveId={vi.fn()}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        onCloseAll={vi.fn()}
        onDiscard={vi.fn()}
        onStageForSend={vi.fn()}
        onRestoreAfterSend={vi.fn()}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(draft.id, {
        accountEmail: "owner@example.com",
      }),
    );
  });

  it("does not replace an existing saved draft's account", () => {
    mockAccounts.push({ email: "owner@example.com" });
    const savedDraft: ComposeState = {
      ...draft,
      savedDraftId: "saved-draft-1",
      savedDraftBackend: "gmail",
      savedDraftAccountEmail: "saved@example.com",
    };
    const onUpdate = vi.fn();

    render(
      <ComposeModal
        drafts={[savedDraft]}
        activeId={savedDraft.id}
        activeDraft={savedDraft}
        onSetActiveId={vi.fn()}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        onCloseAll={vi.fn()}
        onDiscard={vi.fn()}
        onStageForSend={vi.fn()}
        onRestoreAfterSend={vi.fn()}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );

    expect(onUpdate).not.toHaveBeenCalled();
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

    fireEvent.click(getByRole("button", { name: "Schedule send" }));
    const scheduleLaterButton = getByRole("button", {
      name: "Schedule later",
    });
    fireEvent.click(scheduleLaterButton);
    fireEvent.click(scheduleLaterButton);

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

  it("marks a reply thread Done only after the explicit send succeeds", async () => {
    vi.useFakeTimers();
    let resolveSend!: (result: { id: string }) => void;
    mockSendEmailAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );
    const onRegisterComposeCommands = vi.fn();
    render(
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
        onRegisterComposeCommands={onRegisterComposeCommands}
      />,
    );

    expect(onRegisterComposeCommands.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ sendAndMarkDone: expect.any(Function) }),
    );
    const commands = onRegisterComposeCommands.mock.lastCall?.[0];
    act(() => commands?.sendAndMarkDone());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockSendEmailAsync).toHaveBeenCalledOnce();
    expect(mockArchiveEmail).not.toHaveBeenCalled();

    await act(async () => {
      resolveSend({ id: "sent-reply" });
      await Promise.resolve();
    });

    expect(mockArchiveEmail).toHaveBeenCalledWith({
      id: replyDraft.replyToId,
      accountEmail: replyDraft.accountEmail,
      threadId: replyDraft.replyToThreadId,
    });
    expect(mockToast.error).not.toHaveBeenCalledWith(
      "mail.toasts.failedToSendEmail",
    );
  });

  it("applies the saved preference to ordinary reply sends", async () => {
    vi.useFakeTimers();
    mockSettings.sendAndArchive = true;
    mockSendEmailAsync.mockResolvedValue({ id: "sent-reply" });
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

    fireEvent.click(getByRole("button", { name: "mail.compose.send" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(mockSendEmailAsync).toHaveBeenCalledOnce();
    expect(mockArchiveEmail).toHaveBeenCalledWith({
      id: replyDraft.replyToId,
      accountEmail: replyDraft.accountEmail,
      threadId: replyDraft.replyToThreadId,
    });
  });

  it("does not archive new messages when Send + Mark Done is selected", async () => {
    vi.useFakeTimers();
    mockSettings.sendAndArchive = true;
    mockSendEmailAsync.mockResolvedValue({ id: "sent-new" });
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

    fireEvent.click(getByRole("button", { name: "Send + Mark Done" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(mockSendEmailAsync).toHaveBeenCalledOnce();
    expect(mockArchiveEmail).not.toHaveBeenCalled();
  });

  it("reports provider failure and reopens the draft after the popout unmounts", async () => {
    vi.useFakeTimers();
    mockSettings.sendAndArchive = true;
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
        drafts={[replyDraft]}
        activeId={replyDraft.id}
        activeDraft={replyDraft}
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

    fireEvent.click(getByRole("button", { name: "Send + Mark Done" }));
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
    expect(mockArchiveEmail).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onRestoreAfterSend).toHaveBeenCalledWith(replyDraft.id);
  });

  it("restores a failed staged draft for editing and dispatches one retry", async () => {
    vi.useFakeTimers();
    mockSendEmailAsync
      .mockRejectedValueOnce(new Error("Provider rejected send"))
      .mockResolvedValueOnce({ id: "sent-2" });
    const recoveryDraft: ComposeState = {
      ...draft,
      id: "recoverable-draft",
    };
    const discardedDraftIds: string[] = [];

    function RecoveryHarness() {
      const [drafts, setDrafts] = useState([recoveryDraft]);
      const [stagedIds, setStagedIds] = useState<Set<string>>(() => new Set());
      const [activeId, setActiveId] = useState<string | null>(recoveryDraft.id);
      const visibleDrafts = drafts.filter((item) => !stagedIds.has(item.id));
      const visibleActiveId = visibleDrafts.some((item) => item.id === activeId)
        ? activeId
        : (visibleDrafts[visibleDrafts.length - 1]?.id ?? null);
      const activeDraft =
        visibleDrafts.find((item) => item.id === visibleActiveId) ?? null;

      return (
        <>
          <output data-testid="compose-draft-ids">
            {drafts.map((item) => item.id).join(",")}
          </output>
          <output data-testid="visible-compose-draft-ids">
            {visibleDrafts.map((item) => item.id).join(",")}
          </output>
          {visibleDrafts.length > 0 && (
            <ComposeModal
              drafts={visibleDrafts}
              activeId={visibleActiveId}
              activeDraft={activeDraft}
              onSetActiveId={setActiveId}
              onUpdate={(id, updates) =>
                setDrafts((current) =>
                  current.map((item) =>
                    item.id === id ? { ...item, ...updates } : item,
                  ),
                )
              }
              onClose={vi.fn()}
              onCloseAll={vi.fn()}
              onDiscard={(id) => {
                discardedDraftIds.push(id);
                setDrafts((current) =>
                  current.filter((item) => item.id !== id),
                );
              }}
              onStageForSend={(id) => {
                setStagedIds((current) => new Set(current).add(id));
                setActiveId((current) => (current === id ? null : current));
              }}
              onRestoreAfterSend={(id) => {
                setStagedIds((current) => {
                  const next = new Set(current);
                  next.delete(id);
                  return next;
                });
                setActiveId(id);
              }}
              onNewDraft={vi.fn()}
              onFlush={vi.fn()}
            />
          )}
        </>
      );
    }

    const view = render(<RecoveryHarness />);
    fireEvent.click(view.getByRole("button", { name: "mail.compose.send" }));

    expect(view.getByTestId("compose-draft-ids").textContent).toBe(
      recoveryDraft.id,
    );
    expect(view.getByTestId("visible-compose-draft-ids").textContent).toBe("");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
    });

    expect(mockSendEmailAsync).toHaveBeenCalledOnce();
    expect(mockToast.error).toHaveBeenCalledWith(
      "mail.toasts.failedToSendEmail",
    );
    expect(
      mockToast.mock.calls.some(
        ([message]) => message === "mail.toasts.messageSent",
      ),
    ).toBe(false);
    expect(discardedDraftIds).toEqual([]);
    expect(view.getByTestId("visible-compose-draft-ids").textContent).toBe(
      recoveryDraft.id,
    );
    const recipientInput = view.container.querySelector<HTMLInputElement>(
      '[data-recipient-field="to"]',
    );
    expect(recipientInput?.value).toBe(recoveryDraft.to);

    const subjectInput = view.getByPlaceholderText(
      "mail.compose.subject",
    ) as HTMLInputElement;
    fireEvent.change(subjectInput, {
      target: { value: "Edited before retry" },
    });
    expect(subjectInput.value).toBe("Edited before retry");

    fireEvent.click(view.getByRole("button", { name: "mail.compose.send" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
    });

    expect(mockSendEmailAsync).toHaveBeenCalledTimes(2);
    expect(mockSendEmailAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: recoveryDraft.to,
        subject: "Edited before retry",
        body: recoveryDraft.body,
      }),
    );
    expect(discardedDraftIds).toEqual([recoveryDraft.id]);
    expect(view.getByTestId("compose-draft-ids").textContent).toBe("");
    expect(
      mockToast.mock.calls.filter(
        ([message]) => message === "mail.toasts.messageSent",
      ),
    ).toHaveLength(1);
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
