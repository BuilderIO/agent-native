import { describe, expect, it, vi } from "vitest";

import type { DesignDataOperation } from "@/pages/design-editor/data-operations";
import {
  acknowledgeFrameGeometryRestoreClaims,
  createFrameGeometryDataSavePayload,
  frameGeometryRestoreClaimsThroughRevision,
  stageFrameGeometryRestoreClaims,
} from "@/pages/design-editor/domains/use-editor-active-screen-and-geometry";

describe("frame geometry save payload", () => {
  it("copies scoped restore claims into a stable outbox payload", () => {
    const claim = {
      claimId: "claim-1",
      sourceFileId: "deleted-screen",
      targetFileId: "restored-screen",
    };
    const dataOperations: DesignDataOperation[] = [
      {
        op: "set" as const,
        path: ["screenMetadata", "restored-screen"],
        value: { connectionId: "connection-1" },
      },
    ];

    const payload = createFrameGeometryDataSavePayload({
      id: "design-1",
      dataOperations,
      operationSource: "editor-session",
      operationRevision: 7,
      restoreClaims: [claim],
    });

    expect(payload).toEqual({
      id: "design-1",
      dataOperations,
      operationSource: "editor-session",
      operationRevision: 7,
      restoreClaims: [claim],
    });
    claim.targetFileId = "later-target";
    expect(payload.restoreClaims).toEqual([
      {
        claimId: "claim-1",
        sourceFileId: "deleted-screen",
        targetFileId: "restored-screen",
      },
    ]);
  });

  it("omits restoration claims from ordinary saves", () => {
    expect(
      createFrameGeometryDataSavePayload({
        id: "design-1",
        dataOperations: [],
        operationSource: "editor-session",
        operationRevision: 8,
      }),
    ).toEqual({
      id: "design-1",
      dataOperations: [],
      operationSource: "editor-session",
      operationRevision: 8,
    });
  });

  it("keeps the same claim through a rejected save and drops it after success", async () => {
    const claim = {
      claimId: "claim-2",
      sourceFileId: "source-screen",
      targetFileId: "restored-screen",
    };
    let pending = stageFrameGeometryRestoreClaims([], "design-1", [claim], 10);
    const dataOperations: DesignDataOperation[] = [
      {
        op: "set",
        path: ["localhostScreens", "restored-screen"],
        value: { connectionId: "connection-2" },
      },
    ];
    const buildPayload = (
      pendingClaims: typeof pending,
      operationRevision: number,
    ) =>
      createFrameGeometryDataSavePayload({
        id: "design-1",
        dataOperations,
        operationSource: "editor-session",
        operationRevision,
        restoreClaims: frameGeometryRestoreClaimsThroughRevision(
          pendingClaims,
          "design-1",
          operationRevision,
        ),
      });
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary save failure"))
      .mockResolvedValueOnce(undefined);
    const initialPayload = buildPayload(pending, 10);

    await expect(save(initialPayload)).rejects.toThrow(
      "temporary save failure",
    );
    const retryPayload = buildPayload(pending, 11);
    expect(initialPayload.restoreClaims).toEqual([claim]);
    expect(retryPayload.restoreClaims).toEqual([claim]);
    await expect(save(retryPayload)).resolves.toBeUndefined();

    pending = acknowledgeFrameGeometryRestoreClaims(
      pending,
      "design-1",
      retryPayload.restoreClaims as Array<typeof claim>,
    );
    expect(
      frameGeometryRestoreClaimsThroughRevision(pending, "design-1", 12),
    ).toEqual([]);
    expect(buildPayload(pending, 12).restoreClaims).toBeUndefined();
  });

  it("keeps claims scoped to their design across navigation", () => {
    const claim = {
      claimId: "claim-3",
      sourceFileId: "source-a",
      targetFileId: "restored-a",
    };
    const pending = stageFrameGeometryRestoreClaims(
      [],
      "design-a",
      [claim],
      20,
    );
    const operations: DesignDataOperation[] = [
      {
        op: "set",
        path: ["screenMetadata", "restored-a"],
        value: { connectionId: "connection-a" },
      },
    ];

    const designBPayload = createFrameGeometryDataSavePayload({
      id: "design-b",
      dataOperations: operations,
      operationSource: "editor-session-b",
      operationRevision: 21,
      restoreClaims: frameGeometryRestoreClaimsThroughRevision(
        pending,
        "design-b",
        21,
      ),
    });
    const designARetryPayload = createFrameGeometryDataSavePayload({
      id: "design-a",
      dataOperations: operations,
      operationSource: "editor-session-a",
      operationRevision: 22,
      restoreClaims: frameGeometryRestoreClaimsThroughRevision(
        pending,
        "design-a",
        22,
      ),
    });

    expect(designBPayload).not.toHaveProperty("restoreClaims");
    expect(designARetryPayload.restoreClaims).toEqual([claim]);
  });
});
