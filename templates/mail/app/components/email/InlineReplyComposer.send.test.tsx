// @vitest-environment happy-dom

import type { ComposeState } from "@shared/types";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendEmailAsync = vi.hoisted(() => vi.fn());
const mockArchiveEmail = vi.hoisted(() => vi.fn());
const mockSettings = vi.hoisted(() => ({ sendAndArchive: false }));
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
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}));
vi.mock("@/hooks/use-aliases", () => ({
  useAliases: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-emails", () => ({
  useAddOptimisticReply: () => vi.fn(),
  useArchiveEmail: () => ({ mutate: mockArchiveEmail }),
  useSendEmail: () => ({
    mutateAsync: mockSendEmailAsync,
  }),
  useSettings: () => ({ data: mockSettings }),
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
vi.mock("./ComposeEditor", async () => {
  const React = await import("react");
  return {
    ComposeEditor: React.forwardRef(
      ({ onSend }: { onSend: (markDone?: boolean) => void }, _ref) => (
        <button type="button" onClick={() => onSend(true)}>
          Send + Mark Done
        </button>
      ),
    ),
  };
});
vi.mock("./RecipientInput", () => ({ RecipientInput: () => null }));

import { InlineReplyComposer } from "./InlineReplyComposer";

const draft: ComposeState = {
  id: "reply-draft",
  to: "sewell.steve@gmail.com",
  subject: "Re: Test",
  body: "Reply body",
  mode: "reply",
  replyToId: "source-message",
  replyToThreadId: "source-thread",
  accountEmail: "steve@builder.io",
};

describe("InlineReplyComposer Send + Mark Done", () => {
  beforeEach(() => {
    mockSendEmailAsync.mockReset();
    mockArchiveEmail.mockReset();
    mockSettings.sendAndArchive = false;
    mockToast.mockClear();
    mockToast.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("archives the replied-to thread only after the provider confirms the send", async () => {
    vi.useFakeTimers();
    mockSendEmailAsync.mockResolvedValue({ id: "sent-reply" });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const { getByRole } = render(
      <InlineReplyComposer
        draft={draft}
        messages={[]}
        onUpdate={vi.fn()}
        onDiscard={vi.fn()}
        onClose={vi.fn()}
        onPopOut={vi.fn()}
        onFlush={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    fireEvent.click(getByRole("button", { name: "Send + Mark Done" }));
    expect(mockArchiveEmail).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(mockSendEmailAsync).toHaveBeenCalledOnce();
    expect(mockArchiveEmail).toHaveBeenCalledWith({
      id: draft.replyToId,
      accountEmail: draft.accountEmail,
      threadId: draft.replyToThreadId,
    });
    expect(mockToast.error).not.toHaveBeenCalledWith(
      "mail.toasts.failedToSendEmail",
    );
  });
});
