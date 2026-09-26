// @vitest-environment happy-dom


import { describe, expect, it } from "vitest";

import { authoredElementPosition } from "@/components/design/multi-screen/primitive-drop-target";

import { computeReparentedChildPosition } from "../../shared/board-file";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function findByNodeId(doc: Document, nodeId: string): Element {
  const element = doc.querySelector(`[data-agent-native-node-id="${nodeId}"]`);
  if (!element) throw new Error(`missing node ${nodeId}`);
  return element;
}

function resolvePosition(doc: Document, nodeId: string) {
  return authoredElementPosition(findByNodeId(doc, nodeId));
}

describe("nested-container reparent position resolution", () => {
  it("matches the old flat-read behavior for root-level (direct screen-root child) nodes", () => {
    const html = `<!DOCTYPE html><html><body>
      <div data-agent-native-node-id="source" style="position:absolute;left:398px;top:144px;width:80px;height:40px;"></div>
      <div data-agent-native-node-id="target" style="position:absolute;left:250px;top:100px;width:400px;height:400px;"></div>
    </body></html>`;
    const doc = parse(html);
    const sourcePosition = resolvePosition(doc, "source");
    const targetPosition = resolvePosition(doc, "target");
    expect(sourcePosition).toEqual({ x: 398, y: 144 });
    expect(targetPosition).toEqual({ x: 250, y: 100 });
    expect(
      computeReparentedChildPosition(sourcePosition, targetPosition),
    ).toEqual({ x: 148, y: 44 });
  });

  it("resolves a node two containers deep to its true screen-root-relative position (same-screen reparent)", () => {
    const html = `<!DOCTYPE html><html><body>
      <div data-agent-native-node-id="outer" style="position:absolute;left:100px;top:80px;width:600px;height:600px;">
        <div data-agent-native-node-id="inner" style="position:absolute;left:50px;top:40px;width:400px;height:400px;">
          <div data-agent-native-node-id="source" style="position:absolute;left:20px;top:10px;width:80px;height:40px;"></div>
        </div>
      </div>
      <div data-agent-native-node-id="target" style="position:absolute;left:300px;top:250px;width:200px;height:200px;"></div>
    </body></html>`;
    const doc = parse(html);
    const sourcePosition = resolvePosition(doc, "source");
    expect(sourcePosition).toEqual({ x: 170, y: 130 });
    const targetPosition = resolvePosition(doc, "target");
    expect(targetPosition).toEqual({ x: 300, y: 250 });
    expect(
      computeReparentedChildPosition(sourcePosition, targetPosition),
    ).toEqual({ x: -130, y: -120 });
  });

  it("resolves a node nested inside a static-flow (non-absolute) frame with padding, for cross-screen reparent", () => {
    const sourceHtml = `<!DOCTYPE html><html><body>
      <div data-agent-native-node-id="frame" style="position:absolute;left:40px;top:60px;width:500px;height:300px;padding-left:16px;padding-top:16px;display:flex;gap:8px;">
        <div data-agent-native-node-id="sibling" style="width:100px;height:40px;"></div>
        <div data-agent-native-node-id="source" style="width:80px;height:40px;"></div>
      </div>
    </body></html>`;
    const destHtml = `<!DOCTYPE html><html><body>
      <div data-agent-native-node-id="target" style="position:absolute;left:500px;top:500px;width:300px;height:300px;"></div>
    </body></html>`;
    const sourceDoc = parse(sourceHtml);
    const destDoc = parse(destHtml);
    const sourcePosition = resolvePosition(sourceDoc, "source");
    expect(sourcePosition).toEqual({ x: 164, y: 76 });
    const targetPosition = resolvePosition(destDoc, "target");
    expect(targetPosition).toEqual({ x: 500, y: 500 });
    expect(
      computeReparentedChildPosition(sourcePosition, targetPosition),
    ).toEqual({ x: -336, y: -424 });
  });

  it("includes inline relative ancestor left/top in the screen-root walk", () => {
    const html = `<!DOCTYPE html><html><body>
      <div data-agent-native-node-id="frame" style="position:relative;left:300px;top:200px;width:400px;height:400px;">
        <div data-agent-native-node-id="source" style="position:absolute;left:40px;top:20px;width:80px;height:40px;"></div>
      </div>
    </body></html>`;
    expect(resolvePosition(parse(html), "source")).toEqual({ x: 340, y: 220 });
  });
});
