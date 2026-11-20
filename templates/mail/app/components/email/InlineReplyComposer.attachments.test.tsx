// @vitest-environment happy-dom

import type { ComposeAttachment, ComposeState } from "@shared/types";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
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
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }),
}));
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
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}));
vi.mock("@/hooks/use-aliases", () => ({
  useAliases: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-can-manage-storage", () => ({
  useCanManageStorage: () => true,
}));
vi.mock("@/hooks/use-emails", () => ({
  useAddOptimisticReply: () => vi.fn(),
  useArchiveEmail: () => ({ mutate: vi.fn() }),
  useSendEmail: () => ({ mutateAsync: vi.fn() }),
  useSettings: () => ({ data: { sendAndArchive: false } }),
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
  }: {
    onAttach: (attachment: ComposeAttachment) => void;
  }) => (
    <button type="button" onClick={() => onAttach(contentFile)}>
      Attach Plan
    </button>
  ),
}));
vi.mock("./ComposeEditor", async () => {
  const React = await import("react");
  return { ComposeEditor: React.forwardRef(() => null) };
});
vi.mock("./RecipientInput", () => ({ RecipientInput: () => null }));

import { InlineReplyComposer } from "./InlineReplyComposer";

const contentFile: ComposeAttachment = {
  id: "content-file",
  filename: "Plan.pdf",
  mimeType: "application/pdf",
  size: 1200,
};
const uploadedFile: ComposeAttachment = {
  id: "uploaded-file",
  filename: "notes.txt",
  mimeType: "text/plain",
  size: 40,
};
const draft: ComposeState = {
  id: "reply-draft",
  to: "reader@example.com",
  subject: "Re: Plan",
  body: "",
  mode: "reply",
  replyToId: "source-message",
  replyToThreadId: "source-thread",
  accountEmail: "me@example.com",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InlineReplyComposer attachments", () => {
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
      <InlineReplyComposer
        draft={draft}
        messages={[]}
        onUpdate={onUpdate}
        onDiscard={vi.fn()}
        onClose={vi.fn()}
        onPopOut={vi.fn()}
        onFlush={vi.fn()}
        onReopen={vi.fn()}
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
});
