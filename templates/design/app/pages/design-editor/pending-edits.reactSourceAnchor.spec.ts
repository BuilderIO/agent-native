import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import {
  reactSourceAnchorForPendingEdit,
  reactSourceAnchorUnavailableReason,
} from "./pending-edits";
import {
  buildReactSemanticHandoff,
  redactReactSourceAnchor,
} from "./react-semantic-handoff";

function cardButtonInfo(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "button",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
    selector: "button.btn--primary",
    provenance: {
      sourceFile: "src/components/Card.jsx",
      line: 25,
      column: 32,
      component: "Card",
      ownerSourceFile: "src/App.jsx",
      ownerLine: 55,
      ownerColumn: 51,
      ownerComponentName: "Card",
      ownerKey: "b",
    },
    ...overrides,
  };
}

describe("reactSourceAnchorForPendingEdit — .map() instance identity", () => {
  it("carries the React key that separates siblings sharing one call site", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: cardButtonInfo(),
      id: "subject",
      runtimeMultiplicity: 3,
    });

    expect(anchor).toMatchObject({
      sourceFile: "src/components/Card.jsx",
      line: 25,
      column: 32,
      ownerKey: "b",
      runtimeMultiplicity: 3,
      scope: "repeated-render",
    });
  });

  it("survives prompt redaction and reaches the coding-agent handoff", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: cardButtonInfo(),
      id: "subject",
      runtimeMultiplicity: 3,
    })!;

    expect(redactReactSourceAnchor(anchor)?.ownerKey).toBe("b");

    const built = buildReactSemanticHandoff({
      operation: "move",
      desiredChange: "Move the primary button.",
      sourceAnchors: [anchor],
      runtimeRelationship: { kind: "after", subjectAnchorIds: ["subject"] },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.handoff.sourceAnchors[0]?.ownerKey).toBe("b");
    expect(built.handoff.instructions.join("\n")).toContain("ownerKey");
  });

  it("omits ownerKey for a directly-authored instance", () => {
    const info = cardButtonInfo();
    const anchor = reactSourceAnchorForPendingEdit({
      info: {
        ...info,
        provenance: { ...info.provenance, ownerKey: undefined, ownerLine: 44 },
      },
      id: "subject",
    });

    expect(anchor?.ownerKey).toBeUndefined();
  });
});

describe("reactSourceAnchorUnavailableReason", () => {
  it("reports a runtime that exposes no debug info at all", () => {
    expect(
      reactSourceAnchorUnavailableReason([
        cardButtonInfo({ provenance: { unavailableReason: "no-debug-info" } }),
      ]),
    ).toBe("no-debug-info");
  });

  it("stays undefined while nothing has reported yet, so the caller says loading", () => {
    expect(
      reactSourceAnchorUnavailableReason([
        cardButtonInfo({ provenance: undefined }),
        null,
        undefined,
      ]),
    ).toBeUndefined();
  });

  it("ignores resolved elements when another one is unreadable", () => {
    expect(
      reactSourceAnchorUnavailableReason([
        cardButtonInfo(),
        cardButtonInfo({ provenance: { unavailableReason: "not-react" } }),
      ]),
    ).toBe("not-react");
  });
});
