// @vitest-environment happy-dom

import type {
  ChatThreadListRow,
  ChatThreadSummary,
} from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { Activity, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OwnershipChatHistoryRail,
  chatThreadToHistoryItem,
  ownDraftRows,
  useOwnershipChatHistory,
  type UseOwnershipChatHistoryOptions,
  type UseOwnershipChatHistoryResult,
} from "./index.js";

function row(
  id: string,
  overrides: Partial<ChatThreadListRow> = {},
): ChatThreadListRow {
  return {
    id,
    title: id,
    preview: "",
    messageCount: 1,
    createdAt: 1,
    updatedAt: 1,
    scope: null,
    ownerEmail: "owner@example.com",
    accessBasis: "owner",
    visibility: "private",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const t = (key: string, options?: Record<string, unknown>) =>
  `${key}${options?.name ? `:${options.name}` : ""}`;

describe("ownership history row boundary", () => {
  it("opts proven active blank owners and new local rows in without relaxing ownership", () => {
    const local = (id: string): ChatThreadSummary => ({
      id,
      title: "",
      preview: "",
      messageCount: 0,
      createdAt: 1,
      updatedAt: 1,
      scope: null,
    });
    const threads = [
      row("owner", { messageCount: 0 }),
      row("owner-org", { messageCount: 0, visibility: "org" }),
      local("new-local"),
      local("unproven"),
      { ...local("partial"), ownerEmail: "owner@example.com" },
      row("archived", { messageCount: 0, archivedAt: 4 }),
      row("direct", { messageCount: 0, accessBasis: "direct" }),
      row("organization", { messageCount: 0, accessBasis: "organization" }),
    ];
    const options = {
      threads,
      isNewThread: (id: string) => id === "new-local" || id === "partial",
    };
    expect(ownDraftRows(options)).toEqual([]);
    for (const activeId of ["owner", "owner-org", "new-local"]) {
      expect(
        ownDraftRows({ ...options, activeId }).map((row) => row.id),
      ).toEqual([activeId]);
    }
    for (const activeId of [
      "unproven",
      "partial",
      "archived",
      "direct",
      "organization",
      "absent",
    ]) {
      expect(ownDraftRows({ ...options, activeId })).toEqual([]);
    }
    expect(
      ownDraftRows({
        threads: [],
        isNewThread: () => true,
        activeId: "absent-new",
      }),
    ).toEqual([]);
  });
  it("maps owner organization visibility as Mine without attribution", () => {
    const item = chatThreadToHistoryItem(
      row("mine", { visibility: "org", pinnedAt: 2 }),
      { t, activeId: "mine" },
    );
    expect(item).toMatchObject({
      id: "mine",
      accessBasis: "owner",
      pinned: true,
    });
    expect(item.ownerLabel).toBeUndefined();
    expect(item.accessLabel).toBeUndefined();
    expect(item.timestamp).toBeUndefined();
  });

  it.each(["direct", "organization"] as const)(
    "attributes %s rows, dropping inherited pins and actions",
    (accessBasis) => {
      const item = chatThreadToHistoryItem(
        row("shared", { accessBasis, pinnedAt: 20 }),
        { t, now: 60_001 },
      );
      expect(item).toMatchObject({
        title: "shared",
        pinned: false,
        hideActions: true,
        accessBasis,
        ownerLabel: "agentChat.history.ownedBy:owner@example.com",
        accessLabel:
          accessBasis === "direct"
            ? "agentChat.history.accessDirect"
            : "agentChat.history.accessOrganization",
      });
      expect(item.timestamp).toBe(
        new Intl.RelativeTimeFormat("en-US", {
          style: "narrow",
          numeric: "auto",
        }).format(-1, "minute"),
      );
    },
  );

  it("falls back from title to preview to localized untitled copy", () => {
    expect(
      chatThreadToHistoryItem(row("a", { title: "", preview: "Preview" }), {
        t,
      }).titleText,
    ).toBe("Preview");
    expect(
      chatThreadToHistoryItem(row("a", { title: "" }), { t }).titleText,
    ).toBe("agentChat.history.untitledChat");
  });

  it("admits only started owned drafts, including observed local starts", () => {
    const local = (
      id: string,
      overrides: Partial<ChatThreadSummary> = {},
    ): ChatThreadSummary => ({
      id,
      title: "",
      preview: "",
      messageCount: 0,
      createdAt: 1,
      updatedAt: 1,
      scope: null,
      ...overrides,
    });
    const threads = [
      local("untouched"),
      local("started", { messageCount: 1 }),
      local("observed"),
      local("unproven", { messageCount: 2 }),
      local("partial", { messageCount: 1, ownerEmail: "owner@example.com" }),
      row("confirmed"),
      row("archived", { archivedAt: 4 }),
      row("direct", { accessBasis: "direct" }),
      row("organization", { accessBasis: "organization" }),
    ];
    const result = ownDraftRows({
      threads,
      isNewThread: (id) =>
        ["untouched", "started", "observed", "partial", "synthesized"].includes(
          id,
        ),
      observedThreadStarts: new Map([
        ["observed", 3],
        ["synthesized", 5],
        ["stranger", 6],
        ["direct", 7],
        ["archived", 8],
      ]),
    });
    expect(result.map((item) => item.id)).toEqual([
      "started",
      "observed",
      "confirmed",
      "synthesized",
    ]);
    expect(result.at(-1)).toEqual({
      id: "synthesized",
      title: "",
      messageCount: 0,
      createdAt: 5,
      updatedAt: 5,
    });
    expect(result.every((item) => !("accessBasis" in item))).toBe(true);
  });
});

describe("ownership history adapter", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: UseOwnershipChatHistoryResult;
  let mine: ChatThreadListRow[];
  let shared: ChatThreadListRow[];
  let fetchMock: ReturnType<typeof vi.fn>;
  let failMine: boolean;
  let failShared: boolean;
  let renderRail: boolean;
  const selected = vi.fn();
  const newChat = vi.fn();

  function pageResponse(urlValue: unknown): Response {
    const url = new URL(String(urlValue), "http://test.local");
    const ownership = url.searchParams.get("ownership");
    if (
      (ownership === "mine" && failMine) ||
      (ownership === "shared" && failShared)
    )
      return new Response("unavailable", { status: 503 });
    const source = ownership === "mine" ? mine : shared;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit"));
    return Response.json({
      threads: source.slice(offset, offset + limit),
      hasMore: source.length > offset + limit,
    });
  }

  function Probe(props: UseOwnershipChatHistoryOptions) {
    latest = useOwnershipChatHistory(props);
    return renderRail ? (
      <OwnershipChatHistoryRail
        {...latest}
        activeId={props.activeId}
        onSelect={selected}
        onNewChat={newChat}
        showNewChat={false}
      />
    ) : null;
  }

  async function render(options: UseOwnershipChatHistoryOptions = {}) {
    await act(async () => {
      root.render(<Probe {...options} />);
    });
  }

  async function renderActivity(
    options: UseOwnershipChatHistoryOptions,
    mode: "visible" | "hidden",
  ) {
    await act(async () => {
      root.render(
        <Activity mode={mode}>
          <Probe {...options} />
        </Activity>,
      );
    });
  }

  function section(id: string) {
    return latest.sections.find((section) => section.id === id)!;
  }
  function item(id: string) {
    return latest.sections
      .flatMap((section) => section.items)
      .find((item) => item.id === id);
  }
  function sectionElement(id: string) {
    return container.querySelector(
      `[data-section-id="${id}"].an-chat-history__section`,
    )!;
  }
  function clickText(element: Element, text: string) {
    const button = [...element.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === text,
    );
    expect(button).toBeDefined();
    return act(async () => {
      button!.click();
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mine = [];
    shared = [];
    failMine = false;
    failShared = false;
    renderRail = false;
    fetchMock = vi.fn(async (url) => pageResponse(url));
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    selected.mockClear();
    newChat.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("forwards two ownership queries before independent pagination and preserves attribution", async () => {
    mine = [row("mine-org", { visibility: "org" }), row("mine-second")];
    shared = [
      row("direct", { accessBasis: "direct", pinnedAt: 12 }),
      row("shared-second", { accessBasis: "organization" }),
    ];
    await render({
      apiUrl: "/test-chat",
      pageSize: 1,
      query: "term",
      scope: { type: "project", id: "p" },
      includeExternal: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [urlValue] of fetchMock.mock.calls) {
      const url = new URL(String(urlValue), "http://test.local");
      expect(url.pathname).toBe("/test-chat/threads");
      expect(url.searchParams.get("q")).toBe("term");
      expect(url.searchParams.get("includeExternal")).toBe("1");
      expect(url.searchParams.get("scopeId")).toBe("p");
    }
    expect(item("mine-org")?.ownerLabel).toBeUndefined();
    expect(item("direct")).toMatchObject({
      pinned: false,
      hideActions: true,
      ownerLabel: "Owner: owner@example.com",
      accessLabel: "Shared with you",
    });
    await act(async () => {
      await section("shared").onLoadMore!();
    });
    expect(latest.sharedRows.map((row) => row.id)).toEqual([
      "direct",
      "shared-second",
    ]);
    expect(latest.mineRows.map((row) => row.id)).toEqual(["mine-org"]);
    await act(async () => {
      await section("mine").onLoadMore!();
    });
    expect(latest.mineRows.map((row) => row.id)).toEqual([
      "mine-org",
      "mine-second",
    ]);
  });

  it("previews five Shared rows, discloses all loaded pages, and collapses back to five", async () => {
    renderRail = true;
    shared = Array.from({ length: 14 }, (_, i) =>
      row(`shared-${i}`, { accessBasis: "direct" }),
    );
    await render({ pageSize: 7, activeId: "shared-12" });
    expect(
      sectionElement("shared").querySelectorAll(".an-chat-history-row"),
    ).toHaveLength(5);
    expect(
      container.querySelectorAll(".an-chat-history-row--active"),
    ).toHaveLength(0);
    await clickText(sectionElement("shared"), "Show all");
    expect(
      sectionElement("shared").querySelectorAll(".an-chat-history-row"),
    ).toHaveLength(7);
    await clickText(sectionElement("shared"), "Load more");
    expect(
      sectionElement("shared").querySelectorAll(".an-chat-history-row"),
    ).toHaveLength(14);
    expect(
      container.querySelectorAll(".an-chat-history-row--active"),
    ).toHaveLength(1);
    await act(async () => {
      sectionElement("shared")
        .querySelectorAll<HTMLButtonElement>(".an-chat-history-row__button")[12]
        .click();
    });
    expect(selected).toHaveBeenCalledWith("shared-12");
    await act(async () => {
      await latest.refresh();
    });
    expect(
      sectionElement("shared").querySelectorAll(".an-chat-history-row"),
    ).toHaveLength(14);
    await clickText(sectionElement("shared"), "Show less");
    expect(
      sectionElement("shared").querySelectorAll(".an-chat-history-row"),
    ).toHaveLength(5);
    expect(newChat).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.every(([url]) => String(url).includes("/threads?")),
    ).toBe(true);
  });

  it("keeps paging reachable when every loaded Mine row is pinned", async () => {
    renderRail = true;
    mine = Array.from({ length: 8 }, (_, i) =>
      row(`pin-${i}`, { pinnedAt: i + 1 }),
    );
    await render({ pageSize: 3, pinned: true });
    expect(section("mine").items).toEqual([]);
    expect(section("mine").emptyLabel).toBeUndefined();
    expect(
      sectionElement("pinned").querySelectorAll(".an-chat-history-row"),
    ).toHaveLength(3);
    await clickText(sectionElement("mine"), "Show all");
    await clickText(sectionElement("mine"), "Load more");
    expect(
      sectionElement("pinned").querySelectorAll(".an-chat-history-row"),
    ).toHaveLength(6);
    await clickText(sectionElement("mine"), "Load more");
    expect(
      sectionElement("pinned").querySelectorAll(".an-chat-history-row"),
    ).toHaveLength(8);
    expect(sectionElement("pinned").textContent).not.toContain("Show all");
    expect(section("pinned").onLoadMore).toBeUndefined();
  });

  it("lets server rows win draft duplicates and never manufactures active shared rows", async () => {
    mine = [row("owned", { title: "Server title", pinnedAt: 1 })];
    shared = [row("shared", { accessBasis: "direct" })];
    const drafts = ownDraftRows({
      threads: [row("owned"), row("shared"), row("local")],
      isNewThread: () => true,
    });
    await render({
      localMineRows: drafts,
      pinned: true,
      activeId: "unloaded-shared",
    });
    expect(section("mine").items.map((item) => item.id)).toEqual(["local"]);
    expect(item("owned")?.title).toBe("Server title");
    expect(item("shared")?.hideActions).toBe(true);
    expect(item("unloaded-shared")).toBeUndefined();
    expect(latest.findMine("shared")).toBeUndefined();
  });

  it.each(["server", "draft"] as const)(
    "decorates the effective %s rename title while pending and restores it on rollback",
    async (source) => {
      renderRail = true;
      const original = row("owned", { title: "Original", pinnedAt: 2 });
      mine = source === "server" ? [original] : [];
      const localMineRows =
        source === "draft"
          ? ownDraftRows({ threads: [original], isNewThread: () => false })
          : [];
      const pending = deferred<boolean>();
      const decorateItem = vi.fn((item, effectiveRow) => ({
        ...item,
        title: (
          <span data-testid="decorated-title">
            {effectiveRow.title || effectiveRow.preview}
          </span>
        ),
        titleText: effectiveRow.title || effectiveRow.preview,
      }));
      await render({
        pinned: true,
        localMineRows,
        decorateItem,
        mutations: { rename: () => pending.promise },
      });
      let result!: Promise<boolean>;
      act(() => {
        result = latest.listProps.onRename!("owned", "Optimistic");
      });
      expect(
        container.querySelector('[data-testid="decorated-title"]')?.textContent,
      ).toBe("Optimistic");
      expect(item("owned")?.titleText).toBe("Optimistic");
      expect(decorateItem.mock.lastCall?.[1].title).toBe("Optimistic");
      expect(original.title).toBe("Original");
      await act(async () => {
        pending.resolve(false);
        expect(await result).toBe(false);
      });
      expect(
        container.querySelector('[data-testid="decorated-title"]')?.textContent,
      ).toBe("Original");
      expect(item("owned")?.titleText).toBe("Original");
    },
  );

  it.each([
    {
      input: " \t Quarterly\n  Roadmap \r\n ",
      expected: "Quarterly Roadmap",
      label: "whitespace",
    },
    {
      input: `  ${"A".repeat(158)}\t \n B overflow  `,
      expected: `${"A".repeat(158)} B`,
      label: "160 characters",
    },
  ])(
    "normalized rename: $label agrees across pending decoration, callback, datastore and fresh read",
    async ({ input, expected }) => {
      renderRail = true;
      mine = [row("owned", { title: "Original" })];
      const transport = deferred<void>();
      const rename = vi.fn(async (_id: string, title: string) => {
        await transport.promise;
        mine = [row("owned", { title })];
        return true;
      });
      const onMutationFailed = vi.fn();
      const options: UseOwnershipChatHistoryOptions = {
        mutations: { rename },
        onMutationFailed,
        decorateItem: (item, effectiveRow) => ({
          ...item,
          title: (
            <span data-testid="normalized-title">{effectiveRow.title}</span>
          ),
          titleText: effectiveRow.title,
        }),
      };
      await render(options);
      let result!: Promise<boolean>;
      act(() => {
        result = latest.listProps.onRename!("owned", input);
      });
      try {
        expect(item("owned")?.titleText).toBe(expected);
        expect(
          container.querySelector('[data-testid="normalized-title"]')
            ?.textContent,
        ).toBe(expected);
        expect(rename).toHaveBeenCalledExactlyOnceWith("owned", expected);
        expect(mine[0].title).toBe("Original");
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        await act(async () => {
          transport.resolve();
          expect(await result).toBe(true);
        });
      }
      expect(mine[0].title).toBe(expected);
      expect(latest.mineRows).toEqual(mine);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      await act(async () => {
        root.render(null);
      });
      await render(options);
      expect(item("owned")?.titleText).toBe(expected);
      expect(latest.mineRows[0].title).toBe(expected);
      expect(onMutationFailed).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(6);
    },
  );

  it.each(["false", "throw"] as const)(
    "normalized rename: %s rolls back the displayed value without changing persisted data",
    async (failure) => {
      mine = [row("owned", { title: "Original" })];
      const pending = deferred<boolean>();
      const rename = vi.fn(() => pending.promise);
      const onMutationFailed = vi.fn();
      await render({ mutations: { rename }, onMutationFailed });
      let result!: Promise<boolean>;
      act(() => {
        result = latest.listProps.onRename!("owned", " \t Unsaved\n  title  ");
      });
      const cause = new Error("Rename failed");
      try {
        expect(item("owned")?.titleText).toBe("Unsaved title");
        expect(rename).toHaveBeenCalledExactlyOnceWith(
          "owned",
          "Unsaved title",
        );
      } finally {
        await act(async () => {
          if (failure === "throw") pending.reject(cause);
          else pending.resolve(false);
          expect(await result).toBe(false);
        });
      }
      expect(item("owned")?.titleText).toBe("Original");
      expect(mine[0].title).toBe("Original");
      expect(latest.mineRows).toEqual(mine);
      expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(
        "rename",
        "owned",
        ...(failure === "throw" ? [cause] : []),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("normalized rename: empty input retains the persistence callback's failure disposition", async () => {
    mine = [row("owned", { title: "Original" })];
    const rename = vi.fn(async () => false);
    const onMutationFailed = vi.fn();
    await render({ mutations: { rename }, onMutationFailed });
    await act(async () => {
      expect(await latest.listProps.onRename!("owned", " \t\n ")).toBe(false);
    });
    expect(rename).toHaveBeenCalledExactlyOnceWith("owned", "");
    expect(item("owned")?.titleText).toBe("Original");
    expect(mine[0].title).toBe("Original");
    expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith("rename", "owned");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains the decorated rename after persistence when authoritative refresh fails", async () => {
    renderRail = true;
    mine = [row("owned", { title: "Original" })];
    const pending = deferred<boolean>();
    await render({
      mutations: { rename: () => pending.promise },
      decorateItem: (item, effectiveRow) => ({
        ...item,
        title: <span data-testid="decorated-title">{effectiveRow.title}</span>,
        titleText: effectiveRow.title,
      }),
    });
    let result!: Promise<boolean>;
    act(() => {
      result = latest.listProps.onRename!("owned", "Persisted title");
    });
    expect(
      container.querySelector('[data-testid="decorated-title"]')?.textContent,
    ).toBe("Persisted title");
    failMine = true;
    await act(async () => {
      pending.resolve(true);
      expect(await result).toBe(true);
    });
    expect(latest.error?.message).toContain("503");
    expect(
      container.querySelector('[data-testid="decorated-title"]')?.textContent,
    ).toBe("Persisted title");
    expect(latest.mineRows[0].title).toBe("Original");
  });

  it("filters local title/preview search case-sensitively without filtering server transcript matches", async () => {
    mine = [row("server-body-match", { title: "Summary without the term" })];
    shared = [row("shared", { title: "Plan shared", accessBasis: "direct" })];
    const localMineRows = ownDraftRows({
      threads: [
        row("title", { title: "Quarterly Plan" }),
        row("preview", { title: "Notes", preview: "The Plan begins" }),
        row("case-mismatch", { title: "Quarterly plan", preview: "planning" }),
        row("unrelated", { title: "Unrelated" }),
        row("server-body-match", { title: "Plan stale local title" }),
        row("shared", { title: "Plan shared", accessBasis: "direct" }),
      ],
      isNewThread: () => false,
    });
    await render({ query: "  Plan  ", localMineRows });
    expect(section("mine").items.map((item) => item.id)).toEqual([
      "title",
      "preview",
      "server-body-match",
    ]);
    expect(item("server-body-match")?.titleText).toBe(
      "Summary without the term",
    );
    expect(latest.findMine("unrelated")?.id).toBe("unrelated");
    expect(latest.findMine("shared")).toBeUndefined();
    expect(section("shared").items.map((item) => item.id)).toEqual(["shared"]);
    expect(
      fetchMock.mock.calls.every(
        ([url]) =>
          new URL(String(url), "http://test.local").searchParams.get("q") ===
          "Plan",
      ),
    ).toBe(true);

    mine = [];
    shared = [];
    await render({ query: "plan", localMineRows });
    expect(section("mine").items.map((item) => item.id)).toEqual([
      "case-mismatch",
    ]);
    await render({ query: "   ", localMineRows });
    expect(section("mine").items.map((item) => item.id)).toEqual([
      "title",
      "preview",
      "case-mismatch",
      "unrelated",
      "server-body-match",
    ]);
  });

  it("treats percent, underscore, and escape-looking search text literally in each local field", async () => {
    const localMineRows = ownDraftRows({
      threads: [
        row("literal-title", { title: "Status 100%_! complete" }),
        row("literal-preview", { title: "Status", preview: "100%_! complete" }),
        row("wildcard-lookalike", { title: "Status 100abcZ! complete" }),
        row("split-fields", { title: "100%", preview: "_!" }),
      ],
      isNewThread: () => false,
    });
    await render({ query: "  100%_!  ", localMineRows });
    expect(section("mine").items.map((item) => item.id)).toEqual([
      "literal-title",
      "literal-preview",
    ]);
  });

  it("keeps unfiltered owned draft lookup for another intent after a pending rename stops matching search", async () => {
    const localMineRows = ownDraftRows({
      threads: [row("local", { title: "Plan" })],
      isNewThread: () => false,
    });
    const pendingRename = deferred<boolean>();
    const pendingArchive = deferred<boolean>();
    const archive = vi.fn(() => pendingArchive.promise);
    await render({
      query: "Plan",
      localMineRows,
      mutations: { rename: () => pendingRename.promise, archive },
    });
    let renameResult!: Promise<boolean>;
    let archiveResult!: Promise<boolean>;
    act(() => {
      renameResult = latest.listProps.onRename!("local", "Other");
    });
    expect(item("local")).toBeUndefined();
    expect(latest.findMine("local")?.id).toBe("local");
    act(() => {
      archiveResult = latest.listProps.onDelete!("local");
    });
    expect(archive).toHaveBeenCalledWith("local");
    await act(async () => {
      pendingRename.resolve(false);
      expect(await renameResult).toBe(false);
    });
    expect(item("local")).toBeUndefined();
    await act(async () => {
      pendingArchive.resolve(false);
      expect(await archiveResult).toBe(false);
    });
    expect(item("local")?.titleText).toBe("Plan");
  });

  it("moves optimistic pins, retitles, and archives, then reconciles successful persistence", async () => {
    mine = [row("owned")];
    const pendingPin = deferred<boolean>();
    const pin = vi.fn(() => pendingPin.promise);
    const rename = vi.fn(async (_id, title) => {
      mine = [row("owned", { title, pinnedAt: 2 })];
      return true;
    });
    const archive = vi.fn(async () => {
      mine = [];
      return true;
    });
    await render({ pinned: true, mutations: { pin, rename, archive } });
    let pinResult!: Promise<boolean>;
    act(() => {
      pinResult = latest.listProps.onTogglePin!("owned");
    });
    expect(section("pinned").items[0].id).toBe("owned");
    expect(pin).toHaveBeenCalledWith("owned", true);
    mine = [row("owned", { pinnedAt: 2 })];
    await act(async () => {
      pendingPin.resolve(true);
      expect(await pinResult).toBe(true);
    });
    await act(async () => {
      expect(await latest.listProps.onRename!("owned", "New title")).toBe(true);
    });
    expect(item("owned")?.title).toBe("New title");
    await act(async () => {
      expect(await latest.listProps.onDelete!("owned")).toBe(true);
    });
    expect(item("owned")).toBeUndefined();
    expect(latest.mineRows).toEqual([]);
  });

  it.each(["false", "throw"])(
    "rolls back %s mutations and reports failure",
    async (failure) => {
      mine = [row("owned")];
      const pending = deferred<boolean>();
      const onMutationFailed = vi.fn();
      const rename = vi.fn(() => pending.promise);
      await render({ mutations: { rename }, onMutationFailed });
      let result!: Promise<boolean>;
      act(() => {
        result = latest.listProps.onRename!("owned", "Optimistic");
      });
      expect(item("owned")?.title).toBe("Optimistic");
      const cause = new Error("Could not persist");
      await act(async () => {
        if (failure === "throw") pending.reject(cause);
        else pending.resolve(false);
        expect(await result).toBe(false);
      });
      expect(item("owned")?.title).toBe("owned");
      expect(onMutationFailed).toHaveBeenCalledWith(
        "rename",
        "owned",
        ...(failure === "throw" ? [cause] : []),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it.each(
    (["pin", "rename"] as const).flatMap((olderKind) =>
      (["false", "throw"] as const).flatMap((failure) =>
        (["pending", "persisted-refresh-error"] as const).map((laterState) => ({
          olderKind,
          failure,
          laterState,
        })),
      ),
    ),
  )(
    "independent fields: older $olderKind $failure with later $laterState rolls back only the failed field",
    async ({ olderKind, failure, laterState }) => {
      mine = [row("owned", { title: "Original" })];
      const pin = deferred<boolean>();
      const rename = deferred<boolean>();
      const older = olderKind === "pin" ? pin : rename;
      const later = olderKind === "pin" ? rename : pin;
      const onMutationFailed = vi.fn();
      await render({
        pinned: true,
        mutations: { pin: () => pin.promise, rename: () => rename.promise },
        onMutationFailed,
      });
      const start = (kind: "pin" | "rename") =>
        kind === "pin"
          ? latest.listProps.onTogglePin!("owned")
          : latest.listProps.onRename!("owned", "Renamed");
      let olderResult!: Promise<boolean>;
      let laterResult!: Promise<boolean>;
      act(() => {
        olderResult = start(olderKind);
      });
      act(() => {
        laterResult = start(olderKind === "pin" ? "rename" : "pin");
      });
      expect(item("owned")).toMatchObject({
        titleText: "Renamed",
        pinned: true,
      });
      const finishLater = async () => {
        mine = [
          row("owned", {
            title: olderKind === "pin" ? "Renamed" : "Original",
            pinnedAt: olderKind === "rename" ? 2 : null,
          }),
        ];
        failMine = true;
        await act(async () => {
          later.resolve(true);
          expect(await laterResult).toBe(true);
        });
        expect(latest.error?.message).toContain("503");
      };
      if (laterState === "persisted-refresh-error") await finishLater();
      const requestsBeforeFailure = fetchMock.mock.calls.length;
      const cause = new Error("Older field failed");
      await act(async () => {
        if (failure === "throw") older.reject(cause);
        else older.resolve(false);
        expect(await olderResult).toBe(false);
      });
      expect(item("owned")).toMatchObject({
        titleText: olderKind === "pin" ? "Renamed" : "Original",
        pinned: olderKind === "rename",
      });
      expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(
        olderKind,
        "owned",
        ...(failure === "throw" ? [cause] : []),
      );
      expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeFailure);
      if (laterState === "pending") await finishLater();
      expect(item("owned")).toMatchObject({
        titleText: olderKind === "pin" ? "Renamed" : "Original",
        pinned: olderKind === "rename",
      });
      expect(onMutationFailed).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    },
  );

  it.each(["pin", "rename"] as const)(
    "independent fields: a later failure preserves the earlier pending %s intent",
    async (olderKind) => {
      mine = [row("owned", { title: "Original" })];
      const pin = deferred<boolean>();
      const rename = deferred<boolean>();
      const older = olderKind === "pin" ? pin : rename;
      const later = olderKind === "pin" ? rename : pin;
      const onMutationFailed = vi.fn();
      await render({
        pinned: true,
        mutations: { pin: () => pin.promise, rename: () => rename.promise },
        onMutationFailed,
      });
      const start = (kind: "pin" | "rename") =>
        kind === "pin"
          ? latest.listProps.onTogglePin!("owned")
          : latest.listProps.onRename!("owned", "Renamed");
      let olderResult!: Promise<boolean>;
      let laterResult!: Promise<boolean>;
      act(() => {
        olderResult = start(olderKind);
      });
      act(() => {
        laterResult = start(olderKind === "pin" ? "rename" : "pin");
      });
      await act(async () => {
        later.resolve(false);
        expect(await laterResult).toBe(false);
      });
      expect(item("owned")).toMatchObject({
        titleText: olderKind === "rename" ? "Renamed" : "Original",
        pinned: olderKind === "pin",
      });
      expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(
        olderKind === "pin" ? "rename" : "pin",
        "owned",
      );
      mine = [
        row("owned", {
          title: olderKind === "rename" ? "Renamed" : "Original",
          pinnedAt: olderKind === "pin" ? 2 : null,
        }),
      ];
      await act(async () => {
        older.resolve(true);
        expect(await olderResult).toBe(true);
      });
      expect(item("owned")).toMatchObject({
        titleText: olderKind === "rename" ? "Renamed" : "Original",
        pinned: olderKind === "pin",
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    },
  );

  it.each(["pin", "rename"] as const)(
    "independent fields: an authoritative %s refresh keeps the other field pending",
    async (olderKind) => {
      mine = [row("owned", { title: "Original" })];
      const pin = deferred<boolean>();
      const rename = deferred<boolean>();
      const older = olderKind === "pin" ? pin : rename;
      const later = olderKind === "pin" ? rename : pin;
      const onMutationFailed = vi.fn();
      await render({
        pinned: true,
        mutations: { pin: () => pin.promise, rename: () => rename.promise },
        onMutationFailed,
      });
      const start = (kind: "pin" | "rename") =>
        kind === "pin"
          ? latest.listProps.onTogglePin!("owned")
          : latest.listProps.onRename!("owned", "Renamed");
      let olderResult!: Promise<boolean>;
      let laterResult!: Promise<boolean>;
      act(() => {
        olderResult = start(olderKind);
      });
      act(() => {
        laterResult = start(olderKind === "pin" ? "rename" : "pin");
      });
      mine = [
        row("owned", {
          title: olderKind === "rename" ? "Renamed" : "Original",
          pinnedAt: olderKind === "pin" ? 2 : null,
        }),
      ];
      await act(async () => {
        older.resolve(true);
        expect(await olderResult).toBe(true);
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(item("owned")).toMatchObject({
        titleText: "Renamed",
        pinned: true,
      });
      expect(latest.mineRows[0]).toMatchObject({
        title: olderKind === "rename" ? "Renamed" : "Original",
        pinnedAt: olderKind === "pin" ? 2 : null,
      });
      await act(async () => {
        later.resolve(false);
        expect(await laterResult).toBe(false);
      });
      expect(item("owned")).toMatchObject({
        titleText: olderKind === "rename" ? "Renamed" : "Original",
        pinned: olderKind === "pin",
      });
      expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(
        olderKind === "pin" ? "rename" : "pin",
        "owned",
      );
      expect(fetchMock).toHaveBeenCalledTimes(4);
    },
  );

  it("independent fields: a failed archive restores the other pending rename", async () => {
    mine = [row("owned", { title: "Original" })];
    const archive = deferred<boolean>();
    const rename = deferred<boolean>();
    const onMutationFailed = vi.fn();
    await render({
      mutations: {
        archive: () => archive.promise,
        rename: () => rename.promise,
      },
      onMutationFailed,
    });
    let archiveResult!: Promise<boolean>;
    let renameResult!: Promise<boolean>;
    act(() => {
      archiveResult = latest.listProps.onDelete!("owned");
    });
    act(() => {
      renameResult = latest.listProps.onRename!("owned", "Renamed");
    });
    await act(async () => {
      archive.resolve(false);
      expect(await archiveResult).toBe(false);
    });
    expect(item("owned")?.titleText).toBe("Renamed");
    expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(
      "archive",
      "owned",
    );
    await act(async () => {
      rename.resolve(false);
      expect(await renameResult).toBe(false);
    });
    expect(item("owned")?.titleText).toBe("Original");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("independent fields: a successful rename refresh does not clear a pending archive", async () => {
    mine = [row("owned", { title: "Original" })];
    const archive = deferred<boolean>();
    const rename = deferred<boolean>();
    const onMutationFailed = vi.fn();
    await render({
      mutations: {
        archive: () => archive.promise,
        rename: () => rename.promise,
      },
      onMutationFailed,
    });
    let archiveResult!: Promise<boolean>;
    let renameResult!: Promise<boolean>;
    act(() => {
      archiveResult = latest.listProps.onDelete!("owned");
    });
    act(() => {
      renameResult = latest.listProps.onRename!("owned", "Renamed");
    });
    mine = [row("owned", { title: "Renamed" })];
    await act(async () => {
      rename.resolve(true);
      expect(await renameResult).toBe(true);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(item("owned")).toBeUndefined();
    await act(async () => {
      archive.resolve(false);
      expect(await archiveResult).toBe(false);
    });
    expect(item("owned")?.titleText).toBe("Renamed");
    expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(
      "archive",
      "owned",
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(
    (["rename", "pin", "archive"] as const).flatMap((kind) =>
      (["false", "throw"] as const).map((failure) => ({ kind, failure })),
    ),
  )(
    "persisted baseline: failed $kind retry ($failure) restores the prior successful value after refresh error",
    async ({ kind, failure }) => {
      mine = [row("owned", { title: "Original", pinnedAt: null })];
      const retry = deferred<boolean>();
      const mutation = vi
        .fn()
        .mockImplementationOnce(async () => {
          mine =
            kind === "archive"
              ? []
              : [
                  row("owned", {
                    title: kind === "rename" ? "Saved" : "Original",
                    pinnedAt: kind === "pin" ? 2 : null,
                  }),
                ];
          return true;
        })
        .mockReturnValueOnce(retry.promise);
      const onMutationFailed = vi.fn();
      await render({
        pinned: true,
        mutations: { rename: mutation, pin: mutation, archive: mutation },
        onMutationFailed,
      });
      const start = (title: string) =>
        kind === "rename"
          ? latest.listProps.onRename!("owned", title)
          : kind === "pin"
            ? latest.listProps.onTogglePin!("owned")
            : latest.listProps.onDelete!("owned");
      failMine = true;
      await act(async () => {
        expect(await start("Saved")).toBe(true);
      });
      expect(latest.error?.message).toContain("503");
      expect(latest.mineRows[0]).toMatchObject({
        title: "Original",
        pinnedAt: null,
      });
      let result!: Promise<boolean>;
      act(() => {
        result = start("Retry");
      });
      const cause = new Error("Retry failed");
      await act(async () => {
        if (failure === "throw") retry.reject(cause);
        else retry.resolve(false);
        expect(await result).toBe(false);
      });
      if (kind === "archive") {
        expect(item("owned")).toBeUndefined();
        expect(mine).toEqual([]);
      } else {
        expect(item("owned")).toMatchObject({
          titleText: kind === "rename" ? "Saved" : "Original",
          pinned: kind === "pin",
        });
        expect(mine[0]).toMatchObject({
          title: kind === "rename" ? "Saved" : "Original",
          pinnedAt: kind === "pin" ? 2 : null,
        });
      }
      expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(
        kind,
        "owned",
        ...(failure === "throw" ? [cause] : []),
      );
      expect(fetchMock).toHaveBeenCalledTimes(4);
      failMine = false;
      await act(async () => {
        await latest.refresh();
      });
      expect(latest.mineRows).toEqual(mine);
      expect(fetchMock).toHaveBeenCalledTimes(6);
    },
  );

  it.each(
    (["rename", "pin"] as const).flatMap((kind) =>
      (["older-success-first", "newer-failure-first"] as const).map(
        (completion) => ({ kind, completion }),
      ),
    ),
  )(
    "persisted baseline: $kind $completion retains the successful older write through refresh error and Retry",
    async ({ kind, completion }) => {
      mine = [row("owned", { title: "Original", pinnedAt: null })];
      const older = deferred<boolean>();
      const newer = deferred<boolean>();
      const mutation = vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);
      const onMutationFailed = vi.fn();
      await render({
        pinned: true,
        mutations: { rename: mutation, pin: mutation },
        onMutationFailed,
      });
      const start = (title: string) =>
        kind === "rename"
          ? latest.listProps.onRename!("owned", title)
          : latest.listProps.onTogglePin!("owned");
      let oldResult!: Promise<boolean>;
      let newResult!: Promise<boolean>;
      act(() => {
        oldResult = start("First");
      });
      act(() => {
        newResult = start("Second");
      });
      const cause = new Error("Newer failed");
      const failNewer = async () => {
        const requests = fetchMock.mock.calls.length;
        await act(async () => {
          if (kind === "pin") newer.reject(cause);
          else newer.resolve(false);
          expect(await newResult).toBe(false);
        });
        expect(fetchMock).toHaveBeenCalledTimes(requests);
      };
      if (completion === "newer-failure-first") newer.resolve(false);
      mine = [
        row("owned", {
          title: kind === "rename" ? "First" : "Original",
          pinnedAt: kind === "pin" ? 2 : null,
        }),
      ];
      failMine = true;
      await act(async () => {
        older.resolve(true);
        expect(await oldResult).toBe(true);
      });
      expect(latest.error?.message).toContain("503");
      if (completion === "older-success-first") {
        expect(item("owned")).toMatchObject({
          titleText: kind === "rename" ? "Second" : "Original",
          pinned: false,
        });
        await failNewer();
      } else {
        expect(await newResult).toBe(false);
      }
      expect(item("owned")).toMatchObject({
        titleText: kind === "rename" ? "First" : "Original",
        pinned: kind === "pin",
      });
      expect(mine[0]).toMatchObject({
        title: kind === "rename" ? "First" : "Original",
        pinnedAt: kind === "pin" ? 2 : null,
      });
      expect(latest.mineRows[0]).toMatchObject({
        title: "Original",
        pinnedAt: null,
      });
      expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(
        kind,
        "owned",
        ...(kind === "pin" && completion === "older-success-first"
          ? [cause]
          : []),
      );
      expect(fetchMock).toHaveBeenCalledTimes(4);
      failMine = false;
      await act(async () => {
        await latest.refresh();
      });
      expect(latest.mineRows).toEqual(mine);
      mine = [row("owned", { title: "External", pinnedAt: null })];
      await act(async () => {
        await latest.refresh();
      });
      expect(item("owned")).toMatchObject({
        titleText: "External",
        pinned: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(8);
    },
  );

  it.each(
    (["rename", "pin"] as const).flatMap((kind) =>
      (["pending", "confirmed"] as const).map((newerState) => ({
        kind,
        newerState,
      })),
    ),
  )(
    "persisted baseline: older $kind success cannot erase a newer $newerState intent",
    async ({ kind, newerState }) => {
      mine = [row("owned", { title: "Original", pinnedAt: null })];
      const older = deferred<boolean>();
      const newer = deferred<boolean>();
      const mutation = vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);
      const onMutationFailed = vi.fn();
      await render({
        pinned: true,
        mutations: { rename: mutation, pin: mutation },
        onMutationFailed,
      });
      const start = (title: string) =>
        kind === "rename"
          ? latest.listProps.onRename!("owned", title)
          : latest.listProps.onTogglePin!("owned");
      let oldResult!: Promise<boolean>;
      let newResult!: Promise<boolean>;
      act(() => {
        oldResult = start("First");
      });
      act(() => {
        newResult = start("Second");
      });
      const oldMineProof = deferred<Response>();
      const oldSharedProof = deferred<Response>();
      fetchMock
        .mockImplementationOnce(() => oldMineProof.promise)
        .mockImplementationOnce(() => oldSharedProof.promise);
      await act(async () => {
        older.resolve(true);
      });
      expect(mutation).toHaveBeenCalledTimes(2);
      failMine = true;
      if (newerState === "confirmed") {
        mine = [
          row("owned", {
            title: kind === "rename" ? "Second" : "Original",
            pinnedAt: null,
          }),
        ];
        await act(async () => {
          newer.resolve(true);
          expect(await newResult).toBe(true);
        });
      }
      await act(async () => {
        oldMineProof.resolve(
          Response.json({
            threads: [
              row("owned", {
                title: "Original",
                pinnedAt: kind === "pin" ? 2 : null,
              }),
            ],
            hasMore: false,
          }),
        );
        oldSharedProof.resolve(Response.json({ threads: [], hasMore: false }));
        expect(await oldResult).toBe(true);
      });
      expect(item("owned")).toMatchObject({
        titleText: kind === "rename" ? "Second" : "Original",
        pinned: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(
        newerState === "confirmed" ? 6 : 4,
      );
      if (newerState === "pending") {
        mine = [
          row("owned", {
            title: kind === "rename" ? "Second" : "Original",
            pinnedAt: null,
          }),
        ];
        await act(async () => {
          newer.resolve(true);
          expect(await newResult).toBe(true);
        });
      }
      expect(item("owned")).toMatchObject({
        titleText: kind === "rename" ? "Second" : "Original",
        pinned: false,
      });
      expect(onMutationFailed).not.toHaveBeenCalled();
      failMine = false;
      await act(async () => {
        await latest.refresh();
      });
      expect(latest.mineRows).toEqual(mine);
      expect(item("owned")).toMatchObject({
        titleText: mine[0].title,
        pinned: mine[0].pinnedAt != null,
      });
      expect(fetchMock).toHaveBeenCalledTimes(8);
    },
  );

  it("persisted baseline: a captured older refresh cannot clear a newer confirmed fallback", async () => {
    mine = [row("owned", { title: "Original" })];
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const third = deferred<boolean>();
    const rename = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const onMutationFailed = vi.fn();
    await render({ mutations: { rename }, onMutationFailed });
    const firstMineRefresh = deferred<Response>();
    const firstSharedRefresh = deferred<Response>();
    fetchMock
      .mockImplementationOnce(() => firstMineRefresh.promise)
      .mockImplementationOnce(() => firstSharedRefresh.promise);
    let firstResult!: Promise<boolean>;
    let secondResult!: Promise<boolean>;
    let thirdResult!: Promise<boolean>;
    act(() => {
      firstResult = latest.listProps.onRename!("owned", "First");
    });
    await act(async () => {
      first.resolve(true);
    });
    act(() => {
      secondResult = latest.listProps.onRename!("owned", "Second");
    });
    mine = [row("owned", { title: "Second" })];
    failMine = true;
    await act(async () => {
      second.resolve(true);
      expect(await secondResult).toBe(true);
    });
    await act(async () => {
      firstMineRefresh.resolve(
        Response.json({
          threads: [row("owned", { title: "First" })],
          hasMore: false,
        }),
      );
      firstSharedRefresh.resolve(
        Response.json({ threads: [], hasMore: false }),
      );
      expect(await firstResult).toBe(true);
    });
    expect(item("owned")?.titleText).toBe("Second");
    act(() => {
      thirdResult = latest.listProps.onRename!("owned", "Third");
    });
    await act(async () => {
      third.resolve(false);
      expect(await thirdResult).toBe(false);
    });
    expect(item("owned")?.titleText).toBe("Second");
    expect(latest.mineRows[0].title).toBe("Original");
    expect(mine[0].title).toBe("Second");
    expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith("rename", "owned");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    failMine = false;
    await act(async () => {
      await latest.refresh();
    });
    expect(latest.mineRows).toEqual(mine);
    mine = [row("owned", { title: "External" })];
    await act(async () => {
      await latest.refresh();
    });
    expect(item("owned")?.titleText).toBe("External");
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it.each(
    (["pin", "rename", "archive"] as const).flatMap((kind) =>
      (["false", "throw"] as const).map((failure) => ({ kind, failure })),
    ),
  )(
    "Activity lifetime: $kind $failure while hidden settles without an orphan or callback",
    async ({ kind, failure }) => {
      renderRail = true;
      mine = [row("owned", { title: "Original", pinnedAt: null })];
      const pending = deferred<boolean>();
      const onMutationFailed = vi.fn();
      const navigate = vi.fn();
      const consoleError = vi.spyOn(console, "error");
      const options = {
        pinned: true,
        mutations: {
          pin: () => pending.promise,
          rename: () => pending.promise,
          archive: () => pending.promise,
        },
        onMutationFailed,
      };
      await renderActivity(options, "visible");
      let result!: Promise<boolean>;
      act(() => {
        const mutation =
          kind === "pin"
            ? latest.listProps.onTogglePin!("owned")
            : kind === "rename"
              ? latest.listProps.onRename!("owned", "Optimistic")
              : latest.listProps.onDelete!("owned");
        result = mutation.then((succeeded) => {
          if (succeeded) navigate();
          return succeeded;
        });
      });
      await renderActivity(options, "hidden");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await act(async () => {
        if (failure === "throw") pending.reject(new Error("Hidden failure"));
        else pending.resolve(false);
        expect(await result).toBe(false);
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(
          new CustomEvent("agentNative.chatRunning", {
            detail: { isRunning: false },
          }),
        );
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(onMutationFailed).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      await renderActivity(options, "visible");
      expect(item("owned")).toMatchObject({
        titleText: "Original",
        pinned: false,
      });
      expect(latest.mineRows).toEqual(mine);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(onMutationFailed).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it.each(["pin", "rename", "archive"] as const)(
    "Activity lifetime: hidden successful %s survives reactivation refresh error and failed retry",
    async (kind) => {
      renderRail = true;
      mine = [row("owned", { title: "Original", pinnedAt: null })];
      const pending = deferred<boolean>();
      const retry = deferred<boolean>();
      const mutation = vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockReturnValueOnce(retry.promise);
      const onMutationFailed = vi.fn();
      const navigate = vi.fn();
      const consoleError = vi.spyOn(console, "error");
      const options = {
        pinned: true,
        mutations: { pin: mutation, rename: mutation, archive: mutation },
        onMutationFailed,
      };
      await renderActivity(options, "visible");
      const start = (title: string) =>
        kind === "pin"
          ? latest.listProps.onTogglePin!("owned")
          : kind === "rename"
            ? latest.listProps.onRename!("owned", title)
            : latest.listProps.onDelete!("owned");
      let result!: Promise<boolean>;
      act(() => {
        result = start("Saved").then((succeeded) => {
          if (succeeded) navigate();
          return succeeded;
        });
      });
      await renderActivity(options, "hidden");
      mine =
        kind === "archive"
          ? []
          : [
              row("owned", {
                title: kind === "rename" ? "Saved" : "Original",
                pinnedAt: kind === "pin" ? 2 : null,
              }),
            ];
      failMine = true;
      await act(async () => {
        pending.resolve(true);
        expect(await result).toBe(false);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(onMutationFailed).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      await renderActivity(options, "visible");
      expect(latest.error?.message).toContain("503");
      expect(fetchMock).toHaveBeenCalledTimes(6);
      let retryResult!: Promise<boolean>;
      act(() => {
        retryResult = start("Retry");
      });
      await act(async () => {
        retry.resolve(false);
        expect(await retryResult).toBe(false);
      });
      if (kind === "archive") expect(item("owned")).toBeUndefined();
      else
        expect(item("owned")).toMatchObject({
          titleText: kind === "rename" ? "Saved" : "Original",
          pinned: kind === "pin",
        });
      expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(kind, "owned");
      expect(navigate).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(6);
      failMine = false;
      await act(async () => {
        await latest.refresh();
      });
      expect(latest.mineRows).toEqual(mine);
      mine = [row("owned", { title: "External", pinnedAt: null })];
      await act(async () => {
        await latest.refresh();
      });
      expect(item("owned")).toMatchObject({
        titleText: "External",
        pinned: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(10);
    },
  );

  it("Activity lifetime: hidden old-scope completion cannot publish into the new scope", async () => {
    mine = [row("owned")];
    const pending = deferred<boolean>();
    const onMutationFailed = vi.fn();
    const consoleError = vi.spyOn(console, "error");
    const options = {
      scope: { type: "project", id: "old" },
      mutations: { rename: () => pending.promise },
      onMutationFailed,
    };
    await renderActivity(options, "visible");
    let result!: Promise<boolean>;
    act(() => {
      result = latest.listProps.onRename!("owned", "Old title");
    });
    await renderActivity(options, "hidden");
    const newOptions = {
      scope: { type: "project", id: "new" },
      onMutationFailed,
    };
    await renderActivity(newOptions, "hidden");
    await act(async () => {
      pending.resolve(true);
      expect(await result).toBe(false);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    mine = [row("current")];
    await renderActivity(newOptions, "visible");
    expect(latest.mineRows.map((row) => row.id)).toEqual(["current"]);
    expect(item("owned")).toBeUndefined();
    expect(onMutationFailed).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("Activity lifetime: an old captured refresh cannot regain navigation permission or clear a new intent", async () => {
    mine = [row("owned", { title: "Original" })];
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const rename = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onMutationFailed = vi.fn();
    const navigate = vi.fn();
    const consoleError = vi.spyOn(console, "error");
    const options = { mutations: { rename }, onMutationFailed };
    await renderActivity(options, "visible");
    const oldMineRefresh = deferred<Response>();
    const oldSharedRefresh = deferred<Response>();
    fetchMock
      .mockImplementationOnce(() => oldMineRefresh.promise)
      .mockImplementationOnce(() => oldSharedRefresh.promise);
    let firstResult!: Promise<boolean>;
    let secondResult!: Promise<boolean>;
    act(() => {
      firstResult = latest.listProps.onRename!("owned", "First").then(
        (succeeded) => {
          if (succeeded) navigate();
          return succeeded;
        },
      );
    });
    mine = [row("owned", { title: "First" })];
    await act(async () => {
      first.resolve(true);
    });
    await renderActivity(options, "hidden");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await renderActivity(options, "visible");
    act(() => {
      secondResult = latest.listProps.onRename!("owned", "Second");
    });
    await act(async () => {
      oldMineRefresh.resolve(
        Response.json({
          threads: [row("owned", { title: "First" })],
          hasMore: false,
        }),
      );
      oldSharedRefresh.resolve(Response.json({ threads: [], hasMore: false }));
      expect(await firstResult).toBe(false);
    });
    expect(item("owned")?.titleText).toBe("Second");
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => {
      second.resolve(false);
      expect(await secondResult).toBe(false);
    });
    expect(item("owned")?.titleText).toBe("First");
    expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith("rename", "owned");
    expect(consoleError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("Activity lifetime: true unmount settles successful physical work without publication or requests", async () => {
    mine = [row("owned")];
    const pending = deferred<boolean>();
    const onMutationFailed = vi.fn();
    const navigate = vi.fn();
    const consoleError = vi.spyOn(console, "error");
    await renderActivity(
      { mutations: { archive: () => pending.promise }, onMutationFailed },
      "visible",
    );
    const staleRefresh = latest.refresh;
    let result!: Promise<boolean>;
    act(() => {
      result = latest.listProps.onDelete!("owned").then((succeeded) => {
        if (succeeded) navigate();
        return succeeded;
      });
    });
    act(() => {
      root.render(null);
    });
    mine = [];
    await act(async () => {
      pending.resolve(true);
      expect(await result).toBe(false);
      await staleRefresh();
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false },
        }),
      );
    });
    expect(mine).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onMutationFailed).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each(
    (["rename", "pin", "archive"] as const).flatMap((kind) =>
      (["false", "throw"] as const).map((failure) => ({ kind, failure })),
    ),
  )(
    "eligible projection: $kind restores the older queued success after newer $failure",
    async ({ kind, failure }) => {
      mine = [row("owned", { title: "Original", pinnedAt: null })];
      const older = deferred<boolean>();
      const newer = deferred<boolean>();
      const mutation = vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);
      const onMutationFailed = vi.fn();
      await render({
        pinned: true,
        mutations: { rename: mutation, pin: mutation, archive: mutation },
        decorateItem: (item, row) => ({ ...item, titleText: row.title }),
        onMutationFailed,
      });
      const start = (title: string) =>
        kind === "rename"
          ? latest.listProps.onRename!("owned", title)
          : kind === "pin"
            ? latest.listProps.onTogglePin!("owned")
            : latest.listProps.onDelete!("owned");
      let oldResult!: Promise<boolean>;
      let newResult!: Promise<boolean>;
      act(() => {
        oldResult = start("First");
      });
      act(() => {
        newResult = start("Second");
      });
      expect(mutation).toHaveBeenCalledTimes(1);
      mine =
        kind === "archive"
          ? []
          : [
              row("owned", {
                title: kind === "rename" ? "First" : "Original",
                pinnedAt: kind === "pin" ? 2 : null,
              }),
            ];
      failMine = true;
      await act(async () => {
        older.resolve(true);
        expect(await oldResult).toBe(true);
      });
      const cause = new Error("Newer failed");
      await act(async () => {
        if (failure === "throw") newer.reject(cause);
        else newer.resolve(false);
        expect(await newResult).toBe(false);
      });
      if (kind === "archive") expect(item("owned")).toBeUndefined();
      else {
        expect(item("owned")).toMatchObject({
          titleText: kind === "rename" ? "First" : "Original",
          pinned: kind === "pin",
        });
        expect(section(kind === "pin" ? "pinned" : "mine").items[0].id).toBe(
          "owned",
        );
      }
      expect(latest.mineRows[0]).toMatchObject({
        title: "Original",
        pinnedAt: null,
      });
      expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(
        kind,
        "owned",
        ...(failure === "throw" ? [cause] : []),
      );
      expect(fetchMock).toHaveBeenCalledTimes(4);
      failMine = false;
      await act(async () => {
        await latest.refresh();
      });
      expect(latest.mineRows).toEqual(mine);
      expect(mutation).toHaveBeenCalledTimes(2);
      expect(onMutationFailed).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(6);
    },
  );

  it.each(["latest-ready-first", "head-first"] as const)(
    "eligible projection: three queued renames retain latest UI intent in %s order",
    async (completion) => {
      mine = [row("owned", { title: "Original" })];
      const first = deferred<boolean>();
      const second = deferred<boolean>();
      const third = deferred<boolean>();
      const rename = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
        .mockReturnValueOnce(third.promise);
      const onMutationFailed = vi.fn();
      await render({ mutations: { rename }, onMutationFailed });
      let firstResult!: Promise<boolean>;
      let secondResult!: Promise<boolean>;
      let thirdResult!: Promise<boolean>;
      act(() => {
        firstResult = latest.listProps.onRename!("owned", "First");
      });
      act(() => {
        secondResult = latest.listProps.onRename!("owned", "Second");
      });
      act(() => {
        thirdResult = latest.listProps.onRename!("owned", "Third");
      });
      expect(rename).toHaveBeenCalledTimes(1);
      if (completion === "latest-ready-first") third.resolve(false);
      await act(async () => {
        first.resolve(false);
        expect(await firstResult).toBe(false);
      });
      expect(item("owned")?.titleText).toBe("Third");
      expect(rename).toHaveBeenCalledTimes(2);
      expect(onMutationFailed).not.toHaveBeenCalled();
      expect(mine[0].title).toBe("Original");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await act(async () => {
        second.reject(new Error("Middle failed"));
        expect(await secondResult).toBe(false);
      });
      if (completion === "head-first") {
        expect(item("owned")?.titleText).toBe("Third");
        expect(onMutationFailed).not.toHaveBeenCalled();
      }
      await act(async () => {
        third.resolve(false);
        expect(await thirdResult).toBe(false);
      });
      expect(item("owned")?.titleText).toBe("Original");
      expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(
        "rename",
        "owned",
      );
      expect(rename).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it.each(
    (["rename", "pin"] as const).flatMap((kind) =>
      (["refresh-error", "reconciled"] as const).map((baseline) => ({
        kind,
        baseline,
      })),
    ),
  )(
    "eligible projection: $kind retains a $baseline success through an older proof and failed retry",
    async ({ kind, baseline }) => {
      mine = [row("owned", { title: "Original", pinnedAt: null })];
      const older = deferred<boolean>();
      const newer = deferred<boolean>();
      const retry = deferred<boolean>();
      const mutation = vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise)
        .mockReturnValueOnce(retry.promise);
      const onMutationFailed = vi.fn();
      await render({
        pinned: true,
        mutations: { rename: mutation, pin: mutation },
        onMutationFailed,
      });
      const start = (title: string) =>
        kind === "rename"
          ? latest.listProps.onRename!("owned", title)
          : latest.listProps.onTogglePin!("owned");
      let oldResult!: Promise<boolean>;
      let newResult!: Promise<boolean>;
      let retryResult!: Promise<boolean>;
      act(() => {
        oldResult = start("First");
      });
      act(() => {
        newResult = start("Saved");
      });
      const oldMineProof = deferred<Response>();
      const oldSharedProof = deferred<Response>();
      fetchMock
        .mockImplementationOnce(() => oldMineProof.promise)
        .mockImplementationOnce(() => oldSharedProof.promise);
      await act(async () => {
        older.resolve(true);
      });
      mine = [
        row("owned", {
          title: kind === "rename" ? "Saved" : "Original",
          pinnedAt: null,
        }),
      ];
      failMine = baseline === "refresh-error";
      await act(async () => {
        newer.resolve(true);
        expect(await newResult).toBe(true);
      });
      expect(fetchMock).toHaveBeenCalledTimes(6);
      act(() => {
        retryResult = start("Retry");
      });
      await act(async () => {
        retry.resolve(false);
        expect(await retryResult).toBe(false);
      });
      expect(item("owned")).toMatchObject({
        titleText: kind === "rename" ? "Saved" : "Original",
        pinned: false,
      });
      expect(section("mine").items[0].id).toBe("owned");
      expect(mine[0]).toMatchObject({
        title: kind === "rename" ? "Saved" : "Original",
        pinnedAt: null,
      });
      expect(latest.mineRows[0].title).toBe(
        baseline === "refresh-error" ? "Original" : mine[0].title,
      );
      await act(async () => {
        oldMineProof.resolve(
          Response.json({
            threads: [row("owned", { title: "Old", pinnedAt: 1 })],
            hasMore: false,
          }),
        );
        oldSharedProof.resolve(Response.json({ threads: [], hasMore: false }));
        expect(await oldResult).toBe(true);
      });
      expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(kind, "owned");
      expect(fetchMock).toHaveBeenCalledTimes(6);
      failMine = false;
      await act(async () => {
        await latest.refresh();
      });
      expect(latest.mineRows).toEqual(mine);
      expect(item("owned")).toMatchObject({
        titleText: mine[0].title,
        pinned: false,
      });
      expect(mutation).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenCalledTimes(8);
    },
  );

  it.each(["rename", "pin"] as const)(
    "physical ordering: %s persists the latest accepted value through a fresh mount",
    async (kind) => {
      mine = [row("owned", { title: "Original", pinnedAt: null })];
      const older = deferred<void>();
      const newer = deferred<void>();
      let calls = 0;
      const mutation = vi.fn(async (_id: string, value: string | boolean) => {
        await (calls++ === 0 ? older : newer).promise;
        mine = [
          row("owned", {
            title: kind === "rename" ? String(value) : "Original",
            pinnedAt: kind === "pin" && value ? 2 : null,
          }),
        ];
        return true;
      });
      const onMutationFailed = vi.fn();
      const options = {
        pinned: true,
        mutations: { rename: mutation, pin: mutation },
        onMutationFailed,
      };
      await render(options);
      const start = (title: string) =>
        kind === "rename"
          ? latest.listProps.onRename!("owned", title)
          : latest.listProps.onTogglePin!("owned");
      let oldResult!: Promise<boolean>;
      let newResult!: Promise<boolean>;
      act(() => {
        oldResult = start("First");
      });
      act(() => {
        newResult = start("Second");
      });
      await act(async () => {
        newer.resolve();
      });
      await act(async () => {
        older.resolve();
        expect(await oldResult).toBe(true);
        expect(await newResult).toBe(true);
      });
      expect(mine[0]).toMatchObject({
        title: kind === "rename" ? "Second" : "Original",
        pinnedAt: null,
      });
      expect(mutation.mock.calls).toEqual(
        kind === "rename"
          ? [
              ["owned", "First"],
              ["owned", "Second"],
            ]
          : [
              ["owned", true],
              ["owned", false],
            ],
      );
      await act(async () => {
        root.render(null);
      });
      await render(options);
      expect(latest.mineRows).toEqual(mine);
      expect(item("owned")).toMatchObject({
        titleText: kind === "rename" ? "Second" : "Original",
        pinned: false,
      });
      expect(onMutationFailed).not.toHaveBeenCalled();
    },
  );

  it.each(["scope", "query", "enabled", "Activity", "unmount"] as const)(
    "physical ordering: accepted callbacks survive %s and serialize with the replacement view",
    async (boundary) => {
      mine = [row("owned", { title: "Original" })];
      const first = deferred<void>();
      const second = deferred<void>();
      const commits: string[] = [];
      let calls = 0;
      const original = vi.fn(async (_id: string, title: string) => {
        await (calls++ === 0 ? first : second).promise;
        commits.push(title);
        mine = [row("owned", { title })];
        return true;
      });
      const replacement = vi.fn(async (_id: string, title: string) => {
        commits.push(title);
        mine = [row("owned", { title })];
        return true;
      });
      const onMutationFailed = vi.fn();
      const originalOptions = {
        mutations: { rename: original },
        onMutationFailed,
      };
      if (boundary === "Activity")
        await renderActivity(originalOptions, "visible");
      else await render(originalOptions);
      let firstResult!: Promise<boolean>;
      let secondResult!: Promise<boolean>;
      act(() => {
        firstResult = latest.listProps.onRename!("owned", "First");
      });
      act(() => {
        secondResult = latest.listProps.onRename!("owned", "Second");
      });
      expect(original).toHaveBeenCalledTimes(1);
      const nextOptions: UseOwnershipChatHistoryOptions = {
        apiUrl: agentNativePath("/_agent-native/agent-chat"),
        ...(boundary === "scope"
          ? { scope: { type: "project", id: "replacement" } }
          : {}),
        ...(boundary === "query" ? { query: "replacement" } : {}),
        mutations: { rename: replacement },
        onMutationFailed,
      };
      if (boundary === "unmount")
        await act(async () => {
          root.render(null);
        });
      if (boundary === "enabled")
        await render({ ...originalOptions, enabled: false });
      if (boundary === "Activity") {
        await renderActivity(originalOptions, "hidden");
        await renderActivity(nextOptions, "visible");
      } else await render(nextOptions);
      let thirdResult!: Promise<boolean>;
      act(() => {
        thirdResult = latest.listProps.onRename!("owned", "Third");
      });
      expect(replacement).not.toHaveBeenCalled();
      expect(item("owned")?.titleText).toBe("Third");
      const requests = fetchMock.mock.calls.length;
      await act(async () => {
        first.resolve();
        expect(await firstResult).toBe(false);
      });
      expect(original).toHaveBeenCalledTimes(2);
      expect(original.mock.calls[1]).toEqual(["owned", "Second"]);
      expect(replacement).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(requests);
      await act(async () => {
        second.resolve();
        expect(await secondResult).toBe(false);
        expect(await thirdResult).toBe(true);
      });
      expect(commits).toEqual(["First", "Second", "Third"]);
      expect(replacement).toHaveBeenCalledExactlyOnceWith("owned", "Third");
      expect(mine[0].title).toBe("Third");
      expect(latest.mineRows).toEqual(mine);
      expect(fetchMock).toHaveBeenCalledTimes(requests + 2);
      expect(onMutationFailed).not.toHaveBeenCalled();
      await act(async () => {
        root.render(null);
      });
      await render(nextOptions);
      expect(item("owned")?.titleText).toBe("Third");
      let finalResult!: Promise<boolean>;
      act(() => {
        finalResult = latest.listProps.onRename!("owned", "After cleanup");
        expect(replacement).toHaveBeenCalledTimes(2);
      });
      await act(async () => {
        expect(await finalResult).toBe(true);
      });
      expect(mine[0].title).toBe("After cleanup");
    },
  );

  it.each(["false", "throw"] as const)(
    "physical ordering: %s releases the next accepted transport and the final tail",
    async (failure) => {
      mine = [row("owned", { title: "Original" })];
      const pending = deferred<boolean>();
      const cause = new Error("First failed");
      const rename = vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockImplementation(async (_id: string, title: string) => {
          mine = [row("owned", { title })];
          return true;
        });
      const onMutationFailed = vi.fn();
      await render({ mutations: { rename }, onMutationFailed });
      let older!: Promise<boolean>;
      let newer!: Promise<boolean>;
      act(() => {
        older = latest.listProps.onRename!("owned", "Failed");
      });
      act(() => {
        newer = latest.listProps.onRename!("owned", "Saved");
      });
      expect(rename).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (failure === "throw") pending.reject(cause);
        else pending.resolve(false);
        expect(await older).toBe(false);
        expect(await newer).toBe(true);
      });
      expect(mine[0].title).toBe("Saved");
      expect(onMutationFailed).not.toHaveBeenCalled();
      let next!: Promise<boolean>;
      act(() => {
        next = latest.listProps.onRename!("owned", "Next");
        expect(rename).toHaveBeenCalledTimes(3);
      });
      await act(async () => {
        expect(await next).toBe(true);
      });
      expect(latest.mineRows).toEqual(mine);
    },
  );

  it.each(["id", "endpoint"] as const)(
    "physical ordering: a different %s is independent of a blocked transport",
    async (identity) => {
      mine = [row("owned"), row("other")];
      const blocked = deferred<boolean>();
      const original = vi.fn(() => blocked.promise);
      await render({ mutations: { rename: original } });
      let older!: Promise<boolean>;
      act(() => {
        older = latest.listProps.onRename!("owned", "Pending");
      });
      const independent = vi.fn(async () => true);
      await render({
        ...(identity === "endpoint" ? { apiUrl: "/other-chat" } : {}),
        mutations: { rename: independent },
      });
      await act(async () => {
        expect(
          await latest.listProps.onRename!(
            identity === "id" ? "other" : "owned",
            "Independent",
          ),
        ).toBe(true);
      });
      expect(independent).toHaveBeenCalledTimes(1);
      await act(async () => {
        blocked.resolve(false);
        expect(await older).toBe(false);
      });
    },
  );

  it("an older failure cannot roll back a newer optimistic intent", async () => {
    mine = [row("owned")];
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const rename = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await render({ mutations: { rename } });
    let oldResult!: Promise<boolean>;
    let newResult!: Promise<boolean>;
    act(() => {
      oldResult = latest.listProps.onRename!("owned", "First");
    });
    act(() => {
      newResult = latest.listProps.onRename!("owned", "Second");
    });
    await act(async () => {
      first.resolve(false);
      await oldResult;
    });
    expect(item("owned")?.title).toBe("Second");
    mine = [row("owned", { title: "Second" })];
    await act(async () => {
      second.resolve(true);
      await newResult;
    });
    expect(item("owned")?.title).toBe("Second");
  });

  it.each(["false", "throw"])(
    "suppresses an older %s failure callback when a newer same-id rename is accepted",
    async (failure) => {
      mine = [row("owned")];
      const first = deferred<boolean>();
      const second = deferred<boolean>();
      const rename = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const onMutationFailed = vi.fn();
      await render({ mutations: { rename }, onMutationFailed });
      let oldResult!: Promise<boolean>;
      let newResult!: Promise<boolean>;
      act(() => {
        oldResult = latest.listProps.onRename!("owned", "First");
      });
      act(() => {
        newResult = latest.listProps.onRename!("owned", "Second");
      });
      const requestCount = fetchMock.mock.calls.length;
      await act(async () => {
        if (failure === "throw") first.reject(new Error("Older rename failed"));
        else first.resolve(false);
        expect(await oldResult).toBe(false);
      });
      expect(onMutationFailed).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(requestCount);
      mine = [row("owned", { title: "Second" })];
      await act(async () => {
        second.resolve(true);
        expect(await newResult).toBe(true);
      });
      expect(item("owned")?.title).toBe("Second");
      expect(latest.mineRows[0].title).toBe("Second");
      expect(onMutationFailed).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(requestCount + 2);
    },
  );

  it("keeps pending changes through stale refreshes and settled changes through failed authoritative refreshes", async () => {
    mine = [row("owned")];
    const pending = deferred<boolean>();
    await render({ mutations: { rename: () => pending.promise } });
    let result!: Promise<boolean>;
    act(() => {
      result = latest.listProps.onRename!("owned", "Optimistic");
    });
    await act(async () => {
      await latest.refresh();
    });
    expect(item("owned")?.title).toBe("Optimistic");
    failMine = true;
    await act(async () => {
      pending.resolve(true);
      expect(await result).toBe(true);
    });
    expect(item("owned")?.title).toBe("Optimistic");
    expect(latest.mineRows[0].title).toBe("owned");
    expect(latest.error?.message).toContain("503");
    failMine = false;
    mine = [row("owned", { title: "Optimistic" })];
    await act(async () => {
      await latest.refresh();
    });
    mine = [row("owned", { title: "Later server title" })];
    await act(async () => {
      await latest.refresh();
    });
    expect(item("owned")?.title).toBe("Later server title");
  });

  it("accepts a conflicting authoritative post-persistence value after exactly one own refresh", async () => {
    mine = [row("owned")];
    await render({ mutations: { rename: async () => true } });
    await act(async () => {
      expect(await latest.listProps.onRename!("owned", "Optimistic")).toBe(
        true,
      );
    });
    expect(item("owned")?.title).toBe("owned");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("Retry accepts a conflicting server value after a failed post-persistence refresh", async () => {
    mine = [row("owned")];
    await render({ mutations: { rename: async () => true } });
    failMine = true;
    await act(async () => {
      await latest.listProps.onRename!("owned", "Optimistic");
    });
    expect(item("owned")?.title).toBe("Optimistic");
    failMine = false;
    mine = [row("owned", { title: "Changed elsewhere" })];
    await act(async () => {
      await section("mine").onRetry!();
    });
    expect(item("owned")?.title).toBe("Changed elsewhere");
    expect(latest.error).toBeNull();
  });

  it("retains rows and paging on a failed refresh and exposes retry", async () => {
    renderRail = true;
    mine = [row("one"), row("two"), row("three")];
    await render({ pageSize: 1 });
    await act(async () => {
      await section("mine").onLoadMore!();
    });
    failMine = true;
    await act(async () => {
      await latest.refresh();
    });
    expect(latest.mineRows.map((row) => row.id)).toEqual(["one", "two"]);
    expect(section("mine").hasMore).toBe(true);
    expect(section("mine").error).toBe("Couldn't load more chats");
    expect(
      sectionElement("mine").querySelectorAll(".an-chat-history-row"),
    ).toHaveLength(2);
    expect(
      sectionElement("mine").querySelector('[role="alert"]')?.textContent,
    ).toContain("Couldn't load more chats");
    failMine = false;
    await act(async () => {
      await section("mine").onRetry!();
    });
    expect(latest.error).toBeNull();
  });

  it("hides Shared during its initial empty load, then shows recoverable errors", async () => {
    const initial = deferred<Response>();
    fetchMock.mockImplementation((url) =>
      String(url).includes("ownership=shared")
        ? initial.promise
        : Promise.resolve(pageResponse(url)),
    );
    await render();
    expect(latest.sections.map((section) => section.id)).toEqual(["mine"]);
    await act(async () => {
      initial.resolve(new Response("failed", { status: 503 }));
    });
    expect(section("shared").error).toBe("Couldn't load chats");
  });

  it("rejects mutations on Shared and unknown ids even if a decorator exposes actions", async () => {
    shared = [row("shared", { accessBasis: "direct" })];
    const pin = vi.fn();
    const rename = vi.fn();
    const archive = vi.fn();
    await render({
      mutations: { pin, rename, archive },
      decorateItem: (item) => ({ ...item, pinned: true, hideActions: false }),
    });
    expect(item("shared")).toMatchObject({ pinned: false, hideActions: true });
    await act(async () => {
      expect(await latest.listProps.onTogglePin!("shared")).toBe(false);
      expect(await latest.listProps.onRename!("shared", "title")).toBe(false);
      expect(await latest.listProps.onDelete!("unknown")).toBe(false);
    });
    expect(pin).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
  });

  it("does not fetch while disabled or refresh after unmount", async () => {
    await render({ enabled: false });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false },
        }),
      );
      await latest.refresh();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latest.loading).toBe(false);
    await render({ enabled: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const refresh = latest.refresh;
    act(() => {
      root.render(null);
    });
    await refresh();
    window.dispatchEvent(new Event("focus"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["none", "once", "burst"] as const)(
    "notification coordination: %s own events use one authoritative loaded-window refresh",
    async (notifications) => {
      mine = [row("owned", { title: "Original" }), row("other")];
      const rename = vi.fn(async (_id: string, title: string) => {
        mine = [row("owned", { title }), row("other")];
        if (notifications !== "none") {
          window.dispatchEvent(new Event("agent-chat:threads-updated"));
          if (notifications === "burst")
            window.dispatchEvent(new Event("agent-chat:threads-updated"));
        }
        return true;
      });
      await render({ pageSize: 1, mutations: { rename } });
      await act(async () => {
        await section("mine").onLoadMore!();
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      await act(async () => {
        expect(await latest.listProps.onRename!("owned", "Saved")).toBe(true);
      });
      expect(latest.mineRows).toEqual(mine);
      expect(item("owned")?.titleText).toBe("Saved");
      expect(fetchMock).toHaveBeenCalledTimes(5);
      mine = [row("owned", { title: "External" }), row("other")];
      await act(async () => {
        window.dispatchEvent(new Event("agent-chat:threads-updated"));
      });
      expect(item("owned")?.titleText).toBe("External");
      expect(fetchMock).toHaveBeenCalledTimes(7);
    },
  );

  it.each(["false", "throw"] as const)(
    "notification coordination: external events during a %s mutation refresh after failure without changing its outcome",
    async (failure) => {
      mine = [row("owned", { title: "Original" })];
      const pending = deferred<boolean>();
      const onMutationFailed = vi.fn();
      await render({
        mutations: { rename: () => pending.promise },
        onMutationFailed,
      });
      let result!: Promise<boolean>;
      act(() => {
        result = latest.listProps.onRename!("owned", "Unsaved");
      });
      mine = [row("owned", { title: "External" })];
      await act(async () => {
        window.dispatchEvent(new Event("agent-chat:threads-updated"));
        window.dispatchEvent(new Event("agent-chat:threads-updated"));
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const cause = new Error("Not persisted");
      await act(async () => {
        if (failure === "throw") pending.reject(cause);
        else pending.resolve(false);
        expect(await result).toBe(false);
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(latest.mineRows).toEqual(mine);
      expect(item("owned")?.titleText).toBe("External");
      expect(onMutationFailed).toHaveBeenCalledExactlyOnceWith(
        "rename",
        "owned",
        ...(failure === "throw" ? [cause] : []),
      );
    },
  );

  it.each(["success", "error"] as const)(
    "notification coordination: dirty external events during a %s proof get one trailing refresh",
    async (outcome) => {
      mine = [row("owned", { title: "Original" })];
      const onMutationFailed = vi.fn();
      await render({
        mutations: {
          rename: async (_id, title) => {
            mine = [row("owned", { title })];
            return true;
          },
        },
        onMutationFailed,
      });
      const proofMine = deferred<Response>();
      const proofShared = deferred<Response>();
      fetchMock
        .mockImplementationOnce(() => proofMine.promise)
        .mockImplementationOnce(() => proofShared.promise);
      let result!: Promise<boolean>;
      await act(async () => {
        result = latest.listProps.onRename!("owned", "Saved");
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const saved = mine;
      mine = [row("owned", { title: "External" })];
      await act(async () => {
        window.dispatchEvent(new Event("agent-chat:threads-updated"));
        window.dispatchEvent(new Event("agent-chat:threads-updated"));
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      await act(async () => {
        proofMine.resolve(
          outcome === "success"
            ? Response.json({ threads: saved, hasMore: false })
            : new Response("failed", { status: 503 }),
        );
        proofShared.resolve(Response.json({ threads: [], hasMore: false }));
        expect(await result).toBe(true);
      });
      expect(fetchMock).toHaveBeenCalledTimes(6);
      expect(latest.mineRows).toEqual(mine);
      expect(item("owned")?.titleText).toBe("External");
      expect(latest.error).toBeNull();
      expect(onMutationFailed).not.toHaveBeenCalled();
    },
  );

  it("coalesces focus and run-end refreshes for ten seconds with one thread-update subscription", async () => {
    await render();
    const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false },
        }),
      );
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    clock.mockReturnValue(20_001);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true },
        }),
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false },
        }),
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await act(async () => {
      window.dispatchEvent(new Event("agent-chat:threads-updated"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("ignores old mutation completion after a scope change or unmount", async () => {
    mine = [row("owned")];
    const pending = deferred<boolean>();
    const onMutationFailed = vi.fn();
    await render({
      scope: { type: "project", id: "old" },
      mutations: { rename: () => pending.promise },
      onMutationFailed,
    });
    let result!: Promise<boolean>;
    act(() => {
      result = latest.listProps.onRename!("owned", "Old scope title");
    });
    mine = [row("new-scope")];
    await render({ scope: { type: "project", id: "new" }, onMutationFailed });
    const requests = fetchMock.mock.calls.length;
    await act(async () => {
      pending.resolve(true);
      await result;
    });
    expect(fetchMock).toHaveBeenCalledTimes(requests);
    expect(item("new-scope")?.title).toBe("new-scope");
    expect(item("owned")).toBeUndefined();
    expect(onMutationFailed).not.toHaveBeenCalled();
  });

  it("late list responses cannot replace the current scope", async () => {
    const oldMine = deferred<Response>();
    const oldShared = deferred<Response>();
    fetchMock
      .mockImplementationOnce(() => oldMine.promise)
      .mockImplementationOnce(() => oldShared.promise);
    await render({ scope: { type: "project", id: "old" } });
    mine = [row("current")];
    await render({ scope: { type: "project", id: "current" } });
    await act(async () => {
      oldMine.resolve(
        Response.json({ threads: [row("stale")], hasMore: false }),
      );
      oldShared.resolve(
        Response.json({
          threads: [row("stale-shared", { accessBasis: "direct" })],
          hasMore: false,
        }),
      );
    });
    expect(latest.mineRows.map((row) => row.id)).toEqual(["current"]);
    expect(latest.sharedRows).toEqual([]);
    expect(item("stale")).toBeUndefined();
    expect(item("stale-shared")).toBeUndefined();
  });

  it("does not clear a settled override when its authoritative request is superseded", async () => {
    mine = [row("owned")];
    const pending = deferred<boolean>();
    await render({ mutations: { rename: () => pending.promise } });
    let mutation!: Promise<boolean>;
    act(() => {
      mutation = latest.listProps.onRename!("owned", "Optimistic");
    });
    const oldMineRefresh = deferred<Response>();
    const oldSharedRefresh = deferred<Response>();
    fetchMock
      .mockImplementationOnce(() => oldMineRefresh.promise)
      .mockImplementationOnce(() => oldSharedRefresh.promise);
    await act(async () => {
      pending.resolve(true);
    });
    await act(async () => {
      failMine = true;
      await latest.refresh();
    });
    await act(async () => {
      oldMineRefresh.resolve(pageResponse("/threads?ownership=mine&limit=50"));
      oldSharedRefresh.resolve(
        pageResponse("/threads?ownership=shared&limit=50"),
      );
      expect(await mutation).toBe(true);
    });
    expect(item("owned")?.title).toBe("Optimistic");
    failMine = false;
    mine = [row("owned", { title: "Optimistic" })];
    await act(async () => {
      await latest.refresh();
    });
    mine = [row("owned", { title: "Changed later" })];
    await act(async () => {
      await latest.refresh();
    });
    expect(item("owned")?.title).toBe("Changed later");
  });

  it("a pending mutation cannot notify or refetch after unmount", async () => {
    mine = [row("owned")];
    const pending = deferred<boolean>();
    const onMutationFailed = vi.fn();
    await render({
      mutations: { rename: () => pending.promise },
      onMutationFailed,
    });
    let mutation!: Promise<boolean>;
    act(() => {
      mutation = latest.listProps.onRename!("owned", "Pending");
    });
    act(() => {
      root.render(null);
    });
    await act(async () => {
      pending.reject(new Error("Late failure"));
      expect(await mutation).toBe(false);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onMutationFailed).not.toHaveBeenCalled();
  });

  it.each(["scope", "apiUrl", "enabled", "unmount"] as const)(
    "returns false when %s is invalidated during the post-persistence refresh",
    async (invalidation) => {
      mine = [row("owned")];
      const persistence = deferred<boolean>();
      const onMutationFailed = vi.fn();
      await render({
        mutations: { archive: () => persistence.promise },
        onMutationFailed,
      });
      const oldMineRefresh = deferred<Response>();
      const oldSharedRefresh = deferred<Response>();
      fetchMock
        .mockImplementationOnce(() => oldMineRefresh.promise)
        .mockImplementationOnce(() => oldSharedRefresh.promise);
      const navigate = vi.fn();
      let completion!: Promise<boolean>;
      act(() => {
        completion = latest.listProps.onDelete!("owned").then((succeeded) => {
          if (succeeded) navigate();
          return succeeded;
        });
      });
      await act(async () => {
        persistence.resolve(true);
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(navigate).not.toHaveBeenCalled();

      mine = [row("current")];
      if (invalidation === "unmount") {
        act(() => {
          root.render(null);
        });
      } else {
        await render({
          ...(invalidation === "scope"
            ? { scope: { type: "project", id: "current" } }
            : {}),
          ...(invalidation === "apiUrl" ? { apiUrl: "/current-chat" } : {}),
          ...(invalidation === "enabled" ? { enabled: false } : {}),
          onMutationFailed,
        });
      }
      const requestsAfterInvalidation = fetchMock.mock.calls.length;
      await act(async () => {
        oldMineRefresh.resolve(Response.json({ threads: [], hasMore: false }));
        oldSharedRefresh.resolve(
          Response.json({ threads: [], hasMore: false }),
        );
        expect(await completion).toBe(false);
      });
      expect(navigate).not.toHaveBeenCalled();
      expect(onMutationFailed).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(requestsAfterInvalidation);
      if (invalidation === "scope" || invalidation === "apiUrl") {
        expect(latest.mineRows.map((row) => row.id)).toEqual(["current"]);
      } else if (invalidation === "enabled") {
        expect(latest.mineRows).toEqual([]);
      }
    },
  );

  it("does not let an older successful refresh clear a newer intent", async () => {
    mine = [row("owned")];
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const rename = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await render({ mutations: { rename } });
    const oldMineRefresh = deferred<Response>();
    const oldSharedRefresh = deferred<Response>();
    let oldMutation!: Promise<boolean>;
    let newMutation!: Promise<boolean>;
    act(() => {
      oldMutation = latest.listProps.onRename!("owned", "First");
    });
    fetchMock
      .mockImplementationOnce(() => oldMineRefresh.promise)
      .mockImplementationOnce(() => oldSharedRefresh.promise);
    await act(async () => {
      first.resolve(true);
    });
    act(() => {
      newMutation = latest.listProps.onRename!("owned", "Second");
    });
    await act(async () => {
      oldMineRefresh.resolve(pageResponse("/threads?ownership=mine&limit=50"));
      oldSharedRefresh.resolve(
        pageResponse("/threads?ownership=shared&limit=50"),
      );
      await oldMutation;
    });
    expect(item("owned")?.title).toBe("Second");
    mine = [row("owned", { title: "Second" })];
    await act(async () => {
      second.resolve(true);
      await newMutation;
    });
    expect(item("owned")?.title).toBe("Second");
  });
});
