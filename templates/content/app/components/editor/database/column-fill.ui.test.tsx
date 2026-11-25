// @vitest-environment happy-dom

import {
  requestAgentChatThreadOpen,
  useAgentEngineConfigured,
} from "@agent-native/core/client/agent-chat";
import type { ContentDatabaseItem, DocumentProperty } from "@shared/api";
import type { ColumnFill, ColumnFillCell } from "@shared/column-fill";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ColumnFillCellActions,
  ColumnFillCellBadge,
  ColumnFillHeaderStatus,
  ColumnFillProvider,
  useColumnFillMenu,
} from "./column-fill";

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  requestAgentChatThreadOpen: vi.fn(),
  useAgentEngineConfigured: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const summary: DocumentProperty = {
  definition: {
    id: "summary",
    databaseId: "db-1",
    name: "Summary",
    type: "text",
    options: {},
  },
  value: null,
  editable: true,
} as DocumentProperty;
const created: DocumentProperty = {
  definition: {
    id: "created",
    databaseId: "db-1",
    name: "Created",
    type: "date",
    options: {},
  },
  value: null,
  editable: true,
} as DocumentProperty;

function row(id: string, value: string | null): ContentDatabaseItem {
  return {
    id: `item-${id}`,
    databaseId: "db-1",
    document: { id, title: id, canEdit: true },
    properties: [{ ...summary, value }],
  } as unknown as ContentDatabaseItem;
}

const items = [
  row("row-1", null),
  row("row-2", "Written"),
  row("row-3", null),
  row("row-4", ""),
];

function fillOf(
  status: ColumnFill["status"],
  cells: Array<[string, ColumnFillCell["status"], (string | null)?]>,
): ColumnFill {
  return {
    id: "fill-1",
    databaseId: "db-1",
    propertyId: "summary",
    instruction: "Summarize",
    rewrite: false,
    status,
    total: cells.length,
    settled: cells.filter(
      ([, cell]) => cell !== "waiting" && cell !== "running",
    ).length,
    createdAt: "2026-11-23T19:00:00.000Z",
    updatedAt: "2026-11-23T19:00:00.000Z",
    cells: cells.map(([documentId, cell, error]) => ({
      documentId,
      status: cell,
      agentThreadId: cell === "waiting" ? null : `thread-${documentId}`,
      error: error ?? null,
    })),
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let stored: ColumnFill[];
let startRefusal: string | null;
let moreRows: boolean;
let headerWidth: number;
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
const urlOf = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : input.toString();
const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = urlOf(input);
  const body = init?.body ? JSON.parse(init.body as string) : {};
  if (url.includes("list-column-fills")) return json({ fills: stored });
  if (url.includes("start-column-fill")) {
    if (startRefusal) {
      return new Response(
        JSON.stringify({ error: "Refused.", errorCode: startRefusal }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
    const fill = fillOf(
      "running",
      (body.documentIds as string[]).map((id) => [id, "running"]),
    );
    stored = [fill];
    return json(fill);
  }
  if (url.includes("stop-column-fill") || url.includes("retry-column-fill")) {
    return json(stored[0]);
  }
  return json({});
});
const calls = (action: string) =>
  fetch.mock.calls.filter(([input]) => urlOf(input).includes(action));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetch);
  fetch.mockClear();
  vi.mocked(requestAgentChatThreadOpen).mockClear();
  vi.mocked(useAgentEngineConfigured).mockReturnValue({
    canChat: true,
    missing: false,
    state: "configured",
  });
  stored = [];
  startRefusal = null;
  moreRows = false;
  headerWidth = 320;
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

function Table() {
  const openSummary = useColumnFillMenu(summary);
  const openCreated = useColumnFillMenu(created);
  return (
    <div>
      {openSummary ? (
        <button type="button" data-open="summary" onClick={openSummary}>
          Fill Summary
        </button>
      ) : null}
      {openCreated ? (
        <button type="button" data-open="created" onClick={openCreated}>
          Fill Created
        </button>
      ) : null}
      <div data-header>
        <ColumnFillHeaderStatus
          property={summary}
          width={headerWidth}
          narrow={false}
        />
      </div>
      {items.map((item) => (
        <div key={item.id} data-row={item.document.id} className="relative">
          <ColumnFillCellBadge
            propertyId="summary"
            documentId={item.document.id}
          />
          <ColumnFillCellActions
            propertyId="summary"
            documentId={item.document.id}
            onDone={() => {}}
          />
        </div>
      ))}
    </div>
  );
}

async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ColumnFillProvider
          databaseId="db-1"
          databaseDocumentId="db-doc-1"
          items={items}
          moreRows={moreRows}
          properties={[summary, created]}
          enabled
        >
          <Table />
        </ColumnFillProvider>
      </QueryClientProvider>,
    ),
  );
  await settle();
}

const settle = () =>
  act(async () => {
    // fixed-sleep-ok: lets the mocked action responses reach React Query and render; nothing in the page marks that moment
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${what} not found.`);
  }
  return value;
}

const dialog = () =>
  document.body.querySelector<HTMLElement>("[data-column-fill-dialog]");
const buttonNamed = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent.trim() === text,
  );
const shownDialog = () => required(dialog(), "Fill with AI dialog");
const inside = <T extends Element = HTMLElement>(
  scope: ParentNode,
  selector: string,
) => required(scope.querySelector<T>(selector), selector);
const button = (scope: ParentNode, text: string) =>
  required(buttonNamed(scope, text), text);
const sentBody = (action: string) =>
  JSON.parse(String(required(calls(action)[0], action)[1]?.body));
const announcement = () =>
  container.ownerDocument.querySelector('[role="status"][aria-live="polite"]')
    ?.textContent;

async function typeInstruction(value: string) {
  const textarea = inside<HTMLTextAreaElement>(shownDialog(), "textarea");
  const setValue = required(
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
      ?.set,
    "Textarea value setter",
  );
  await act(async () => {
    setValue.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openDialog() {
  await act(async () =>
    inside<HTMLButtonElement>(container, '[data-open="summary"]').click(),
  );
  await settle();
}

describe("Fill with AI", () => {
  it("is offered on text columns but not on date columns", async () => {
    await render();
    expect(container.querySelector('[data-open="summary"]')).not.toBeNull();
    expect(container.querySelector('[data-open="created"]')).toBeNull();
  });

  it("counts the view's empty cells before starting, and fills only those", async () => {
    await render();
    await openDialog();

    const count = inside(shownDialog(), "[data-column-fill-count]");
    expect(count.textContent).toBe('database.fillWithAiCount:{"count":3}');
    expect(
      shownDialog().querySelector("[data-column-fill-more-rows]"),
    ).toBeNull();
    const fill = button(shownDialog(), "database.fillWithAiStart");
    expect(fill.disabled).toBe(true);

    await act(async () => inside(shownDialog(), '[role="checkbox"]').click());
    expect(count.textContent).toBe(
      'database.fillWithAiRewriteCount:{"count":4}',
    );
    await act(async () => inside(shownDialog(), '[role="checkbox"]').click());

    await typeInstruction("One sentence for search results");
    expect(fill.disabled).toBe(false);
    await act(async () => fill.click());
    await settle();

    expect(sentBody("start-column-fill")).toEqual({
      databaseId: "db-1",
      propertyId: "summary",
      instruction: "One sentence for search results",
      rewrite: false,
      documentIds: ["row-1", "row-3", "row-4"],
    });
    expect(dialog()).toBeNull();
    expect(announcement()).toBe(
      'database.fillStarted:{"name":"Summary","count":3}',
    );
  });

  it("says only the loaded rows are included when the view has more", async () => {
    moreRows = true;
    await render();
    await openDialog();

    expect(
      inside(shownDialog(), "[data-column-fill-more-rows]").textContent,
    ).toBe("database.fillWithAiLoadedOnly");
  });

  it("says AI isn't set up before anything starts", async () => {
    vi.mocked(useAgentEngineConfigured).mockReturnValue({
      canChat: false,
      missing: true,
      state: "missing",
    });
    await render();
    await openDialog();
    await typeInstruction("Summarize");

    expect(
      shownDialog().querySelector('[role="alert"]')?.textContent,
    ).toContain("database.fillWithAiNeedsSetup");
    expect(button(shownDialog(), "database.fillWithAiStart").disabled).toBe(
      true,
    );
    expect(calls("start-column-fill")).toHaveLength(0);
  });

  it("says AI isn't set up when the server refuses to start for that", async () => {
    startRefusal = "AI_SETUP_REQUIRED";
    await render();
    await openDialog();
    await typeInstruction("Summarize");
    await act(async () =>
      button(shownDialog(), "database.fillWithAiStart").click(),
    );
    await settle();

    expect(
      shownDialog().querySelector('[role="alert"]')?.textContent,
    ).toContain("database.fillWithAiNeedsSetup");
    expect(button(shownDialog(), "database.fillWithAiStart").disabled).toBe(
      true,
    );
  });

  it("shows progress in the header and on each cell, and stops from the header", async () => {
    stored = [
      fillOf("running", [
        ["row-1", "filled"],
        ["row-3", "running"],
        ["row-4", "waiting"],
      ]),
    ];
    await render();

    const header = inside(container, "[data-header]");
    expect(header.textContent).toContain(
      'database.fillProgress:{"done":1,"total":3}',
    );
    expect(header.querySelector("[data-column-fill-compact]")).toBeNull();
    const cellStatus = (id: string) =>
      container
        .querySelector(`[data-row="${id}"] [data-column-fill-cell]`)
        ?.getAttribute("data-column-fill-cell");
    expect(cellStatus("row-1")).toBeUndefined();
    expect(cellStatus("row-3")).toBe("running");
    expect(cellStatus("row-4")).toBe("waiting");

    const stop = inside<HTMLButtonElement>(header, "[data-column-fill-stop]");
    expect(stop.getAttribute("aria-label")).toBe(
      'database.fillStopLabel:{"name":"Summary"}',
    );
    await act(async () => stop.click());
    await settle();
    expect(sentBody("stop-column-fill")).toEqual({ fillId: "fill-1" });
  });

  it("shortens the header's count at the default column width, with the full text for screen readers", async () => {
    stored = [
      fillOf("running", [
        ["row-1", "filled"],
        ["row-3", "running"],
        ["row-4", "waiting"],
      ]),
    ];
    headerWidth = 180;
    await render();

    const header = inside(container, "[data-header]");
    const short = inside(header, "[data-column-fill-compact]");
    expect(short.textContent).toBe("1/3");
    expect(short.getAttribute("aria-hidden")).toBe("true");
    const full = required(short.nextElementSibling, "full count");
    expect(full.textContent).toBe('database.fillProgress:{"done":1,"total":3}');
    expect(full.classList.contains("sr-only")).toBe(true);
    inside(header, "[data-column-fill-stop]");
  });

  it("offers Try again and Open chat on a failed cell, and Edit in chat on a filled one", async () => {
    stored = [
      fillOf("done", [
        ["row-1", "filled"],
        ["row-3", "failed", "Nothing to fill from the page."],
      ]),
    ];
    await render();

    const failed = inside(container, '[data-row="row-3"]');
    expect(failed.textContent).toContain("Nothing to fill from the page.");
    await act(async () => button(failed, "database.fillTryAgain").click());
    await settle();
    expect(sentBody("retry-column-fill-cell")).toEqual({
      fillId: "fill-1",
      documentId: "row-3",
    });

    await act(async () => button(failed, "database.fillOpenChat").click());
    expect(requestAgentChatThreadOpen).toHaveBeenLastCalledWith({
      threadId: "thread-row-3",
    });

    const filled = inside(container, '[data-row="row-1"]');
    await act(async () => button(filled, "database.fillEditInChat").click());
    expect(requestAgentChatThreadOpen).toHaveBeenLastCalledWith({
      threadId: "thread-row-1",
    });
    expect(inside(container, "[data-header]").textContent).toBe("");
  });

  it("offers no Try again while a fill is stopping", async () => {
    stored = [
      fillOf("stopping", [
        ["row-1", "running"],
        ["row-3", "failed", "Nothing to fill from the page."],
      ]),
    ];
    await render();

    const failed = inside(container, '[data-row="row-3"]');
    const labels = [...failed.querySelectorAll("button")].map(
      (candidate) => candidate.textContent,
    );
    expect(labels).toContain("database.fillOpenChat");
    expect(labels).not.toContain("database.fillTryAgain");
  });

  it("announces when a fill finishes", async () => {
    stored = [
      fillOf("running", [
        ["row-1", "filled"],
        ["row-3", "running"],
      ]),
    ];
    await render();
    stored = [
      fillOf("done", [
        ["row-1", "filled"],
        ["row-3", "failed", "The model refused."],
      ]),
    ];
    await act(async () => {
      await client.refetchQueries({
        queryKey: ["action", "list-column-fills"],
      });
    });
    await settle();
    expect(announcement()).toBe(
      'database.fillFinishedWithFailures:{"name":"Summary","count":1}',
    );
  });
});
