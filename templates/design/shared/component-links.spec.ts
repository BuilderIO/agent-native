// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  buildCodeLayerProjection,
  ensureCodeLayerNodeIdsInHtml,
  type CodeLayerNode,
  type CodeLayerSource,
} from "./code-layer";
import {
  analyzeComponentLinks,
  applyComponentPropertyEdit,
  applyComponentStructureEdit,
  materializeComponentLink,
  resetComponentInstanceOverrides,
} from "./component-links";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_NAME_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
  instanceFromNode,
} from "./component-model";
import { GROUP_RUNTIME_ATTR } from "./group-runtime";

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

function structuralDocuments() {
  const main = `<section ${NODE_ID_ATTR}="main-card" ${COMPONENT_NAME_ATTR}="Card" ${COMPONENT_ID_ATTR}="cmp-card"><h2 ${NODE_ID_ATTR}="title" id="main-title-anchor" class="title absolute" data-agent-native-constraint="free" style="position:absolute;left:10px;top:20px;width:100px;height:20px">Title</h2><p ${NODE_ID_ATTR}="subtitle" class="subtitle absolute" data-agent-native-constraint="free" style="position:absolute;left:150px;top:40px;width:120px;height:24px;color:black">Subtitle</p></section><aside ${NODE_ID_ATTR}="outside">Outside</aside>`;
  const subtitleOverrides = encodeURIComponent(
    JSON.stringify([
      { sourceNodeId: "subtitle", property: "textContent" },
      { sourceNodeId: "subtitle", property: "style:color" },
      {
        sourceNodeId: "subtitle",
        property: "attribute:data-agent-native-layer-name",
      },
    ]),
  );
  const instance = (rootId: string, titleId: string, subtitleId: string) =>
    `<section ${NODE_ID_ATTR}="${rootId}" ${COMPONENT_NAME_ATTR}="Card copy" ${COMPONENT_REF_ATTR}="cmp-card" style="position:absolute;left:100px;top:200px;width:300px;height:100px"><h2 ${NODE_ID_ATTR}="${titleId}" id="instance-title-anchor" ${COMPONENT_SOURCE_NODE_ID_ATTR}="title" class="title absolute" data-agent-native-constraint="free" style="position:absolute;left:50px;top:5px;width:100px;height:20px">Title</h2><p ${NODE_ID_ATTR}="${subtitleId}" ${COMPONENT_SOURCE_NODE_ID_ATTR}="subtitle" class="subtitle absolute" data-agent-native-constraint="free" data-agent-native-layer-name="Instance subtitle" style="position:absolute;left:40px;top:50px;width:120px;height:24px;color:orange" ${COMPONENT_OVERRIDES_ATTR}="${subtitleOverrides}">Instance override</p></section>`;
  return {
    main,
    instance,
    documents: [
      { source: SOURCE, content: main },
      {
        source: { ...SOURCE, fileId: "file-2" },
        content: instance(
          "instance-card-2",
          "instance-title-2",
          "instance-subtitle-2",
        ),
      },
      {
        source: { ...SOURCE, fileId: "file-3" },
        content: instance(
          "instance-card-3",
          "instance-title-3",
          "instance-subtitle-3",
        ),
      },
    ],
  };
}

function nestedOwnershipDocuments(args: {
  canonicalChildren: string;
  referenceChildren: string;
}) {
  const fixture = structuralDocuments();
  const innerMain = `<article ${NODE_ID_ATTR}="inner-main" ${COMPONENT_NAME_ATTR}="Inner" ${COMPONENT_ID_ATTR}="cmp-inner">${args.canonicalChildren}</article>`;
  const mainWithInner = fixture.main.replace(
    '<aside data-agent-native-node-id="outside">',
    `${innerMain}<aside data-agent-native-node-id="outside">`,
  );
  const nestedReference = `<article ${NODE_ID_ATTR}="nested-source" ${COMPONENT_REF_ATTR}="cmp-inner">${args.referenceChildren}</article>`;
  const main = mainWithInner.replace(
    "</section>",
    `${nestedReference}</section>`,
  );
  const instanceChildren = args.referenceChildren.replace(
    /data-agent-native-node-id="nested-/g,
    'data-agent-native-node-id="instance-nested-',
  );
  const nestedInstance = `<article ${NODE_ID_ATTR}="instance-nested-source" ${COMPONENT_REF_ATTR}="cmp-inner" ${COMPONENT_SOURCE_NODE_ID_ATTR}="nested-source">${instanceChildren}</article>`;
  return fixture.documents.map((document, index) => ({
    ...document,
    content:
      index === 0
        ? main
        : document.content.replace("</section>", `${nestedInstance}</section>`),
  }));
}

function applyMainStructure(
  documents: ReturnType<typeof structuralDocuments>["documents"],
  intent: Parameters<typeof applyVisualEdit>[1],
  targetNodeId = "title",
) {
  const mainDocument = documents[0]!;
  const transformed = applyVisualEdit(mainDocument.content, intent, {
    source: mainDocument.source,
    allowMainComponentStructure: true,
  });
  expect(transformed.result.status).toBe("applied");
  return applyComponentStructureEdit({
    documents,
    target: { fileId: SOURCE.fileId!, nodeId: targetNodeId },
    mainBefore: mainDocument.content,
    mainAfter: transformed.content,
  });
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

describe("linked component structure propagation", () => {
  it("treats component prop attributes as inherited values with instance overrides", () => {
    const emptyOverrides = encodeURIComponent("[]");
    const main = `<button ${NODE_ID_ATTR}="main-button" ${COMPONENT_NAME_ATTR}="Button" ${COMPONENT_ID_ATTR}="cmp-button" data-agent-native-prop-variant="primary">Main</button>`;
    const reference = `<button ${NODE_ID_ATTR}="instance-button" ${COMPONENT_NAME_ATTR}="Button" ${COMPONENT_REF_ATTR}="cmp-button" data-agent-native-component-overrides="${emptyOverrides}" data-agent-native-prop-variant="primary">Instance</button>`;
    const documents = [
      { source: SOURCE, content: main },
      {
        source: { ...SOURCE, fileId: "file-2" },
        content: reference,
      },
    ];

    const mainEdit = applyComponentPropertyEdit({
      documents,
      target: { fileId: SOURCE.fileId!, nodeId: "main-button" },
      edit: {
        kind: "attribute",
        attribute: "data-agent-native-prop-variant",
        value: "secondary",
      },
    });
    expect(mainEdit.status).toBe("updated");
    if (mainEdit.status !== "updated") return;
    const afterMain = documents.map((document) => ({
      ...document,
      content:
        mainEdit.changes.find(
          (change) => change.fileId === document.source.fileId,
        )?.after ?? document.content,
    }));
    expect(
      nodeWithAttribute(
        projection(afterMain[1]!.content, afterMain[1]!.source).nodes,
        "data-agent-native-prop-variant",
        "secondary",
      ),
    ).toBeTruthy();

    const instanceEdit = applyComponentPropertyEdit({
      documents: afterMain,
      target: { fileId: "file-2", nodeId: "instance-button" },
      edit: {
        kind: "attribute",
        attribute: "data-agent-native-prop-variant",
        value: "outline",
      },
    });
    expect(instanceEdit.status).toBe("updated");
    if (instanceEdit.status !== "updated") return;
    const afterInstance = afterMain.map((document) => ({
      ...document,
      content:
        instanceEdit.changes.find(
          (change) => change.fileId === document.source.fileId,
        )?.after ?? document.content,
    }));
    expect(afterInstance[1]!.content).toContain(
      'data-agent-native-prop-variant="outline"',
    );
    expect(decodeURIComponent(afterInstance[1]!.content)).toContain(
      '"property":"attribute:data-agent-native-prop-variant"',
    );

    const laterMainEdit = applyComponentPropertyEdit({
      documents: afterInstance,
      target: { fileId: SOURCE.fileId!, nodeId: "main-button" },
      edit: {
        kind: "attribute",
        attribute: "data-agent-native-prop-variant",
        value: "quiet",
      },
    });
    expect(laterMainEdit.status).toBe("updated");
    if (laterMainEdit.status !== "updated") return;
    const afterLaterMain = afterInstance.map((document) => ({
      ...document,
      content:
        laterMainEdit.changes.find(
          (change) => change.fileId === document.source.fileId,
        )?.after ?? document.content,
    }));
    expect(afterLaterMain[0]!.content).toContain(
      'data-agent-native-prop-variant="quiet"',
    );
    expect(afterLaterMain[1]!.content).toContain(
      'data-agent-native-prop-variant="outline"',
    );

    const reset = resetComponentInstanceOverrides({
      documents: afterLaterMain,
      instance: { fileId: "file-2", nodeId: "instance-button" },
    });
    expect(reset.status).toBe("updated");
    if (reset.status !== "updated") return;
    const afterReset = reset.changes.find(
      (change) => change.fileId === "file-2",
    )?.after;
    expect(afterReset).toContain('data-agent-native-prop-variant="quiet"');
    expect(decodeURIComponent(afterReset ?? "")).not.toContain(
      "attribute:data-agent-native-prop-variant",
    );

    const afterResetDocuments = afterLaterMain.map((document) => ({
      ...document,
      content:
        reset.changes.find((change) => change.fileId === document.source.fileId)
          ?.after ?? document.content,
    }));
    const emptyMainEdit = applyComponentPropertyEdit({
      documents: afterResetDocuments,
      target: { fileId: SOURCE.fileId!, nodeId: "main-button" },
      edit: {
        kind: "attribute",
        attribute: "data-agent-native-prop-variant",
        value: "",
      },
    });
    expect(emptyMainEdit.status).toBe("updated");
    if (emptyMainEdit.status !== "updated") return;
    const afterEmptyMain = afterResetDocuments.map((document) => ({
      ...document,
      content:
        emptyMainEdit.changes.find(
          (change) => change.fileId === document.source.fileId,
        )?.after ?? document.content,
    }));
    const emptyInstanceEdit = applyComponentPropertyEdit({
      documents: afterEmptyMain,
      target: { fileId: "file-2", nodeId: "instance-button" },
      edit: {
        kind: "attribute",
        attribute: "data-agent-native-prop-variant",
        value: "outline",
      },
    });
    expect(emptyInstanceEdit.status).toBe("updated");
    if (emptyInstanceEdit.status !== "updated") return;
    const afterEmptyInstance = afterEmptyMain.map((document) => ({
      ...document,
      content:
        emptyInstanceEdit.changes.find(
          (change) => change.fileId === document.source.fileId,
        )?.after ?? document.content,
    }));
    const emptyReset = resetComponentInstanceOverrides({
      documents: afterEmptyInstance,
      instance: { fileId: "file-2", nodeId: "instance-button" },
    });
    expect(emptyReset.status).toBe("updated");
    if (emptyReset.status !== "updated") return;
    const afterEmptyReset = emptyReset.changes.find(
      (change) => change.fileId === "file-2",
    )?.after;
    expect(afterEmptyReset).toContain('data-agent-native-prop-variant=""');
    expect(decodeURIComponent(afterEmptyReset ?? "")).not.toContain(
      "attribute:data-agent-native-prop-variant",
    );
  });

  it("propagates a main child deletion to every cross-screen instance", () => {
    const fixture = structuralDocuments();
    const result = applyMainStructure(fixture.documents, {
      kind: "deleteNode",
      target: { nodeId: "title" },
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.changes.map(({ fileId }) => fileId)).toEqual([
      "file-1",
      "file-2",
      "file-3",
    ]);
    for (const change of result.changes.slice(1)) {
      expect(change.after).not.toContain(
        `data-agent-native-component-source-node-id="title"`,
      );
      expect(change.after).toContain(
        `data-agent-native-component-source-node-id="subtitle"`,
      );
      expect(change.after).toContain("Instance override");
    }
  });

  it("preserves every raw instance gap when the last projected child is deleted", () => {
    const fixture = structuralDocuments();
    const documents = fixture.documents.map((document, index) => ({
      ...document,
      content: document.content
        .replace(
          /<\/h2><p /,
          `</h2><!--gap-${index}-between-->between-${index}<p `,
        )
        .replace(
          /<\/p><\/section>/,
          `</p>after-${index}<!--gap-${index}-suffix--></section>`,
        ),
    }));
    const result = applyMainStructure(documents, {
      kind: "deleteNode",
      target: { nodeId: "subtitle" },
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    for (const [index, fileId] of ["file-1", "file-2", "file-3"].entries()) {
      const after = result.changes.find(
        (change) => change.fileId === fileId,
      )?.after;
      expect(after).toContain(`<!--gap-${index}-between-->between-${index}`);
      expect(after).toContain(`after-${index}<!--gap-${index}-suffix-->`);
    }
  });

  it("keeps adjacent raw gaps before the next surviving child when a middle child is deleted", () => {
    const fixture = structuralDocuments();
    const documents = fixture.documents.map((document, index) => ({
      ...document,
      content: document.content
        .replace(/<\/h2><p /, `</h2><!--gap-${index}-one-->raw-${index}-one<p `)
        .replace(
          /<\/p><\/section>/,
          `</p><!--gap-${index}-two-->raw-${index}-two<div ${NODE_ID_ATTR}="third-${index}" ${
            index === 0 ? "" : `${COMPONENT_SOURCE_NODE_ID_ATTR}="third-0" `
          }>Third</div><!--gap-${index}-three-->raw-${index}-three</section>`,
        ),
    }));
    const result = applyMainStructure(documents, {
      kind: "deleteNode",
      target: { nodeId: "subtitle" },
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    for (const [index, fileId] of ["file-2", "file-3"].entries()) {
      const after = result.changes.find(
        (change) => change.fileId === fileId,
      )?.after;
      expect(after).toBeDefined();
      const firstGap = after!.indexOf(`<!--gap-${index + 1}-one-->`);
      const secondGap = after!.indexOf(`<!--gap-${index + 1}-two-->`);
      const thirdChild = after!.indexOf(
        `${COMPONENT_SOURCE_NODE_ID_ATTR}="third-0"`,
      );
      const thirdGap = after!.indexOf(`<!--gap-${index + 1}-three-->`);
      expect(firstGap).toBeGreaterThan(-1);
      expect(secondGap).toBeGreaterThan(firstGap);
      expect(thirdChild).toBeGreaterThan(secondGap);
      expect(thirdGap).toBeGreaterThan(thirdChild);
      expect(after!.match(new RegExp(`raw-${index + 1}-`, "g"))).toHaveLength(
        3,
      );
    }
  });

  it("reorders children while retaining an instance text and style override", () => {
    const fixture = structuralDocuments();
    const documents = fixture.documents.map((document, index) => ({
      ...document,
      content: document.content.replace(
        /<\/h2><p /,
        `</h2><!--identity-gap-${index}-->unprojected-${index}<p `,
      ),
    }));
    const result = applyMainStructure(documents, {
      kind: "moveNode",
      target: { nodeId: "subtitle" },
      anchor: { nodeId: "title" },
      placement: "before",
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    const instance = result.changes.find(({ fileId }) => fileId === "file-2");
    expect(instance).toBeDefined();
    const after = instance!.after;
    expect(
      after.indexOf('data-agent-native-component-source-node-id="subtitle"'),
    ).toBeLessThan(
      after.indexOf('data-agent-native-component-source-node-id="title"'),
    );
    expect(after).toContain("Instance override");
    expect(after).toContain("color:orange");
    const gap = "<!--identity-gap-1-->unprojected-1";
    expect(after.split(gap)).toHaveLength(2);
    expect(after.indexOf(gap)).toBeLessThan(
      after.indexOf('data-agent-native-component-source-node-id="subtitle"'),
    );
  });

  it("wraps with changed local coordinates and syncs only unoverridden values", () => {
    const fixture = structuralDocuments();
    const result = applyMainStructure(fixture.documents, {
      kind: "wrapNodes",
      targetIds: ["title", "subtitle"],
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    const instance = result.changes.find(({ fileId }) => fileId === "file-2");
    expect(instance).toBeDefined();
    const instanceProjection = projection(instance!.after, {
      ...SOURCE,
      fileId: "file-2",
    });
    const wrapper = instanceProjection.nodes.find(
      (node) =>
        node.attributes["data-agent-native-group-wrapper"] === "true" &&
        node.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR],
    );
    expect(wrapper).toBeDefined();
    const title = nodeWithAttribute(
      instanceProjection.nodes,
      COMPONENT_SOURCE_NODE_ID_ATTR,
      "title",
    );
    expect(title.style.left).toBe("0px");
    expect(title.style.top).toBe("0px");
    const subtitle = nodeWithAttribute(
      instanceProjection.nodes,
      COMPONENT_SOURCE_NODE_ID_ATTR,
      "subtitle",
    );
    expect(subtitle.style.left).toBe("140px");
    expect(subtitle.style.top).toBe("20px");
    expect(subtitle.style.color).toBe("orange");
    expect(subtitle.layerName).toBe("Instance subtitle");
    expect(instance!.after).toContain(
      `data-agent-native-component-overrides="${encodeURIComponent(
        JSON.stringify([
          { sourceNodeId: "subtitle", property: "textContent" },
          { sourceNodeId: "subtitle", property: "style:color" },
          {
            sourceNodeId: "subtitle",
            property: "attribute:data-agent-native-layer-name",
          },
        ]),
      )}"`,
    );
  });

  it("installs a measured Group runtime after validating the canonical main boundary", () => {
    const fixture = structuralDocuments();
    const documents = fixture.documents.map((document, index) =>
      index === 0
        ? {
            ...document,
            content: document.content
              .replace(
                "<section ",
                '<section data-agent-native-group-wrapper="true" data-an-primitive="frame" ',
              )
              .replace(/position:absolute;/g, "position:relative;"),
          }
        : document,
    );
    const mainDocument = documents[0]!;
    const mainProjection = projection(mainDocument.content);
    const titleId = nodeWithAttribute(
      mainProjection.nodes,
      NODE_ID_ATTR,
      "title",
    ).id;
    const subtitleId = nodeWithAttribute(
      mainProjection.nodes,
      NODE_ID_ATTR,
      "subtitle",
    ).id;
    const transformed = applyVisualEdit(
      mainDocument.content,
      {
        kind: "wrapNodes",
        targetIds: [titleId, subtitleId],
        sizeHints: {
          [titleId]: { left: 10, top: 20, width: 100, height: 20 },
          [subtitleId]: { left: 150, top: 40, width: 120, height: 24 },
        },
      },
      {
        source: mainDocument.source,
        allowMainComponentStructure: true,
      },
    );

    expect(transformed.result.status).toBe("applied");
    expect(transformed.content).toContain(
      "data-agent-native-measured-flow-group",
    );
    expect(transformed.content).not.toContain(`<script ${GROUP_RUNTIME_ATTR}`);

    const result = applyComponentStructureEdit({
      documents,
      target: { fileId: SOURCE.fileId!, nodeId: "main-card" },
      mainBefore: mainDocument.content,
      mainAfter: transformed.content,
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.changes.map(({ fileId }) => fileId)).toEqual([
      "file-1",
      "file-2",
      "file-3",
    ]);
    for (const change of result.changes) {
      expect(change.after).toContain("data-agent-native-measured-flow-group");
      expect(
        change.after.match(new RegExp(`<script ${GROUP_RUNTIME_ATTR}\\b`, "g")),
      ).toHaveLength(1);
    }
  });

  it("syncs auto-layout markers and classes without changing instance placement", () => {
    const fixture = structuralDocuments();
    const result = applyMainStructure(fixture.documents, {
      kind: "wrapNodes",
      targetIds: ["title", "subtitle"],
      autoLayout: true,
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    const instance = result.changes.find(({ fileId }) => fileId === "file-3");
    expect(instance).toBeDefined();
    const instanceProjection = projection(instance!.after, {
      ...SOURCE,
      fileId: "file-3",
    });
    const title = nodeWithAttribute(
      instanceProjection.nodes,
      COMPONENT_SOURCE_NODE_ID_ATTR,
      "title",
    );
    expect(title.classes).toEqual(["title"]);
    expect(title.style.position).toBeUndefined();
    expect(title.dataAttributes["data-agent-native-constraint"]).toBe("free");
    const root = nodeWithAttribute(
      instanceProjection.nodes,
      COMPONENT_REF_ATTR,
      "cmp-card",
    );
    expect(root.style.left).toBe("100px");
    expect(root.style.top).toBe("200px");
    expect(root.style.width).toBe("300px");
    expect(root.style.height).toBe("100px");
  });

  it("unwraps a main wrapper and restores direct instance children", () => {
    const fixture = structuralDocuments();
    const wrapped = applyVisualEdit(
      fixture.main,
      { kind: "wrapNodes", targetIds: ["title", "subtitle"] },
      { source: SOURCE, allowMainComponentStructure: true },
    );
    expect(wrapped.result.status).toBe("applied");
    const wrapperId = wrapped.result.wrapperNodeId;
    expect(wrapperId).toBeDefined();
    if (wrapped.result.status !== "applied" || !wrapperId) return;
    const first = applyComponentStructureEdit({
      documents: fixture.documents,
      target: { fileId: SOURCE.fileId!, nodeId: "title" },
      mainBefore: fixture.main,
      mainAfter: wrapped.content,
    });
    expect(first.status).toBe("updated");
    if (first.status !== "updated") return;
    const wrappedDocuments = fixture.documents.map((document) => ({
      ...document,
      content:
        first.changes.find(({ fileId }) => fileId === document.source.fileId)
          ?.after ?? document.content,
    }));
    const unwrapped = applyVisualEdit(
      wrapped.content,
      { kind: "unwrap", targetId: wrapperId },
      { source: SOURCE, allowMainComponentStructure: true },
    );
    expect(unwrapped.result.status).toBe("applied");
    if (unwrapped.result.status !== "applied") return;

    const result = applyComponentStructureEdit({
      documents: wrappedDocuments,
      target: { fileId: SOURCE.fileId!, nodeId: "title" },
      mainBefore: wrapped.content,
      mainAfter: unwrapped.content,
    });
    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    const instance = result.changes.find(({ fileId }) => fileId === "file-2");
    expect(instance).toBeDefined();
    expect(instance!.after).not.toContain("data-agent-native-group-wrapper");
    expect(instance!.after).toContain(
      `data-agent-native-component-source-node-id="title"`,
    );
    expect(instance!.after).toContain("Instance override");
  });

  it("adds a main child to two same-file instances with unique durable and authored ids", () => {
    const fixture = structuralDocuments();
    const first = fixture.documents[1]!;
    const second = fixture.documents[2]!;
    const sameFileContent =
      fixture.main +
      first.content +
      second.content +
      `<aside ${NODE_ID_ATTR}="same-file-outside">Outside</aside>`;
    const documents = [
      { source: SOURCE, content: sameFileContent },
      { source: { ...SOURCE, fileId: "file-3" }, content: first.content },
    ];
    const mainDocument = documents[0]!;
    const mainAfter = mainDocument.content.replace(
      "</section>",
      `<div ${NODE_ID_ATTR}="added" id="badge" aria-labelledby="badge-label" class="badge"><span ${NODE_ID_ATTR}="badge-label" id="badge-label">Added</span><label ${NODE_ID_ATTR}="badge-control" for="badge-label">Label</label><label ${NODE_ID_ATTR}="badge-existing-control" for="main-title-anchor">Existing</label><svg ${NODE_ID_ATTR}="badge-art" id="badge-art"><defs><clipPath id="badge-clip"><rect width="10" height="10"/></clipPath></defs><rect width="10" height="10" clip-path="url(#badge-clip)"/></svg></div></section>`,
    );
    const result = applyComponentStructureEdit({
      documents,
      target: { fileId: SOURCE.fileId!, nodeId: "main-card" },
      mainBefore: mainDocument.content,
      mainAfter,
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    const sameFile = result.changes.find(({ fileId }) => fileId === "file-1");
    expect(sameFile).toBeDefined();
    const addedNodes = projection(sameFile!.after).nodes.filter(
      (node) => node.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR] === "added",
    );
    const ids = addedNodes.map((node) => node.dataAttributes[NODE_ID_ATTR]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const authoredIds = [
      ...sameFile!.after.matchAll(/(?:^|\s)id="([^"]+)"/g),
    ].map((match) => match[1]);
    expect(authoredIds.filter((id) => id === "badge")).toHaveLength(1);
    expect(authoredIds.filter((id) => id === "badge-label")).toHaveLength(1);
    expect(authoredIds.filter((id) => id === "badge-art")).toHaveLength(1);
    expect(authoredIds.filter((id) => id === "badge-clip")).toHaveLength(1);
    expect(
      authoredIds.filter((id) => id?.startsWith("an-instance-file-1:")),
    ).toHaveLength(8);
    expect(
      new Set(authoredIds.filter((id) => id?.startsWith("an-instance-file-1:")))
        .size,
    ).toBe(8);
    expect(sameFile!.after).toContain('for="an-instance-file-1:badge-label');
    expect(sameFile!.after).toContain('for="instance-title-anchor"');
    expect(sameFile!.after).toContain(
      'clip-path="url(#an-instance-file-1:badge-art:id:badge-clip',
    );
  });

  it("materializes an inserted nested instance with fresh ownership in every reference", () => {
    const fixture = structuralDocuments();
    const innerMain = `<article ${NODE_ID_ATTR}="inner-main" ${COMPONENT_NAME_ATTR}="Inner" ${COMPONENT_ID_ATTR}="cmp-inner"><span ${NODE_ID_ATTR}="inner-label" id="inner-label-anchor">Inner label</span></article>`;
    const mainBefore = fixture.main.replace(
      '<aside data-agent-native-node-id="outside">',
      `${innerMain}<aside data-agent-native-node-id="outside">`,
    );
    const nestedMarkup = `<article ${NODE_ID_ATTR}="nested-source" ${COMPONENT_REF_ATTR}="cmp-inner"><span ${NODE_ID_ATTR}="nested-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-label" id="nested-label-anchor" aria-labelledby="nested-label-anchor">Nested label</span></article>`;
    const closing = mainBefore.indexOf("</section>");
    const mainAfter =
      mainBefore.slice(0, closing) + nestedMarkup + mainBefore.slice(closing);
    const documents = fixture.documents.map((document, index) =>
      index === 0 ? { ...document, content: mainBefore } : document,
    );
    const result = applyComponentStructureEdit({
      documents,
      target: { fileId: SOURCE.fileId!, nodeId: "main-card" },
      mainBefore,
      mainAfter,
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    for (const fileId of ["file-2", "file-3"]) {
      const change = result.changes.find((entry) => entry.fileId === fileId);
      expect(change).toBeDefined();
      const nested = projection(change!.after, { ...SOURCE, fileId }).nodes;
      const nestedRoot = nodeWithAttribute(
        nested,
        COMPONENT_SOURCE_NODE_ID_ATTR,
        "nested-source",
      );
      expect(nestedRoot.dataAttributes[COMPONENT_REF_ATTR]).toBe("cmp-inner");
      expect(nestedRoot.dataAttributes[NODE_ID_ATTR]).not.toBe("nested-source");
      const nestedLabel = nodeWithAttribute(
        nested,
        COMPONENT_SOURCE_NODE_ID_ATTR,
        "inner-label",
      );
      expect(nestedLabel.dataAttributes[NODE_ID_ATTR]).not.toBe("nested-label");
      expect(change!.after).toContain('aria-labelledby="an-instance-file-');
      expect(change!.after).toContain("Nested label");
    }

    const propagatedDocuments = documents.map((document) => ({
      ...document,
      content:
        result.changes.find((entry) => entry.fileId === document.source.fileId)
          ?.after ?? document.content,
    }));
    const nestedEdit = applyComponentPropertyEdit({
      documents: propagatedDocuments,
      target: { fileId: SOURCE.fileId!, nodeId: "inner-label" },
      edit: { kind: "textContent", value: "Nested update" },
    });
    expect(nestedEdit.status).toBe("updated");
    if (nestedEdit.status !== "updated") return;
    for (const fileId of ["file-1", "file-2", "file-3"]) {
      const change = nestedEdit.changes.find(
        (entry) => entry.fileId === fileId,
      );
      expect(change).toBeDefined();
      expect(change!.after).toContain("Nested update");
    }
    expect(
      nestedEdit.changes.find((entry) => entry.fileId === "file-2")!.after,
    ).toContain("Instance override");

    const propagatedMain = propagatedDocuments[0]!;
    const removed = applyVisualEdit(
      propagatedMain.content,
      { kind: "deleteNode", target: { nodeId: "nested-source" } },
      { source: SOURCE, allowMainComponentStructure: true },
    );
    expect(removed.result.status).toBe("applied");
    if (removed.result.status !== "applied") return;
    const removal = applyComponentStructureEdit({
      documents: propagatedDocuments,
      target: { fileId: SOURCE.fileId!, nodeId: "title" },
      mainBefore: propagatedMain.content,
      mainAfter: removed.content,
    });
    expect(removal.status).toBe("updated");
    if (removal.status !== "updated") return;
    for (const fileId of ["file-2", "file-3"]) {
      const change = removal.changes.find((entry) => entry.fileId === fileId);
      expect(change).toBeDefined();
      expect(change!.after).not.toContain(
        `data-agent-native-component-source-node-id="nested-source"`,
      );
      expect(change!.after).not.toContain(`${COMPONENT_REF_ATTR}="cmp-inner"`);
    }
  });

  it.each([
    {
      label: "a bogus nested source-node ID",
      canonicalChildren: `<span ${NODE_ID_ATTR}="inner-label">Inner label</span>`,
      referenceChildren: `<span ${NODE_ID_ATTR}="nested-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="BOGUS">Nested label</span>`,
    },
    {
      label: "duplicated canonical nested source-node IDs",
      canonicalChildren: `<span ${NODE_ID_ATTR}="inner-label">First</span><span ${NODE_ID_ATTR}="inner-label">Second</span>`,
      referenceChildren: `<span ${NODE_ID_ATTR}="nested-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-label">First</span><span ${NODE_ID_ATTR}="nested-copy" ${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-copy">Second</span>`,
    },
    {
      label: "a missing canonical nested source-node ID",
      canonicalChildren: `<span>Inner label</span>`,
      referenceChildren: `<span ${NODE_ID_ATTR}="nested-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-label">Nested label</span>`,
    },
  ])(
    "refuses $label atomically",
    ({ canonicalChildren, referenceChildren }) => {
      const documents = nestedOwnershipDocuments({
        canonicalChildren,
        referenceChildren,
      });
      const before = documents.map(({ source, content }) => ({
        fileId: source.fileId,
        content,
      }));
      const result = applyComponentPropertyEdit({
        documents,
        target: { fileId: SOURCE.fileId!, nodeId: "title" },
        edit: { kind: "style", property: "color", value: "red" },
      });

      expect(result.status).toBe("unsupported-nested-link");
      expect(result).not.toHaveProperty("changes");
      expect(
        documents.map(({ source, content }) => ({
          fileId: source.fileId,
          content,
        })),
      ).toEqual(before);
    },
  );

  it.each(["BOGUS", "nested-source"])(
    "refuses a canonical nested root source-node ID from the wrong ownership domain (%s)",
    (sourceNodeId) => {
      const documents = nestedOwnershipDocuments({
        canonicalChildren: `<span ${NODE_ID_ATTR}="inner-label">Inner label</span>`,
        referenceChildren: `<span ${NODE_ID_ATTR}="nested-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-label">Nested label</span>`,
      });
      const main = documents[0]!;
      main.content = main.content.replace(
        `${NODE_ID_ATTR}="nested-source" ${COMPONENT_REF_ATTR}="cmp-inner"`,
        `${NODE_ID_ATTR}="nested-source" ${COMPONENT_REF_ATTR}="cmp-inner" ${COMPONENT_SOURCE_NODE_ID_ATTR}="${sourceNodeId}"`,
      );
      const before = documents.map(({ source, content }) => ({
        fileId: source.fileId,
        content,
      }));

      const result = applyComponentPropertyEdit({
        documents,
        target: { fileId: SOURCE.fileId!, nodeId: "title" },
        edit: { kind: "style", property: "color", value: "red" },
      });

      expect(result.status).toBe("unsupported-nested-link");
      expect(result).not.toHaveProperty("changes");
      expect(
        documents.map(({ source, content }) => ({
          fileId: source.fileId,
          content,
        })),
      ).toEqual(before);
    },
  );

  it.each([
    {
      label: "invalid node id",
      nodeId: "does-not-exist",
      status: "missing-node",
    },
    { label: "stale preimage", nodeId: "title", status: "edit-refused" },
  ])("refuses %s without changing any file", ({ label, nodeId, status }) => {
    const fixture = structuralDocuments();
    const before = fixture.documents.map(({ source, content }) => ({
      fileId: source.fileId,
      content,
    }));
    const result = applyComponentStructureEdit({
      documents: fixture.documents,
      target: { fileId: SOURCE.fileId!, nodeId },
      mainBefore:
        label === "stale preimage" ? fixture.main + " " : fixture.main,
      mainAfter: fixture.main,
    });
    expect(result.status).toBe(status);
    expect(result).not.toHaveProperty("changes");
    expect(
      fixture.documents.map(({ source, content }) => ({
        fileId: source.fileId,
        content,
      })),
    ).toEqual(before);
  });

  it("refuses a main snapshot that edits exterior markup", () => {
    const fixture = structuralDocuments();
    const result = applyMainStructure(fixture.documents, {
      kind: "deleteNode",
      target: { nodeId: "title" },
    });
    expect(result.status).toBe("updated");
    const transformed = applyVisualEdit(
      fixture.main,
      {
        kind: "deleteNode",
        target: { nodeId: "title" },
      },
      { source: SOURCE, allowMainComponentStructure: true },
    );
    expect(transformed.result.status).toBe("applied");
    const exterior = transformed.content + "<footer>changed</footer>";
    const refused = applyComponentStructureEdit({
      documents: fixture.documents,
      target: { fileId: SOURCE.fileId!, nodeId: "title" },
      mainBefore: fixture.main,
      mainAfter: exterior,
    });
    expect(refused.status).toBe("edit-refused");
    expect(refused).toMatchObject({
      message: "structure-edit-outside-main-root",
    });
  });
});
