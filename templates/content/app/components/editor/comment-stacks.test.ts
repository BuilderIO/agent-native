// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { CommentThread } from "@/hooks/use-comments";

import {
  commentBlockKey,
  commentStackFront,
  commentStackKey,
  commentThreadReplyCount,
  groupCommentStacks,
  measureCommentBlocks,
} from "./comment-stacks";

function thread(
  id: string,
  {
    fieldId = null,
    resolved = false,
    property = false,
    times = ["2026-10-20T12:00:00Z"],
  }: {
    fieldId?: string | null;
    resolved?: boolean;
    property?: boolean;
    times?: string[];
  } = {},
): CommentThread {
  return {
    threadId: id,
    quotedText: property ? null : `quote ${id}`,
    prefix: null,
    suffix: null,
    startOffset: 0,
    field: fieldId ? { fieldId, fieldName: fieldId } : null,
    property: property
      ? { propertyId: "status", propertyName: "Status", propertyValue: "Open" }
      : null,
    resolved,
    comments: times.map((created_at, index) => ({
      id: `${id}-${index}`,
      document_id: "fixture",
      thread_id: id,
      parent_id: index === 0 ? null : `${id}-0`,
      content: `Comment ${id} ${index}`,
      quoted_text: property ? null : `quote ${id}`,
      anchor_prefix: null,
      anchor_suffix: null,
      anchor_start_offset: 0,
      mentions: [],
      author_email: "reviewer@example.test",
      author_name: "Reviewer",
      resolved: resolved ? 1 : 0,
      created_at,
      updated_at: created_at,
      notion_comment_id: null,
      submission_source: "frontend",
    })),
  };
}

function editor(html: string) {
  const root = document.createElement("div");
  root.innerHTML = `<div class="ProseMirror">${html}</div>`;
  return root;
}

function highlight(root: ParentNode, threadId: string) {
  return root.querySelector(`[data-comment-thread="${threadId}"]`)!;
}

describe("comment stack blocks", () => {
  it("puts highlights in the same top-level block together", () => {
    const root = editor(
      `<p>One <span data-comment-thread="a">a</span> and <strong><span data-comment-thread="b">b</span></strong></p>
       <p><span data-comment-thread="c">c</span></p>`,
    );
    expect(commentBlockKey(highlight(root, "a"))).toBe(
      commentBlockKey(highlight(root, "b")),
    );
    expect(commentBlockKey(highlight(root, "a"))).not.toBe(
      commentBlockKey(highlight(root, "c")),
    );
  });

  it("counts each list item as its own block, nested ones included", () => {
    const root = editor(
      `<ul>
         <li><p><span data-comment-thread="first">x</span> <span data-comment-thread="also-first">y</span></p>
           <ul><li><p><span data-comment-thread="nested">z</span></p></li></ul>
         </li>
         <li><p><span data-comment-thread="second">w</span></p></li>
       </ul>`,
    );
    const key = (id: string) => commentBlockKey(highlight(root, id));
    expect(key("first")).toBe(key("also-first"));
    expect(new Set([key("first"), key("nested"), key("second")]).size).toBe(3);
  });

  it("has no block for a highlight outside an editor", () => {
    const root = document.createElement("div");
    root.innerHTML = `<p><span data-comment-thread="loose">x</span></p>`;
    expect(commentBlockKey(highlight(root, "loose"))).toBeNull();
  });

  it("keys a stack by its tab as well as its block", () => {
    expect(commentStackKey(null, "0")).not.toBe(commentStackKey("notes", "0"));
  });

  it("measures each thread's first highlight in document order, skipping closed tabs", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-block-field-panel data-block-field-id="content"><div class="ProseMirror">
        <p><span data-comment-thread="b">b</span> <span data-comment-thread="a">a</span></p>
        <p><span data-comment-thread="b">b again</span></p>
      </div></div>
      <div data-block-field-panel data-block-field-id="notes" hidden><div class="ProseMirror">
        <p><span data-comment-thread="n">n</span></p>
      </div></div>`;
    const blocks = measureCommentBlocks(root, [
      thread("a"),
      thread("b"),
      thread("n", { fieldId: "notes" }),
      thread("p", { property: true }),
    ]);
    expect([...blocks.keys()]).toEqual(["b", "a"]);
    expect(blocks.get("a")?.key).toBe(blocks.get("b")?.key);
    expect(blocks.get("b")!.order).toBeLessThan(blocks.get("a")!.order);
  });

  it("puts a thread on a whole block with the highlights in that block", () => {
    const root = editor(
      `<ul><li>
         <p><span data-comment-thread="text">x</span></p>
         <div data-comment-block-threads="clip-1 clip-2"><video></video></div>
       </li></ul>
       <div data-comment-block-threads="solo"><video></video></div>`,
    );
    const blocks = measureCommentBlocks(root, [
      thread("text"),
      thread("clip-1"),
      thread("clip-2"),
      thread("solo"),
    ]);
    expect([...blocks.keys()]).toEqual(["text", "clip-1", "clip-2", "solo"]);
    expect(blocks.get("clip-1")?.key).toBe(blocks.get("text")?.key);
    expect(blocks.get("clip-2")?.key).toBe(blocks.get("text")?.key);
    expect(blocks.get("solo")?.key).not.toBe(blocks.get("text")?.key);
    const stacks = groupCommentStacks(
      [thread("clip-1"), thread("clip-2"), thread("solo")],
      blocks,
    );
    expect(stacks.map((stack) => stack.threads.map((t) => t.threadId))).toEqual(
      [["clip-1", "clip-2"]],
    );
  });
});

describe("grouping comment stacks", () => {
  const placements = new Map([
    ["a", { key: ":0", order: 0 }],
    ["b", { key: ":0", order: 1 }],
    ["c", { key: ":0", order: 2 }],
    ["solo", { key: ":1", order: 3 }],
    ["l1", { key: ":2.0", order: 4 }],
    ["l2", { key: ":2.0", order: 5 }],
    ["l3", { key: ":2.1", order: 6 }],
    ["notes-a", { key: "notes:0", order: 7 }],
    ["notes-b", { key: "notes:0", order: 8 }],
  ]);

  it("stacks two or more open threads per block, in document order", () => {
    const stacks = groupCommentStacks(
      [
        thread("c"),
        thread("l2"),
        thread("solo"),
        thread("a"),
        thread("l3"),
        thread("b"),
        thread("l1"),
      ],
      placements,
    );
    expect(
      stacks.map((stack) => [
        stack.key,
        stack.threads.map((member) => member.threadId),
      ]),
    ).toEqual([
      [":0", ["a", "b", "c"]],
      [":2.0", ["l1", "l2"]],
    ]);
  });

  it("leaves resolved threads, Property threads, and threads without a highlight out", () => {
    const stacks = groupCommentStacks(
      [
        thread("a"),
        thread("b", { resolved: true }),
        thread("p1", { property: true }),
        thread("p2", { property: true }),
        thread("unplaced"),
      ],
      new Map([
        ...placements,
        ["p1", { key: ":0", order: 9 }],
        ["p2", { key: ":0", order: 10 }],
      ]),
    );
    expect(stacks).toEqual([]);
  });

  it("never stacks threads from different tabs together", () => {
    const stacks = groupCommentStacks(
      [thread("a"), thread("notes-a", { fieldId: "notes" })],
      placements,
    );
    expect(stacks).toEqual([]);
  });
});

describe("a stack's front thread", () => {
  const older = thread("older", {
    times: ["2026-10-20T10:00:00Z", "2026-10-20T15:00:00Z"],
  });
  const newer = thread("newer", { times: ["2026-10-20T14:00:00Z"] });
  const first = thread("first", { times: ["2026-10-20T09:00:00Z"] });

  it("is the thread with the newest comment, replies included, until one is touched", () => {
    expect(commentStackFront([first, newer, older], new Map()).threadId).toBe(
      "older",
    );
    expect(commentStackFront([first, newer], new Map()).threadId).toBe("newer");
  });

  it("is the thread last touched in the block", () => {
    expect(
      commentStackFront(
        [first, newer, older],
        new Map([
          ["newer", 1],
          ["first", 2],
        ]),
      ).threadId,
    ).toBe("first");
  });

  it("ignores touches on threads outside the block", () => {
    expect(
      commentStackFront([first, newer], new Map([["elsewhere", 5]])).threadId,
    ).toBe("newer");
  });
});

describe("commentThreadReplyCount", () => {
  it("counts the replies a thread holds", () => {
    expect(
      commentThreadReplyCount(
        thread("page", {
          times: ["2026-10-20T10:00:00Z", "2026-10-20T11:00:00Z"],
        }),
      ),
    ).toBe(1);
  });

  it("takes a Clip thread's count from Clips, which can hold replies back", () => {
    const listed = thread("clip", {
      times: ["2026-10-20T10:00:00Z", "2026-10-20T11:00:00Z"],
    });
    expect(
      commentThreadReplyCount({
        ...listed,
        clip: {
          recordingId: "rec_1",
          threadId: "c1",
          videoTimestampMs: 0,
          canComment: true,
          canResolve: false,
          replyCount: 7,
        },
      }),
    ).toBe(7);
  });
});
