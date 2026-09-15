// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  buildCodeLayerProjection,
  ensureCodeLayerNodeIdsInHtml,
  type CodeLayerNode,
  type CodeLayerSource,
} from "./code-layer";
import {
  analyzeComponentLinks,
  materializeComponentLink,
} from "./component-links";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_NAME_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
  instanceFromNode,
} from "./component-model";

const SOURCE: CodeLayerSource = {
  kind: "design-file",
  designId: "design-1",
  fileId: "file-1",
  filename: "index.html",
};

const NODE_ID_ATTR = "data-agent-native-node-id";

function projection(content: string, source = SOURCE) {
  return buildCodeLayerProjection(content, { source });
}

function nodeWithAttribute(
  nodes: CodeLayerNode[],
  attribute: string,
  value: string,
): CodeLayerNode {
  const node = nodes.find(
    (candidate) => candidate.dataAttributes[attribute] === value,
  );
  if (!node) throw new Error(`Missing projected node ${attribute}=${value}`);
  return node;
}

function canonicalHtml(
  inner = '<span data-agent-native-node-id="main-label">Label</span>',
) {
  return `<main><button ${NODE_ID_ATTR}="main-button" ${COMPONENT_NAME_ATTR}="PlayButton" ${COMPONENT_ID_ATTR}="cmp-play">${inner}</button></main>`;
}

function cloneMarkupWithNewNodeIds(markup: string) {
  const doc = document.implementation.createHTMLDocument("clone");
  const template = doc.createElement("template");
  template.innerHTML = markup;
  const element = template.content.firstElementChild;
  if (!element) throw new Error("Clone markup has no root element");
  const nodeIdMap = new Map<string, string>();
  [element, ...Array.from(element.querySelectorAll("*"))].forEach(
    (node, index) => {
      const oldId = node.getAttribute(NODE_ID_ATTR);
      if (!oldId) return;
      const newId = `clone-${index}-${oldId}`;
      nodeIdMap.set(oldId, newId);
      node.setAttribute(NODE_ID_ATTR, newId);
    },
  );
  return { html: element.outerHTML, nodeIdMap };
}

describe("linked component identity foundation", () => {
  it("resolves refs by opaque ID and leaves same-name legacy copies unlinked", () => {
    const content =
      `${canonicalHtml()}` +
      `<button ${NODE_ID_ATTR}="instance-button" ${COMPONENT_NAME_ATTR}="Renamed display label" ${COMPONENT_REF_ATTR}="cmp-play"><span ${NODE_ID_ATTR}="instance-label">Label</span></button>` +
      `<button ${NODE_ID_ATTR}="second-instance" ${COMPONENT_NAME_ATTR}="PlayButton" ${COMPONENT_REF_ATTR}="cmp-play">Second</button>` +
      `<button ${NODE_ID_ATTR}="legacy-button" ${COMPONENT_NAME_ATTR}="PlayButton">Legacy</button>`;
    const result = analyzeComponentLinks([projection(content)]);

    expect(result.invalidNodes).toEqual([]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      status: "resolved",
      componentId: "cmp-play",
      main: { dataAttributes: { [NODE_ID_ATTR]: "main-button" } },
      references: [
        { dataAttributes: { [NODE_ID_ATTR]: "instance-button" } },
        { dataAttributes: { [NODE_ID_ATTR]: "second-instance" } },
      ],
    });
    const resolved = result.components[0];
    if (resolved?.status !== "resolved")
      throw new Error("Expected a resolved link");
    expect(instanceFromNode(resolved.main)?.componentId).toBe("cmp-play");
    const reference = resolved.references[0];
    if (!reference) throw new Error("Expected one linked reference");
    expect(instanceFromNode(reference)?.componentRef).toBe("cmp-play");
  });

  it("reports missing and duplicate identities while linking same-design Screens", () => {
    const missing = analyzeComponentLinks([
      projection(
        `<button ${NODE_ID_ATTR}="orphan" ${COMPONENT_REF_ATTR}="cmp-gone">Orphan</button>`,
      ),
    ]);
    expect(missing.components[0]).toMatchObject({
      status: "missing-main",
      componentId: "cmp-gone",
    });

    const duplicated = analyzeComponentLinks([
      projection(
        `<button ${COMPONENT_ID_ATTR}="cmp-duplicate" ${NODE_ID_ATTR}="main-a">A</button><button ${COMPONENT_ID_ATTR}="cmp-duplicate" ${NODE_ID_ATTR}="main-b">B</button>`,
      ),
    ]);
    const duplicateResult = duplicated.components[0];
    expect(duplicateResult?.status).toBe("ambiguous-main");
    if (duplicateResult?.status !== "ambiguous-main") {
      throw new Error("Expected duplicate canonical identity to be ambiguous");
    }
    expect(
      duplicateResult.mains.map((node) => node.dataAttributes[NODE_ID_ATTR]),
    ).toEqual(["main-a", "main-b"]);

    const otherFile = { ...SOURCE, fileId: "file-2" };
    const crossFile = analyzeComponentLinks([
      projection(
        `<button ${COMPONENT_ID_ATTR}="cmp-cross" ${NODE_ID_ATTR}="main-cross">Main</button>`,
      ),
      projection(
        `<button ${COMPONENT_REF_ATTR}="cmp-cross" ${NODE_ID_ATTR}="ref-cross">Ref</button>`,
        otherFile,
      ),
    ]);
    expect(crossFile.components[0]).toMatchObject({
      status: "resolved",
      componentId: "cmp-cross",
      references: [{ dataAttributes: { [NODE_ID_ATTR]: "ref-cross" } }],
    });

    const otherDesign = analyzeComponentLinks([
      projection(
        `<button ${COMPONENT_ID_ATTR}="cmp-cross-design" ${NODE_ID_ATTR}="main-cross-design">Main</button>`,
      ),
      projection(
        `<button ${COMPONENT_REF_ATTR}="cmp-cross-design" ${NODE_ID_ATTR}="ref-cross-design">Ref</button>`,
        { ...otherFile, designId: "design-2" },
      ),
    ]);
    expect(otherDesign.components[0]).toMatchObject({
      status: "source-mismatch",
    });

    const incompatibleSourceKind = analyzeComponentLinks([
      projection(
        `<button ${COMPONENT_ID_ATTR}="cmp-kind" ${NODE_ID_ATTR}="main-kind">Main</button>`,
      ),
      projection(
        `<button ${COMPONENT_REF_ATTR}="cmp-kind" ${NODE_ID_ATTR}="ref-kind">Ref</button>`,
        { ...SOURCE, kind: "inline-html" },
      ),
    ]);
    expect(incompatibleSourceKind.components[0]).toMatchObject({
      status: "source-mismatch",
    });
  });

  it("keeps opaque IDs exact and does not trim a reference into a match", () => {
    const result = analyzeComponentLinks([
      projection(
        `<button ${COMPONENT_ID_ATTR}="cmp-exact" ${NODE_ID_ATTR}="main-exact">Main</button><button ${COMPONENT_REF_ATTR}=" cmp-exact " ${NODE_ID_ATTR}="ref-spaced">Ref</button><button ${COMPONENT_REF_ATTR}="   " ${NODE_ID_ATTR}="ref-empty">Empty</button>`,
      ),
    ]);

    expect(result.components).toContainEqual({
      status: "missing-main",
      componentId: " cmp-exact ",
      references: [
        expect.objectContaining({
          dataAttributes: expect.objectContaining({
            [NODE_ID_ATTR]: "ref-spaced",
          }),
        }),
      ],
    });
    expect(result.invalidNodes).toHaveLength(1);
    expect(result.invalidNodes[0]).toMatchObject({
      reason: "empty-identity",
      node: { dataAttributes: { [NODE_ID_ATTR]: "ref-empty" } },
    });
  });

  it("materializes a clone with distinct node IDs and stable canonical descendant IDs", () => {
    const original = ensureCodeLayerNodeIdsInHtml(canonicalHtml(), {
      source: SOURCE,
    }).content;
    const mainProjection = projection(original);
    const mainNode = nodeWithAttribute(
      mainProjection.nodes,
      COMPONENT_ID_ATTR,
      "cmp-play",
    );
    if (!mainNode.source) throw new Error("Canonical main has no source span");
    const mainMarkup = original.slice(
      mainNode.source.start,
      mainNode.source.end,
    );
    const cloned = cloneMarkupWithNewNodeIds(mainMarkup);

    const result = materializeComponentLink({
      mainProjection,
      mainNode,
      targetSource: SOURCE,
      cloneHtml: cloned.html,
      nodeIdMap: cloned.nodeIdMap,
    });
    expect(result.status).toBe("materialized");
    if (result.status !== "materialized") return;

    const cloneProjection = projection(result.content);
    const cloneRoot = nodeWithAttribute(
      cloneProjection.nodes,
      COMPONENT_REF_ATTR,
      "cmp-play",
    );
    expect(cloneRoot.dataAttributes[COMPONENT_ID_ATTR]).toBeUndefined();
    expect(cloneRoot.dataAttributes[NODE_ID_ATTR]).toBe(result.rootNodeId);
    expect(result.rootNodeId).not.toBe(mainNode.dataAttributes[NODE_ID_ATTR]);

    const originalLabel = nodeWithAttribute(
      mainProjection.nodes,
      NODE_ID_ATTR,
      "main-label",
    );
    const originalLabelId = originalLabel.dataAttributes[NODE_ID_ATTR];
    if (!originalLabelId) throw new Error("Canonical label has no durable ID");
    const cloneLabel = nodeWithAttribute(
      cloneProjection.nodes,
      COMPONENT_SOURCE_NODE_ID_ATTR,
      originalLabelId,
    );
    expect(cloneLabel.dataAttributes[NODE_ID_ATTR]).toBe(
      cloned.nodeIdMap.get(originalLabelId),
    );
    expect(cloneLabel.dataAttributes[NODE_ID_ATTR]).not.toBe(originalLabelId);

    const crossScreenMaterialization = materializeComponentLink({
      mainProjection,
      mainNode,
      targetSource: { ...SOURCE, fileId: "file-other" },
      cloneHtml: cloned.html,
      nodeIdMap: cloned.nodeIdMap,
    });
    expect(crossScreenMaterialization.status).toBe("materialized");
    expect(
      materializeComponentLink({
        mainProjection,
        mainNode,
        targetSource: {
          ...SOURCE,
          designId: "design-other",
          fileId: "file-other",
        },
        cloneHtml: cloned.html,
        nodeIdMap: cloned.nodeIdMap,
      }),
    ).toEqual({ status: "source-mismatch" });
    expect(
      materializeComponentLink({
        mainProjection,
        mainNode,
        targetSource: { ...SOURCE, kind: "inline-html" },
        cloneHtml: cloned.html,
        nodeIdMap: cloned.nodeIdMap,
      }),
    ).toEqual({ status: "source-mismatch" });

    const linked = analyzeComponentLinks([
      projection(`${original}${result.content}`),
    ]);
    expect(linked.components[0]).toMatchObject({
      status: "resolved",
      componentId: "cmp-play",
      references: [{ dataAttributes: { [NODE_ID_ATTR]: result.rootNodeId } }],
    });
  });

  it("only rewrites parsed component attributes, preserving quoted lookalikes and boolean attributes", () => {
    const original = ensureCodeLayerNodeIdsInHtml(
      canonicalHtml(`<span ${NODE_ID_ATTR}="main-label">Label</span>`),
      { source: SOURCE },
    ).content;
    const mainProjection = projection(original);
    const mainNode = nodeWithAttribute(
      mainProjection.nodes,
      COMPONENT_ID_ATTR,
      "cmp-play",
    );
    const sourceRootId = mainNode.dataAttributes[NODE_ID_ATTR];
    const sourceLabelId = nodeWithAttribute(
      mainProjection.nodes,
      NODE_ID_ATTR,
      "main-label",
    ).dataAttributes[NODE_ID_ATTR];
    if (!sourceRootId || !sourceLabelId)
      throw new Error("Canonical subtree is missing durable IDs");

    const cloneHtml = `<button ${NODE_ID_ATTR}="clone-root" ${COMPONENT_ID_ATTR}="cmp-play" disabled title='keep data-agent-native-component-id="quoted" and data-agent-native-node-id="also-quoted"'><span ${NODE_ID_ATTR}="clone-label">Label</span></button>`;
    const titleSource = `title='keep data-agent-native-component-id="quoted" and data-agent-native-node-id="also-quoted"'`;
    const result = materializeComponentLink({
      mainProjection,
      mainNode,
      targetSource: SOURCE,
      cloneHtml,
      nodeIdMap: new Map([
        [sourceRootId, "clone-root"],
        [sourceLabelId, "clone-label"],
      ]),
    });

    expect(result.status).toBe("materialized");
    if (result.status !== "materialized") return;
    expect(result.content).toContain(titleSource);
    expect(result.content).toContain(" disabled ");
    expect(result.content).not.toContain(`${COMPONENT_ID_ATTR}="cmp-play"`);
    expect(result.content).toContain(`${COMPONENT_REF_ATTR}="cmp-play"`);
  });

  it("refuses nested linked components without rewriting their link identity", () => {
    const original = ensureCodeLayerNodeIdsInHtml(
      canonicalHtml(
        `<span ${NODE_ID_ATTR}="main-label" ${COMPONENT_REF_ATTR}="cmp-inner">Inner</span>`,
      ),
      { source: SOURCE },
    ).content;
    const mainProjection = projection(original);
    const mainNode = nodeWithAttribute(
      mainProjection.nodes,
      COMPONENT_ID_ATTR,
      "cmp-play",
    );
    if (!mainNode.source) throw new Error("Canonical main has no source span");
    const mainMarkup = original.slice(
      mainNode.source.start,
      mainNode.source.end,
    );
    const cloned = cloneMarkupWithNewNodeIds(mainMarkup);
    const cloneHtml = cloned.html;
    const result = materializeComponentLink({
      mainProjection,
      mainNode,
      targetSource: SOURCE,
      cloneHtml,
      nodeIdMap: cloned.nodeIdMap,
    });
    expect(result).toMatchObject({ status: "unsupported-nested-link" });
    expect(cloneHtml).toContain(`${COMPONENT_REF_ATTR}="cmp-inner"`);
  });
});
