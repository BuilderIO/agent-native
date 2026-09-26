import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DesignEditor.tsx", import.meta.url), {
  encoding: "utf8",
});
const handlerModule = readFileSync(
  new URL("./design-editor/commands/layer-move-to-screen.ts", import.meta.url),
  { encoding: "utf8" },
);
const handlerStart = handlerModule.indexOf(
  "export function runLayerMoveToScreen",
);
const handlerEnd = handlerModule.length;
const handlerSource = handlerModule.slice(handlerStart, handlerEnd);
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

  it("reports a competing runtime insert instead of silently dropping it", () => {
    expect(source).toMatch(
      /typeof next !== "function" && next[\s\S]*?runtimeStructurePendingTransactionRef\.current[\s\S]*?toast\.error\(t\("designEditor\.toasts\.layerMoveFailed"\)/,
    );
  });

  it("holds a failed cross-screen move until cancellation and rollback settle", () => {
    const rejectionStart = source.indexOf(
      "const handleRuntimeStructureDeleteRejected = useCallback(",
    );
    const rejectionEnd = source.indexOf("useEffect(() => {", rejectionStart);
    const rejectionHandler = source.slice(rejectionStart, rejectionEnd);
    const cancellationBranch = rejectionHandler.indexOf(
      'details.reason === "cancelled"',
    );
    const admissionRelease = rejectionHandler.indexOf(
      "releaseCrossScreenDropAdmission(",
    );

    expect(rejectionStart).toBeGreaterThan(0);
    expect(cancellationBranch).toBeGreaterThan(0);
    expect(admissionRelease).toBeGreaterThan(cancellationBranch);
    expect(rejectionHandler).toContain(
      "runtimeStructureRollbackRequest?.transactionId ===",
    );

    const deleteTimeoutStart = source.indexOf(
      "const deleteRequest = runtimeStructureDeleteRequest;",
    );
    const rollbackResultStart = source.indexOf(
      "const handleRuntimeStructureRollbackResult = useCallback(",
    );
    const deleteTimeoutEffect = source.slice(
      deleteTimeoutStart,
      rollbackResultStart,
    );
    expect(deleteTimeoutEffect).toContain("!deleteRequest.cancelRequested");
  });

  it("cancels rollback timeout on the first bridge result without rearming per render", () => {
    const resultStart = source.indexOf(
      "const handleRuntimeStructureRollbackResult = useCallback(",
    );
    const timeoutHandlerStart = source.indexOf(
      "const runtimeStructureRollbackResultHandlerRef = useRef(",
      resultStart,
    );
    const timeoutEffectEnd = source.indexOf(
      "const handleRuntimeLayerRenameApplied = useCallback(",
      timeoutHandlerStart,
    );
    const resultHandler = source.slice(resultStart, timeoutHandlerStart);
    const timeoutEffect = source.slice(timeoutHandlerStart, timeoutEffectEnd);

    expect(resultHandler).toContain("cancelCrossScreenRollbackTimeout(");
    expect(timeoutEffect).toContain(
      "runtimeStructureRollbackResultHandlerRef.current({",
    );
    expect(timeoutEffect).toContain("[runtimeStructureRollbackRequest]");
    expect(timeoutEffect).not.toContain(
      "[handleRuntimeStructureRollbackResult, runtimeStructureRollbackRequest]",
    );
  });
});
