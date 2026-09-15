import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Design editor header", () => {
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");

  it("keeps the title without rendering the review status chip", () => {
    expect(editorSource).toContain("{projectTitleControl}");
    expect(editorSource).not.toContain("ReviewStatusControl");
    expect(editorSource).not.toContain("status={reviewStatus}");
  });
});
