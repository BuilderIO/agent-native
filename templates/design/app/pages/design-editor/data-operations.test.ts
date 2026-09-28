import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  applyDesignDataOperations,
  buildDataOperationsKeepalivePayload,
  buildFrameGeometryDataOperations,
  clearAcknowledgedDesignDataOperations,
  clearAcknowledgedDesignDataOperationsThroughRevision,
  compactDesignDataOperations,
  invertDesignDataOperations,
  pendingDesignDataOperations,
  rebaseDesignDataWithPendingOperations,
  stagePendingDesignDataOperations,
  type DesignDataOperation,
} from "./data-operations";

const frameA = { x: 0, y: 0, width: 400, height: 300 };
const frameB = { x: 500, y: 0, width: 400, height: 300 };

describe("Design editor data operations", () => {
  it("emits only changed frame entries", () => {
    const operations = buildFrameGeometryDataOperations({
      previousGeometry: { a: frameA, b: frameB },
      nextGeometry: { a: { ...frameA, x: 40 }, b: frameB },
      designData: {},
    });

    expect(operations).toEqual([
      {
        op: "set",
        path: ["canvasFrames", "a"],
        value: { ...frameA, x: 40 },
      },
    ]);
  });

  it("uses an explicit delete for a removed frame", () => {
    expect(
      buildFrameGeometryDataOperations({
        previousGeometry: { a: frameA, b: frameB },
        nextGeometry: { b: frameB },
        designData: {},
      }),
    ).toEqual([{ op: "delete", path: ["canvasFrames", "a"] }]);
  });

  it("keeps a canceled debounced edit when an immediate snapshot supersedes it", () => {
    const queued = buildFrameGeometryDataOperations({
      previousGeometry: { a: frameA },
      nextGeometry: { a: { ...frameA, x: 20 } },
      designData: {},
    });
    const immediate = buildFrameGeometryDataOperations({
      previousGeometry: { a: { ...frameA, x: 20 } },
      nextGeometry: { a: { ...frameA, x: 40 } },
      designData: {},
    });

    expect(compactDesignDataOperations([...queued, ...immediate])).toEqual([
      {
        op: "set",
        path: ["canvasFrames", "a"],
        value: { ...frameA, x: 40 },
      },
    ]);
  });

  it("returns no operations for unchanged geometry", () => {
    expect(
      buildFrameGeometryDataOperations({
        previousGeometry: { a: frameA },
        nextGeometry: { a: { ...frameA } },
        designData: {},
      }),
    ).toEqual([]);
  });

  it("inverts data operations using the prior values and paths", () => {
    const data = {
      screenMetadata: { a: { heightPinned: false } },
      canvasFrames: { a: frameA },
    };
    const operations: DesignDataOperation[] = [
      { op: "set", path: ["screenMetadata", "a", "heightMode"], value: "hug" },
      {
        op: "set",
        path: ["canvasFrames", "a"],
        value: { ...frameA, height: 84 },
      },
    ];
    const next = applyDesignDataOperations(data, operations);

    expect(
      applyDesignDataOperations(
        next,
        invertDesignDataOperations(data, operations),
      ),
    ).toEqual(data);
    expect(invertDesignDataOperations(data, operations)).toEqual([
      { op: "set", path: ["canvasFrames", "a"], value: frameA },
      { op: "delete", path: ["screenMetadata", "a", "heightMode"] },
    ]);
  });

  it("syncs only changed viewport fields without replacing peer metadata", () => {
    const designData = {
      screenMetadata: {
        a: { title: "Home", width: 400, height: 280, peerField: "keep" },
      },
      localhostScreens: {
        a: { path: "/", width: 390, height: 300, peerField: "keep" },
      },
    };
    const operations = buildFrameGeometryDataOperations({
      previousGeometry: { a: { ...frameA, height: 280 } },
      nextGeometry: { a: frameA },
      designData,
      syncViewportFrameIds: ["a", "a"],
    });

    expect(operations).toEqual([
      { op: "set", path: ["canvasFrames", "a"], value: frameA },
      {
        op: "set",
        path: ["screenMetadata", "a", "height"],
        value: 300,
      },
      {
        op: "set",
        path: ["localhostScreens", "a", "width"],
        value: 400,
      },
    ]);
    expect(applyDesignDataOperations(designData, operations)).toMatchObject({
      screenMetadata: {
        a: { title: "Home", width: 400, height: 300, peerField: "keep" },
      },
      localhostScreens: {
        a: { path: "/", width: 400, height: 300, peerField: "keep" },
      },
    });
  });

  it("pins an explicitly resized screen as fixed height mode", () => {
    const operations = buildFrameGeometryDataOperations({
      previousGeometry: { a: { ...frameA, width: 400, height: 280 } },
      nextGeometry: { a: { ...frameA, width: 440, height: 280 } },
      designData: {
        screenMetadata: {
          a: {
            width: 400,
            height: 280,
            heightPinned: false,
            heightMode: "hug",
          },
        },
      },
      syncViewportFrameIds: ["a"],
      pinHeightFrameIds: ["a"],
    });

    expect(operations).toContainEqual({
      op: "set",
      path: ["screenMetadata", "a", "heightPinned"],
      value: true,
    });
    expect(operations).toContainEqual({
      op: "set",
      path: ["screenMetadata", "a", "heightMode"],
      value: "fixed",
    });
  });

  it("keeps the newest pending value per path and does not clear a superseding write", () => {
    const first: DesignDataOperation[] = [
      { op: "set", path: ["canvasFrames", "a"], value: frameA },
    ];
    const second: DesignDataOperation[] = [
      {
        op: "set",
        path: ["canvasFrames", "a"],
        value: { ...frameA, x: 40 },
      },
      { op: "delete", path: ["canvasFrames", "b"] },
    ];
    const stagedFirst = stagePendingDesignDataOperations({}, first, 1);
    const stagedSecond = stagePendingDesignDataOperations(
      stagedFirst,
      second,
      2,
    );
    const afterFirstAck = clearAcknowledgedDesignDataOperations(
      stagedSecond,
      first,
      1,
    );

    expect(pendingDesignDataOperations(afterFirstAck)).toEqual(second);
    expect(
      pendingDesignDataOperations(
        clearAcknowledgedDesignDataOperations(afterFirstAck, second, 2),
      ),
    ).toEqual([]);
  });

  it("clears a compacted acknowledgement without dropping newer queued edits", () => {
    const revisionOne = stagePendingDesignDataOperations(
      {},
      [{ op: "set", path: ["canvasFrames", "a"], value: frameA }],
      1,
    );
    const revisionTwo = stagePendingDesignDataOperations(
      revisionOne,
      [{ op: "delete", path: ["canvasFrames", "b"] }],
      2,
    );
    const revisionThree = stagePendingDesignDataOperations(
      revisionTwo,
      [{ op: "set", path: ["canvasFrames", "c"], value: frameB }],
      3,
    );

    expect(
      pendingDesignDataOperations(
        clearAcknowledgedDesignDataOperationsThroughRevision(revisionThree, 2),
      ),
    ).toEqual([{ op: "set", path: ["canvasFrames", "c"], value: frameB }]);
  });

  it("compacts and guards keepalive payloads by source, emptiness, and byte cap", () => {
    const operations: DesignDataOperation[] = [
      { op: "set", path: ["canvasFrames", "a"], value: frameA },
      {
        op: "set",
        path: ["canvasFrames", "a"],
        value: { ...frameA, x: 40 },
      },
    ];

    expect(compactDesignDataOperations(operations)).toEqual([operations[1]]);
    expect(
      buildDataOperationsKeepalivePayload(undefined, operations, "tab-a", 2),
    ).toBeNull();
    expect(
      buildDataOperationsKeepalivePayload("design-1", [], "tab-a", 2),
    ).toBeNull();
    expect(
      buildDataOperationsKeepalivePayload("design-1", operations, "tab-a", 2),
    ).toEqual({
      id: "design-1",
      dataOperations: [operations[1]],
      operationSource: "tab-a",
      operationRevision: 2,
    });
    expect(
      buildDataOperationsKeepalivePayload(
        "design-1",
        operations,
        "tab-a",
        2,
        20,
      ),
    ).toBeNull();
    expect(
      buildDataOperationsKeepalivePayload("design-1", operations, "tab-a", -1),
    ).toBeNull();
  });

  it("keeps DesignEditor geometry, duplicate, fusion, and unload writes off legacy data snapshots", () => {
    const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");

    expect(source).not.toMatch(
      /updateDesignAsync\(\s*\{\s*id\s*,\s*data\s*[},:]/,
    );
    expect(source).not.toMatch(
      /updateDesignMutation\.mutate\(\s*\{\s*id\s*,\s*data\s*[},:]/,
    );
    expect(source).not.toMatch(
      /sendActionKeepalive\(\s*["']update-design["']\s*,\s*\{\s*id\s*,\s*data\s*[},:]/,
    );
    expect(source).toContain("tryCallActionKeepalive");
    expect(source).toContain("createFrameGeometryOutboxEntry");
    expect(source).toContain(
      "operationSource: designSaveOperationSourceRef.current",
    );
    expect(source).not.toContain("operationSource: TAB_ID");
    expect(source).toContain("operationRevision: revision");
  });

  it("rebases rapid Screen H over an older render while W is pending", () => {
    const screenId = "screen";
    const initialGeometry = { x: 0, y: 0, width: 402, height: 874 };
    const initialData = {
      canvasFrames: { [screenId]: initialGeometry },
      screenMetadata: { [screenId]: { width: 402, height: 874 } },
    };
    const widthOperations = buildFrameGeometryDataOperations({
      previousGeometry: { [screenId]: initialGeometry },
      nextGeometry: { [screenId]: { ...initialGeometry, width: 800 } },
      designData: initialData,
      syncViewportFrameIds: [screenId],
    });
    const pendingAfterWidth = stagePendingDesignDataOperations(
      {},
      widthOperations,
      1,
    );

    const designDataJsonRef = rebaseDesignDataWithPendingOperations(
      initialData,
      pendingAfterWidth,
    );
    const beforeHeight = designDataJsonRef.canvasFrames as Record<
      string,
      typeof initialGeometry
    >;
    const nextGeometry = {
      [screenId]: { ...beforeHeight[screenId]!, height: 800 },
    };
    const heightOperations = buildFrameGeometryDataOperations({
      previousGeometry: beforeHeight,
      nextGeometry,
      designData: designDataJsonRef,
      syncViewportFrameIds: [screenId],
      pinHeightFrameIds: [screenId],
    });
    const secondRequestOperations = compactDesignDataOperations([
      ...pendingDesignDataOperations(pendingAfterWidth),
      ...heightOperations,
    ]);
    expect(secondRequestOperations).toContainEqual({
      op: "set",
      path: ["canvasFrames", screenId],
      value: { ...initialGeometry, width: 800, height: 800 },
    });
    const persisted = applyDesignDataOperations(
      applyDesignDataOperations(initialData, widthOperations),
      secondRequestOperations,
    );

    expect(persisted.canvasFrames).toEqual({
      [screenId]: { ...initialGeometry, width: 800, height: 800 },
    });
    expect(persisted.screenMetadata).toMatchObject({
      [screenId]: { width: 800, height: 800 },
    });
  });
});
