// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  buildCodeLayerProjection,
  patchCodeLayerNodeAttributes,
  readCodeLayerNodeTextContent,
  type CodeLayerSource,
} from "./code-layer";
import {
  applyComponentPropertyEdit,
  resetComponentInstanceOverrides,
  type ComponentNodeHandle,
  type ComponentSourceDocument,
} from "./component-links";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_NAME_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
} from "./component-model";
import { annotateScreenHtmlForPersist } from "./screen-annotation";

const designId = "design-propagation";
const nodeIdAttr = "data-agent-native-node-id";

function source(fileId: string): CodeLayerSource {
  return {
    kind: "design-file",
    designId,
    fileId,
    filename: `${fileId}.html`,
  };
}

function componentDocuments(): ComponentSourceDocument[] {
  const mainSource = source("main-screen");
  const main = `<section ${nodeIdAttr}="main-root" ${COMPONENT_NAME_ATTR}="PlayButton" ${COMPONENT_ID_ATTR}="component-7"><span ${nodeIdAttr}="main-label" style="font-size: 14px; color: #222; background-image: url(data:image/svg+xml;charset=utf8,%3Csvg;%3C/svg%3E)">Play</span></section>`;
  const instance = (
    rootId: string,
    labelId: string,
    fileId: string,
    labelText: string,
    labelStyle: string,
    extraRootAttrs = "",
  ): ComponentSourceDocument => ({
    source: source(fileId),
    content: `<section ${nodeIdAttr}="${rootId}" ${COMPONENT_NAME_ATTR}="Display name can change" ${COMPONENT_REF_ATTR}="component-7" ${extraRootAttrs}><span ${nodeIdAttr}="${labelId}" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-label" style="${labelStyle}">${labelText}</span></section>`,
  });

  return [
    { source: mainSource, content: main },
    instance(
      "instance-b-root",
      "instance-b-label",
      "screen-b",
      "Play",
      "font-size: 14px; color: #222 !important; background-image: url(data:image/svg+xml;charset=utf8,%3Csvg;%3C/svg%3E)",
    ),
    instance(
      "instance-c-root",
      "instance-c-label",
      "screen-c",
      "Play",
      "font-size: 14px; color: #222; background-image: url(data:image/svg+xml;charset=utf8,%3Csvg;%3C/svg%3E)",
    ),
  ];
}

function sameScreenDocuments(): ComponentSourceDocument[] {
  const documents = componentDocuments();
  return [
    {
      source: source("one-screen"),
      content: documents.map(({ content }) => content).join(""),
    },
  ];
}

function nestedComponentDocuments(): ComponentSourceDocument[] {
  return [
    {
      source: source("play-main"),
      content: `<button ${nodeIdAttr}="play-main-root" ${COMPONENT_NAME_ATTR}="Play button" ${COMPONENT_ID_ATTR}="play-button"><span ${nodeIdAttr}="play-main-label" style="color: blue">Play</span></button>`,
    },
    {
      source: source("card-main"),
      content: `<article ${nodeIdAttr}="card-main-root" ${COMPONENT_NAME_ATTR}="Card" ${COMPONENT_ID_ATTR}="card"><button ${nodeIdAttr}="card-play-root" ${COMPONENT_REF_ATTR}="play-button" ${COMPONENT_SOURCE_NODE_ID_ATTR}="play-main-root"><span ${nodeIdAttr}="card-play-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="play-main-label" style="color: blue">Play</span></button><h2 ${nodeIdAttr}="card-title" style="color: black">Card title</h2></article>`,
    },
    {
      source: source("card-copy"),
      content: `<article ${nodeIdAttr}="card-copy-root" ${COMPONENT_NAME_ATTR}="Card copy" ${COMPONENT_REF_ATTR}="card"><button ${nodeIdAttr}="card-copy-play-root" ${COMPONENT_REF_ATTR}="play-button" ${COMPONENT_SOURCE_NODE_ID_ATTR}="card-play-root"><span ${nodeIdAttr}="card-copy-play-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="play-main-label" style="color: blue">Play</span></button><h2 ${nodeIdAttr}="card-copy-title" ${COMPONENT_SOURCE_NODE_ID_ATTR}="card-title" style="color: black">Card title</h2></article>`,
    },
  ];
}

function nestedParentOverrideDocuments(): ComponentSourceDocument[] {
  const inheritedColorOverride = encodeURIComponent(
    JSON.stringify([
      { sourceNodeId: "play-main-root", property: "style:color" },
    ]),
  );
  return [
    {
      source: source("play-main"),
      content: `<button ${nodeIdAttr}="play-main-root" ${COMPONENT_NAME_ATTR}="Play button" ${COMPONENT_ID_ATTR}="play-button" style="color: blue"><span ${nodeIdAttr}="play-main-label">Play</span></button>`,
    },
    {
      source: source("card-main"),
      content: `<article ${nodeIdAttr}="card-main-root" ${COMPONENT_NAME_ATTR}="Card" ${COMPONENT_ID_ATTR}="card"><button ${nodeIdAttr}="card-play-root" ${COMPONENT_REF_ATTR}="play-button" ${COMPONENT_SOURCE_NODE_ID_ATTR}="play-main-root" ${COMPONENT_OVERRIDES_ATTR}="${inheritedColorOverride}" style="color: orange"><span ${nodeIdAttr}="card-play-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="play-main-label">Play</span></button><h2 ${nodeIdAttr}="card-title" style="color: black">Card title</h2></article>`,
    },
    {
      source: source("card-copy"),
      content: `<article ${nodeIdAttr}="card-copy-root" ${COMPONENT_NAME_ATTR}="Card copy" ${COMPONENT_REF_ATTR}="card"><button ${nodeIdAttr}="card-copy-play-root" ${COMPONENT_REF_ATTR}="play-button" ${COMPONENT_SOURCE_NODE_ID_ATTR}="card-play-root" style="color: orange"><span ${nodeIdAttr}="card-copy-play-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="play-main-label">Play</span></button><h2 ${nodeIdAttr}="card-copy-title" ${COMPONENT_SOURCE_NODE_ID_ATTR}="card-title" style="color: black">Card title</h2></article>`,
    },
  ];
}

function durableNode(document: ComponentSourceDocument, nodeId: string) {
  const matches = buildCodeLayerProjection(document.content, {
    source: document.source,
  }).nodes.filter((node) => node.dataAttributes[nodeIdAttr] === nodeId);
  if (matches.length !== 1) {
    throw new Error(`Expected one node ${nodeId} in ${document.source.fileId}`);
  }
  return matches[0]!;
}

function textContent(document: ComponentSourceDocument, nodeId: string) {
  return readCodeLayerNodeTextContent(
    document.content,
    durableNode(document, nodeId),
  );
}

function overrides(document: ComponentSourceDocument, nodeId: string) {
  const raw = durableNode(document, nodeId).dataAttributes[
    COMPONENT_OVERRIDES_ATTR
  ];
  return raw
    ? (JSON.parse(decodeURIComponent(raw)) as Array<{
        sourceNodeId: string;
        property: string;
      }>)
    : [];
}

function handle(fileId: string, nodeId: string): ComponentNodeHandle {
  return { fileId, nodeId };
}

function applyChanges(
  documents: readonly ComponentSourceDocument[],
  changes: Array<{ fileId: string; after: string }>,
): ComponentSourceDocument[] {
  const changed = new Map(changes.map(({ fileId, after }) => [fileId, after]));
  return documents.map((document) => ({
    ...document,
    content: changed.get(document.source.fileId ?? "") ?? document.content,
  }));
}

describe("linked component property propagation", () => {
  it("keeps a pasted text-root correspondence intact through screen normalization", () => {
    const main = `<html><body><button ${nodeIdAttr}="main-root" ${COMPONENT_NAME_ATTR}="Shared Button" ${COMPONENT_ID_ATTR}="component-7" style="background-color: #2f74f5; color: #fff"><span data-an-text="" ${nodeIdAttr}="main-label">Shared action</span></button></body></html>`;
    const pasted = `<html><body><button ${nodeIdAttr}="copy-root" ${COMPONENT_NAME_ATTR}="Shared Button" ${COMPONENT_REF_ATTR}="component-7" style="background-color: rgb(47, 116, 245); color: rgb(255, 255, 255)"><span data-an-text="" ${nodeIdAttr}="copy-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-label" style="color: rgb(255, 255, 255); font: 13.3333px Arial; outline: rgb(255, 255, 255) none 3px; text-align: center">Shared action</span></button></body></html>`;
    const once = annotateScreenHtmlForPersist(pasted, "html");
    const twice = annotateScreenHtmlForPersist(once, "html");

    expect(twice).toBe(once);
    expect(once.match(/<span\b/g) ?? []).toHaveLength(1);
    expect(once).toContain(`${COMPONENT_SOURCE_NODE_ID_ATTR}="main-label"`);
    expect(once).toContain(`${nodeIdAttr}="copy-label"`);

    const result = applyComponentPropertyEdit({
      documents: [
        { source: source("screen-a"), content: main },
        { source: source("screen-b"), content: once },
      ],
      target: handle("screen-a", "main-root"),
      edit: { kind: "style", property: "backgroundColor", value: "#fff" },
    });
    expect(result.status).toBe("updated");
  });
  it("inherits a parent-owned nested override while keeping clone-local values resettable", () => {
    let documents = nestedParentOverrideDocuments();
    expect(durableNode(documents[1]!, "card-play-root").style.color).toBe(
      "orange",
    );
    expect(durableNode(documents[2]!, "card-copy-play-root").style.color).toBe(
      "orange",
    );

    const parentRed = applyComponentPropertyEdit({
      documents,
      target: handle("card-main", "card-play-root"),
      edit: { kind: "style", property: "color", value: "red" },
    });
    expect(parentRed.status).toBe("updated");
    if (parentRed.status !== "updated") return;
    documents = applyChanges(documents, parentRed.changes);
    expect(durableNode(documents[2]!, "card-copy-play-root").style.color).toBe(
      "red",
    );

    const childMainBlue = applyComponentPropertyEdit({
      documents,
      target: handle("play-main", "play-main-root"),
      edit: { kind: "style", property: "color", value: "blueviolet" },
    });
    expect(childMainBlue.status).toBe("updated");
    if (childMainBlue.status !== "updated") return;
    documents = applyChanges(documents, childMainBlue.changes);
    expect(durableNode(documents[1]!, "card-play-root").style.color).toBe(
      "red",
    );
    expect(durableNode(documents[2]!, "card-copy-play-root").style.color).toBe(
      "red",
    );

    const cloneGreen = applyComponentPropertyEdit({
      documents,
      target: handle("card-copy", "card-copy-play-root"),
      edit: { kind: "style", property: "color", value: "green" },
    });
    expect(cloneGreen.status).toBe("updated");
    if (cloneGreen.status !== "updated") return;
    documents = applyChanges(documents, cloneGreen.changes);

    const parentGreen = applyComponentPropertyEdit({
      documents,
      target: handle("card-main", "card-play-root"),
      edit: { kind: "style", property: "color", value: "green" },
    });
    expect(parentGreen.status).toBe("updated");
    if (parentGreen.status !== "updated") return;
    documents = applyChanges(documents, parentGreen.changes);
    expect(durableNode(documents[1]!, "card-play-root").style.color).toBe(
      "green",
    );
    expect(durableNode(documents[2]!, "card-copy-play-root").style.color).toBe(
      "green",
    );
    expect(overrides(documents[2]!, "card-copy-play-root")).toContainEqual({
      sourceNodeId: "play-main-root",
      property: "style:color",
    });

    const parentYellow = applyComponentPropertyEdit({
      documents,
      target: handle("card-main", "card-play-root"),
      edit: { kind: "style", property: "color", value: "yellow" },
    });
    expect(parentYellow.status).toBe("updated");
    if (parentYellow.status !== "updated") return;
    documents = applyChanges(documents, parentYellow.changes);
    expect(durableNode(documents[1]!, "card-play-root").style.color).toBe(
      "yellow",
    );
    expect(durableNode(documents[2]!, "card-copy-play-root").style.color).toBe(
      "green",
    );

    const reset = resetComponentInstanceOverrides({
      documents,
      instance: handle("card-copy", "card-copy-play-root"),
    });
    expect(reset.status).toBe("updated");
    if (reset.status !== "updated") return;
    documents = applyChanges(documents, reset.changes);
    expect(durableNode(documents[2]!, "card-copy-play-root").style.color).toBe(
      "yellow",
    );

    const parentTeal = applyComponentPropertyEdit({
      documents,
      target: handle("card-main", "card-play-root"),
      edit: { kind: "style", property: "color", value: "teal" },
    });
    expect(parentTeal.status).toBe("updated");
    if (parentTeal.status !== "updated") return;
    documents = applyChanges(documents, parentTeal.changes);
    expect(durableNode(documents[2]!, "card-copy-play-root").style.color).toBe(
      "teal",
    );
  });

  it("routes nested text overrides through the parent source and resets to that source", () => {
    let documents = nestedParentOverrideDocuments();
    const parentText = applyComponentPropertyEdit({
      documents,
      target: handle("card-main", "card-play-label"),
      edit: { kind: "textContent", value: "Parent label" },
    });
    expect(parentText.status).toBe("updated");
    if (parentText.status !== "updated") return;
    documents = applyChanges(documents, parentText.changes);
    expect(
      decodeURIComponent(
        durableNode(documents[1]!, "card-play-root").dataAttributes[
          COMPONENT_OVERRIDES_ATTR
        ] ?? "",
      ),
    ).toContain('"property":"textContent"');
    expect(textContent(documents[2]!, "card-copy-play-label")).toBe(
      "Parent label",
    );

    const childMainText = applyComponentPropertyEdit({
      documents,
      target: handle("play-main", "play-main-label"),
      edit: { kind: "textContent", value: "Child main label" },
    });
    expect(childMainText.status).toBe("updated");
    if (childMainText.status !== "updated") return;
    documents = applyChanges(documents, childMainText.changes);
    expect(textContent(documents[1]!, "card-play-label")).toBe("Parent label");
    expect(textContent(documents[2]!, "card-copy-play-label")).toBe(
      "Parent label",
    );

    const localText = applyComponentPropertyEdit({
      documents,
      target: handle("card-copy", "card-copy-play-label"),
      edit: { kind: "textContent", value: "Local label" },
    });
    expect(localText.status).toBe("updated");
    if (localText.status !== "updated") return;
    documents = applyChanges(documents, localText.changes);

    const latestParentText = applyComponentPropertyEdit({
      documents,
      target: handle("card-main", "card-play-label"),
      edit: { kind: "textContent", value: "Latest parent label" },
    });
    expect(latestParentText.status).toBe("updated");
    if (latestParentText.status !== "updated") return;
    documents = applyChanges(documents, latestParentText.changes);
    expect(textContent(documents[2]!, "card-copy-play-label")).toBe(
      "Local label",
    );

    const reset = resetComponentInstanceOverrides({
      documents,
      instance: handle("card-copy", "card-copy-play-root"),
    });
    if (reset.status !== "updated") throw new Error(JSON.stringify(reset));
    expect(reset.status).toBe("updated");
    if (reset.status !== "updated") return;
    documents = applyChanges(documents, reset.changes);
    expect(textContent(documents[2]!, "card-copy-play-label")).toBe(
      "Latest parent label",
    );

    const newerParentText = applyComponentPropertyEdit({
      documents,
      target: handle("card-main", "card-play-label"),
      edit: { kind: "textContent", value: "Newest parent label" },
    });
    expect(newerParentText.status).toBe("updated");
    if (newerParentText.status !== "updated") return;
    documents = applyChanges(documents, newerParentText.changes);
    expect(textContent(documents[2]!, "card-copy-play-label")).toBe(
      "Newest parent label",
    );
  });

  it("does not inherit root placement or rotation, while root sizing still propagates", () => {
    let documents: ComponentSourceDocument[] = [
      {
        source: source("position-main"),
        content: `<section ${nodeIdAttr}="position-main-root" ${COMPONENT_ID_ATTR}="positioned" style="position: absolute; left: -539px; top: 152px; width: 360px; height: 315px; rotate: 0deg; transform: rotate(0deg)"><div ${nodeIdAttr}="position-child" style="left: 8px; top: 12px">Card</div></section>`,
      },
      {
        source: source("position-instance"),
        content: `<section ${nodeIdAttr}="position-instance-root" ${COMPONENT_REF_ATTR}="positioned" style="position: absolute; left: -539px; top: 152px; width: 360px; height: 315px; rotate: 0deg; transform: rotate(0deg)"><div ${nodeIdAttr}="position-instance-child" ${COMPONENT_SOURCE_NODE_ID_ATTR}="position-child" style="left: 8px; top: 12px">Card</div></section>`,
      },
    ];

    for (const edit of [
      { kind: "style" as const, property: "left", value: "-439px" },
      { kind: "style" as const, property: "top", value: "203px" },
      { kind: "style" as const, property: "rotate", value: "15deg" },
      {
        kind: "style" as const,
        property: "transform",
        value: "rotate(15deg)",
      },
    ]) {
      const result = applyComponentPropertyEdit({
        documents,
        target: handle("position-main", "position-main-root"),
        edit,
      });
      expect(result.status).toBe("updated");
      if (result.status !== "updated") return;
      documents = applyChanges(documents, result.changes);
      const instanceRoot = durableNode(documents[1]!, "position-instance-root");
      expect(instanceRoot.style[edit.property]).toBe(
        edit.property === "left"
          ? "-539px"
          : edit.property === "top"
            ? "152px"
            : edit.property === "rotate"
              ? "0deg"
              : "rotate(0deg)",
      );
    }

    const width = applyComponentPropertyEdit({
      documents,
      target: handle("position-main", "position-main-root"),
      edit: { kind: "style", property: "width", value: "400px" },
    });
    expect(width.status).toBe("updated");
    if (width.status !== "updated") return;
    documents = applyChanges(documents, width.changes);
    expect(durableNode(documents[0]!, "position-main-root").style.width).toBe(
      "400px",
    );
    expect(
      durableNode(documents[1]!, "position-instance-root").style.width,
    ).toBe("400px");

    const height = applyComponentPropertyEdit({
      documents,
      target: handle("position-main", "position-main-root"),
      edit: { kind: "style", property: "height", value: "330px" },
    });
    expect(height.status).toBe("updated");
    if (height.status !== "updated") return;
    documents = applyChanges(documents, height.changes);
    expect(
      durableNode(documents[1]!, "position-instance-root").style.height,
    ).toBe("330px");

    for (const edit of [
      { property: "left", value: "20px" },
      { property: "top", value: "24px" },
    ]) {
      const childEdit = applyComponentPropertyEdit({
        documents,
        target: handle("position-main", "position-child"),
        edit: { kind: "style", ...edit },
      });
      expect(childEdit.status).toBe("updated");
      if (childEdit.status !== "updated") return;
      documents = applyChanges(documents, childEdit.changes);
      expect(
        durableNode(documents[1]!, "position-instance-child").style[
          edit.property
        ],
      ).toBe(edit.value);
    }
  });

  it("keeps instance root placement when resetting a root Fill override", () => {
    let documents: ComponentSourceDocument[] = [
      {
        source: source("reset-position-main"),
        content: `<section ${nodeIdAttr}="reset-position-main-root" ${COMPONENT_ID_ATTR}="reset-position" style="left: -539px; top: 152px; width: 360px; height: 315px; background-color: white"></section>`,
      },
      {
        source: source("reset-position-instance"),
        content: `<section ${nodeIdAttr}="reset-position-instance-root" ${COMPONENT_REF_ATTR}="reset-position" style="left: -539px; top: 152px; width: 360px; height: 315px; background-color: white"></section>`,
      },
    ];

    const move = applyComponentPropertyEdit({
      documents,
      target: handle("reset-position-instance", "reset-position-instance-root"),
      edit: { kind: "style", property: "left", value: "-239px" },
    });
    expect(move.status).toBe("updated");
    if (move.status !== "updated") return;
    documents = applyChanges(documents, move.changes);
    expect(
      durableNode(documents[1]!, "reset-position-instance-root").style.left,
    ).toBe("-239px");
    expect(
      durableNode(documents[1]!, "reset-position-instance-root").dataAttributes[
        COMPONENT_OVERRIDES_ATTR
      ],
    ).toBeUndefined();

    const fill = applyComponentPropertyEdit({
      documents,
      target: handle("reset-position-instance", "reset-position-instance-root"),
      edit: { kind: "style", property: "background-color", value: "green" },
    });
    expect(fill.status).toBe("updated");
    if (fill.status !== "updated") return;
    documents = applyChanges(documents, fill.changes);
    expect(
      durableNode(documents[1]!, "reset-position-instance-root").style[
        "background-color"
      ],
    ).toBe("green");
    expect(overrides(documents[1]!, "reset-position-instance-root")).toEqual([
      {
        sourceNodeId: "reset-position-main-root",
        property: "style:background-color",
      },
    ]);

    const currentInstance = durableNode(
      documents[1]!,
      "reset-position-instance-root",
    );
    const legacyContent = patchCodeLayerNodeAttributes(documents[1]!.content, [
      {
        node: currentInstance,
        attributes: {
          [COMPONENT_OVERRIDES_ATTR]: encodeURIComponent(
            JSON.stringify([
              ...overrides(documents[1]!, "reset-position-instance-root"),
              {
                sourceNodeId: "reset-position-main-root",
                property: "style:left",
              },
            ]),
          ),
        },
      },
    ]);
    expect(legacyContent).not.toBeNull();
    documents = documents.map((document, index) =>
      index === 1 ? { ...document, content: legacyContent! } : document,
    );

    const reset = resetComponentInstanceOverrides({
      documents,
      instance: handle(
        "reset-position-instance",
        "reset-position-instance-root",
      ),
    });
    expect(reset.status).toBe("updated");
    if (reset.status !== "updated") return;
    documents = applyChanges(documents, reset.changes);

    const instanceRoot = durableNode(
      documents[1]!,
      "reset-position-instance-root",
    );
    expect(instanceRoot.style).toMatchObject({
      left: "-239px",
      top: "152px",
      "background-color": "white",
    });
    expect(
      instanceRoot.dataAttributes[COMPONENT_OVERRIDES_ATTR],
    ).toBeUndefined();
  });
  it("propagates a nested child main edit through parent mains and parent instances", () => {
    const documents = nestedComponentDocuments();
    const result = applyComponentPropertyEdit({
      documents,
      target: handle("play-main", "play-main-label"),
      edit: { kind: "style", property: "color", value: "orange" },
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.changes.map(({ fileId }) => fileId).sort()).toEqual([
      "card-copy",
      "card-main",
      "play-main",
    ]);
    for (const fileId of ["card-main", "card-copy"]) {
      const changed = result.changes.find((change) => change.fileId === fileId);
      expect(changed?.after).toContain('style="color: orange"');
      expect(changed?.after).toContain(` ${COMPONENT_REF_ATTR}="play-button"`);
    }
    expect(
      result.changes.find((change) => change.fileId === "card-copy")?.after,
    ).toContain(` ${COMPONENT_SOURCE_NODE_ID_ATTR}="play-main-label"`);

    const parentEdit = applyComponentPropertyEdit({
      documents: applyChanges(documents, result.changes),
      target: handle("card-main", "card-title"),
      edit: { kind: "style", property: "color", value: "red" },
    });
    expect(parentEdit.status).toBe("updated");
    if (parentEdit.status !== "updated") return;
    expect(
      parentEdit.changes.find((change) => change.fileId === "card-copy")?.after,
    ).toContain('style="color: red"');
  });

  it("updates two cross-Screen instances, retains text and fill overrides, then resets to latest main values", () => {
    let documents = componentDocuments();

    const textOverride = applyComponentPropertyEdit({
      documents,
      target: handle("screen-b", "instance-b-label"),
      edit: { kind: "textContent", value: "Start" },
    });
    expect(textOverride.status).toBe("updated");
    if (textOverride.status !== "updated") return;
    documents = applyChanges(documents, textOverride.changes);

    const fillOverride = applyComponentPropertyEdit({
      documents,
      target: handle("screen-b", "instance-b-label"),
      edit: { kind: "style", property: "color", value: "red" },
    });
    expect(fillOverride.status).toBe("updated");
    if (fillOverride.status !== "updated") return;
    documents = applyChanges(documents, fillOverride.changes);

    const fontEdit = applyComponentPropertyEdit({
      documents,
      target: handle("main-screen", "main-label"),
      edit: { kind: "style", property: "font-size", value: "18px" },
    });
    expect(fontEdit.status).toBe("updated");
    if (fontEdit.status !== "updated") return;
    expect(fontEdit.changes.map(({ fileId }) => fileId).sort()).toEqual([
      "main-screen",
      "screen-b",
      "screen-c",
    ]);
    documents = applyChanges(documents, fontEdit.changes);

    const fillEdit = applyComponentPropertyEdit({
      documents,
      target: handle("main-screen", "main-label"),
      edit: { kind: "style", property: "color", value: null },
    });
    expect(fillEdit.status).toBe("updated");
    if (fillEdit.status !== "updated") return;
    documents = applyChanges(documents, fillEdit.changes);

    const mainLabel = durableNode(documents[0]!, "main-label");
    const instanceBLabel = durableNode(documents[1]!, "instance-b-label");
    const instanceCLabel = durableNode(documents[2]!, "instance-c-label");
    expect(mainLabel.style).toMatchObject({
      "font-size": "18px",
    });
    expect(mainLabel.style.color).toBeUndefined();
    expect(instanceBLabel.style).toMatchObject({
      "font-size": "18px",
      color: "red !important",
    });
    expect(instanceCLabel.style).toMatchObject({ "font-size": "18px" });
    expect(instanceCLabel.style.color).toBeUndefined();
    expect(instanceBLabel.textSnippet).toBe("Start");
    expect(instanceCLabel.textSnippet).toBe("Play");
    expect(instanceBLabel.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
      "main-label",
    );
    expect(instanceCLabel.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
      "main-label",
    );
    expect(instanceBLabel.dataAttributes[nodeIdAttr]).toBe("instance-b-label");
    expect(instanceCLabel.dataAttributes[nodeIdAttr]).toBe("instance-c-label");
    const storedOverrides = decodeURIComponent(
      instanceBLabel.dataAttributes[COMPONENT_OVERRIDES_ATTR] ?? "",
    );
    expect(storedOverrides).toContain("textContent");
    expect(storedOverrides).toContain("style:color");
    expect(storedOverrides).not.toContain("inheritedValue");

    const reset = resetComponentInstanceOverrides({
      documents,
      instance: handle("screen-b", "instance-b-label"),
    });
    expect(reset.status).toBe("updated");
    if (reset.status !== "updated") return;
    documents = applyChanges(documents, reset.changes);

    const resetLabel = durableNode(documents[1]!, "instance-b-label");
    expect(resetLabel.textSnippet).toBe("Play");
    expect(resetLabel.style).toMatchObject({ "font-size": "18px" });
    expect(resetLabel.style.color).toBeUndefined();
    expect(resetLabel.dataAttributes[COMPONENT_OVERRIDES_ATTR]).toBeUndefined();
    expect(resetLabel.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
      "main-label",
    );
  });

  it("resets a layer-name override to a legacy imported attribute", () => {
    const documents: ComponentSourceDocument[] = [
      {
        source: source("legacy-main"),
        content: `<section ${nodeIdAttr}="legacy-main-root" ${COMPONENT_NAME_ATTR}="Legacy card" ${COMPONENT_ID_ATTR}="legacy-card"><span ${nodeIdAttr}="legacy-label" layer-name="Imported card">Card</span></section>`,
      },
      {
        source: source("legacy-instance"),
        content: `<section ${nodeIdAttr}="legacy-instance-root" ${COMPONENT_REF_ATTR}="legacy-card"><span ${nodeIdAttr}="legacy-instance-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="legacy-label" data-agent-native-layer-name="Local card" ${COMPONENT_OVERRIDES_ATTR}="${encodeURIComponent(JSON.stringify([{ sourceNodeId: "legacy-label", property: "attribute:data-agent-native-layer-name" }]))}">Card</span></section>`,
      },
    ];

    const reset = resetComponentInstanceOverrides({
      documents,
      instance: handle("legacy-instance", "legacy-instance-label"),
    });
    expect(reset.status).toBe("updated");
    if (reset.status !== "updated") return;

    const updated = applyChanges(documents, reset.changes);
    const instance = durableNode(updated[1]!, "legacy-instance-label");
    expect(instance.dataAttributes["data-agent-native-layer-name"]).toBe(
      "Imported card",
    );
    expect(instance.dataAttributes[COMPONENT_OVERRIDES_ATTR]).toBeUndefined();
  });

  it("edits and resets the selected instance when the main and peers share a Screen", () => {
    let documents = sameScreenDocuments();

    const override = applyComponentPropertyEdit({
      documents,
      target: handle("one-screen", "instance-c-label"),
      edit: { kind: "textContent", value: "Second instance" },
    });
    expect(override.status).toBe("updated");
    if (override.status !== "updated") return;
    documents = applyChanges(documents, override.changes);
    expect(durableNode(documents[0]!, "instance-b-label").textSnippet).toBe(
      "Play",
    );
    expect(durableNode(documents[0]!, "instance-c-label").textSnippet).toBe(
      "Second instance",
    );
    const storedOverrides = decodeURIComponent(
      durableNode(documents[0]!, "instance-c-label").dataAttributes[
        COMPONENT_OVERRIDES_ATTR
      ] ?? "",
    );
    expect(JSON.parse(storedOverrides)).toEqual([
      { sourceNodeId: "main-label", property: "textContent" },
    ]);

    const mainEdit = applyComponentPropertyEdit({
      documents,
      target: handle("one-screen", "main-label"),
      edit: { kind: "textContent", value: "Latest main text" },
    });
    expect(mainEdit.status).toBe("updated");
    if (mainEdit.status !== "updated") return;
    documents = applyChanges(documents, mainEdit.changes);
    expect(durableNode(documents[0]!, "instance-b-label").textSnippet).toBe(
      "Latest main text",
    );
    expect(durableNode(documents[0]!, "instance-c-label").textSnippet).toBe(
      "Second instance",
    );

    const reset = resetComponentInstanceOverrides({
      documents,
      instance: handle("one-screen", "instance-c-label"),
    });
    expect(reset.status).toBe("updated");
    if (reset.status !== "updated") return;
    documents = applyChanges(documents, reset.changes);

    expect(durableNode(documents[0]!, "instance-b-label").textSnippet).toBe(
      "Latest main text",
    );
    const resetNode = durableNode(documents[0]!, "instance-c-label");
    expect(resetNode.textSnippet).toBe("Latest main text");
    expect(resetNode.dataAttributes[COMPONENT_OVERRIDES_ATTR]).toBeUndefined();
    expect(resetNode.dataAttributes[nodeIdAttr]).toBe("instance-c-label");
    expect(resetNode.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
      "main-label",
    );
  });

  it("refuses ambiguous, missing, and malformed linked edits without exposing partial writes", () => {
    const documents = componentDocuments();
    const before = documents.map(({ content }) => content);
    const missing = applyComponentPropertyEdit({
      documents,
      target: handle("main-screen", "missing-label"),
      edit: { kind: "textContent", value: "Changed" },
    });
    expect(missing.status).toBe("missing-node");

    const ambiguousDocuments = [
      ...documents,
      {
        source: source("duplicate-screen"),
        content: `<div ${nodeIdAttr}="duplicate-root" ${COMPONENT_ID_ATTR}="component-7">Other main</div>`,
      },
    ];
    const ambiguous = applyComponentPropertyEdit({
      documents: ambiguousDocuments,
      target: handle("main-screen", "main-label"),
      edit: { kind: "style", property: "font-size", value: "20px" },
    });
    expect(ambiguous.status).toBe("ambiguous-main");

    const nestedDocuments = componentDocuments();
    nestedDocuments[1]!.content = nestedDocuments[1]!.content.replace(
      'style="font-size:',
      `${COMPONENT_REF_ATTR}="nested-link" style="font-size:`,
    );
    const nestedBefore = nestedDocuments.map(({ content }) => content);
    const nested = applyComponentPropertyEdit({
      documents: nestedDocuments,
      target: handle("main-screen", "main-label"),
      edit: { kind: "style", property: "font-size", value: "20px" },
    });
    expect(nested.status).toBe("unsupported-nested-link");

    const dataUriDocuments = componentDocuments();
    dataUriDocuments[0]!.content = dataUriDocuments[0]!.content.replace(
      "color: #222",
      "color: #222; background-image: url(data:image/svg+xml;base64,ab;cd)",
    );
    const dataUriEdit = applyComponentPropertyEdit({
      documents: dataUriDocuments,
      target: handle("main-screen", "main-label"),
      edit: { kind: "style", property: "font-size", value: "20px" },
    });
    expect(dataUriEdit.status).toBe("updated");
    if (dataUriEdit.status !== "updated") return;
    expect(dataUriEdit.changes[0]?.after).toContain(
      "background-image: url(data:image/svg+xml;base64,ab;cd)",
    );
    expect(dataUriEdit.changes[0]?.after).toContain("font-size: 20px");

    expect(documents.map(({ content }) => content)).toEqual(before);
    expect(nestedDocuments.map(({ content }) => content)).toEqual(nestedBefore);
  });

  it("refuses malformed override metadata before editing or resetting an instance", () => {
    const documents = componentDocuments();
    documents[1]!.content = documents[1]!.content.replace(
      `${nodeIdAttr}="instance-b-label"`,
      `${nodeIdAttr}="instance-b-label" ${COMPONENT_OVERRIDES_ATTR}="%"`,
    );
    const before = documents.map(({ content }) => content);

    const edit = applyComponentPropertyEdit({
      documents,
      target: handle("screen-b", "instance-b-label"),
      edit: { kind: "style", property: "color", value: "#f00" },
    });
    expect(edit.status).toBe("invalid-override-metadata");
    expect(documents.map(({ content }) => content)).toEqual(before);

    const reset = resetComponentInstanceOverrides({
      documents,
      instance: handle("screen-b", "instance-b-label"),
    });
    expect(reset.status).toBe("invalid-override-metadata");
    expect(documents.map(({ content }) => content)).toEqual(before);
  });
});
