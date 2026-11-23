// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Creators = {
  data?: {
    creators: Array<{
      email: string;
      name: string | null;
      imageUrl: string | null;
    }>;
  };
  error?: Error | null;
};

const mocks = vi.hoisted(() => ({
  threads: [] as Array<Record<string, unknown>>,
  creators: {} as Creators,
  creatorQuery: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  notifyChatThreadsUpdated: vi.fn(),
  useChatThreadList: () => ({
    threads: mocks.threads,
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: "org-1" } }),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    status: "authenticated",
    session: { email: "viewer@example.test" },
  }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  currentActionQueryCacheBinding: () => undefined,
  useActionQueryCanFetch: () => true,
  runActionQueryRead: (
    _client: unknown,
    _key: unknown,
    _signal: unknown,
    read: (onResponse: (response: Response) => void) => unknown,
  ) => read(() => {}),
  actionErrorMessage: () => undefined,
  useActionMutation: () => ({ mutateAsync: vi.fn() }),
  callAction: async (
    name: string,
    params: { ownerEmails: string[] },
    options?: { method?: string },
  ) => {
    mocks.creatorQuery(name, params);
    if (options?.method !== "GET")
      throw new Error("Method not allowed. Use GET.");
    if (mocks.creators.error) throw mocks.creators.error;
    return {
      creators: (mocks.creators.data?.creators ?? []).filter((creator) =>
        params.ownerEmails.includes(creator.email),
      ),
    };
  },
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, options?: Record<string, unknown>) => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        messages,
      );
    return typeof value === "string"
      ? value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
          String(options?.[name]),
        )
      : key;
  },
}));

import messages from "@/i18n/en-US";

import { ThreadsPage } from "./ThreadsPage";

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`No item at ${index}`);
  return item;
}

const row = (
  id: string,
  title: string,
  ownerEmail: string,
  basis = "owner",
) => ({
  id,
  title,
  ownerEmail,
  updatedAt: Date.parse("2026-11-08T10:00:00.000Z"),
  accessBasis: basis,
});

describe("threads page rows (QA25/QA26)", () => {
  let host: HTMLDivElement;
  let root: Root;
  const render = async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <ThreadsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => {
      if (host.querySelector(".skeleton-shimmer"))
        throw new Error("creators still loading");
    });
  };
  const rows = () =>
    [...host.querySelectorAll<HTMLElement>('[role="row"]')].slice(1);
  const readable = (el: HTMLElement) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[aria-hidden=true]").forEach((n) => n.remove());
    return copy.textContent.trim();
  };
  const cells = (rowEl: HTMLElement) => [
    ...rowEl.querySelectorAll<HTMLElement>('[role="cell"]'),
  ];

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.creatorQuery.mockClear();
    mocks.creators = {
      data: {
        creators: [
          { email: "ada@example.test", name: "Ada Lovelace", imageUrl: null },
          {
            email: "grace@example.test",
            name: "Grace Hopper",
            imageUrl: null,
          },
        ],
      },
    };
    mocks.threads = [
      row("t1", "Revenue by channel", "ada@example.test"),
      row("t2", "Churn drivers", "grace@example.test", "organization"),
      row("t3", "Another of Ada's", "ada@example.test"),
    ];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("has Title, Last Updated and Creator column headers only", async () => {
    await render();
    expect(
      [...host.querySelectorAll('[role="columnheader"]')].map((h) =>
        h.textContent.trim(),
      ),
    ).toEqual(["Title", "Last Updated", "Creator"]);
  });

  it("shows each thread's own creator, distinct per row", async () => {
    await render();
    const creators = rows().map((r) => readable(at(cells(r), 2)));
    expect(creators).toEqual(["Ada Lovelace", "Grace Hopper", "Ada Lovelace"]);
  });

  it("reads creators once for the whole list, not once per row", async () => {
    await render();
    const calls = mocks.creatorQuery.mock.calls.filter(
      ([name]) => name === "list-thread-creators",
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    expect(at(calls, 0)[1]).toEqual({
      ownerEmails: ["ada@example.test", "grace@example.test"],
    });
  });

  it("splits more than 100 distinct creators into requests the action accepts", async () => {
    const emails = Array.from(
      { length: 205 },
      (_, i) => `user${i}@example.test`,
    );
    mocks.threads = emails.map((email, i) =>
      row(`t${i}`, `Thread ${i}`, email),
    );
    mocks.creators = {
      data: {
        creators: emails.map((email, i) => ({
          email,
          name: `User ${i}`,
          imageUrl: null,
        })),
      },
    };
    await render();
    const sizes = mocks.creatorQuery.mock.calls.map(
      ([, params]) => (params as { ownerEmails: string[] }).ownerEmails.length,
    );
    expect(sizes.sort((a, b) => a - b)).toEqual([5, 100, 100]);
    expect(readable(at(cells(at(rows(), 204)), 2))).toBe("User 204");
  });

  it("keeps the actions menu out of the date's cell and out of absolute positioning", async () => {
    await render();
    const first = at(rows(), 0);
    const menu = first.querySelector<HTMLElement>(
      'button[aria-label="Actions for Revenue by channel"]',
    );
    expect(menu).not.toBeNull();
    const date = at(cells(first), 1);
    expect(date.contains(menu)).toBe(false);
    expect(menu?.closest('[role="cell"]')).toBe(at(cells(first), 0));
    const reveal = menu?.parentElement?.className ?? "";
    expect(reveal).toMatch(/\bml-auto\b/);
    expect(reveal).toMatch(/\bopacity-0\b/);
    expect(reveal).toMatch(/group-hover\/row:opacity-100/);
    expect(reveal).toMatch(/focus-within:opacity-100/);
    expect(reveal).toMatch(/has-\[\[data-state=open\]\]:opacity-100/);
    for (
      let el: HTMLElement | null = menu;
      el && el !== first;
      el = el.parentElement
    )
      expect(el.className).not.toMatch(/\babsolute\b/);
  });

  it("shows relative time under a week and the short date after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-08T10:11:00.000Z"));
      mocks.threads = [
        row("t1", "Eleven minutes", "ada@example.test"),
        {
          ...row("t2", "Three hours", "ada@example.test"),
          updatedAt: Date.parse("2026-11-08T07:11:00.000Z"),
        },
        {
          ...row("t3", "Three days", "ada@example.test"),
          updatedAt: Date.parse("2026-11-05T10:11:00.000Z"),
        },
        {
          ...row("t4", "Ten days", "ada@example.test"),
          updatedAt: Date.parse("2026-10-29T10:11:00.000Z"),
        },
      ];
      await render();
      expect(rows().map((r) => readable(at(cells(r), 1)))).toEqual([
        "11 min ago",
        "3 hrs ago",
        "3 days ago",
        "Oct 29, 2026",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still gives a shared row no actions menu", async () => {
    await render();
    expect(
      host.querySelector('button[aria-label="Actions for Churn drivers"]'),
    ).toBeNull();
  });

  it("uses the source fallback for someone outside the workspace", async () => {
    mocks.creators = {
      data: {
        creators: [
          { email: "ada@example.test", name: "Ada Lovelace", imageUrl: null },
        ],
      },
    };
    await render();
    const grace = at(cells(at(rows(), 1)), 2);
    expect(readable(grace)).toBe("Workspace User");
  });

  it("falls back to the member's email only when they have no name", async () => {
    mocks.creators = {
      data: {
        creators: [
          { email: "ada@example.test", name: null, imageUrl: null },
          { email: "grace@example.test", name: "Grace Hopper", imageUrl: null },
        ],
      },
    };
    await render();
    expect(readable(at(cells(at(rows(), 0)), 2))).toBe("ada@example.test");
  });

  it("says so when creators could not be read instead of showing blanks", async () => {
    mocks.creators = { error: new Error("boom") };
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not load this list.",
    );
    expect(readable(at(cells(at(rows(), 0)), 2))).toBe("");
  });
});
