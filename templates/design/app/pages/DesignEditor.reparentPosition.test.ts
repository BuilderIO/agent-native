// @vitest-environment happy-dom

/**
 * DesignEditor.reparentPosition.test.ts
 *
 * Regression coverage for the nested-container reparent bug: DesignEditor's
 * (private, unexported) `getAbsolutePositioningForNodeInHtml` used to read
 * only a node's own inline `style.left`/`style.top` — correct for a direct
 * child of the screen root, but wrong for anything nested inside another
 * positioned/flow container, since that value is relative to the node's OWN
 * immediate parent rather than the screen root. `computeReparentedChildPosition`
 * (shared/board-file.ts) then did a flat `source - target` subtraction,
 * which is only valid when both inputs share the same coordinate space.
 * Combining a parent-relative read with that flat subtraction produced a
 * garbage delta whenever the source or target container was nested two or
 * more levels deep — the dropped element visibly jumped away from the
 * cursor.
 *
 * The fix reuses `authoredElementPosition` (MultiScreenCanvas's
 * primitive-drop-target.ts — now exported for exactly this reuse) inside
 * `getAbsolutePositioningForNodeInHtml`, which walks every ancestor up to
 * `<body>` accumulating positioned-ancestor offsets and static-flow
 * padding/sibling contributions. That produces a true screen-root-relative
 * position for both source and target regardless of nesting depth, so
 * `computeReparentedChildPosition`'s flat subtraction becomes valid again.
 *
 * `getAbsolutePositioningForNodeInHtml` itself stays private to
 * DesignEditor.tsx (matching every other module-level helper in that file),
 * so this spec exercises the exact same public seam DesignEditor.tsx now
 * calls through: `authoredElementPosition` feeding
 * `computeReparentedChildPosition`, using jsdom-style parsed documents built
 * the same way `getAbsolutePositioningForNodeInHtml` builds them (DOMParser
 * + a `data-agent-native-node-id` lookup).
 */

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
    // Both nodes are direct children of <body> — the ancestor walk should
    // terminate after a single step and return their own inline left/top
    // unchanged, exactly like the previous naive implementation.
    expect(sourcePosition).toEqual({ x: 398, y: 144 });
    expect(targetPosition).toEqual({ x: 250, y: 100 });
    expect(
      computeReparentedChildPosition(sourcePosition, targetPosition),
    ).toEqual({ x: 148, y: 44 });
  });

  it("resolves a node two containers deep to its true screen-root-relative position (same-screen reparent)", () => {
    // outer (absolute, root-level) > inner (absolute, nested) > source
    //   (absolute, nested again). target is a root-level frame the user
    // drags `source` into.
    const html = `<!DOCTYPE html><html><body>
      <div data-agent-native-node-id="outer" style="position:absolute;left:100px;top:80px;width:600px;height:600px;">
        <div data-agent-native-node-id="inner" style="position:absolute;left:50px;top:40px;width:400px;height:400px;">
          <div data-agent-native-node-id="source" style="position:absolute;left:20px;top:10px;width:80px;height:40px;"></div>
        </div>
      </div>
      <div data-agent-native-node-id="target" style="position:absolute;left:300px;top:250px;width:200px;height:200px;"></div>
    </body></html>`;
    const doc = parse(html);
    // Screen-root-relative source position = 100+50+20, 80+40+10.
    const sourcePosition = resolvePosition(doc, "source");
    expect(sourcePosition).toEqual({ x: 170, y: 130 });
    const targetPosition = resolvePosition(doc, "target");
    expect(targetPosition).toEqual({ x: 300, y: 250 });
    // Old (buggy) behavior would have read source.style.left/top verbatim —
    // {x: 20, y: 10}, relative to "inner" — and subtracted target's root
    // position from THAT, teleporting the dropped node far from the cursor.
    // The fixed pipeline instead produces the correct parent-relative delta
    // once "source" is reparented under "target".
    expect(
      computeReparentedChildPosition(sourcePosition, targetPosition),
    ).toEqual({ x: -130, y: -120 });
  });

  it("resolves a node nested inside a static-flow (non-absolute) frame with padding, for cross-screen reparent", () => {
    // Source screen: a frame with padding contains "source" as its second
    // flex child (so the walk must also account for the preceding sibling's
    // width + gap, not just ancestor padding).
    const sourceHtml = `<!DOCTYPE html><html><body>
      <div data-agent-native-node-id="frame" style="position:absolute;left:40px;top:60px;width:500px;height:300px;padding-left:16px;padding-top:16px;display:flex;gap:8px;">
        <div data-agent-native-node-id="sibling" style="width:100px;height:40px;"></div>
        <div data-agent-native-node-id="source" style="width:80px;height:40px;"></div>
      </div>
    </body></html>`;
    // Destination screen: target frame lives at a different root offset.
    const destHtml = `<!DOCTYPE html><html><body>
      <div data-agent-native-node-id="target" style="position:absolute;left:500px;top:500px;width:300px;height:300px;"></div>
    </body></html>`;
    const sourceDoc = parse(sourceHtml);
    const destDoc = parse(destHtml);
    // Screen-root-relative source: frame origin (40,60) + frame padding
    // (16,16) + sibling's width+gap (100+8) contributed on the x axis only
    // (row flex) = 40+16+100+8=164, 60+16=76.
    const sourcePosition = resolvePosition(sourceDoc, "source");
    expect(sourcePosition).toEqual({ x: 164, y: 76 });
    const targetPosition = resolvePosition(destDoc, "target");
    expect(targetPosition).toEqual({ x: 500, y: 500 });
    expect(
      computeReparentedChildPosition(sourcePosition, targetPosition),
    ).toEqual({ x: -336, y: -424 });
  });
});
