import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { describeFlowContainer, NO_FLOW_CONTAINER } from "./nudge-intent";
import {
  isPasteContainer,
  resolvePastePlacementForSelection,
  type PasteTargetNode,
} from "./paste-placement";

function target(overrides: Partial<PasteTargetNode> = {}): PasteTargetNode {
  return {
    tag: "div",
    hasElementChildren: false,
    hasText: false,
    container: NO_FLOW_CONTAINER,
    ...overrides,
  };
}

describe("isPasteContainer", () => {
  it("accepts an auto layout frame", () => {
    expect(
      isPasteContainer(
        target({
          container: describeFlowContainer({ style: { display: "flex" } }),
        }),
      ),
    ).toBe(true);
  });

  it("accepts a plain frame that already holds children", () => {
    expect(isPasteContainer(target({ hasElementChildren: true }))).toBe(true);
  });

  it("accepts an empty frame", () => {
    expect(isPasteContainer(target())).toBe(true);
  });

  it("rejects a div that is really a text object", () => {
    expect(isPasteContainer(target({ hasText: true }))).toBe(false);
  });

  it("rejects text elements even when they nest inline markup", () => {
    for (const tag of ["p", "h2", "span", "button", "a", "li"]) {
      expect(isPasteContainer(target({ tag, hasElementChildren: true }))).toBe(
        false,
      );
    }
  });

  it("rejects replaced elements", () => {
    for (const tag of ["img", "input", "svg", "video", "canvas"]) {
      expect(isPasteContainer(target({ tag }))).toBe(false);
    }
  });

  it("rejects a canvas primitive that is not a frame", () => {
    expect(isPasteContainer(target({ primitiveKind: "rectangle" }))).toBe(
      false,
    );
    expect(isPasteContainer(target({ primitiveKind: "frame" }))).toBe(true);
  });
});

function elementInfoFor(nodeId: string, tagName = "div"): ElementInfo {
  return {
    tagName,
    sourceId: nodeId,
    selector: `[data-agent-native-node-id="${nodeId}"]`,
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as ElementInfo;
}

const SCREEN = `<!doctype html><html><body>
  <section data-agent-native-node-id="card-section" style="display:flex;flex-direction:column;gap:12px">
    <article data-agent-native-node-id="card">
      <h3 data-agent-native-node-id="card-title">Alpha</h3>
    </article>
  </section>
  <div data-agent-native-node-id="free-frame" style="position:relative;width:400px;height:300px"></div>
  <p data-agent-native-node-id="copy">Some body copy</p>
</body></html>`;

describe("resolvePastePlacementForSelection", () => {
  it("pastes into a selected auto layout container, in its flow", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: elementInfoFor("card-section", "section"),
      }),
    ).toMatchObject({ placement: "inside" });
  });

  it("pastes into a selected free container without joining a flow", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: elementInfoFor("free-frame"),
      }),
    ).toMatchObject({ placement: "inside" });
  });

  it("pastes after a selected text object", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: elementInfoFor("copy", "p"),
      }),
    ).toMatchObject({ placement: "after" });
  });

  it("pastes after a selected heading inside a card rather than into it", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: elementInfoFor("card-title", "h3"),
      }),
    ).toMatchObject({ placement: "after" });
  });

  it("pastes into a selected card that holds children", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: elementInfoFor("card", "article"),
      }),
    ).toMatchObject({ placement: "inside" });
  });

  it("returns null when there is no selection or no source to resolve", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: null,
      }),
    ).toBeNull();
    expect(
      resolvePastePlacementForSelection({
        content: "",
        selectedElement: elementInfoFor("card"),
      }),
    ).toBeNull();
  });

  it("returns null when the selection cannot be found in the document", () => {
    expect(
      resolvePastePlacementForSelection({
        content: SCREEN,
        selectedElement: elementInfoFor("gone", "aside"),
      }),
    ).toBeNull();
  });
});
