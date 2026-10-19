// @vitest-environment happy-dom

import type { ContentDatabaseItem, DocumentProperty } from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { richEditor, setRichEditorValue } from "../comment-composer-test-utils";
import { DatabaseCellComments } from "./database-cell-comments";
import { DatabaseItemCommentsContext } from "./database-item-comments";

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  chatModelSelectionStorageKey: (scope: string) => `model:${scope}`,
  useChatModels: () => ({
    configuredModels: [],
    selectionReady: false,
    selectedModel: "",
    selectedEngine: "",
    selectedEffort: undefined,
    unavailableSelection: null,
    onModelChange: vi.fn(),
  }),
  sendToAgentChat: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  useAvatarUrl: () => null,
  useSession: () => ({ session: { email: "me@example.test" } }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: (date: Date | string) => new Date(date).toISOString(),
  }),
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [] }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const status: DocumentProperty = {
  definition: { id: "status", name: "Status", type: "text", options: {} },
  value: "In progress",
  editable: true,
} as DocumentProperty;

function row(
  access: { canComment: boolean; canEdit: boolean },
  comments?: ContentDatabaseItem["comments"],
) {
  return {
    id: "item-1",
    databaseId: "db-1",
    document: { id: "row-1", title: "Launch plan", ...access },
    properties: [status],
    ...(comments ? { comments } : {}),
  } as unknown as ContentDatabaseItem;
}

function comment(threadId: string, propertyId: string, resolved = 0) {
  return {
    id: threadId,
    document_id: "row-1",
    thread_id: threadId,
    parent_id: null,
    content: `About ${propertyId}`,
    quoted_text: null,
    property_id: propertyId,
    property_name: propertyId === "status" ? "Status" : "Due",
    property_value: propertyId === "status" ? "In progress" : "Friday",
    mentions: [],
    author_email: "reviewer@example.test",
    author_name: "Reviewer",
    resolved,
    created_at: "2026-10-19T10:00:00.000Z",
    updated_at: "2026-10-19T10:00:00.000Z",
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let stored: ReturnType<typeof comment>[];
let listFails: boolean;
const openComments = vi.fn();
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
const urlOf = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : input.toString();
const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = urlOf(input);
  const body = init?.body ? JSON.parse(init.body as string) : {};
  if (url.includes("list-comments")) {
    return listFails
      ? new Response("{}", { status: 500 })
      : json({ comments: stored });
  }
  if (url.includes("add-comment")) {
    stored = [
      ...stored,
      { ...comment("posted", "status"), content: body.content },
    ];
    return json({ id: "posted", threadId: "posted" });
  }
  if (url.includes("update-comment")) {
    stored = stored.map((entry) =>
      entry.id === body.id
        ? { ...entry, resolved: Number(body.resolved) }
        : entry,
    );
    return json({ ok: true });
  }
  return json({});
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetch);
  fetch.mockClear();
  openComments.mockReset();
  stored = [];
  listFails = false;
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

async function render(children: ReactNode, provided = true) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {provided ? (
            <DatabaseItemCommentsContext.Provider value={openComments}>
              {children}
            </DatabaseItemCommentsContext.Provider>
          ) : (
            children
          )}
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  );
}

const cell = (item: ContentDatabaseItem) => (
  <div className="group/cell relative flex">
    <span>In progress</span>
    <DatabaseCellComments item={item} property={status} />
  </div>
);

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 75));
  });

const card = () =>
  document.body.querySelector<HTMLElement>("[data-database-cell-comment-card]");
const button = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === label,
  );
const calls = (action: string) =>
  fetch.mock.calls.filter(([input]) => urlOf(input).includes(action));
const startButton = () =>
  container.querySelector<HTMLButtonElement>(
    "[data-database-cell-comment-start]",
  )!;

function stubHover(canHover: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(any-hover: none)" ? !canHover : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("Comments on a Collection table cell", () => {
  it("starts a Property comment from scratch on a cell, for someone who can comment but not edit", async () => {
    await render(cell(row({ canComment: true, canEdit: false })));
    expect(container.querySelector("[data-database-cell-comments]")).toBeNull();
    const start = container.querySelector<HTMLButtonElement>(
      "[data-database-cell-comment-start]",
    )!;
    expect(start.getAttribute("aria-label")).toBe(
      'comments.commentOnProperty:{"name":"Status"}',
    );

    await act(async () => start.click());
    await settle();
    expect(card()?.getAttribute("data-database-cell-comment-card")).toBe(
      "start",
    );
    const label = card()!.querySelector("[data-comment-property-target]");
    expect(label?.textContent).toContain("Status");
    expect(label?.textContent).toContain("In progress");

    await setRichEditorValue(richEditor(card()!)!, "Should this be Done?");
    await act(async () => button(card()!, "comments.submit")!.click());
    await settle();
    const [, init] = calls("add-comment")[0]!;
    expect(JSON.parse(init?.body as string)).toMatchObject({
      documentId: "row-1",
      content: "Should this be Done?",
      propertyId: "status",
      databaseId: "db-1",
    });
    expect(openComments).not.toHaveBeenCalled();
    await settle();
    expect(card()?.querySelector('[data-thread-card="posted"]')).not.toBeNull();

    // The peek records where to return focus, then takes it.
    const peek = document.createElement("button");
    document.body.append(peek);
    let focusedWhenOpened: Element | null = null;
    openComments.mockImplementation(() => {
      focusedWhenOpened = document.activeElement;
      peek.focus();
    });
    await act(async () =>
      card()!
        .querySelector<HTMLButtonElement>(
          "[data-database-cell-comment-open-row]",
        )!
        .click(),
    );
    await settle();
    expect(openComments).toHaveBeenCalledWith(
      expect.objectContaining({ id: "item-1" }),
      "posted",
    );
    expect(card()).toBeNull();
    expect(focusedWhenOpened).toBe(start);
    // Pulling focus back to the table would close the peek.
    expect(document.activeElement).toBe(peek);
    peek.remove();
  });

  it("opens a cell's open threads from its marker, and closes once the last is resolved", async () => {
    stored = [
      comment("t-status", "status"),
      comment("t-due", "due"),
      comment("t-old", "status", 1),
    ];
    await render(
      cell(
        row(
          { canComment: true, canEdit: true },
          {
            open: 2,
            properties: {
              status: { open: 1, latestThreadId: "t-status" },
              due: { open: 1, latestThreadId: "t-due" },
            },
          },
        ),
      ),
    );
    const marker = container.querySelector<HTMLButtonElement>(
      "[data-database-cell-comments]",
    )!;
    await act(async () => marker.click());
    await settle();
    expect(card()?.getAttribute("data-database-cell-comment-card")).toBe(
      "read",
    );
    expect(
      [...card()!.querySelectorAll("[data-thread-card]")].map((node) =>
        node.getAttribute("data-thread-card"),
      ),
    ).toEqual(["t-status"]);
    expect(openComments).not.toHaveBeenCalled();

    await act(async () => button(card()!, "comments.resolve")!.click());
    await settle();
    const [, init] = calls("update-comment")[0]!;
    expect(JSON.parse(init?.body as string)).toMatchObject({
      id: "t-status",
      resolved: true,
    });
    expect(card()).toBeNull();
    // The marker goes once the row's counts refresh.
    expect(document.activeElement).toBe(startButton());
  });

  it("keeps unsent text when the cell's own button is clicked again, and closes an empty card", async () => {
    await render(cell(row({ canComment: true, canEdit: true })));
    await act(async () => startButton().click());
    await settle();
    await act(async () => startButton().click());
    await settle();
    expect(card()).toBeNull();

    await act(async () => startButton().click());
    await settle();
    await setRichEditorValue(richEditor(card()!)!, "Should this be Done?");
    await act(async () => startButton().click());
    await settle();
    expect(richEditor(card()!)?.textContent).toContain("Should this be Done?");
  });

  it("on a touch screen, writes the new comment in the row's peek", async () => {
    stubHover(false);
    await render(cell(row({ canComment: true, canEdit: true })));
    await act(async () => startButton().click());
    await settle();
    expect(openComments).toHaveBeenCalledWith(
      expect.objectContaining({ id: "item-1" }),
      null,
      "status",
    );
    expect(card()).toBeNull();
  });

  it("reads a cell's threads again when its marker is newer than the cache", async () => {
    // Someone else commented since this row's threads were last read.
    client.setQueryData(["action", "list-comments", { documentId: "row-1" }], {
      comments: [],
    });
    stored = [comment("t-status", "status")];
    await render(
      cell(
        row(
          { canComment: true, canEdit: true },
          {
            open: 1,
            properties: { status: { open: 1, latestThreadId: "t-status" } },
          },
        ),
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-database-cell-comments]")!
        .click(),
    );
    await settle();
    expect(card()).not.toBeNull();
    expect(
      card()!.querySelector('[data-thread-card="t-status"]'),
    ).not.toBeNull();
  });

  it("closes a card whose read fails, and refreshes a marker that no longer matches", async () => {
    const rows = ["action", "get-content-database", { documentId: "db" }];
    client.setQueryData(rows, { items: [{ document: { id: "row-1" } }] });
    const marked = row(
      { canComment: true, canEdit: true },
      {
        open: 1,
        properties: { status: { open: 1, latestThreadId: "t-status" } },
      },
    );
    const marker = () =>
      container.querySelector<HTMLButtonElement>(
        "[data-database-cell-comments]",
      )!;

    listFails = true;
    await render(cell(marked));
    await act(async () => marker().click());
    await settle();
    expect(card()).toBeNull();

    // Someone else resolved the thread since the row was read.
    listFails = false;
    await act(async () => marker().click());
    await settle();
    expect(card()).toBeNull();
    expect(client.getQueryState(rows)?.isInvalidated).toBe(true);
  });

  it("offers no way to start a comment to someone who can only view", async () => {
    await render(
      cell(
        row(
          { canComment: false, canEdit: false },
          { open: 1, properties: { status: { open: 1, latestThreadId: "t" } } },
        ),
      ),
    );
    expect(
      container.querySelector("[data-database-cell-comment-start]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-database-cell-comments]"),
    ).not.toBeNull();
  });

  it("shows nothing outside a Collection that provides Comments", async () => {
    await render(cell(row({ canComment: true, canEdit: true })), false);
    expect(container.querySelector("button")).toBeNull();
  });
});
