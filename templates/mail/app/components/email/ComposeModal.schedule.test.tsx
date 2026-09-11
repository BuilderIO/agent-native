// @vitest-environment happy-dom

import type { ComposeState } from "@shared/types";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockScheduleEmail = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => {
  const toast = vi.fn();
  Object.assign(toast, { error: vi.fn(), dismiss: vi.fn() });
  return toast;
});

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
  useSendEmail: () => ({ isPending: false, mutate: vi.fn() }),
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
    onSendLater,
  }: {
    onSendLater: (runAt: number) => void;
  }) => (
    <button onClick={() => onSendLater(Date.now() + 60_000)}>Schedule</button>
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
    mockToast.mockClear();
  });

  afterEach(() => {
    cleanup();
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
        onNewDraft={vi.fn()}
        onFlush={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    const scheduleButton = getByRole("button", { name: "Schedule" });
    fireEvent.click(scheduleButton);
    fireEvent.click(scheduleButton);

    expect(mockScheduleEmail).toHaveBeenCalledOnce();

    resolveSchedule({});
    await vi.waitFor(() => expect(onDiscard).toHaveBeenCalledOnce());
  });
});
