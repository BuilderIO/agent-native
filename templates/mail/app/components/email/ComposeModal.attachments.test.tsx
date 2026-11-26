// @vitest-environment happy-dom

import type { ComposeAttachment, ComposeState } from "@shared/types";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openFilePicker: vi.fn(),
  uploadFiles: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useAgentChatGenerating: () => [false, vi.fn()],
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({
    formatDate: (date: Date) => date.toISOString(),
  }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/use-account-filter", () => ({
  useAccountFilter: () => ({ allAccounts: [] }),
}));
vi.mock("@/hooks/use-aliases", () => ({
  useAliases: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-can-manage-storage", () => ({
  useCanManageStorage: () => true,
}));
vi.mock("@/hooks/use-draft-queue", () => ({
  useUpdateQueuedDraft: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-emails", () => ({
  useAddOptimisticReply: () => vi.fn(),
  useSendEmail: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useArchiveEmail: () => ({ mutate: vi.fn() }),
  useSettings: () => ({ data: { sendAndArchive: false } }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-scheduled-jobs", () => ({
  useScheduleEmail: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/agent-generate", () => ({ canUseAgentGenerate: vi.fn() }));
vi.mock("@/lib/alias-utils", () => ({
  expandAliasTokens: (value: string) => value,
}));
vi.mock("@/lib/upload", () => ({
  openFilePicker: mocks.openFilePicker,
  uploadFile: vi.fn(),
  uploadFiles: mocks.uploadFiles,
}));
vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));
vi.mock("./AttachmentStrip", () => ({ AttachmentStrip: () => null }));
vi.mock("./AttachFromContentButton", () => ({
  AttachFromContentButton: ({
    onAttach,
    onPendingChange,
  }: {
    onAttach: (attachment: ComposeAttachment) => void;
    onPendingChange?: (pending: boolean) => void;
  }) => (
    <>
      <button type="button" onClick={() => onAttach(contentFile)}>
        Attach Plan
      </button>
      <button type="button" onClick={() => onPendingChange?.(true)}>
        Start attaching Plan
      </button>
      <button
        type="button"
        onClick={() => {
          onAttach(contentFile);
          onPendingChange?.(false);
        }}
      >
        Finish attaching Plan
      </button>
    </>
  ),
}));
vi.mock("./ComposeEditor", () => ({ ComposeEditor: () => null }));
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
      <button type="button" onClick={onSend}>
        Send
      </button>
      <button type="button" onClick={() => onSendLater(Date.now() + 60_000)}>
        Send later
      </button>
    </>
  ),
}));

import { toast } from "sonner";

import { ComposeModal } from "./ComposeModal";

const contentFile: ComposeAttachment = {
  id: "content-file",
  filename: "Plan.pdf",
  originalName: "Plan.pdf",
  mimeType: "application/pdf",
  size: 1200,
};
const uploadedFile: ComposeAttachment = {
  id: "uploaded-file",
  filename: "notes.txt",
  originalName: "notes.txt",
  mimeType: "text/plain",
  size: 40,
};
const draft: ComposeState = {
  id: "draft-1",
  to: "reader@example.com",
  subject: "Plan",
  body: "",
  mode: "compose",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ComposeModal attachments", () => {
  it("keeps a Content page attached while a file upload is still running", async () => {
    let finishUpload: (files: ComposeAttachment[]) => void = () => {};
    mocks.openFilePicker.mockResolvedValue(new File(["notes"], "notes.txt"));
    mocks.uploadFiles.mockReturnValue(
      new Promise<ComposeAttachment[]>((resolve) => {
        finishUpload = resolve;
      }),
    );
    const onUpdate = vi.fn();
    const { getByRole } = render(
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

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "mail.compose.attachFile" }));
    });
    fireEvent.click(getByRole("button", { name: "Attach Plan" }));
    await act(async () => {
      finishUpload([uploadedFile]);
    });

    expect(onUpdate).toHaveBeenLastCalledWith(draft.id, {
      attachments: [contentFile, uploadedFile],
    });
  });

  it("won't send or schedule while a file is still uploading", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let finishUpload: (files: ComposeAttachment[]) => void = () => {};
    mocks.openFilePicker.mockResolvedValue(new File(["notes"], "notes.txt"));
    mocks.uploadFiles.mockReturnValue(
      new Promise<ComposeAttachment[]>((resolve) => {
        finishUpload = resolve;
      }),
    );
    const onStageForSend = vi.fn();
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
        onRestoreAfterSend={vi.fn()}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "mail.compose.attachFile" }));
    });
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Send" }));
    });
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Send later" }));
    });

    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith("mail.toasts.waitForAttachments");
    expect(onStageForSend).not.toHaveBeenCalled();

    await act(async () => {
      finishUpload([uploadedFile]);
    });
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Send" }));
    });

    expect(onStageForSend).toHaveBeenCalledWith(draft.id);
  });

  it("won't send while a Content page is still attaching", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onStageForSend = vi.fn();
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
        onRestoreAfterSend={vi.fn()}
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Start attaching Plan" }));
    });
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Send" }));
    });

    expect(toast.error).toHaveBeenCalledWith("mail.toasts.waitForAttachments");
    expect(onStageForSend).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Finish attaching Plan" }));
    });
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Send" }));
    });

    expect(onStageForSend).toHaveBeenCalledWith(draft.id);
  });
});
