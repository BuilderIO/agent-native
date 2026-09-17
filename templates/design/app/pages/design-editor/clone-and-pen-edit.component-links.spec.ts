// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { applyComponentStructureEdit } from "@shared/component-links";
import { describe, expect, it } from "vitest";

import {
  planLinkedComponentStructureClone,
  type ComponentCloneBatchContext,
} from "./clone-and-pen-edit";

describe("planLinkedComponentStructureClone", () => {
  it("returns an exact-envelope main snapshot with a fresh durable selection", () => {
    const source = {
      kind: "design-file" as const,
      designId: "design-1",
      fileId: "main-file",
      filename: "index.html",
    };
    const content = `<!doctype html>\n<html><head><!--keep--></head><body><section data-agent-native-node-id="main" data-agent-native-component-id="card"><span data-agent-native-node-id="label">Label</span></section><section data-agent-native-node-id="instance" data-agent-native-component-ref="card"><span data-agent-native-node-id="instance-label" data-agent-native-component-source-node-id="label">Label</span></section></body></html>`;
    const projection = buildCodeLayerProjection(content, { source });
    const label = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "label",
    );
    expect(label).toBeDefined();
    if (!label) return;

    const options = {
      targetSelectors: [
        `[data-agent-native-node-id="${label.dataAttributes["data-agent-native-node-id"]}"]`,
      ],
      placement: "after" as const,
      componentLinks: {
        sourceFileIds: [source.fileId],
        targetSource: source,
        documents: [
          { source, content },
          {
            source: { ...source, fileId: "instance-file" },
            content:
              '<section data-agent-native-node-id="instance" data-agent-native-component-ref="card"><span data-agent-native-node-id="instance-label" data-agent-native-component-source-node-id="label">Label</span></section>',
          },
        ],
      },
    };
    const plan = planLinkedComponentStructureClone(
      content,
      ['<span data-agent-native-node-id="new-label">New</span>'],
      options,
    );

    expect(plan).not.toBeNull();
    if (!plan || !label.source) return;
    expect(plan.mainBefore).toBe(content);
    expect(plan.targetNodeId).toBe("main");
    expect(plan.selectionNodeIds).toHaveLength(1);
    expect(plan.selectionNodeIds[0]).not.toBe("new-label");
    expect(plan.mainAfter.slice(0, label.source.start)).toBe(
      content.slice(0, label.source.start),
    );
    expect(plan.mainAfter.endsWith(content.slice(label.source.end))).toBe(true);
    expect(plan.mainAfter).toContain("New");
    expect(plan.mainAfter).toContain(
      `data-agent-native-node-id="${plan.selectionNodeIds[0]}"`,
    );
    const transformed = applyComponentStructureEdit({
      documents: [
        { source, content },
        {
          source: { ...source, fileId: "instance-file" },
          content:
            '<section data-agent-native-node-id="instance" data-agent-native-component-ref="card"><span data-agent-native-node-id="instance-label" data-agent-native-component-source-node-id="label">Label</span></section>',
        },
      ],
      target: { fileId: source.fileId, nodeId: plan.targetNodeId },
      mainBefore: plan.mainBefore,
      mainAfter: plan.mainAfter,
    });
    expect(transformed.status).toBe("updated");
    if (transformed.status === "updated") {
      expect(
        transformed.changes.find((change) => change.fileId === "instance-file")
          ?.after,
      ).toContain("New");
    }
  });

  it("keeps instance insertion refused even when the main option is enabled", () => {
    const content =
      '<section data-agent-native-node-id="main" data-agent-native-component-id="card"><span data-agent-native-node-id="label">Label</span></section><section data-agent-native-node-id="instance" data-agent-native-component-ref="card"><span data-agent-native-node-id="instance-label" data-agent-native-component-source-node-id="label">Label</span></section>';
    const plan = planLinkedComponentStructureClone(
      content,
      ['<span data-agent-native-node-id="new-label">New</span>'],
      {
        targetSelectors: ['[data-agent-native-node-id="instance-label"]'],
        placement: "after",
      },
    );
    expect(plan).toBeNull();
  });

  it("plans a measured Group clone before the document runtime is installed", () => {
    const source = {
      kind: "design-file" as const,
      designId: "design-1",
      fileId: "main-file",
      filename: "index.html",
    };
    const content = `<!doctype html><html><body><section data-agent-native-node-id="main" data-agent-native-component-id="card"><span data-agent-native-node-id="label">Label</span></section><section data-agent-native-node-id="instance" data-agent-native-component-ref="card"><span data-agent-native-node-id="instance-label" data-agent-native-component-source-node-id="label">Label</span></section></body></html>`;
    const plan = planLinkedComponentStructureClone(
      content,
      [
        '<div data-agent-native-node-id="group" data-agent-native-layer-name="Group" data-agent-native-group-wrapper="true" data-agent-native-measured-flow-group="true" style="position:relative;width:40px;height:20px"><span data-agent-native-node-id="group-label" style="position:absolute;left:0;top:0">New</span></div>',
      ],
      {
        targetSelectors: ['[data-agent-native-node-id="label"]'],
        placement: "after",
        componentLinks: {
          sourceFileIds: [source.fileId],
          targetSource: source,
          documents: [
            { source, content },
            {
              source: { ...source, fileId: "instance-file" },
              content:
                '<section data-agent-native-node-id="instance" data-agent-native-component-ref="card"><span data-agent-native-node-id="instance-label" data-agent-native-component-source-node-id="label">Label</span></section>',
            },
          ],
        },
      },
    );

    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.mainAfter).toContain("data-agent-native-measured-flow-group");
    expect(plan.mainAfter).not.toContain("data-agent-native-group-runtime");

    const transformed = applyComponentStructureEdit({
      documents: [
        { source, content },
        {
          source: { ...source, fileId: "instance-file" },
          content:
            '<section data-agent-native-node-id="instance" data-agent-native-component-ref="card"><span data-agent-native-node-id="instance-label" data-agent-native-component-source-node-id="label">Label</span></section>',
        },
      ],
      target: { fileId: source.fileId, nodeId: plan.targetNodeId },
      mainBefore: plan.mainBefore,
      mainAfter: plan.mainAfter,
    });
    expect(transformed.status).toBe("updated");
    if (transformed.status !== "updated") return;
    expect(
      transformed.changes.find((change) => change.fileId === "instance-file")
        ?.after,
    ).toContain("data-agent-native-measured-flow-group");
    for (const change of transformed.changes) {
      expect(
        change.after.match(/<script data-agent-native-group-runtime\b/g),
      ).toHaveLength(1);
    }
  });

  it("propagates source projection errors instead of falling through as an ordinary clone", () => {
    const source = {
      kind: "design-file" as const,
      designId: "design-1",
      fileId: "main-file",
      filename: "index.html",
    };
    const content =
      '<section data-agent-native-node-id="main" data-agent-native-component-id="card"><span data-agent-native-node-id="label">Label</span></section>';
    const componentLinks = {} as ComponentCloneBatchContext;
    Object.defineProperties(componentLinks, {
      sourceFileIds: { value: [source.fileId] },
      documents: { value: [{ source, content }] },
      targetSource: {
        get() {
          throw new Error("source projection failed");
        },
      },
    });

    expect(() =>
      planLinkedComponentStructureClone(
        content,
        ['<span data-agent-native-node-id="new-label">New</span>'],
        {
          targetSelectors: ['[data-agent-native-node-id="label"]'],
          placement: "after",
          componentLinks,
        },
      ),
    ).toThrow("source projection failed");
  });
});
