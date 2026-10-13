import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

describe("DesignEditor candidate review navigation", () => {
  const source = readDesignEditorSource();
  const reviewHandler = source.slice(
    source.indexOf("const handleReviewNodeRewrite"),
    source.indexOf("const handleReviewPendingScreen"),
  );

  it("keeps review in Overview and only uses focused navigation from Single view", () => {
    expect(reviewHandler).toContain('viewModeRef.current = "overview"');
    expect(reviewHandler).toContain('setViewMode("overview")');
    expect(reviewHandler).toContain("setActiveFileId(proposal.fileId)");
    expect(reviewHandler).toContain(
      "setOverviewSelectedScreenIds([proposal.fileId])",
    );
    expect(reviewHandler).toContain("handleBreakpointBarSelect(undefined)");
    expect(reviewHandler).toContain("setCameraCommand({");
    expect(reviewHandler).not.toContain("handleSidebarScreenSelect");
  });

  it("mounts one viewport-level panel and marks the active responsive preview", () => {
    expect(source).toContain("nodeRewriteCanvasTarget={screenIsActive}");
    expect(source).toContain(
      "<NodeRewriteProposalPanel\n          designId={id}",
    );
    expect(source).toContain("proposalSnapshot={activeNodeRewriteProposal}");
  });
});
