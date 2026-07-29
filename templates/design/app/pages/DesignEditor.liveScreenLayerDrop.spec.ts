import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DesignEditor.tsx", import.meta.url), {
  encoding: "utf8",
});
const handlerStart = source.indexOf("const handleLayerMoveToScreen");
const handlerEnd = source.indexOf("const handleLayerMove =", handlerStart);
const handlerSource = source.slice(handlerStart, handlerEnd);
const liveBranchStart = handlerSource.indexOf(
  "if (isStandaloneHttpUrl(destContent))",
);
const liveBranchEnd = handlerSource.indexOf(
  "let nextDestContent",
  liveBranchStart,
);
const liveBranchSource = handlerSource.slice(liveBranchStart, liveBranchEnd);

describe("DesignEditor Layers-panel live-screen row drop", () => {
  it("routes a board subtree through the runtime bridge before stored-document moves", () => {
    expect(handlerStart).toBeGreaterThan(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(liveBranchStart).toBeGreaterThan(0);
    expect(liveBranchEnd).toBeGreaterThan(liveBranchStart);
    expect(liveBranchSource).toContain("prepareLiveScreenLayerDrop");
    expect(liveBranchSource).toContain("setRuntimeStructureInsertRequest");
    expect(liveBranchSource).toContain('anchor: { selector: "body" }');
    expect(liveBranchSource).toContain("draggedOwner.fileId !== boardFileId");
  });

  it("cannot persist either the live URL or the board source in the runtime branch", () => {
    expect(liveBranchSource).not.toContain("applyFileContentUpdate");
    expect(liveBranchSource).not.toContain("applyLocalContentUpdate");
    expect(liveBranchSource).not.toContain("moveNodeBetweenDocuments");
    expect(liveBranchSource).not.toContain("recordContentHistoryEntry");
    expect(liveBranchSource).toMatch(
      /setRuntimeStructureInsertRequest\([\s\S]*?return;/,
    );
  });

  it("surfaces unsupported and bridge-rejected inserts instead of claiming success", () => {
    expect(liveBranchSource).toContain(
      'toast.error(t("designEditor.toasts.layerMoveFailed")',
    );
    expect(source).toMatch(
      /const handleRuntimeStructureInsertRejected[\s\S]*?toast\.error\(t\("designEditor\.toasts\.layerMoveFailed"\)/,
    );
  });
});
