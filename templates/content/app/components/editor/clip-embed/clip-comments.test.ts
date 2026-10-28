import { describe, expect, it } from "vitest";

import {
  clipCommentThreads,
  clipThreadPassed,
  type ClipCommentSource,
  type ClipThreadView,
} from "./clip-comments";

function thread(
  id: string,
  videoTimestampMs: number,
  overrides?: Partial<ClipThreadView>,
): ClipThreadView {
  return {
    id,
    videoTimestampMs,
    content: `Comment ${id}`,
    authorEmail: "ada@example.test",
    authorName: "Ada Example",
    createdAt: "2026-10-23T12:00:00.000Z",
    replyCount: 0,
    replies: [],
    ...overrides,
  };
}

function source(overrides?: Partial<ClipCommentSource>): ClipCommentSource {
  return {
    recordingId: "rec_1",
    threads: [thread("c1", 4_000)],
    canComment: true,
    isOwner: false,
    fieldId: null,
    ...overrides,
  };
}

describe("clipCommentThreads", () => {
  it("gives each Clip thread a margin id, its moment, and its replies", () => {
    const [margin] = clipCommentThreads(
      "doc_1",
      [
        source({
          threads: [
            thread("c1", 4_000, {
              replyCount: 1,
              replies: [
                {
                  id: "r1",
                  content: "Agreed",
                  authorEmail: "bo@example.test",
                  authorName: "Bo",
                  createdAt: "2026-10-23T12:05:00.000Z",
                },
              ],
            }),
          ],
        }),
      ],
      "bo@example.test",
    );
    expect(margin).toMatchObject({
      threadId: "clip:rec_1:c1",
      quotedText: null,
      field: null,
      resolved: false,
      clip: {
        recordingId: "rec_1",
        threadId: "c1",
        videoTimestampMs: 4_000,
        canComment: true,
        canResolve: false,
      },
    });
    expect(
      margin?.comments.map((comment) => [comment.id, comment.parent_id]),
    ).toEqual([
      ["c1", null],
      ["r1", "c1"],
    ]);
    expect(margin?.comments[0]?.thread_id).toBe("clip:rec_1:c1");
  });

  it("lets a thread's author and the Clip's owner resolve it, if Clips takes their comments", () => {
    const resolvable = (
      overrides: Partial<ClipCommentSource>,
      email: string | null,
    ) =>
      clipCommentThreads("doc_1", [source(overrides)], email)[0]?.clip
        ?.canResolve;
    expect(resolvable({}, "ADA@example.test")).toBe(true);
    expect(resolvable({}, "bo@example.test")).toBe(false);
    expect(resolvable({ isOwner: true }, "bo@example.test")).toBe(true);
    expect(resolvable({ isOwner: true, canComment: false }, null)).toBe(false);
    expect(
      resolvable(
        { threads: [thread("c1", 0, { authorEmail: null })] },
        "bo@example.test",
      ),
    ).toBe(false);
  });

  it("shows a Clip placed twice once, beside the first", () => {
    const threads = clipCommentThreads(
      "doc_1",
      [source({ fieldId: "tab_a" }), source({ fieldId: "tab_b" })],
      null,
    );
    expect(threads).toHaveLength(1);
    expect(threads[0]?.field).toEqual({ fieldId: "tab_a", fieldName: null });
  });

  it("marks a comment Clips hasn't confirmed as pending", () => {
    const [margin] = clipCommentThreads(
      "doc_1",
      [
        source({
          threads: [thread("optimistic-op1", 2_000, { operationId: "op1" })],
        }),
      ],
      null,
    );
    expect(margin?.comments[0]?.mutation).toEqual({
      operationId: "op1",
      kind: "create",
      status: "pending",
    });
  });
});

describe("clipThreadPassed", () => {
  const threads = clipCommentThreads(
    "doc_1",
    [
      source({
        threads: [
          thread("a", 2_000),
          thread("b", 5_000),
          thread("c", 5_000),
          thread("d", 9_000),
        ],
      }),
    ],
    null,
  );
  const passed = (ms: number, preferred?: string) =>
    clipThreadPassed(threads, ms, preferred)?.clip?.threadId ?? null;

  it("is the last thread at or before the playhead", () => {
    expect(passed(1_999)).toBeNull();
    expect(passed(2_000)).toBe("a");
    expect(passed(4_999)).toBe("a");
    expect(passed(9_000)).toBe("d");
    expect(passed(60_000)).toBe("d");
  });

  it("keeps the preferred thread of several at the passed moment", () => {
    expect(passed(5_000)).toBe("c");
    expect(passed(6_000, "clip:rec_1:b")).toBe("b");
    expect(passed(6_000, "clip:rec_1:a")).toBe("c");
  });
});
