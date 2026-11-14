// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { Comment, CommentThread } from "@/hooks/use-comments";

import {
  commentThreadOrderFacts,
  compareDiscussionEntries,
  discussionThreadTarget,
  discussionTime,
  isPageCommentThread,
  suggestionMatchesSearch,
  threadMatchesSearch,
  threadMentions,
  type DiscussionSort,
} from "./discussion-panel";

const at = (minute: number) =>
  `2026-10-21T12:${String(minute).padStart(2, "0")}:00.000Z`;

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "comment",
    document_id: "page",
    thread_id: "thread",
    parent_id: null,
    content: "Filler comment",
    quoted_text: null,
    anchor_prefix: null,
    anchor_suffix: null,
    anchor_start_offset: null,
    mentions: [],
    author_email: "reviewer@example.test",
    author_name: "Reviewer",
    resolved: 0,
    created_at: at(0),
    updated_at: at(0),
    notion_comment_id: null,
    ...overrides,
  };
}

function thread(
  threadId: string,
  overrides: Partial<CommentThread> = {},
  createdMinute = 0,
): CommentThread {
  return {
    threadId,
    quotedText: null,
    prefix: null,
    suffix: null,
    startOffset: null,
    resolved: false,
    comments: [
      comment({
        id: `${threadId}-root`,
        thread_id: threadId,
        created_at: at(createdMinute),
      }),
    ],
    ...overrides,
  };
}

const property = (propertyId: string) => ({
  propertyId,
  propertyName: propertyId,
  propertyValue: null,
});

// Where each highlight shows on the page, and the Page's Property order.
const documentTops = new Map([
  ["text-high", 100],
  ["text-low", 400],
]);
const propertyOrder = ["priority", "status"];

function order(sort: DiscussionSort, threads: CommentThread[]) {
  return threads
    .map((entry) =>
      commentThreadOrderFacts(entry, {
        documentTop: documentTops.get(entry.threadId),
        propertyIndex: (id) => propertyOrder.indexOf(id),
      }),
    )
    .sort((left, right) => compareDiscussionEntries(sort, left, right))
    .map((facts) => facts.id);
}

describe("Discussion order", () => {
  it("puts the page first, then Properties, then text by where it shows, then text that doesn't show", () => {
    const threads = [
      thread("orphan-late", { quotedText: "Gone", startOffset: 90 }),
      thread("text-low", { quotedText: "Lower" }),
      thread("property-second", { property: property("status") }),
      thread("page-late", {}, 5),
      thread("orphan-unplaced", { quotedText: "Nowhere" }),
      thread("text-high", { quotedText: "Higher" }, 9),
      thread("property-removed", { property: property("removed") }),
      thread("orphan-early", { quotedText: "Gone too", startOffset: 10 }),
      thread("property-first", { property: property("priority") }, 9),
      thread("page-early", {}, 2),
    ];

    expect(order("page", threads)).toEqual([
      "page-early",
      "page-late",
      "property-first",
      "property-second",
      "property-removed",
      "text-high",
      "text-low",
      "orphan-early",
      "orphan-late",
      "orphan-unplaced",
    ]);
  });

  it("breaks page-order ties by when each thread started, then by id", () => {
    const threads = [
      thread("same-time-b", { property: property("status") }, 4),
      thread("later", { property: property("status") }, 6),
      thread("same-time-a", { property: property("status") }, 4),
      thread("unplaced-later", { quotedText: "Nowhere" }, 8),
      thread("unplaced-earlier", { quotedText: "Nowhere" }, 1),
    ];

    expect(order("page", threads)).toEqual([
      "same-time-a",
      "same-time-b",
      "later",
      "unplaced-earlier",
      "unplaced-later",
    ]);
  });

  it("sorts by newest activity, counting replies", () => {
    const replied = thread("replied", {}, 1);
    replied.comments.push(
      comment({
        id: "reply",
        thread_id: "replied",
        parent_id: "replied-root",
        created_at: at(9),
      }),
    );
    const threads = [
      thread("text-high", { quotedText: "Higher" }, 3),
      replied,
      thread("property-first", { property: property("priority") }, 5),
    ];

    expect(order("activity", threads)).toEqual([
      "replied",
      "property-first",
      "text-high",
    ]);
  });

  it("sorts oldest first whatever each thread points at", () => {
    const threads = [
      thread("page", {}, 7),
      thread("property", { property: property("priority") }, 5),
      thread("text", { quotedText: "Higher" }, 1),
      thread("orphan", { quotedText: "Gone", startOffset: 0 }, 3),
    ];

    expect(order("oldest", threads)).toEqual([
      "text",
      "orphan",
      "property",
      "page",
    ]);
  });

  it("records each thread's rank and position", () => {
    const facts = (entry: CommentThread, documentTop?: number) =>
      commentThreadOrderFacts(entry, {
        documentTop,
        propertyIndex: (id) => propertyOrder.indexOf(id),
      });

    expect(facts(thread("page"))).toMatchObject({ rank: 0, position: 0 });
    expect(
      facts(thread("property", { property: property("status") })),
    ).toMatchObject({ rank: 1, position: 1 });
    expect(
      facts(thread("removed", { property: property("removed") })),
    ).toMatchObject({ rank: 1, position: Infinity });
    expect(facts(thread("shown", { quotedText: "Text" }), 240)).toMatchObject({
      rank: 2,
      position: 240,
    });
    expect(
      facts(thread("hidden", { quotedText: "Text", startOffset: 30 })),
    ).toMatchObject({ rank: 3, position: 30 });
  });
});

describe("discussionThreadTarget", () => {
  it("tells the page, text, and Property threads apart", () => {
    expect(discussionThreadTarget({ quotedText: null, property: null })).toBe(
      "page",
    );
    expect(discussionThreadTarget({ quotedText: "   " })).toBe("page");
    expect(discussionThreadTarget({ quotedText: "A sentence" })).toBe("text");
    expect(
      discussionThreadTarget({ quotedText: "", property: property("status") }),
    ).toBe("property");
    expect(
      discussionThreadTarget({
        quotedText: "Draft",
        property: property("status"),
      }),
    ).toBe("property");
    expect(isPageCommentThread({ quotedText: "" })).toBe(true);
    expect(isPageCommentThread({ quotedText: "A sentence" })).toBe(false);
    expect(
      isPageCommentThread({ quotedText: null, property: property("status") }),
    ).toBe(false);
  });
});

describe("threadMatchesSearch", () => {
  const onText = thread("text", {
    quotedText: "The launch plan",
    comments: [
      comment({
        content: "Needs a date",
        author_name: "Ada Lovelace",
        author_email: "ada@example.test",
      }),
      comment({
        id: "reply",
        parent_id: "comment",
        content: "Agreed",
        author_name: null,
        author_email: "grace@example.test",
      }),
    ],
  });
  const onProperty = thread("property", {
    property: {
      propertyId: "status",
      propertyName: "Status",
      propertyValue: "In review",
    },
  });

  it("matches the quote, the words, and the people, ignoring case", () => {
    expect(threadMatchesSearch(onText, "LAUNCH")).toBe(true);
    expect(threadMatchesSearch(onText, " needs a ")).toBe(true);
    expect(threadMatchesSearch(onText, "ada lovelace")).toBe(true);
    expect(threadMatchesSearch(onText, "grace@example")).toBe(true);
    expect(threadMatchesSearch(onText, "budget")).toBe(false);
  });

  it("matches a Property's name and value", () => {
    expect(threadMatchesSearch(onProperty, "status")).toBe(true);
    expect(threadMatchesSearch(onProperty, "in review")).toBe(true);
    expect(threadMatchesSearch(onProperty, "launch")).toBe(false);
  });

  it("matches everything for a blank search", () => {
    expect(threadMatchesSearch(onProperty, "   ")).toBe(true);
  });

  it("matches a suggested edit's summary and author", () => {
    const suggestion = {
      summary: "Tighten the intro",
      authorEmail: "ada@example.test",
    };
    expect(suggestionMatchesSearch(suggestion, "INTRO")).toBe(true);
    expect(suggestionMatchesSearch(suggestion, "ada@")).toBe(true);
    expect(suggestionMatchesSearch(suggestion, "outro")).toBe(false);
    expect(suggestionMatchesSearch(suggestion, "")).toBe(true);
  });

  it("matches the words a suggested edit changes, even with no summary", () => {
    const draft = {
      authorEmail: null,
      operations: [
        { kind: "replace_text", before: "Old wording", after: "New wording" },
        {
          kind: "add_text_block",
          block: {
            type: "paragraph",
            content: [{ type: "text", text: "An added paragraph" }],
          },
        },
        {
          kind: "set_inline_mark",
          before: [[]],
          after: [[{ type: "bold" }]],
        },
      ],
    };
    expect(suggestionMatchesSearch(draft, "old word")).toBe(true);
    expect(suggestionMatchesSearch(draft, "new wording")).toBe(true);
    expect(suggestionMatchesSearch(draft, "added para")).toBe(true);
    // A mark is not words on the page.
    expect(suggestionMatchesSearch(draft, "bold")).toBe(false);
  });
});

describe("discussionTime", () => {
  it("reads Postgres timestamp text the way it reads ISO", () => {
    expect(discussionTime("2026-10-21 12:34:56.789+00")).toBe(
      Date.parse("2026-10-21T12:34:56.789Z"),
    );
    expect(discussionTime("2026-10-21 20:23:32.584-05")).toBe(
      Date.parse("2026-10-22T01:23:32.584Z"),
    );
    expect(discussionTime("2026-10-21T12:00:00.000Z")).toBe(
      Date.parse("2026-10-21T12:00:00.000Z"),
    );
  });

  it("sorts newest activity across both forms", () => {
    const iso = thread("iso", {}, 0);
    iso.comments[0]!.created_at = "2026-10-21T12:10:00.000Z";
    const postgres = thread("postgres", {}, 0);
    postgres.comments[0]!.created_at = "2026-10-21 12:20:00+00";
    expect(order("activity", [iso, postgres])).toEqual(["postgres", "iso"]);
  });
});

describe("threadMentions", () => {
  const mentioned = thread("mentioned", {
    comments: [
      comment({
        mentions: [{ kind: "agent", model: "model", name: "Ada" }],
      }),
      comment({
        id: "reply",
        parent_id: "comment",
        mentions: [{ kind: "person", email: "Ada@Example.test", name: "Ada" }],
      }),
    ],
  });

  it("finds a person mentioned in any comment, ignoring case and spaces", () => {
    expect(threadMentions(mentioned, " ada@example.TEST ")).toBe(true);
    expect(threadMentions(mentioned, "grace@example.test")).toBe(false);
  });

  it("finds nobody without an email to look for", () => {
    expect(threadMentions(mentioned, null)).toBe(false);
    expect(threadMentions(mentioned, undefined)).toBe(false);
    expect(threadMentions(mentioned, "  ")).toBe(false);
  });
});
