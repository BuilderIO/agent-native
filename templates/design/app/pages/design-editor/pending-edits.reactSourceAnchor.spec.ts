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

describe("toolkit leaf provenance", () => {
  it("uses an app-authored owner when the rendered leaf is outside the root", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: cardButtonInfo({
        provenance: {
          sourceFile: "/workspace/toolkit/Button.tsx",
          line: 71,
          column: 7,
          component: "EmptyState",
          ownerSourceFile: "/workspace/app/src/App.tsx",
          ownerLine: 42,
          ownerColumn: 9,
          ownerComponentName: "EmptyState",
        },
      }),
      id: "target",
      rootPath: "/workspace/app",
    })!;

    expect(anchor.relPath).toBeUndefined();
    expect(anchor.ownerRelPath).toBe("src/App.tsx");

    const built = buildReactSemanticHandoff({
      operation: "move",
      desiredChange: "Move the selected runtime element.",
      sourceAnchors: [anchor],
      runtimeRelationship: { kind: "after", subjectAnchorIds: ["target"] },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.handoff.sourceAnchors[0]).toMatchObject({
      relPath: "src/App.tsx",
      sourceFile: "src/App.tsx",
      line: 42,
      column: 9,
      component: "EmptyState",
    });
  });

  it("refuses a toolkit leaf with no app-authored owner", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: cardButtonInfo({
        provenance: {
          sourceFile: "/workspace/toolkit/Button.tsx",
          line: 71,
          column: 7,
          ownerSourceFile: "/workspace/toolkit/EmptyState.tsx",
          ownerLine: 12,
          ownerColumn: 3,
        },
      }),
      id: "target",
      rootPath: "/workspace/app",
    })!;

    const built = buildReactSemanticHandoff({
      operation: "move",
      desiredChange: "Move the selected runtime element.",
      sourceAnchors: [anchor],
      runtimeRelationship: { kind: "after", subjectAnchorIds: ["target"] },
    });
    expect(built).toMatchObject({
      ok: false,
      rejection: {
        code: "unsafe-source-path",
      },
    });
    if (built.ok) return;
    expect(built.rejection.reason).toContain("app-authored owner path");
  });
});
