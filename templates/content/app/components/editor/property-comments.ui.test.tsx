// @vitest-environment happy-dom

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

describe("PropertyCommentControl", () => {
  function controls(overrides: Partial<PropertyCommentsValue> = {}) {
    return {
      canComment: true,
      openThreadsByProperty: new Map(),
      pendingPropertyId: null,
      activeThreadId: null,
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
});
