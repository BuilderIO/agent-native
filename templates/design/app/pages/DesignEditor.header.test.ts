import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Design editor header", () => {
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");

  it("keeps the title without rendering the review status chip", () => {
    expect(editorSource).toContain("{projectTitleControl}");
    expect(editorSource).not.toContain("ReviewStatusControl");
    expect(editorSource).not.toContain("status={reviewStatus}");
  });

  it("routes board review threads and uses unread roots for the comments badge", () => {
    expect(editorSource).toContain("const boardTarget = targetId === null");
    expect(editorSource).toContain(
      "setActiveFileId(boardTarget ? (boardFileId ?? null) : targetId)",
    );
    expect(editorSource).toContain("reviewCommentsCount: reviewUnreadCount");
  });
});
