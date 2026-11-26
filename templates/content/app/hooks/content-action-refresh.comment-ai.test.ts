import { describe, expect, it } from "vitest";

import { contentActionInvalidatePredicate } from "./content-action-refresh";

const aiRequests = [
  "action",
  "list-comment-ai-requests",
  { documentId: "doc-1" },
];
const comments = ["action", "list-comments", { documentId: "doc-1" }];
const page = ["action", "get-document", { id: "doc-1" }];

function refreshes(
  queryKey: readonly unknown[],
  key: string,
  resourceId?: string,
) {
  const predicate = contentActionInvalidatePredicate("/page/doc-1");
  return predicate({ queryKey }, [
    {
      source: "action",
      key,
      ...(resourceId ? { resourceType: "document", resourceId } : {}),
    },
  ]);
}

describe("refresh after a comment AI write", () => {
  it.each([
    "start-comment-ai-request",
    "submit-comment-ai-classification",
    "reconcile-comment-ai-session",
    "reply-to-comment-ai-request",
    "create-comment-ai-suggestion",
    "apply-comment-ai-request",
    "undo-comment-ai-request",
  ])("%s on this page refreshes its AI operations", (key) => {
    expect(refreshes(aiRequests, key, "doc-1")).toBe(true);
    expect(refreshes(aiRequests, key)).toBe(true);
  });

  it("shows a teammate the AI's reply on the page it was asked on", () => {
    expect(refreshes(comments, "reply-to-comment-ai-request", "doc-1")).toBe(
      true,
    );
    expect(refreshes(page, "reply-to-comment-ai-request", "doc-1")).toBe(false);
  });

  it("shows an undone edit the way it shows an applied one", () => {
    for (const key of ["apply-comment-ai-request", "undo-comment-ai-request"]) {
      expect(refreshes(page, key, "doc-1")).toBe(true);
      expect(refreshes(comments, key, "doc-1")).toBe(true);
    }
  });

  it("leaves the open page alone when the write was on another page", () => {
    for (const key of [
      "start-comment-ai-request",
      "reconcile-comment-ai-session",
      "reply-to-comment-ai-request",
      "create-comment-ai-suggestion",
      "apply-comment-ai-request",
      "undo-comment-ai-request",
    ]) {
      expect(refreshes(aiRequests, key, "doc-2")).toBe(false);
      expect(refreshes(comments, key, "doc-2")).toBe(false);
    }
    expect(
      refreshes(
        [
          "action",
          "list-resource-suggestions",
          { resourceType: "document", resourceId: "doc-1" },
        ],
        "create-comment-ai-suggestion",
        "doc-2",
      ),
    ).toBe(false);
  });
});
