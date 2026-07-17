import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DesignEditor candidate review navigation", () => {
  const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const reviewHandler = source.slice(
    source.indexOf("const handleReviewNodeRewrite"),
    source.indexOf("const handleReviewPendingScreen"),
  );

  it("keeps review in Overview and only uses focused navigation from Single view", () => {
    const overviewBranch = reviewHandler.slice(
      reviewHandler.indexOf('viewModeRef.current === "overview"'),
      reviewHandler.indexOf("handleSidebarScreenSelect"),
    );

    expect(overviewBranch).toContain("setActiveFileId(proposal.fileId)");
    expect(overviewBranch).toContain(
      "setOverviewSelectedScreenIds([proposal.fileId])",
    );
    expect(overviewBranch).toContain("handleBreakpointBarSelect(undefined)");
    expect(overviewBranch).toContain("setCameraCommand({");
    expect(overviewBranch).toMatch(/return;\s*}\s*$/);
    expect(reviewHandler).toContain(
      "handleSidebarScreenSelect(proposal.fileId)",
    );
  });

  it("mounts one viewport-level panel and marks the active base preview", () => {
    expect(source).toContain(
      "nodeRewriteCanvasTarget={\n            screenIsActive && breakpointWidthPx === undefined\n          }",
    );
    expect(source).toContain(
      "<NodeRewriteProposalPanel\n          designId={id}",
    );
    expect(source).toContain("proposalSnapshot={activeNodeRewriteProposal}");
  });
});
