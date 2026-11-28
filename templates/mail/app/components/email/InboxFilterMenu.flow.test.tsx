import {
  inboxFilterAccepts,
  inboxFilterParamForView,
  inboxFilterRequest,
} from "@shared/inbox-filters";
import type { ListInboxThreadsResult } from "@shared/inbox-threads";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Link, MemoryRouter, useLocation, useSearchParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import { TooltipProvider } from "@/components/ui/tooltip";

const server = vi.hoisted(() => ({
  call: (_name: string, _args: Record<string, unknown>): Promise<unknown> =>
    Promise.reject(new Error("no fake server")),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: (name: string, args: Record<string, unknown>) =>
    server.call(name, args),
  callActionWithRetry: (name: string, args: Record<string, unknown>) =>
    server.call(name, args),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { inboxTabLinkHref } from "@/components/layout/AppLayout";
import { useMarkThreadRead } from "@/hooks/use-emails";
import { resolveInboxTabId, useInboxThreads } from "@/hooks/use-inbox-threads";

import { InboxFilterMenu } from "./InboxFilterMenu";

const ACCOUNT = "owner@example.com";

type FakeThread = {
  threadId: string;
  subject: string;
  tab: "important" | "other";
  unread: boolean;
  starred: boolean;
};

let threads: FakeThread[] = [];
let listRequests: Array<Record<string, unknown>> = [];
let markReadRequests: Array<Record<string, unknown>> = [];

function lastListRequest() {
  return listRequests[listRequests.length - 1];
}

function listInboxThreads(args: Record<string, unknown>) {
  listRequests.push(args);
  const tab = args.tab === "other" ? "other" : "important";
  const accepts =
    typeof args.inboxFilter === "string"
      ? inboxFilterAccepts(args.inboxFilter)
      : null;
  const inTab = threads.filter((thread) => thread.tab === tab);
  const rows = inTab.filter(
    (thread) =>
      !accepts || accepts({ unread: thread.unread, starred: thread.starred }),
  );
  const count = (id: "important" | "other") => {
    const members = threads.filter((thread) => thread.tab === id);
    return {
      total: members.length,
      unread: members.filter((thread) => thread.unread).length,
    };
  };
  const result: ListInboxThreadsResult = {
    tabs: [
      {
        id: "important",
        kind: "important",
        name: "Important",
        ...count("important"),
      },
      { id: "other", kind: "other", name: "Other", ...count("other") },
    ],
    activeTabId: tab,
    items: rows.map((thread) => ({
      id: `m-${thread.threadId}`,
      threadId: thread.threadId,
      accountEmail: ACCOUNT,
      from: { name: "Ada", email: "ada@example.com" },
      to: [{ name: "Owner", email: ACCOUNT }],
      subject: thread.subject,
      snippet: "",
      body: "",
      date: "2026-11-20T00:00:00.000Z",
      labelIds: ["inbox"],
      isRead: !thread.unread,
      isStarred: thread.starred,
      isArchived: false,
      isTrashed: false,
      messageCount: 1,
      unreadCount: thread.unread ? 1 : 0,
      messageIds: [`m-${thread.threadId}`],
      isAutomated: tab === "other",
    })),
    tabPreviews: {},
    total: count(tab).total,
    hasMore: false,
    reachedCap: false,
    syncing: false,
    accounts: [],
    labels: [],
  };
  return result;
}

function CurrentUrl() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

function FilteredInbox() {
  const [searchParams] = useSearchParams();
  const viewFilter = inboxFilterParamForView("inbox", searchParams);
  const inboxFilter = inboxFilterRequest(viewFilter);
  const inbox = useInboxThreads({
    tab: resolveInboxTabId(searchParams),
    limit: 50,
    offset: 0,
    ...(inboxFilter ? { inboxFilter } : {}),
  });
  const markRead = useMarkThreadRead();
  return (
    <>
      <InboxFilterMenu />
      <nav>
        {inbox.data?.tabs.map((tab) => (
          <Link key={tab.id} to={inboxTabLinkHref(tab, [], viewFilter)}>
            {tab.name}
          </Link>
        ))}
      </nav>
      <ul aria-label="Rows">
        {inbox.data?.items.map((item) => (
          <li key={item.threadId}>
            {item.subject}
            <button
              type="button"
              onClick={() =>
                markRead.mutate({
                  threadId: item.threadId,
                  accountEmail: ACCOUNT,
                })
              }
            >
              Mark {item.subject} read
            </button>
          </li>
        ))}
      </ul>
      <CurrentUrl />
    </>
  );
}

function renderInbox(url: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>
          <FilteredInbox />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function rows() {
  return Array.from(
    screen
      .getByRole("list", { name: "Rows", hidden: true })
      .querySelectorAll("li"),
  ).map((row) => row.firstChild?.textContent);
}

function clickButton(name: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name ||
      candidate.textContent.trim() === name,
  );
  if (!button) throw new Error(`No button named ${name}`);
  fireEvent.click(button);
}

function openFilterMenu() {
  const trigger = Array.from(
    document.querySelectorAll('button[aria-haspopup="dialog"]'),
  ).find((button) => button.textContent.startsWith("Filter"));
  if (!trigger) throw new Error("No Filter button");
  if (trigger.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(trigger);
  }
}

function clickOption(name: string) {
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((candidate) => candidate.textContent.trim() === name);
  if (!option) throw new Error(`No option named ${name}`);
  fireEvent.click(option);
}

beforeEach(() => {
  threads = [
    {
      threadId: "t1",
      subject: "Unread plan",
      tab: "important",
      unread: true,
      starred: false,
    },
    {
      threadId: "t2",
      subject: "Read memo",
      tab: "important",
      unread: false,
      starred: true,
    },
    {
      threadId: "t3",
      subject: "Unread digest",
      tab: "other",
      unread: true,
      starred: false,
    },
    {
      threadId: "t4",
      subject: "Read receipt",
      tab: "other",
      unread: false,
      starred: false,
    },
  ];
  listRequests = [];
  markReadRequests = [];
  server.call = async (name, args) => {
    if (name === "list-inbox-threads") return listInboxThreads(args);
    if (name === "mark-thread-read") {
      markReadRequests.push(args);
      threads = threads.map((thread) =>
        thread.threadId === args.threadId
          ? { ...thread, unread: false }
          : thread,
      );
      return { threadId: args.threadId, isRead: true };
    }
    throw new Error(`unexpected action ${name}`);
  };
});

afterEach(cleanup);

describe("Mail inbox Filter menu flow", () => {
  it("filters the server read, keeps the filter across tabs, drops a row that stops matching, and clears", async () => {
    renderInbox("/inbox?tab=important");
    await waitFor(() => expect(rows()).toEqual(["Unread plan", "Read memo"]));

    openFilterMenu();
    clickButton("Add filter");
    clickOption("Unread");

    await waitFor(() => expect(rows()).toEqual(["Unread plan"]));
    expect(
      screen.getByText("/inbox?tab=important&r=unread:is_checked"),
    ).toBeTruthy();
    expect(lastListRequest()).toMatchObject({
      tab: "important",
      inboxFilter: "r=unread:is_checked",
    });

    fireEvent.click(screen.getByRole("link", { name: "Other", hidden: true }));
    await waitFor(() => expect(rows()).toEqual(["Unread digest"]));
    expect(
      screen.getByText("/inbox?tab=other&r=unread:is_checked"),
    ).toBeTruthy();
    expect(lastListRequest()).toMatchObject({
      tab: "other",
      inboxFilter: "r=unread:is_checked",
    });

    const requestsBeforeMutation = listRequests.length;
    await act(async () => clickButton("Mark Unread digest read"));
    await waitFor(() => expect(rows()).toEqual([]));
    expect(listRequests).toHaveLength(requestsBeforeMutation);
    await waitFor(() =>
      expect(markReadRequests).toEqual([
        { threadId: "t3", accountEmail: ACCOUNT },
      ]),
    );

    openFilterMenu();
    clickButton("Clear");
    await waitFor(() =>
      expect(rows()).toEqual(["Unread digest", "Read receipt"]),
    );
    expect(screen.getByText("/inbox?tab=other")).toBeTruthy();
    expect(lastListRequest()).not.toHaveProperty("inboxFilter");
  });
});
