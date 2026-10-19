// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: null as Record<string, unknown> | null,
  editors: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
}));
vi.mock("@/hooks/use-document-properties", () => ({
  documentPropertiesPlaceholder: () => undefined,
  documentPropertiesResponseMatchesScope: (
    documentId: string,
    databaseId: string | null,
    data: { documentId?: string; databaseId?: string | null } | undefined,
  ) => data?.documentId === documentId && data?.databaseId === databaseId,
  useDocumentProperties: () => mocks.query,
  useConfigureDocumentProperty: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeleteDocumentProperty: () => ({ mutateAsync: vi.fn() }),
  useReorderDocumentProperty: () => ({ mutateAsync: vi.fn() }),
  useSetDocumentProperty: () => ({ mutateAsync: vi.fn(async () => ({})) }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/QueryErrorState", () => ({
  QueryErrorState: () => null,
}));
vi.mock("./VisualEditor", async () => {
  const React = await import("react");
  return {
    // Draws each open thread's highlight the way the real editor does.
    VisualEditor: (props: Record<string, unknown>) => {
      const label = React.useRef(String(props.content)).current;
      mocks.editors.set(label, props);
      const threads =
        (props.commentThreads as { threadId: string }[] | undefined) ?? [];
      return React.createElement(
        "div",
        { className: "ProseMirror", "data-visual-editor": label },
        threads.map((thread) =>
          React.createElement("span", {
            key: thread.threadId,
            "data-comment-thread": thread.threadId,
          }),
        ),
      );
    },
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import {
  commentTabsFromProperties,
  commentThreadFieldId,
  groupCommentsByTab,
  commentThreadPlacement,
  openReviewCountsByField,
  showsCommentTabs,
} from "./block-field-comment-threads";
import {
  BlockFieldCommentsProvider,
  useBlockFieldComments,
} from "./block-field-comments";
import { __resetBlockFieldSaveRegistry } from "./blockFieldSaveRegistry";
import type { PendingCommentSelection } from "./CommentsSidebar";
import { DocumentBlockFields } from "./DocumentBlockFields";

function field(
  id: string,
  options: { name?: string; primary?: boolean; position?: number } = {},
) {
  return {
    definition: {
      id,
      databaseId: "db-1",
      name: options.name ?? id,
      type: "blocks",
      visibility: "always_show",
      options: { blocks: { primary: options.primary ?? false } },
      position: options.position ?? 0,
      createdAt: "2026-10-18T00:00:00.000Z",
      updatedAt: "2026-10-18T00:00:00.000Z",
    },
    value: `${options.name ?? id} text`,
    editable: true,
    blocksField: { revision: 1 },
  };
}

const content = () =>
  field("content", { name: "Content", primary: true, position: 0 });
const notes = () => field("notes", { name: "Notes", position: 1 });

function setFields(fields: unknown[]) {
  mocks.query = {
    data: {
      documentId: "doc-1",
      databaseId: "db-1",
      canEditValues: true,
      canManageSchema: true,
      properties: fields,
    },
    isError: false,
    isRefetching: false,
  };
}

function thread(
  id: string,
  fieldId: string | null,
  extra: Partial<CommentThread> = {},
): CommentThread {
  return {
    threadId: id,
    quotedText: "filler text",
    prefix: null,
    suffix: null,
    startOffset: 0,
    field: fieldId ? { fieldId, fieldName: `${fieldId} name` } : null,
    resolved: false,
    comments: [],
    ...extra,
  };
}

function suggestion(
  id: string,
  extra: Partial<ResourceSuggestion> = {},
): ResourceSuggestion {
  return {
    id,
    proposalId: null,
    revision: 1,
    resourceType: "document",
    resourceId: "doc-1",
    adapterKind: "markdown",
    adapterVersion: 1,
    threadId: `suggestion-${id}`,
    authorEmail: "reviewer@example.test",
    actorKind: "human",
    baseRevision: "base",
    status: "pending",
    summary: "Filler edit",
    ownerEmail: "reviewer@example.test",
    orgId: null,
    visibility: "private",
    createdAt: "2026-10-18T00:00:00Z",
    updatedAt: "2026-10-18T00:00:00Z",
    metadata: null,
    operations: [],
    ...extra,
  } as ResourceSuggestion;
}

const propertyThread = () =>
  thread("property-thread", null, {
    property: {
      propertyId: "status",
      propertyName: "Status",
      propertyValue: null,
    },
  });

describe("comment tabs", () => {
  it("puts a thread with no field, from before field comments, on the body (CMT-6)", () => {
    const legacy = thread("legacy", null);
    delete legacy.field;
    expect(commentThreadFieldId(legacy)).toBeNull();
    expect(commentThreadFieldId(thread("notes-thread", "notes"))).toBe("notes");
  });

  it("lists Blocks fields in tab order, with the primary field as the body", () => {
    expect(
      commentTabsFromProperties([
        notes(),
        content(),
        field("other", { name: "Other", position: 2 }),
      ] as never),
    ).toEqual([
      { fieldId: null, name: "Content" },
      { fieldId: "notes", name: "Notes" },
      { fieldId: "other", name: "Other" },
    ]);
    expect(commentTabsFromProperties(undefined)).toEqual([]);
  });

  it("groups by tab in tab order, then deleted tabs under their saved name", () => {
    const tabs = [
      { fieldId: null, name: "Content" },
      { fieldId: "notes", name: "Notes" },
      { fieldId: "empty", name: "Empty" },
    ];
    const threads = [
      thread("gone-1", "gone"),
      thread("notes-1", "notes"),
      thread("body-1", null),
      thread("gone-2", "gone"),
      propertyThread(),
    ];
    const groups = groupCommentsByTab(threads, tabs, commentThreadPlacement);
    expect(
      groups.map((group) => [
        group.key,
        group.name,
        group.removed,
        group.entries.map((entry) => entry.threadId),
      ]),
    ).toEqual([
      ["", "Content", false, ["body-1", "property-thread"]],
      ["notes", "Notes", false, ["notes-1"]],
      ["gone", "gone name", true, ["gone-1", "gone-2"]],
    ]);
    expect(
      groupCommentsByTab(threads, tabs, commentThreadPlacement, true).map(
        (group) => group.key,
      ),
    ).toEqual(["", "notes", "empty", "gone"]);
  });

  it("never lists the page body as a deleted tab", () => {
    const groups = groupCommentsByTab(
      [thread("body-1", null)],
      [{ fieldId: "notes", name: "Notes" }],
      commentThreadPlacement,
    );
    expect(groups.map((group) => [group.key, group.removed])).toEqual([
      ["", false],
    ]);
  });

  it("groups only with two or more Blocks fields, or a deleted tab's threads (CMT-4)", () => {
    const body = [{ fieldId: null, name: "Content" }];
    const two = [...body, { fieldId: "notes", name: "Notes" }];
    expect(showsCommentTabs(two, [])).toBe(true);
    expect(showsCommentTabs(body, [thread("body-1", null)])).toBe(false);
    expect(showsCommentTabs(body, [propertyThread()])).toBe(false);
    expect(showsCommentTabs(body, [thread("gone-1", "gone")])).toBe(true);
    expect(showsCommentTabs([], [thread("gone-1", "gone")])).toBe(false);
  });

  it("counts open review per tab the way the margin shows it (CMT-3)", () => {
    const counts = openReviewCountsByField({
      threads: [
        thread("body-1", null),
        thread("body-2", null),
        thread("body-resolved", null, { resolved: true }),
        thread("notes-1", "notes"),
        propertyThread(),
      ],
      suggestions: [
        suggestion("single"),
        suggestion("unplaced"),
        suggestion("accepted", { status: "accepted" }),
        suggestion("member-1", { proposalId: "proposal" }),
        suggestion("member-2", { proposalId: "proposal" }),
        // An AI edit reviewed inside its thread counts with the thread.
        suggestion("embedded", {
          metadata: { sourceThreadId: "body-1", commentAiRequestId: "request" },
        }),
      ],
      draftSuggestions: [{}],
      anchoredSuggestionIds: [
        "single",
        "accepted",
        "member-1",
        "member-2",
        "embedded",
      ],
    });
    // Two threads, one suggestion, one proposal, one draft.
    expect(counts.get(null)).toBe(5);
    expect(counts.get("notes")).toBe(1);
    expect(counts.has("status")).toBe(false);
  });
});

describe("useBlockFieldComments", () => {
  let root: Root;
  let container: HTMLDivElement;
  let entry = "/page/doc-1";
  let latest: ReturnType<typeof useBlockFieldComments>;
  let renders: {
    target: string | null;
    open: string | null;
    pending: boolean;
  }[];
  const scrolled: string[] = [];
  const onComment = vi.fn();

  function Harness({
    threads,
    selectedThreadId = null,
    focusSuggestionId = null,
    pendingComment = null,
  }: {
    threads: CommentThread[];
    selectedThreadId?: string | null;
    focusSuggestionId?: string | null;
    pendingComment?: PendingCommentSelection | null;
  }) {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const comments = useBlockFieldComments({
      expectsBlockFields: true,
      threads,
      suggestions: [],
      draftSuggestions: [],
      anchoredSuggestionIds: null,
      selectedThreadId,
      selectedSuggestionId: null,
      focusSuggestionId,
      hoveredThreadId: null,
      pendingComment,
      showCommentIndicators: true,
      onComment,
      scrollContainerRef,
    });
    latest = comments;
    renders.push({
      target: selectedThreadId,
      open: comments.openFieldId,
      pending: comments.tabSwitchPending,
    });
    return (
      <div ref={scrollContainerRef}>
        <BlockFieldCommentsProvider value={comments.provider}>
          <DocumentBlockFields
            documentId="doc-1"
            databaseId="db-1"
            databaseDocumentId="db-page"
            canEdit
            primaryEditor={createElement(
              "div",
              { className: "ProseMirror", "data-body-editor": "" },
              <span data-comment-thread="body-1" />,
            )}
            onFieldTabChange={comments.onFieldTabChange}
          />
        </BlockFieldCommentsProvider>
        {comments.tabSwitchPending ? null : (
          <ul data-rail>
            {comments.railThreads.map((railThread) => (
              <li key={railThread.threadId} data-rail-thread>
                {railThread.threadId}
              </li>
            ))}
          </ul>
        )}
        <LocationProbe />
      </div>
    );
  }

  const location = { href: "" };
  function LocationProbe() {
    const current = useLocation();
    location.href = `${current.pathname}${current.search}`;
    return null;
  }

  async function render(props: Parameters<typeof Harness>[0]) {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={[entry]}>
          <TooltipProvider>
            <Harness {...props} />
          </TooltipProvider>
        </MemoryRouter>,
      ),
    );
    // Lets a scroll scheduled for the next frame run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function rail() {
    const list = container.querySelector("[data-rail]");
    return list
      ? [...list.querySelectorAll("[data-rail-thread]")].map(
          (item) => item.textContent,
        )
      : null;
  }

  function selectedTab() {
    return container
      .querySelector('[role="tab"][aria-selected="true"]')
      ?.getAttribute("data-block-field-id");
  }

  async function clickTab(id: string) {
    await act(async () =>
      container
        .querySelector<HTMLElement>(
          `[role="tab"][data-block-field-id="${id}"]`,
        )!
        .click(),
    );
  }

  const threads = [
    thread("body-1", null),
    thread("notes-1", "notes"),
    thread("gone-1", "gone"),
    propertyThread(),
  ];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0),
    );
    scrolled.length = 0;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
      scrolled.push(this.getAttribute("data-comment-thread") ?? "");
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    entry = "/page/doc-1";
    renders = [];
    mocks.editors.clear();
    onComment.mockReset();
    localStorage.clear();
    setFields([content(), notes()]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    __resetBlockFieldSaveRegistry();
    vi.unstubAllGlobals();
  });

  it("shows only the open tab's threads in the margin, and Property threads on every tab (CMT-1)", async () => {
    await render({ threads });
    expect(rail()).toEqual(["body-1", "property-thread"]);
    expect(latest.railShowsSuggestions).toBe(true);

    await clickTab("notes");
    expect(rail()).toEqual(["notes-1", "property-thread"]);
    expect(latest.railShowsSuggestions).toBe(false);
    // Each editor highlights only its own threads.
    expect(
      container.querySelector('[data-visual-editor="Notes text"]')?.innerHTML,
    ).toBe('<span data-comment-thread="notes-1"></span>');
  });

  it("keeps a comment from before field comments on the body's tab (CMT-6)", async () => {
    const legacy = thread("legacy", null);
    delete legacy.field;
    await render({ threads: [legacy, thread("notes-1", "notes")] });
    expect(rail()).toEqual(["legacy"]);

    await clickTab("notes");
    expect(rail()).toEqual(["notes-1"]);
  });

  it("opens a thread's tab and scrolls to its highlight, holding the margin until then (CMT-5)", async () => {
    await render({ threads });
    expect(selectedTab()).toBe("content");

    await render({ threads, selectedThreadId: "notes-1" });
    expect(selectedTab()).toBe("notes");
    expect(location.href).toBe("/page/doc-1?field=notes");
    expect(rail()).toEqual(["notes-1", "property-thread"]);
    expect(scrolled).toEqual(["notes-1"]);
    // No render showed the margin for another tab while the thread was open,
    // which would have dropped the selection.
    expect(
      renders.filter(
        (entry) =>
          entry.target === "notes-1" &&
          !entry.pending &&
          entry.open !== "notes",
      ),
    ).toEqual([]);
    expect(renders.some((entry) => entry.pending)).toBe(true);
  });

  it("opens the body's tab for a body thread or a suggestion (CMT-5)", async () => {
    entry = "/page/doc-1?field=notes";
    await render({ threads });
    expect(selectedTab()).toBe("notes");

    await render({ threads, selectedThreadId: "body-1" });
    expect(selectedTab()).toBe("content");
    expect(scrolled).toEqual(["body-1"]);

    await clickTab("notes");
    await render({ threads, focusSuggestionId: "suggestion-1" });
    expect(selectedTab()).toBe("content");
  });

  it("opens the tab only once, so another tab can be opened while the thread stays selected", async () => {
    await render({ threads, selectedThreadId: "notes-1" });
    expect(selectedTab()).toBe("notes");

    await clickTab("content");
    await render({ threads, selectedThreadId: "notes-1" });
    expect(selectedTab()).toBe("content");
    expect(latest.tabSwitchPending).toBe(false);
  });

  it("opens nothing for a thread in a deleted tab or on a Property", async () => {
    await render({ threads, selectedThreadId: "gone-1" });
    expect(selectedTab()).toBe("content");
    expect(latest.tabSwitchPending).toBe(false);
    expect(rail()).not.toBeNull();

    await clickTab("notes");
    await render({ threads, selectedThreadId: "property-thread" });
    expect(selectedTab()).toBe("notes");
    expect(latest.tabSwitchPending).toBe(false);
  });

  it("waits for the fields to load before opening a thread's tab", async () => {
    mocks.query = { data: undefined, isError: false, isRefetching: false };
    await render({ threads, selectedThreadId: "notes-1" });
    expect(latest.tabSwitchPending).toBe(true);
    expect(rail()).toBeNull();

    setFields([content(), notes()]);
    await render({ threads, selectedThreadId: "notes-1" });
    expect(selectedTab()).toBe("notes");
    expect(rail()).toEqual(["notes-1", "property-thread"]);
  });

  it("highlights a new comment in its own tab, and shows its card only there", async () => {
    const range = { from: 1, to: 6 };
    const pendingComment = {
      quotedText: "Notes",
      offsetTop: 0,
      range,
      fieldId: "notes",
    };
    await render({ threads, pendingComment });
    expect(latest.pendingVisible).toBe(false);
    expect(latest.bodyPendingHighlight).toBeNull();
    expect(mocks.editors.get("Notes text")?.pendingHighlight).toBe(range);

    await clickTab("notes");
    expect(latest.pendingVisible).toBe(true);

    await render({
      threads,
      pendingComment: { quotedText: "Content", offsetTop: 0, range },
    });
    expect(latest.pendingVisible).toBe(false);
    expect(latest.bodyPendingHighlight).toBe(range);
    expect(mocks.editors.get("Notes text")?.pendingHighlight).toBeNull();
  });

  it("names the field when text in its tab is commented on (CMT-1)", async () => {
    await render({ threads });
    const editor = mocks.editors.get("Notes text")!;
    (editor.onComment as (...args: unknown[]) => void)("Notes", 12);
    expect(onComment).toHaveBeenCalledWith(
      "notes",
      "Notes",
      12,
      undefined,
      undefined,
    );
  });
});
