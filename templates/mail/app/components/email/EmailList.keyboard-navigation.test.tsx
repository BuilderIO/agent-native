// @vitest-environment happy-dom

import { AI_PRIORITY_MAX_EMAILS } from "@shared/ai-priority";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { isValidElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  scrollToIndex: vi.fn(),
  trash: vi.fn(),
  searchQuery: "",
  virtualStart: 0,
  virtualWindowSize: Number.POSITIVE_INFINITY,
  view: "all",
  headerActions: null as unknown,
  priorityRequest: vi.fn(),
  priorityFeedback: vi.fn(),
  queryClient: {
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => {
      const start = Math.min(mocks.virtualStart, count);
      const end = Math.min(count, start + mocks.virtualWindowSize);
      return Array.from({ length: end - start }, (_, offset) => {
        const index = start + offset;
        return {
          index,
          key: `synthetic-row-${index}`,
          start: index * 48,
        };
      });
    },
    getTotalSize: () => count * 48,
    measureElement: vi.fn(),
    scrollToIndex: (index: number, options?: { align: string }) => {
      mocks.scrollToIndex(index, options);
      if (Number.isFinite(mocks.virtualWindowSize)) {
        mocks.virtualStart = Math.max(
          0,
          index - Math.floor(mocks.virtualWindowSize / 2),
        );
      }
    },
  }),
}));

vi.mock("react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useNavigate: () => mocks.navigate,
  useParams: () => ({ view: mocks.view }),
  useSearchParams: () => [
    new URLSearchParams(
      mocks.searchQuery ? { q: mocks.searchQuery } : undefined,
    ),
  ],
}));

vi.mock("@/components/layout/HeaderActions", () => ({
  useSetHeaderActions: (actions: unknown) => {
    mocks.headerActions = actions;
  },
}));

vi.mock("@/components/GoogleConnectBanner", () => ({
  GoogleConnectBanner: () => null,
}));

vi.mock("@/components/email/AiFilterDialog", () => ({
  AiFilterDialog: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const PassThrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    DropdownMenu: PassThrough,
    DropdownMenuContent: PassThrough,
    DropdownMenuItem: ({
      children,
      onSelect,
    }: {
      children?: React.ReactNode;
      onSelect?: () => void;
    }) => React.createElement("button", { onClick: onSelect }, children),
    DropdownMenuLabel: PassThrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuSub: PassThrough,
    DropdownMenuSubContent: PassThrough,
    DropdownMenuSubTrigger: PassThrough,
    DropdownMenuTrigger: PassThrough,
  };
});

vi.mock("@/hooks/use-account-filter", () => ({
  useAccountFilter: () => ({ activeAccounts: new Set(), allAccounts: [] }),
}));

vi.mock("@/hooks/use-ai-priority", () => ({
  useAiPriority: () => ({
    isPending: false,
    mutateAsync: mocks.priorityRequest,
  }),
}));

vi.mock("@/hooks/use-ai-priority-feedback", () => ({
  useAiPriorityFeedback: () => ({
    mutateAsync: mocks.priorityFeedback,
  }),
}));

vi.mock("@/hooks/use-automations", () => ({
  useAutomations: () => ({ data: [], isFetching: false }),
}));

vi.mock("@/hooks/use-emails", () => {
  const mutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    createSuppressionToken: vi.fn(() => ({ ids: new Map() })),
    getSuppressionIds: vi.fn(() => []),
  });
  return {
    EMPTY_LABELS: [],
    MoveEmailPartialFailure: class MoveEmailPartialFailure extends Error {},
    releaseSuppressionClaims: vi.fn(),
    useEmails: () => ({ data: [] }),
    useLabels: () => ({ data: [] }),
    useMarkRead: mutation,
    useMarkThreadRead: mutation,
    useToggleStar: mutation,
    useArchiveEmail: mutation,
    useUnarchiveEmail: mutation,
    useTrashEmail: () => ({
      mutate: mocks.trash,
      mutateAsync: vi.fn(),
      createSuppressionToken: vi.fn(() => ({ ids: new Map() })),
      getSuppressionIds: vi.fn(() => []),
    }),
    useUntrashEmail: mutation,
    useBulkArchiveEmails: mutation,
    useBulkTrashEmails: mutation,
    useBulkToggleStar: mutation,
    useBulkMarkRead: mutation,
    useMoveEmail: mutation,
  };
});

vi.mock("@/hooks/use-scheduled-jobs", () => ({
  useDeleteScheduledJob: () => ({ mutate: vi.fn() }),
  useSendScheduledJobNow: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-undo", () => ({
  setUndoAction: vi.fn(() => vi.fn()),
  setUndoToastId: vi.fn(),
  UNDO_DURATION: 10_000,
}));

vi.mock("@/lib/thread-cache", () => ({
  ensureThread: vi.fn(() => Promise.resolve([])),
  warmThreads: vi.fn(),
}));

import { EmailList, rememberPriorityScore } from "./EmailList";

const messages = ["first", "middle", "last"].map((id, index) => ({
  id,
  threadId: `thread-${id}`,
  from: { name: `Sender ${id}`, email: `${id}@example.test` },
  to: [{ name: "Synthetic User", email: "user@example.test" }],
  subject: `Subject ${id}`,
  snippet: `Snippet ${id}`,
  body: `Body ${id}`,
  date: new Date(Date.UTC(2026, 0, 3 - index)).toISOString(),
  isRead: true,
  isStarred: false,
  isArchived: false,
  isTrashed: false,
  labelIds: [],
  accountEmail: "synthetic@example.test",
}));

function Harness({
  emails = messages,
  onCompose,
  accountErrors,
  hasNextPage,
  isFetchingNextPage,
  showPrioritySort,
  jevConfigured = showPrioritySort,
  sortMode,
}: {
  emails?: React.ComponentProps<typeof EmailList>["emails"];
  onCompose?: React.ComponentProps<typeof EmailList>["onCompose"];
  accountErrors?: React.ComponentProps<typeof EmailList>["accountErrors"];
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  showPrioritySort?: boolean;
  jevConfigured?: boolean;
  sortMode?: "newest" | "priority";
}) {
  const [focusedId, setFocusedId] = useState<string | null>("first");
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  return (
    <>
      <input aria-label="Synthetic input" />
      <output aria-label="Focused id">{focusedId}</output>
      <EmailList
        emails={emails}
        isLoading={false}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        onCompose={onCompose}
        accountErrors={accountErrors}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        showPrioritySort={showPrioritySort}
        jevConfigured={jevConfigured}
        sortMode={sortMode}
      />
    </>
  );
}

function rows() {
  return screen.queryAllByRole("row");
}

function press(key: string, shiftKey = false) {
  fireEvent.keyDown(window, { key, shiftKey });
}

function hasPrioritySortOption(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasPrioritySortOption);
  if (!isValidElement(node)) return false;
  const props = node.props as {
    children?: unknown;
    onSelect?: unknown;
    value?: unknown;
  };
  const isPriorityAction =
    props.value === "priority" ||
    (props.onSelect !== undefined &&
      hasText(props.children, "mail.sort.priority"));
  return isPriorityAction || hasPrioritySortOption(props.children);
}

function hasText(node: unknown, text: string): boolean {
  if (node === text) return true;
  if (Array.isArray(node)) return node.some((child) => hasText(child, text));
  if (!isValidElement(node)) return false;
  return hasText((node.props as { children?: unknown }).children, text);
}

function hasJevConnectionPrompt(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasJevConnectionPrompt);
  if (!isValidElement(node)) return false;
  if (
    typeof node.type === "function" &&
    node.type.name === "JevConnectionPrompt"
  ) {
    return true;
  }
  return hasJevConnectionPrompt(
    (node.props as { children?: unknown }).children,
  );
}

describe("EmailList keyboard navigation interactions", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.scrollToIndex.mockReset();
    mocks.trash.mockReset();
    mocks.searchQuery = "";
    mocks.virtualStart = 0;
    mocks.virtualWindowSize = Number.POSITIVE_INFINITY;
    mocks.view = "all";
    mocks.headerActions = null;
    mocks.queryClient = {
      getQueryData: vi.fn(),
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn(),
    };
    mocks.priorityRequest.mockReset().mockResolvedValue({ scores: [] });
    mocks.priorityFeedback
      .mockReset()
      .mockResolvedValue({ totalVotes: 1, recentVotes: [] });
  });

  afterEach(() => cleanup());

  it("keeps Priority visible with a Jev connect action when unavailable", () => {
    mocks.view = "inbox";
    render(<Harness showPrioritySort={false} />);

    expect(hasPrioritySortOption(mocks.headerActions)).toBe(false);
    expect(hasJevConnectionPrompt(mocks.headerActions)).toBe(true);
  });

  it("shows Priority sort when Jev is configured", () => {
    mocks.view = "inbox";
    render(<Harness showPrioritySort />);

    expect(hasPrioritySortOption(mocks.headerActions)).toBe(true);
    expect(hasJevConnectionPrompt(mocks.headerActions)).toBe(false);
  });

  it("reuses priority scores when the visible inbox emails change", async () => {
    mocks.view = "inbox";
    mocks.priorityRequest.mockImplementation(
      async ({
        emails,
      }: {
        emails: Array<{ id: string; accountEmail: string }>;
      }) => ({
        scores: emails.map(({ id, accountEmail }) => ({
          emailId: id,
          accountEmail,
          score: id === "middle" ? 0.9 : id === "last" ? 0.8 : 0.1,
        })),
      }),
    );
    const firstTabEmails = [messages[0], messages[1]].map((email) => ({
      ...email,
      labelIds: ["inbox"],
    }));
    const secondTabEmails = [messages[1], messages[2]].map((email) => ({
      ...email,
      labelIds: ["inbox"],
    }));
    const { rerender } = render(
      <Harness emails={firstTabEmails} showPrioritySort sortMode="priority" />,
    );

    await waitFor(() =>
      expect(rows()[0].textContent).toContain("Subject middle"),
    );
    rerender(
      <Harness emails={secondTabEmails} showPrioritySort sortMode="priority" />,
    );

    await waitFor(() =>
      expect(rows()[0].textContent).toContain("Subject middle"),
    );
    expect(mocks.priorityRequest).toHaveBeenLastCalledWith({
      emails: [expect.objectContaining({ id: "last" })],
    });
  });

  it("does not roll back a newer priority vote when an older vote fails", async () => {
    mocks.view = "inbox";
    const inboxEmails = messages.map((email) => ({
      ...email,
      labelIds: ["inbox"],
    }));
    let rejectOlderVote!: (error: Error) => void;
    mocks.priorityRequest.mockResolvedValue({
      scores: inboxEmails.map((email) => ({
        emailId: email.id,
        accountEmail: email.accountEmail,
        score: email.id === "first" ? 0.9 : email.id === "middle" ? 0.6 : 0.2,
      })),
    });
    mocks.priorityFeedback
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectOlderVote = reject;
        }),
      )
      .mockResolvedValueOnce({ totalVotes: 2, recentVotes: [] });

    render(
      <Harness emails={inboxEmails} showPrioritySort sortMode="priority" />,
    );
    await waitFor(() => expect(mocks.priorityRequest).toHaveBeenCalledTimes(1));
    expect(rows()[0].textContent).toContain("Subject first");

    fireEvent.click(within(rows()[0]).getByText("mail.aiFilter.importantMode"));
    fireEvent.click(
      within(rows()[0]).getByText("mail.aiFilter.notImportantMode"),
    );
    await waitFor(() =>
      expect(mocks.priorityFeedback).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(rows()[0].textContent).toContain("Subject middle"),
    );

    await act(async () => rejectOlderVote(new Error("vote failed")));

    expect(rows()[0].textContent).toContain("Subject middle");
  });

  it("keeps cached priority scores when volatile labels change", async () => {
    mocks.view = "inbox";
    mocks.priorityRequest.mockResolvedValue({
      scores: messages.map((email) => ({
        emailId: email.id,
        accountEmail: email.accountEmail,
        score: email.id === "middle" ? 0.9 : 0.1,
      })),
    });
    const inboxEmails = messages.map((email) => ({
      ...email,
      labelIds: ["inbox"],
    }));
    const { rerender } = render(
      <Harness emails={inboxEmails} showPrioritySort sortMode="priority" />,
    );

    await waitFor(() => expect(mocks.priorityRequest).toHaveBeenCalledTimes(1));
    rerender(
      <Harness
        emails={inboxEmails.map((email) => ({
          ...email,
          labelIds: [
            "inbox",
            "UNREAD",
            "STARRED",
            "agent-native-important",
            "[superhuman]/ai/automated",
          ],
        }))}
        showPrioritySort
        sortMode="priority"
      />,
    );

    expect(mocks.priorityRequest).toHaveBeenCalledTimes(1);
    expect(rows()[0].textContent).toContain("Subject middle");
  });

  it("reuses priority scores on the first render after the list remounts", async () => {
    mocks.view = "inbox";
    const inboxEmails = [messages[0], messages[1], messages[2]].map(
      (email) => ({
        ...email,
        labelIds: ["inbox"],
      }),
    );
    let resolvePriority!: (result: {
      scores: Array<{
        emailId: string;
        accountEmail: string;
        score: number;
      }>;
    }) => void;
    mocks.priorityRequest.mockReturnValue(
      new Promise((resolve) => {
        resolvePriority = resolve;
      }),
    );

    const firstMount = render(
      <Harness emails={inboxEmails} showPrioritySort sortMode="priority" />,
    );
    expect(mocks.priorityRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolvePriority({
        scores: [
          {
            emailId: "first",
            accountEmail: "synthetic@example.test",
            score: 0.1,
          },
          {
            emailId: "middle",
            accountEmail: "synthetic@example.test",
            score: 0.9,
          },
          {
            emailId: "last",
            accountEmail: "synthetic@example.test",
            score: 0.8,
          },
        ],
      });
    });
    expect(rows()[0].textContent).toContain("Subject middle");
    firstMount.unmount();

    render(
      <Harness emails={inboxEmails} showPrioritySort sortMode="priority" />,
    );

    expect(rows()[0].textContent).toContain("Subject middle");
    expect(mocks.priorityRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps duplicate message IDs separate across accounts", async () => {
    mocks.view = "inbox";
    const inboxEmails = [
      {
        ...messages[0],
        id: "shared-message-id",
        threadId: "first-account-thread",
        accountEmail: "first@example.test",
        subject: "First account",
        labelIds: ["inbox"],
      },
      {
        ...messages[1],
        id: "shared-message-id",
        threadId: "second-account-thread",
        accountEmail: "second@example.test",
        subject: "Second account",
        labelIds: ["inbox"],
      },
    ];
    mocks.priorityRequest.mockResolvedValue({
      scores: [
        {
          emailId: "shared-message-id",
          accountEmail: "first@example.test",
          score: 0.1,
        },
        {
          emailId: "shared-message-id",
          accountEmail: "second@example.test",
          score: 0.9,
        },
      ],
    });

    const firstMount = render(
      <Harness emails={inboxEmails} showPrioritySort sortMode="priority" />,
    );
    await waitFor(() =>
      expect(rows()[0].textContent).toContain("Second account"),
    );
    firstMount.unmount();

    render(
      <Harness emails={inboxEmails} showPrioritySort sortMode="priority" />,
    );

    expect(rows()[0].textContent).toContain("Second account");
    expect(mocks.priorityRequest).toHaveBeenCalledTimes(1);
  });

  it("bounds cached priority scores to the supported priority window", () => {
    const cache = new Map<string, { inputKey: string; score: number }>();
    for (let index = 0; index <= AI_PRIORITY_MAX_EMAILS; index += 1) {
      rememberPriorityScore(cache, String(index), {
        inputKey: String(index),
        score: index,
      });
    }

    expect(cache.size).toBe(AI_PRIORITY_MAX_EMAILS);
    expect(cache.has("0")).toBe(false);
    expect(cache.has(String(AI_PRIORITY_MAX_EMAILS))).toBe(true);
  });

  it("keeps partial refresh warnings out of a populated cached list", () => {
    render(
      <Harness
        accountErrors={[
          { email: "steve@builder.io", error: "temporary refresh failure" },
        ]}
      />,
    );

    expect(rows()).toHaveLength(3);
    expect(screen.queryByText("mail.error.someAccountsFailed")).toBeNull();
  });

  it("keeps refresh warnings on empty search results", () => {
    mocks.searchQuery = "invoice";
    render(
      <Harness
        emails={[]}
        accountErrors={[{ email: "steve@builder.io", error: "temporary" }]}
      />,
    );

    expect(screen.getByText("mail.error.someAccountsFailed")).toBeTruthy();
    expect(screen.getByText("mail.empty.noSearchResults")).toBeTruthy();
  });

  it("keeps refresh warnings while an empty page is fetching more rows", () => {
    render(
      <Harness
        emails={[]}
        accountErrors={[{ email: "steve@builder.io", error: "temporary" }]}
        hasNextPage
        isFetchingNextPage
      />,
    );

    expect(screen.getByText("mail.error.someAccountsFailed")).toBeTruthy();
    expect(screen.getByText("mail.empty.loadingMore")).toBeTruthy();
  });

  it("moves visible focus with j/k and arrows and clamps at both ends", () => {
    render(<Harness />);
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      "true",
      null,
      null,
    ]);

    press("j");
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      null,
      "true",
      null,
    ]);
    press("ArrowDown");
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "true",
    ]);
    press("j");
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "true",
    ]);

    press("k");
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      null,
      "true",
      null,
    ]);
    press("ArrowUp");
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      "true",
      null,
      null,
    ]);
    press("k");
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      "true",
      null,
      null,
    ]);
  });

  it("extends selected rows with Shift+j and Shift+ArrowDown; plain j clears selection", () => {
    render(<Harness />);

    press("j", true);
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual([
      "true",
      "true",
      "false",
    ]);
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      null,
      "true",
      null,
    ]);
    press("ArrowDown", true);
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual([
      "true",
      "true",
      "true",
    ]);
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "true",
    ]);

    press("k");
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "false",
    ]);
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      null,
      "true",
      null,
    ]);
  });

  it("extends a multi-selection upward with Shift+k and Shift+ArrowUp", () => {
    render(<Harness />);
    press("j");
    press("j");

    press("k", true);
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "true",
    ]);
    press("ArrowUp", true);
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual([
      "true",
      "true",
      "true",
    ]);
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      "true",
      null,
      null,
    ]);
  });

  it("Escape clears the selection without moving focus", () => {
    render(<Harness />);
    press("j", true);
    press("Escape");

    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "false",
    ]);
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      null,
      "true",
      null,
    ]);
  });

  it.each(["Enter", "o"])("opens the focused thread with %s", (key) => {
    render(<Harness />);
    press("ArrowDown");
    press(key);

    expect(mocks.navigate).toHaveBeenCalledWith("/all/thread-middle");
  });

  it.each([
    { key: "d", shiftKey: false },
    { key: "#", shiftKey: true },
    { key: "#", shiftKey: false },
  ])("trashes the focused thread with $key", ({ key, shiftKey }) => {
    render(<Harness />);
    press(key, shiftKey);

    expect(mocks.trash).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "first",
        accountEmail: "synthetic@example.test",
        threadId: "thread-first",
        suppressionToken: expect.any(Object),
      }),
    );
  });

  it("does not wrap a one-row list and keeps an empty list free of focused rows", () => {
    const { rerender } = render(<Harness emails={[messages[0]]} />);
    press("k");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].getAttribute("aria-current")).toBe("true");
    press("j");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].getAttribute("aria-current")).toBe("true");

    rerender(<Harness emails={[]} />);
    expect(rows()).toHaveLength(0);
    expect(screen.getByLabelText("Focused id").textContent).toBe("first");
    press("j");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("moves into rows appended by a later fetch", () => {
    const fetchedMessage = {
      ...messages[2],
      id: "newly-fetched",
      threadId: "thread-newly-fetched",
      date: new Date(Date.UTC(2025, 11, 31)).toISOString(),
      subject: "Subject newly fetched",
    };
    const { rerender } = render(<Harness emails={messages} />);
    press("j");
    press("j");

    rerender(<Harness emails={[...messages, fetchedMessage]} />);
    press("j");

    expect(screen.getByLabelText("Focused id").textContent).toBe(
      "newly-fetched",
    );
    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      null,
      null,
      null,
      "true",
    ]);
  });

  it("scrolls virtualized focus into the rendered window", () => {
    const manyMessages = Array.from({ length: 10 }, (_, index) => ({
      ...messages[index % messages.length],
      id: `row-${index}`,
      threadId: `thread-row-${index}`,
      date: new Date(Date.UTC(2026, 0, 20 - index)).toISOString(),
      subject: `Subject row-${index}`,
    }));
    mocks.virtualWindowSize = 3;
    const view = render(<Harness emails={manyMessages} />);
    expect(rows()).toHaveLength(3);

    for (let index = 0; index < 7; index += 1) press("j");
    view.rerender(<Harness emails={manyMessages} />);

    expect(mocks.scrollToIndex).toHaveBeenCalledWith(7, { align: "auto" });
    const focusedRows = rows().filter(
      (row) => row.getAttribute("aria-current") === "true",
    );
    expect(focusedRows).toHaveLength(1);
    expect(focusedRows[0].textContent).toContain("Subject row-7");
  });

  it("does not consume navigation shortcuts while an input is focused", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Synthetic input" });
    input.focus();
    fireEvent.keyDown(input, { key: "j" });

    expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
      "true",
      null,
      null,
    ]);
    expect(screen.getByLabelText("Focused id").textContent).toBe("first");
  });

  it("maps r and a to reply and Reply All for the focused conversation", () => {
    const onCompose = vi.fn();
    render(<Harness onCompose={onCompose} />);

    press("r");
    press("a");

    expect(onCompose).toHaveBeenNthCalledWith(1, messages[0], "reply");
    expect(onCompose).toHaveBeenNthCalledWith(2, messages[0], "replyAll");
  });
});
