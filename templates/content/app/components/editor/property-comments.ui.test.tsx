// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import type { DocumentProperty } from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import { richEditor, setRichEditorValue } from "./comment-composer-test-utils";
import { CommentDraftProvider } from "./comment-drafts";
import {
  CommentsSidebar,
  useCommentReplyDrafts,
  usePendingCommentDraft,
} from "./CommentsSidebar";
import {
  PropertyCommentControl,
  PropertyCommentsContext,
  openThreadsByProperty,
  propertyThreadTarget,
  revealPendingComment,
  threadPropertyId,
  type PropertyCommentsValue,
} from "./property-comments";

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

const score = (value: number): DocumentProperty =>
  ({
    definition: { id: "score", name: "Score", type: "number", options: {} },
    value,
    editable: true,
  }) as DocumentProperty;

function thread(
  threadId: string,
  property: CommentThread["property"],
): CommentThread {
  return {
    threadId,
    quotedText: null,
    resolved: false,
    property,
    comments: [
      {
        id: threadId,
        document_id: "row-1",
        thread_id: threadId,
        parent_id: null,
        content: "This should be 8",
        quoted_text: null,
        property_id: property?.propertyId ?? null,
        property_name: property?.propertyName ?? null,
        property_value: property?.propertyValue ?? null,
        mentions: [],
        author_email: "reviewer@example.test",
        author_name: "Reviewer",
        resolved: 0,
        created_at: "2026-10-18T10:00:00.000Z",
        updated_at: "2026-10-18T10:00:00.000Z",
      },
    ],
  } as unknown as CommentThread;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

async function render(children: ReactNode) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <CommentDraftProvider documentId="row-1">
            {children}
          </CommentDraftProvider>
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  );
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 75));
  });

describe("Property comments in the comments sidebar", () => {
  it("labels a new Property comment and sends the Property instead of a quote", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "c1", threadId: "c1" }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    let owner!: ReturnType<typeof usePendingCommentDraft>;
    function Owner() {
      owner = usePendingCommentDraft("row-1");
      const replyDrafts = useCommentReplyDrafts("row-1");
      return (
        <CommentsSidebar
          documentId="row-1"
          replyDrafts={replyDrafts}
          documentProperties={[score(5)]}
          pendingComment={owner.pendingComment}
          onPendingChange={owner.changePendingComment}
          onPendingDone={(id) => owner.completePendingComment(id)}
          alignToAnchors={false}
          forceVisible
        />
      );
    }
    await render(<Owner />);
    await act(async () =>
      owner.setPendingComment({
        quotedText: "",
        offsetTop: 0,
        property: {
          propertyId: "score",
          propertyName: "Score",
          propertyValue: "5",
        },
        databaseId: "db-1",
      }),
    );
    await settle();
    const label = container.querySelector("[data-comment-property-target]");
    expect(label?.getAttribute("data-comment-property-target")).toBe("current");
    expect(label?.textContent).toContain("Score");
    expect(label?.textContent).toContain("5");
    expect(label?.querySelector(".truncate")).toBeNull();
    expect(container.textContent).not.toContain("comments.selectTextToComment");

    await setRichEditorValue(richEditor(container)!, "This should be 8");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((node) => node.getAttribute("aria-label") === "comments.submit")!
        .click(),
    );
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string);
    expect(body).toMatchObject({
      documentId: "row-1",
      content: "This should be 8",
      propertyId: "score",
      databaseId: "db-1",
    });
    expect(body).not.toHaveProperty("quotedText");
  });

  it("shows what a Property was, and that it was removed, without a missing-highlight warning", async () => {
    function Sidebar({ properties }: { properties: DocumentProperty[] }) {
      const replyDrafts = useCommentReplyDrafts("row-1");
      return (
        <CommentsSidebar
          documentId="row-1"
          replyDrafts={replyDrafts}
          threads={[
            thread("t1", {
              propertyId: "score",
              propertyName: "Score",
              propertyValue: "5",
            }),
          ]}
          documentProperties={properties}
          alignToAnchors={false}
          forceVisible
        />
      );
    }
    await render(<Sidebar properties={[score(8)]} />);
    await settle();
    const target = () =>
      container.querySelector("[data-comment-property-target]");
    expect(target()?.getAttribute("data-comment-property-target")).toBe(
      "changed",
    );
    expect(target()?.textContent).toContain(
      'comments.propertyWas:{"value":"5"}',
    );
    expect(container.textContent).not.toContain("comments.unanchored");

    await render(<Sidebar properties={[]} />);
    await settle();
    expect(target()?.getAttribute("data-comment-property-target")).toBe(
      "removed",
    );
    expect(target()?.textContent).toContain(
      'comments.propertyRemoved:{"name":"Score"}',
    );
  });

  it("shows a thread's Property in Info from Discussion, while the Property is there", async () => {
    const showSubject = vi.fn();
    const scoreThread = thread("t1", {
      propertyId: "score",
      propertyName: "Score",
      propertyValue: "5",
    });
    function Discussion({ properties }: { properties: DocumentProperty[] }) {
      const replyDrafts = useCommentReplyDrafts("row-1");
      return (
        <CommentsSidebar
          documentId="row-1"
          replyDrafts={replyDrafts}
          threads={[scoreThread]}
          documentProperties={properties}
          presentation="history"
          onShowThreadSubject={showSubject}
          forceVisible
        />
      );
    }
    await render(<Discussion properties={[score(5)]} />);
    await settle();
    const subject = () =>
      container.querySelector<HTMLElement>(
        '[data-discussion-subject="property"]',
      );
    expect(subject()?.tagName).toBe("BUTTON");
    expect(subject()?.getAttribute("aria-label")).toBe(
      'comments.showPropertyInInfo:{"property":"Score"}',
    );
    expect(subject()?.textContent).toContain("Score · 5");
    // A Property's value shows in full.
    expect(subject()?.querySelector(".line-clamp-2")).toBeNull();
    await act(async () => subject()?.click());
    expect(showSubject).toHaveBeenCalledWith(scoreThread);

    // A removed Property has nowhere to show.
    await render(<Discussion properties={[]} />);
    await settle();
    expect(subject()?.tagName).toBe("DIV");
  });
});

describe("a Property's threads under its row in Info", () => {
  it("lists them flat with no line naming the Property, and writes a new one there", async () => {
    let owner!: ReturnType<typeof usePendingCommentDraft>;
    function Info() {
      owner = usePendingCommentDraft("row-1");
      const replyDrafts = useCommentReplyDrafts("row-1");
      return (
        <CommentsSidebar
          documentId="row-1"
          replyDrafts={replyDrafts}
          threads={[
            thread("t1", {
              propertyId: "score",
              propertyName: "Score",
              propertyValue: "5",
            }),
            thread("t2", {
              propertyId: "score",
              propertyName: "Score",
              propertyValue: "5",
            }),
          ]}
          documentProperties={[score(5)]}
          pendingComment={owner.pendingComment}
          onPendingChange={owner.changePendingComment}
          onPendingDone={(id) => owner.completePendingComment(id)}
          alignToAnchors={false}
          surface="panel"
          underSubject
          forceVisible
        />
      );
    }
    await render(<Info />);
    await settle();
    const cards = [...container.querySelectorAll("[data-thread-card]")];
    expect(cards.map((card) => card.getAttribute("data-thread-card"))).toEqual([
      "t1",
      "t2",
    ]);
    expect(
      cards.every(
        (card) => card.getAttribute("data-comment-surface") === "panel",
      ),
    ).toBe(true);
    expect(
      container.querySelector("[data-comment-property-target]"),
    ).toBeNull();
    expect(container.querySelector("[data-discussion-subject]")).toBeNull();
    for (const layout of container.querySelectorAll<HTMLElement>(
      "[data-comment-layout-thread]",
    ))
      expect(layout.style.marginTop).toBe("");

    await act(async () =>
      owner.setPendingComment({
        quotedText: "",
        offsetTop: 0,
        property: {
          propertyId: "score",
          propertyName: "Score",
          propertyValue: "5",
        },
        databaseId: "db-1",
      }),
    );
    await settle();
    expect(container.querySelector("[data-comment-pending]")).not.toBeNull();
    expect(richEditor(container)).toBeTruthy();
    expect(
      container.querySelector("[data-comment-property-target]"),
    ).toBeNull();
  });
});

describe("a Property's threads with a suggested edit selected on the Page", () => {
  it("leaves the suggested edit out from under the Property", async () => {
    const pageEdit = {
      id: "edit-1",
      proposalId: null,
      revision: 1,
      resourceType: "document",
      resourceId: "row-1",
      adapterKind: "markdown",
      adapterVersion: 1,
      threadId: "suggestion-edit-1",
      authorEmail: "reviewer@example.test",
      actorKind: "human",
      baseRevision: "base",
      status: "pending",
      summary: "Tighten the intro",
      ownerEmail: "reviewer@example.test",
      orgId: null,
      visibility: "private",
      createdAt: "2026-10-18T11:00:00Z",
      updatedAt: "2026-10-18T11:00:00Z",
      metadata: null,
      operations: [],
    } as ResourceSuggestion;
    function Info() {
      const owner = usePendingCommentDraft("row-1");
      const replyDrafts = useCommentReplyDrafts("row-1");
      return (
        <CommentsSidebar
          documentId="row-1"
          replyDrafts={replyDrafts}
          threads={[
            thread("t1", {
              propertyId: "score",
              propertyName: "Score",
              propertyValue: "5",
            }),
          ]}
          documentProperties={[score(5)]}
          pendingComment={owner.pendingComment}
          onPendingChange={owner.changePendingComment}
          onPendingDone={(id) => owner.completePendingComment(id)}
          suggestions={[pageEdit]}
          activeSuggestionId="edit-1"
          alignToAnchors={false}
          surface="panel"
          underSubject
          forceVisible
        />
      );
    }
    await render(<Info />);
    await settle();
    expect(
      [...container.querySelectorAll("[data-thread-card]")].map((card) =>
        card.getAttribute("data-thread-card"),
      ),
    ).toEqual(["t1"]);
    expect(container.querySelector("[data-suggestion-id]")).toBeNull();
  });
});

describe("propertyThreadTarget", () => {
  it("shows each reader their own value when none was recorded", () => {
    const candidate = {
      definition: {
        id: "candidate",
        name: "Candidate",
        type: "relation",
        options: {},
      },
      value: ["row-a"],
      relationTargets: [{ documentId: "row-a", title: "Jane Doe" }],
      editable: true,
    } as unknown as DocumentProperty;
    const recorded = {
      propertyId: "candidate",
      propertyName: "Candidate",
      propertyValue: null,
    };
    expect(propertyThreadTarget(recorded, [candidate])).toEqual({
      name: "Candidate",
      value: "Jane Doe",
      state: "current",
    });
    expect(propertyThreadTarget(recorded, [])).toEqual({
      name: "Candidate",
      value: null,
      state: "removed",
    });
  });

  it("reads a remembered date the way the table shows it", () => {
    const due = {
      definition: { id: "due", name: "Due", type: "date", options: {} },
      value: "2026-11-02",
      editable: true,
    } as unknown as DocumentProperty;
    const day = (month: number, date: number) =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(2026, month - 1, date));
    expect(
      propertyThreadTarget(
        { propertyId: "due", propertyName: "Due", propertyValue: "2026-11-02" },
        [due],
      ),
    ).toEqual({ name: "Due", value: day(11, 2), state: "current" });
    expect(
      propertyThreadTarget(
        {
          propertyId: "due",
          propertyName: "Due",
          propertyValue: "2026-10-30 - 2026-11-02",
        },
        [due],
      ),
    ).toEqual({
      name: "Due",
      value: `${day(10, 30)} - ${day(11, 2)}`,
      state: "changed",
    });
    // Recorded while Due was still a number.
    expect(
      propertyThreadTarget(
        { propertyId: "due", propertyName: "Due", propertyValue: "12" },
        [due],
      ),
    ).toEqual({ name: "Due", value: "12", state: "changed" });
  });
});

describe("threadPropertyId", () => {
  const onProperty = (propertyId: string) => ({
    propertyId,
    propertyName: propertyId,
    propertyValue: null,
  });
  const threads = [
    thread("open", onProperty("a")),
    { ...thread("resolved", onProperty("b")), resolved: true },
    thread("body", null),
  ];

  it("finds the Property of an open or a resolved thread", () => {
    expect(threadPropertyId(threads, "open")).toBe("a");
    expect(threadPropertyId(threads, "resolved")).toBe("b");
  });

  it("has none for a thread off any Property, or no thread", () => {
    expect(threadPropertyId(threads, "body")).toBeNull();
    expect(threadPropertyId(threads, null)).toBeNull();
    expect(threadPropertyId(undefined, "open")).toBeNull();
  });
});

describe("revealPendingComment", () => {
  const selector = '[data-property-threads="a"] [data-comment-pending]';
  let scope: HTMLElement;

  function drawBox() {
    const threads = document.createElement("div");
    threads.setAttribute("data-property-threads", "a");
    const box = document.createElement("div");
    box.setAttribute("data-comment-pending", "");
    threads.append(box);
    scope.append(threads);
    return box;
  }

  /** Lets the page deliver anything it was going to tell an observer. */
  function nextTask() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    scope = document.createElement("div");
    document.body.append(scope);
  });

  afterEach(() => {
    scope.remove();
    vi.useRealTimers();
  });

  it("reveals a box already drawn at once", () => {
    const box = drawBox();
    const reveal = vi.fn();

    expect(revealPendingComment(scope, selector, reveal)).toBeUndefined();
    expect(reveal).toHaveBeenCalledWith(box);
  });

  it("reveals a box once Info draws it after reading its Properties", async () => {
    const reveal = vi.fn();
    const stop = revealPendingComment(scope, selector, reveal);
    expect(reveal).not.toHaveBeenCalled();

    const box = drawBox();
    await vi.waitFor(() => expect(reveal).toHaveBeenCalledWith(box));

    drawBox();
    await nextTask();
    expect(reveal).toHaveBeenCalledTimes(1);
    stop?.();
  });

  it("stops waiting after a few seconds, or when cleaned up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const late = vi.fn();
    revealPendingComment(scope, selector, late);
    vi.advanceTimersByTime(5_000);
    vi.useRealTimers();
    drawBox();
    await nextTask();
    expect(late).not.toHaveBeenCalled();

    scope.replaceChildren();
    const cancelled = vi.fn();
    revealPendingComment(scope, selector, cancelled)?.();
    drawBox();
    await nextTask();
    expect(cancelled).not.toHaveBeenCalled();
  });
});

describe("PropertyCommentControl", () => {
  function controls(overrides: Partial<PropertyCommentsValue> = {}) {
    return {
      canComment: true,
      openThreadsByProperty: new Map(),
      pendingPropertyId: null,
      activeThreadId: null,
      selectedPropertyId: null,
      startComment: vi.fn(),
      openThread: vi.fn(),
      ...overrides,
    } satisfies PropertyCommentsValue;
  }

  it("starts a comment on a Property with no open threads", async () => {
    const value = controls();
    await render(
      <PropertyCommentsContext.Provider value={value}>
        <PropertyCommentControl property={score(5)} />
      </PropertyCommentsContext.Provider>,
    );
    const start = container.querySelector<HTMLButtonElement>(
      "[data-property-comment-start]",
    )!;
    expect(start.getAttribute("aria-label")).toBe(
      'comments.commentOnProperty:{"name":"Score"}',
    );
    await act(async () => start.click());
    expect(value.startComment).toHaveBeenCalledWith(score(5));
  });

  it("marks open threads and opens the latest one", async () => {
    const older = thread("older", {
      propertyId: "score",
      propertyName: "Score",
      propertyValue: "5",
    });
    const latest = thread("latest", {
      propertyId: "score",
      propertyName: "Score",
      propertyValue: "6",
    });
    const value = controls({
      openThreadsByProperty: openThreadsByProperty([
        older,
        latest,
        { ...thread("resolved", older.property), resolved: true },
      ]),
    });
    await render(
      <PropertyCommentsContext.Provider value={value}>
        <PropertyCommentControl property={score(6)} />
      </PropertyCommentsContext.Provider>,
    );
    const marker = container.querySelector<HTMLButtonElement>(
      "[data-property-comment-marker]",
    )!;
    expect(marker.getAttribute("data-comment-thread")).toBe("latest");
    expect(marker.textContent).toBe("2");
    expect(
      [...marker.querySelectorAll("[data-comment-thread]")].map((node) =>
        node.getAttribute("data-comment-thread"),
      ),
    ).toEqual(["older"]);
    await act(async () => marker.click());
    expect(value.openThread).toHaveBeenCalledWith("latest");
    expect(container.querySelector("[data-property-comment-start]")).toBeNull();
  });

  it("opens and closes the threads under the row in Info", async () => {
    const value = controls({
      openThreadsByProperty: openThreadsByProperty([
        thread("only", {
          propertyId: "score",
          propertyName: "Score",
          propertyValue: "5",
        }),
      ]),
    });
    const toggle = vi.fn();
    const renderInfo = (openPropertyId: string | null) =>
      render(
        <PropertyCommentsContext.Provider
          value={{
            ...value,
            inline: { openPropertyId, toggle, renderThreads: () => null },
          }}
        >
          <PropertyCommentControl property={score(5)} />
        </PropertyCommentsContext.Provider>,
      );
    await renderInfo(null);
    const marker = () =>
      container.querySelector<HTMLButtonElement>(
        "[data-property-comment-marker]",
      );
    expect(marker()?.textContent).toBe("1");
    expect(marker()?.getAttribute("aria-expanded")).toBe("false");
    // Info has no margin to place it in, and the page opens a thread at its
    // place when clicked.
    expect(marker()?.hasAttribute("data-comment-thread")).toBe(false);
    await act(async () => marker()?.click());
    expect(toggle).toHaveBeenCalledWith("score");
    expect(value.openThread).not.toHaveBeenCalled();

    await renderInfo("score");
    expect(marker()?.getAttribute("aria-expanded")).toBe("true");
  });

  it("leaves aria-expanded off the count beside the page", async () => {
    await render(
      <PropertyCommentsContext.Provider
        value={controls({
          openThreadsByProperty: openThreadsByProperty([
            thread("only", {
              propertyId: "score",
              propertyName: "Score",
              propertyValue: "5",
            }),
          ]),
        })}
      >
        <PropertyCommentControl property={score(5)} />
      </PropertyCommentsContext.Provider>,
    );
    expect(
      container
        .querySelector("[data-property-comment-marker]")
        ?.hasAttribute("aria-expanded"),
    ).toBe(false);
  });
});
