// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => ({})),
  isPending: false,
  composer: {} as {
    onChange?: (value: string) => void;
    onSubmit?: () => void;
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: {
      items: [
        {
          id: "c:thread-1",
          kind: "comment",
          recordingId: "rec-1",
          recordingTitle: "Demo",
          authorEmail: "sam@example.com",
          createdAt: new Date().toISOString(),
        },
      ],
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useActionMutation: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: mocks.isPending,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [] }),
}));

vi.mock("@/components/library/page-header", () => ({
  PageHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
}));

vi.mock("@/components/workspace/notifications-list", () => ({
  NotificationsList: ({
    items,
    onReply,
  }: {
    items: unknown[];
    onReply: (item: unknown) => void;
  }) => (
    <button type="button" data-reply onClick={() => onReply(items[0])}>
      reply
    </button>
  ),
}));

vi.mock("@/components/player/comment-composer", () => ({
  CommentComposer: (props: {
    onChange: (value: string) => void;
    onSubmit: () => void;
  }) => {
    mocks.composer = props;
    return <textarea readOnly />;
  },
}));

import NotificationsRoute from "./_app.notifications";

describe("NotificationsRoute reply", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.mutateAsync.mockClear();
    mocks.isPending = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function openReply(text: string) {
    act(() => root.render(<NotificationsRoute />));
    act(() => {
      container.querySelector<HTMLButtonElement>("[data-reply]")?.click();
    });
    act(() => mocks.composer.onChange?.(text));
  }

  it("sends a reply when Enter submits it", async () => {
    await openReply("On it");
    await act(async () => mocks.composer.onSubmit?.());

    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "rec-1",
        content: "On it",
        threadId: "thread-1",
      }),
    );
  });

  it("doesn't send again while the first reply is on its way", async () => {
    mocks.isPending = true;
    await openReply("On it");
    await act(async () => mocks.composer.onSubmit?.());

    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
