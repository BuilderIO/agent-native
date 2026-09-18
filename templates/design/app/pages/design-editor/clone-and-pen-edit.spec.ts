// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  patchCodeLayerNodeAttributes,
} from "@shared/code-layer";
import type { CodeLayerSource } from "@shared/code-layer";
import {
  analyzeComponentLinks,
  applyComponentPropertyEdit,
} from "@shared/component-links";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
} from "@shared/component-model";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  insertClonedHtmlLayers,
  extractLayerPosition,
  prepareClonedHtmlLayersForLiveInsert,
  preserveClipboardLayerName,
} from "./clone-and-pen-edit";

const LIVE_URL = "http://localhost:5173/products?preview=1";

afterEach(() => vi.unstubAllGlobals());

describe("extractLayerPosition", () => {
  it("returns authored layout coordinates without applying the transform", () => {
    expect(
      extractLayerPosition(
        '<div style="position:absolute;left:40px;top:120px;transform:translate(16px, 24px) rotate(2deg)"></div>',
      ),
    ).toEqual({ x: 40, y: 120 });
  });

  it("does not treat an in-flow transform as absolute placement", () => {
    expect(
      extractLayerPosition(
        '<div style="transform:translate3d(12px, 18px, 0)"></div>',
      ),
    ).toBeNull();
  });

  it("preserves transform and sizing when positioning a clone", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div data-agent-native-node-id="source" style="position:absolute;left:40px;top:120px;width:180px;height:64px;transform:translate(16px, 24px) rotate(2deg)">Source</div>',
      ],
      { positions: [{ x: 50, y: 130 }] },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect((clone as HTMLElement).style.left).toBe("50px");
    expect((clone as HTMLElement).style.top).toBe("130px");
    expect((clone as HTMLElement).style.width).toBe("180px");
    expect((clone as HTMLElement).style.height).toBe("64px");
    expect((clone as HTMLElement).style.transform).toBe(
      "translate(16px, 24px) rotate(2deg)",
    );
  });

  it("keeps a transform-inclusive paste target near the canvas origin", () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        readonly is2D = true;
        readonly a = 1;
        readonly b = 0;
        readonly c = 0;
        readonly d = 1;
        readonly e = 100;
        readonly f = 0;

        constructor(_transform: string) {}
      },
    );
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div data-agent-native-node-id="source" style="position:absolute;left:100px;top:40px;width:100px;height:50px;transform:translateX(100px)">Source</div>',
      ],
      {
        positions: [{ x: 50, y: 40, space: "visual" }],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect((clone as HTMLElement).style.left).toBe("-50px");
    expect((clone as HTMLElement).style.top).toBe("40px");
    expect((clone as HTMLElement).style.transform).toBe("translateX(100px)");
  });

  it("places a rotated layer by its transformed bounds around the default origin", () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        readonly is2D = true;
        readonly a = 0;
        readonly b = 1;
        readonly c = -1;
        readonly d = 0;
        readonly e = 0;
        readonly f = 0;

        constructor(_transform: string) {}
      },
    );
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div style="position:absolute;left:0;top:0;width:100px;height:50px;transform:rotate(90deg)">Rotated</div>',
      ],
      { positions: [{ x: 50, y: 60, space: "visual" }] },
    );

    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect(clone.style.left).toBe("25px");
    expect(clone.style.top).toBe("85px");
  });

  it("pastes a rotated layer with no explicit height instead of refusing the clone", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div style="position:absolute;left:40px;top:60px;width:260px;transform:rotate(2deg)">Card</div>',
      ],
      { positions: [{ x: 50, y: 40, space: "visual" }] },
    );

    expect(result).not.toBeNull();
    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect(clone.style.left).toBe("50px");
    expect(clone.style.top).toBe("40px");
  });

  it("places a scaled layer by its transformed bounds around a percentage origin", () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        readonly is2D = true;
        readonly a = 2;
        readonly b = 0;
        readonly c = 0;
        readonly d = 2;
        readonly e = 0;
        readonly f = 0;

        constructor(_transform: string) {}
      },
    );
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div style="position:absolute;left:0;top:0;width:100px;height:50px;transform:scale(2);transform-origin:25% 75%">Scaled</div>',
      ],
      { positions: [{ x: 50, y: 40, space: "visual" }] },
    );

    const clone = parseFragment(result!.htmlFragments[0]!) as HTMLElement;
    expect(clone.style.left).toBe("75px");
    expect(clone.style.top).toBe("78px");
  });
});

describe("linked component cloning", () => {
  const designId = "design-components";
  const sourceFileId = "screen-source";
  const source = {
    kind: "design-file" as const,
    designId,
    fileId: sourceFileId,
    filename: "index.html",
  };
  const nestedOverrides = encodeURIComponent(
    JSON.stringify([{ sourceNodeId: "play-label", property: "style:color" }]),
  );
  const outerOverrides = encodeURIComponent(
    JSON.stringify([{ sourceNodeId: "card-copy", property: "style:color" }]),
  );
  const sourceHtml = `<!doctype html><html><body>
    <article data-agent-native-node-id="card-main" data-agent-native-component-id="cmp-card" data-agent-native-component="Card">
      <button data-agent-native-node-id="card-play" data-agent-native-component-ref="cmp-play" data-agent-native-component="PlayButton" data-agent-native-component-overrides="${nestedOverrides}">
        <span data-agent-native-node-id="play-label-instance" data-agent-native-component-source-node-id="play-label">Play</span>
      </button>
      <p data-agent-native-node-id="card-copy" style="color: black">Card</p>
    </article>
    <button data-agent-native-node-id="play-main" data-agent-native-component-id="cmp-play" data-agent-native-component="PlayButton">
      <span data-agent-native-node-id="play-label" style="color: white">Play</span>
    </button>
  </body></html>`;
  const sourceDocument = (content: string) => ({ source, content });
  const findNode = (
    content: string,
    nodeId: string,
    sourceValue: CodeLayerSource = source,
  ) =>
    buildCodeLayerProjection(content, { source: sourceValue }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === nodeId,
    );
  const assertLinksResolve = (
    contents: Array<{ source: CodeLayerSource; content: string }>,
  ) => {
    const analysis = analyzeComponentLinks(
      contents.map(({ source: sourceValue, content }) =>
        buildCodeLayerProjection(content, { source: sourceValue }),
      ),
    );
    expect(analysis.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentId: "cmp-card",
          status: "resolved",
        }),
        expect.objectContaining({
          componentId: "cmp-play",
          status: "resolved",
        }),
      ]),
    );
    expect(analysis.invalidNodes).toEqual([]);
  };

  it("duplicates a main twice, then duplicates a linked reference without losing nested mappings", () => {
    const mainHtml = findNode(sourceHtml, "card-main")?.source;
    expect(mainHtml).toBeTruthy();
    if (!mainHtml) return;
    const mainFragment = sourceHtml.slice(mainHtml.start, mainHtml.end);
    const first = insertClonedHtmlLayers(sourceHtml, [mainFragment], {
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource: source,
        documents: [sourceDocument(sourceHtml)],
      },
    });
    expect(first).not.toBeNull();
    if (!first) return;
    const firstProjection = buildCodeLayerProjection(first.content, { source });
    const firstReference = firstProjection.nodes.find(
      (node) => node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-card",
    );
    expect(firstReference).toBeTruthy();
    if (!firstReference) return;
    const withOverrides = patchCodeLayerNodeAttributes(first.content, [
      {
        node: firstReference,
        attributes: { [COMPONENT_OVERRIDES_ATTR]: outerOverrides },
      },
    ]);
    expect(withOverrides).not.toBeNull();
    if (!withOverrides) return;
    const second = insertClonedHtmlLayers(withOverrides, [mainFragment], {
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource: source,
        documents: [sourceDocument(withOverrides)],
      },
    });
    expect(second).not.toBeNull();
    if (!second) return;

    const afterTwoMains = buildCodeLayerProjection(second.content, { source });
    const cardReferences = afterTwoMains.nodes.filter(
      (node) => node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-card",
    );
    expect(cardReferences).toHaveLength(2);
    const sourceReference = cardReferences[0];
    expect(sourceReference).toBeTruthy();
    if (!sourceReference) return;
    const sourceNestedReference = sourceReference.children[0]
      ? afterTwoMains.nodes.find(
          (node) => node.id === sourceReference.children[0],
        )
      : undefined;
    expect(sourceNestedReference).toBeTruthy();
    if (!sourceNestedReference) return;
    const withNestedOverride = patchCodeLayerNodeAttributes(second.content, [
      {
        node: sourceNestedReference,
        attributes: { [COMPONENT_OVERRIDES_ATTR]: nestedOverrides },
      },
    ]);
    expect(withNestedOverride).not.toBeNull();
    if (!withNestedOverride) return;
    const cloneSourceProjection = buildCodeLayerProjection(withNestedOverride, {
      source,
    });
    const cloneSourceReference = cloneSourceProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        sourceReference.dataAttributes["data-agent-native-node-id"],
    );
    expect(cloneSourceReference?.source).toBeTruthy();
    if (!cloneSourceReference?.source) return;
    const referenceFragment = withNestedOverride.slice(
      cloneSourceReference.source.start,
      cloneSourceReference.source.end,
    );
    const third = insertClonedHtmlLayers(
      withNestedOverride,
      [referenceFragment],
      {
        componentLinks: {
          sourceFileIds: [sourceFileId],
          targetSource: source,
          documents: [sourceDocument(withNestedOverride)],
        },
      },
    );
    expect(third).not.toBeNull();
    if (!third) return;

    const finalProjection = buildCodeLayerProjection(third.content, { source });
    const finalReferences = finalProjection.nodes.filter(
      (node) => node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-card",
    );
    expect(finalReferences).toHaveLength(3);
    const clonedReference = finalProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        third.rootNodeIds[0],
    );
    expect(clonedReference?.dataAttributes[COMPONENT_OVERRIDES_ATTR]).toBe(
      outerOverrides,
    );
    const clonedOuterRoot = finalProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        third.rootNodeIds[0],
    );
    const nestedReference = clonedOuterRoot?.children[0]
      ? finalProjection.nodes.find(
          (node) => node.id === clonedOuterRoot.children[0],
        )
      : undefined;
    expect(nestedReference?.dataAttributes[COMPONENT_OVERRIDES_ATTR]).toBe(
      nestedOverrides,
    );
    const nestedLabel = nestedReference?.children[0]
      ? finalProjection.nodes.find(
          (node) => node.id === nestedReference.children[0],
        )
      : undefined;
    expect(nestedLabel?.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
      "play-label",
    );
    expect(
      new Set(
        finalReferences.map(
          (node) => node.dataAttributes["data-agent-native-node-id"],
        ),
      ).size,
    ).toBe(3);
    assertLinksResolve([sourceDocument(third.content)]);
  });

  it("links a main clone across Screens in the same Design and refuses cross-Design identity", () => {
    const mainSpan = findNode(sourceHtml, "card-main")?.source;
    expect(mainSpan).toBeTruthy();
    if (!mainSpan) return;
    const mainFragment = sourceHtml.slice(mainSpan.start, mainSpan.end);
    const targetSource = {
      kind: "design-file" as const,
      designId,
      fileId: "screen-target",
      filename: "target.html",
    };
    const targetHtml =
      '<!doctype html><html><body><div id="anchor"></div></body></html>';
    const moved = insertClonedHtmlLayers(targetHtml, [mainFragment], {
      targetSelectors: ["#anchor"],
      placement: "inside",
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource,
        documents: [
          sourceDocument(sourceHtml),
          { source: targetSource, content: targetHtml },
        ],
      },
    });
    expect(moved).not.toBeNull();
    if (!moved) return;
    const targetProjection = buildCodeLayerProjection(moved.content, {
      source: targetSource,
    });
    expect(
      targetProjection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] ===
          moved.rootNodeIds[0],
      )?.dataAttributes[COMPONENT_REF_ATTR],
    ).toBe("cmp-card");
    assertLinksResolve([
      sourceDocument(sourceHtml),
      { source: targetSource, content: moved.content },
    ]);

    const wrongDesignSource = { ...targetSource, designId: "other-design" };
    expect(
      insertClonedHtmlLayers(targetHtml, [mainFragment], {
        componentLinks: {
          sourceFileIds: [sourceFileId],
          targetSource: wrongDesignSource,
          documents: [
            sourceDocument(sourceHtml),
            { source: wrongDesignSource, content: targetHtml },
          ],
        },
      }),
    ).toBeNull();
  });

  it("links a canonical component nested inside an ordinary container clone", () => {
    const containerHtml = sourceHtml
      .replace(
        '<article data-agent-native-node-id="card-main"',
        '<section data-agent-native-node-id="group-main"><article data-agent-native-node-id="card-main"',
      )
      .replace(
        '    </article>\n    <button data-agent-native-node-id="play-main"',
        '    </article></section>\n    <button data-agent-native-node-id="play-main"',
      );
    const groupSpan = findNode(containerHtml, "group-main")?.source;
    expect(groupSpan).toBeTruthy();
    if (!groupSpan) return;
    const groupFragment = containerHtml.slice(groupSpan.start, groupSpan.end);
    const duplicated = insertClonedHtmlLayers(containerHtml, [groupFragment], {
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource: source,
        documents: [sourceDocument(containerHtml)],
      },
    });
    expect(duplicated).not.toBeNull();
    if (!duplicated) return;

    const projection = buildCodeLayerProjection(duplicated.content, { source });
    const cloneGroup = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        duplicated.rootNodeIds[0],
    );
    const clonedCard = cloneGroup?.children[0]
      ? projection.nodes.find((node) => node.id === cloneGroup.children[0])
      : undefined;
    expect(clonedCard?.dataAttributes[COMPONENT_ID_ATTR]).toBeUndefined();
    expect(clonedCard?.dataAttributes[COMPONENT_REF_ATTR]).toBe("cmp-card");
    const originalCard = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "card-main",
    );
    expect(originalCard?.dataAttributes[COMPONENT_ID_ATTR]).toBe("cmp-card");
    const clonedPlay = clonedCard?.children[0]
      ? projection.nodes.find((node) => node.id === clonedCard.children[0])
      : undefined;
    expect(clonedPlay?.dataAttributes[COMPONENT_REF_ATTR]).toBe("cmp-play");
    expect(clonedPlay?.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
      "card-play",
    );
    expect(
      clonedPlay?.dataAttributes[COMPONENT_OVERRIDES_ATTR],
    ).toBeUndefined();
    const clonedLabel = clonedPlay?.children[0]
      ? projection.nodes.find((node) => node.id === clonedPlay.children[0])
      : undefined;
    expect(clonedLabel?.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
      "play-label",
    );
    assertLinksResolve([sourceDocument(duplicated.content)]);
  });

  it("preserves a linked reference nested inside an ordinary container clone", () => {
    const mainSpan = findNode(sourceHtml, "card-main")?.source;
    expect(mainSpan).toBeTruthy();
    if (!mainSpan) return;
    const mainFragment = sourceHtml.slice(mainSpan.start, mainSpan.end);
    const withReference = insertClonedHtmlLayers(sourceHtml, [mainFragment], {
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource: source,
        documents: [sourceDocument(sourceHtml)],
      },
    });
    expect(withReference).not.toBeNull();
    if (!withReference) return;
    const beforeWrap = buildCodeLayerProjection(withReference.content, {
      source,
    });
    const referenceRoot = beforeWrap.nodes.find(
      (node) =>
        node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-card" &&
        node.dataAttributes["data-agent-native-node-id"] ===
          withReference.rootNodeIds[0],
    );
    expect(referenceRoot?.source).toBeTruthy();
    if (!referenceRoot?.source) return;
    const withOverrides = patchCodeLayerNodeAttributes(withReference.content, [
      {
        node: referenceRoot,
        attributes: { [COMPONENT_OVERRIDES_ATTR]: outerOverrides },
      },
    ]);
    expect(withOverrides).not.toBeNull();
    if (!withOverrides) return;
    const overriddenProjection = buildCodeLayerProjection(withOverrides, {
      source,
    });
    const overriddenReference = overriddenProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        withReference.rootNodeIds[0],
    );
    expect(overriddenReference?.source).toBeTruthy();
    if (!overriddenReference?.source) return;
    const nestedReference = overriddenReference.children[0]
      ? overriddenProjection.nodes.find(
          (node) => node.id === overriddenReference.children[0],
        )
      : undefined;
    expect(nestedReference).toBeTruthy();
    if (!nestedReference) return;
    const withNestedOverride = patchCodeLayerNodeAttributes(withOverrides, [
      {
        node: nestedReference,
        attributes: { [COMPONENT_OVERRIDES_ATTR]: nestedOverrides },
      },
    ]);
    expect(withNestedOverride).not.toBeNull();
    if (!withNestedOverride) return;
    const finalBeforeWrap = buildCodeLayerProjection(withNestedOverride, {
      source,
    });
    const finalOverriddenReference = finalBeforeWrap.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        withReference.rootNodeIds[0],
    );
    expect(finalOverriddenReference?.source).toBeTruthy();
    if (!finalOverriddenReference?.source) return;
    const referenceHtml = withNestedOverride.slice(
      finalOverriddenReference.source.start,
      finalOverriddenReference.source.end,
    );
    const wrappedHtml =
      withNestedOverride.slice(0, finalOverriddenReference.source.start) +
      `<aside data-agent-native-node-id="ordinary-ref-group">${referenceHtml}</aside>` +
      withNestedOverride.slice(finalOverriddenReference.source.end);
    const groupFragment = `<aside data-agent-native-node-id="ordinary-ref-group">${referenceHtml}</aside>`;
    const duplicated = insertClonedHtmlLayers(wrappedHtml, [groupFragment], {
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource: source,
        documents: [sourceDocument(wrappedHtml)],
      },
    });
    expect(duplicated).not.toBeNull();
    if (!duplicated) return;

    const projection = buildCodeLayerProjection(duplicated.content, { source });
    const cloneGroup = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        duplicated.rootNodeIds[0],
    );
    const clonedCard = cloneGroup?.children[0]
      ? projection.nodes.find((node) => node.id === cloneGroup.children[0])
      : undefined;
    expect(clonedCard?.dataAttributes[COMPONENT_REF_ATTR]).toBe("cmp-card");
    expect(clonedCard?.dataAttributes[COMPONENT_OVERRIDES_ATTR]).toBe(
      outerOverrides,
    );
    const clonedPlay = clonedCard?.children[0]
      ? projection.nodes.find((node) => node.id === clonedCard.children[0])
      : undefined;
    expect(clonedPlay?.dataAttributes[COMPONENT_REF_ATTR]).toBe("cmp-play");
    expect(clonedPlay?.dataAttributes[COMPONENT_OVERRIDES_ATTR]).toBe(
      nestedOverrides,
    );
    const clonedLabel = clonedPlay?.children[0]
      ? projection.nodes.find((node) => node.id === clonedPlay.children[0])
      : undefined;
    expect(clonedLabel?.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
      "play-label",
    );
    assertLinksResolve([sourceDocument(duplicated.content)]);
  });

  it("propagates a nested main edit through the cloned parent reference", () => {
    const propagationHtml = sourceHtml.replace(
      ` data-agent-native-component-overrides="${nestedOverrides}"`,
      "",
    );
    const mainSpan = findNode(propagationHtml, "card-main")?.source;
    expect(mainSpan).toBeTruthy();
    if (!mainSpan) return;
    const mainFragment = propagationHtml.slice(mainSpan.start, mainSpan.end);
    const cloned = insertClonedHtmlLayers(propagationHtml, [mainFragment], {
      componentLinks: {
        sourceFileIds: [sourceFileId],
        targetSource: source,
        documents: [sourceDocument(propagationHtml)],
      },
    });
    expect(cloned).not.toBeNull();
    if (!cloned) return;

    const propagation = applyComponentPropertyEdit({
      documents: [sourceDocument(cloned.content)],
      target: { fileId: sourceFileId, nodeId: "play-label" },
      edit: { kind: "style", property: "color", value: "red" },
    });
    expect(propagation.status).toBe("updated");
    if (propagation.status !== "updated") return;
    const finalContent = propagation.changes.find(
      (change) => change.fileId === sourceFileId,
    )?.after;
    expect(finalContent).toBeTruthy();
    if (!finalContent) return;
    const finalProjection = buildCodeLayerProjection(finalContent, { source });
    const playReferences = finalProjection.nodes.filter(
      (node) => node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-play",
    );
    expect(playReferences).toHaveLength(2);
    for (const reference of playReferences) {
      const instanceLabel = finalProjection.nodes.find(
        (node) =>
          node.parentId === reference.id &&
          node.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR] === "play-label",
      );
      expect(instanceLabel?.style.color).toBe("red");
    }
  });

  it("refuses a component subtree with ambiguous copied durable IDs", () => {
    const ambiguousHtml = sourceHtml.replace(
      'data-agent-native-node-id="card-copy"',
      'data-agent-native-node-id="card-play"',
    );
    const mainSpan = findNode(ambiguousHtml, "card-main")?.source;
    expect(mainSpan).toBeTruthy();
    if (!mainSpan) return;
    const result = insertClonedHtmlLayers(
      "<!doctype html><html><body></body></html>",
      [ambiguousHtml.slice(mainSpan.start, mainSpan.end)],
      {
        componentLinks: {
          sourceFileIds: [sourceFileId],
          targetSource: source,
          documents: [sourceDocument(ambiguousHtml)],
        },
      },
    );
    expect(result).toBeNull();
  });

  it("refuses a clone batch when a linked reference cannot be resolved", () => {
    const unresolvedContent = `<!doctype html><html><body>
      <section data-agent-native-node-id="unresolved" data-agent-native-component-ref="missing-component">Source</section>
    </body></html>`;
    const result = insertClonedHtmlLayers(
      unresolvedContent,
      [
        '<div data-agent-native-node-id="ordinary">Ordinary clone</div>',
        '<section data-agent-native-node-id="unresolved" data-agent-native-component-ref="missing-component">Unresolved linked clone</section>',
      ],
      {
        componentLinks: {
          sourceFileIds: [sourceFileId, sourceFileId],
          targetSource: source,
          documents: [sourceDocument(unresolvedContent)],
        },
      },
    );

    expect(result).toBeNull();
  });
});

function parseFragment(html: string): Element {
  const doc = new DOMParser().parseFromString(
    `<template>${html}</template>`,
    "text/html",
  );
  const element = doc.querySelector("template")?.content.firstElementChild;
  if (!element) throw new Error("Expected one cloned element");
  return element;
}

describe("prepareClonedHtmlLayersForLiveInsert", () => {
  it("rejects a failed snapshot sentinel atomically", () => {
    const layerHtmls = [
      `<div data-agent-native-node-id=\"one\">One</div>`,
      `<div data-agent-native-node-id=\"two\">Two</div>`,
    ];
    const liveResult = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      layerHtmls,
      { styleSnapshots: [undefined, null] },
    );
    const storedResult = insertClonedHtmlLayers(
      "<!doctype html><html><body></body></html>",
      layerHtmls,
      { styleSnapshots: [undefined, null] },
    );

    expect(liveResult).toBeNull();
    expect(storedResult).toBeNull();
  });

  it("preserves the human runtime layer name before clone ids replace authored ids", () => {
    const html =
      '<section id="runtime-panel" data-component-name="RuntimePanel">Panel</section>';
    const enriched = preserveClipboardLayerName(html, "Runtime Panel");
    const root = parseFragment(enriched);

    expect(root.getAttribute("data-agent-native-layer-name")).toBe(
      "Runtime Panel",
    );
    expect(
      preserveClipboardLayerName(
        '<section data-agent-native-layer-name="Authored">Panel</section>',
        "Runtime Panel",
      ),
    ).toContain('data-agent-native-layer-name="Authored"');
  });

  it("clones a subtree with fresh node ids and remapped authored id references", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        `<section id="card" data-agent-native-node-id="root" data-agent-native-runtime-component-id="runtime-component-card" data-agent-native-runtime-instance-id="root">
          <label for="field" data-agent-native-node-id="label">Name</label>
          <input id="field" aria-labelledby="card" data-agent-native-node-id="input">
        </section>`,
      ],
      { stripRootPosition: true },
    );

    expect(result).not.toBeNull();
    const clone = parseFragment(result!.htmlFragments[0]!);
    const label = clone.querySelector("label")!;
    const input = clone.querySelector("input")!;
    expect(clone.getAttribute("data-agent-native-node-id")).not.toBe("root");
    expect(clone.getAttribute("data-agent-native-runtime-component-id")).toBe(
      "runtime-component-card",
    );
    expect(clone.getAttribute("data-agent-native-runtime-instance-id")).toBe(
      clone.getAttribute("data-agent-native-node-id"),
    );
    expect(label.getAttribute("data-agent-native-node-id")).not.toBe("label");
    expect(input.getAttribute("data-agent-native-node-id")).not.toBe("input");
    expect(clone.id).not.toBe("card");
    expect(input.id).not.toBe("field");
    expect(label.getAttribute("for")).toBe(input.id);
    expect(input.getAttribute("aria-labelledby")).toBe(clone.id);
    expect(result!.rootNodeIds).toEqual([
      clone.getAttribute("data-agent-native-node-id"),
    ]);
    expect(result!.nodeIdMap.get("root")).toBe(
      clone.getAttribute("data-agent-native-node-id"),
    );
    expect(result!.nodeIdMap.get("input")).toBe(
      input.getAttribute("data-agent-native-node-id"),
    );
  });

  it("keeps clone names stable when authored ids are re-keyed", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(LIVE_URL, [
      `<section id="runtime-panel" data-agent-native-node-id="root"><div>Panel</div></section>`,
      `<div data-agent-native-node-id="unnamed"></div>`,
    ]);

    expect(result).not.toBeNull();
    expect(
      result!.htmlFragments.map(
        (html) => buildCodeLayerProjection(html).nodes[0]?.layerName,
      ),
      // "Runtime Panel" is an explicit runtime name; the unnamed plain <div>
      // has no id/class/aria-label so layerNameFor() falls back to the tag
      // ("Frame") — the clone must derive the SAME tag fallback, never the
      // literal "Copy" (Figma parity: a duplicate keeps the identical name).
    ).toEqual(["Runtime Panel", "Frame"]);
    expect(result!.htmlFragments[0]).not.toContain('id="runtime-panel"');
    expect(result!.htmlFragments[1]).not.toContain(
      'data-agent-native-layer-name="Copy"',
    );
  });

  it("drops the Figma/Fusion source identity so deleting a copy cannot resolve to the original", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        `<section data-loc="Card.tsx:12:4" data-builder-id="blk-1">
          <h3 data-loc="Card.tsx:13:6">Title</h3>
          <p data-code-layer-id="layer-9" data-layer-id="l-2">Body</p>
        </section>`,
      ],
      { stripRootPosition: true },
    );

    expect(result).not.toBeNull();
    const clone = parseFragment(result!.htmlFragments[0]!);
    for (const attribute of [
      "data-loc",
      "data-builder-id",
      "data-code-layer-id",
      "data-layer-id",
    ]) {
      expect(clone.hasAttribute(attribute)).toBe(false);
      expect(clone.querySelector(`[${attribute}]`)).toBeNull();
    }
    const nodeIds = [clone, ...Array.from(clone.querySelectorAll("*"))].map(
      (node) => node.getAttribute("data-agent-native-node-id"),
    );
    expect(nodeIds.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
  });

  it("preserves sanitized provenance and computed portable styles", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        `<article
          data-agent-native-node-id="card"
          data-source-framework="react"
          data-source-file="src/Card.tsx"
          data-source-line="42"
          data-source-column="7"
          data-component-name="Card"
          style="display:flex;color:rgb(1, 2, 3)"
        ><span data-agent-native-node-id="title">Title</span></article>`,
      ],
      {
        styleSnapshots: [
          {
            version: 1,
            rootSourceId: "card",
            nodes: [
              {
                sourceId: "card",
                path: [],
                styles: {
                  display: "grid",
                  "background-color": "rgb(4, 5, 6)",
                },
              },
              {
                sourceId: "title",
                path: [0],
                styles: { "font-weight": "700" },
              },
            ],
          },
        ],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect(clone.getAttribute("data-source-framework")).toBe("react");
    expect(clone.getAttribute("data-source-file")).toBe("src/Card.tsx");
    expect(clone.getAttribute("data-source-line")).toBe("42");
    expect(clone.getAttribute("data-source-column")).toBe("7");
    expect(clone.getAttribute("data-component-name")).toBe("Card");
    expect(clone.getAttribute("data-agent-native-clone-root")).toBe("true");
    expect((clone as HTMLElement).style.display).toBe("grid");
    expect((clone as HTMLElement).style.backgroundColor).toBe("rgb(4, 5, 6)");
    expect((clone.querySelector("span") as HTMLElement).style.fontWeight).toBe(
      "700",
    );
  });

  it("preserves group identity when cloning a legacy generated wrapper", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div data-agent-native-node-id="an-group" data-agent-native-layer-name="Group" data-agent-native-preserve-styles="true"><span data-agent-native-node-id="child">Text</span></div>',
      ],
      {
        styleSnapshots: [
          {
            version: 1,
            rootSourceId: "group",
            nodes: [
              {
                sourceId: "group",
                path: [],
                styles: { display: "block" },
              },
            ],
          },
        ],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect(clone.getAttribute("data-agent-native-group-wrapper")).toBe("true");
    expect(clone.getAttribute("data-agent-native-clone-root")).toBe("true");
  });

  it("preserves legacy generated group identity without a style snapshot", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(LIVE_URL, [
      '<div data-agent-native-node-id="an-group" data-agent-native-layer-name="Group" data-agent-native-preserve-styles="true"><span data-agent-native-node-id="child">Text</span></div>',
    ]);

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect(clone.getAttribute("data-agent-native-group-wrapper")).toBe("true");
  });

  it("marks a copied authored Group as a clone, not a legacy generated wrapper", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div data-agent-native-node-id="group" data-agent-native-layer-name="Group"><span data-agent-native-node-id="child">Text</span></div>',
      ],
      {
        styleSnapshots: [
          {
            version: 1,
            rootSourceId: "group",
            nodes: [
              {
                sourceId: "group",
                path: [],
                styles: { display: "block" },
              },
            ],
          },
        ],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect(clone.getAttribute("data-agent-native-group-wrapper")).toBeNull();
    expect(clone.getAttribute("data-agent-native-clone-root")).toBe("true");
  });

  it("does not promote an older copied Group with preserved styles", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        '<div data-agent-native-node-id="copy-old-group" data-agent-native-layer-name="Group" data-agent-native-preserve-styles="true"><span data-agent-native-node-id="child">Text</span></div>',
      ],
      {
        styleSnapshots: [
          {
            version: 1,
            rootSourceId: "copy-old-group",
            nodes: [
              {
                sourceId: "copy-old-group",
                path: [],
                styles: { display: "block" },
              },
            ],
          },
        ],
      },
    );

    const clone = parseFragment(result!.htmlFragments[0]!);
    expect(clone.getAttribute("data-agent-native-group-wrapper")).toBeNull();
    expect(clone.getAttribute("data-agent-native-clone-root")).toBe("true");
  });

  it("returns the destination URL byte-for-byte instead of turning it into HTML", () => {
    const destination = "http://localhost:5173/a%20b?x=%3Cmain%3E#section";
    const result = prepareClonedHtmlLayersForLiveInsert(destination, [
      '<div data-agent-native-node-id="source">Safe</div>',
    ]);

    expect(result?.destinationContent).toBe(destination);
    expect(result?.destinationContent).not.toContain("<!DOCTYPE");
    expect(
      prepareClonedHtmlLayersForLiveInsert(
        "<!doctype html><html><body></body></html>",
        ['<div data-agent-native-node-id="source">Safe</div>'],
      ),
    ).toBeNull();
  });

  it("returns one safe root per entry and strips active markup", () => {
    const result = prepareClonedHtmlLayersForLiveInsert(
      LIVE_URL,
      [
        `<div data-agent-native-node-id="one" onclick="attack()">
          One<script>attack()</script>
        </div>`,
        `<button data-agent-native-node-id="two" style="position:absolute;left:9px;top:10px" formaction="javascript:attack()" autofocus>
          Two<iframe></iframe>
        </button>`,
      ],
      {
        positions: [{ x: 12.4, y: 25.6 }, null],
        stripRootPosition: true,
      },
    );

    expect(result?.htmlFragments).toHaveLength(2);
    expect(result?.rootNodeIds).toHaveLength(2);
    expect(new Set(result?.rootNodeIds).size).toBe(2);
    const first = parseFragment(result!.htmlFragments[0]!);
    const second = parseFragment(result!.htmlFragments[1]!);
    expect((first as HTMLElement).style.position).toBe("absolute");
    expect((first as HTMLElement).style.left).toBe("12px");
    expect((first as HTMLElement).style.top).toBe("26px");
    expect(first.hasAttribute("onclick")).toBe(false);
    expect(first.querySelector("script")).toBeNull();
    expect(second.hasAttribute("formaction")).toBe(false);
    expect(second.hasAttribute("autofocus")).toBe(false);
    expect(second.querySelector("iframe")).toBeNull();
    expect((second as HTMLElement).style.position).toBe("");
    expect((second as HTMLElement).style.left).toBe("");
    expect((second as HTMLElement).style.top).toBe("");
  });

  it("rejects an active element used as the fragment root", () => {
    expect(
      prepareClonedHtmlLayersForLiveInsert(LIVE_URL, [
        '<script data-agent-native-node-id="script">attack()</script>',
      ]),
    ).toBeNull();
  });
});
