import { planLocalJsxVisualEdit } from "@shared/local-jsx-visual-edit";
import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { reactSourceAnchorForPendingEdit } from "./pending-edits";
import {
  buildReactSemanticHandoff,
  redactReactSourceAnchor,
} from "./react-semantic-handoff";

/**
 * The React 19 anchor is not an authored coordinate.
 *
 * `_debugSource` is gone in React 19 and its `jsxDEV` discards the authored
 * `__source` argument the dev transform still emits, so the only surviving
 * position is a `_debugStack` frame into the file the DEV SERVER SERVES.
 * Measured against the React 19.2 + Vite 8 target used for this work: an `<h1>`
 * authored at App.jsx:13:7 reports as App.jsx:26:20 — off by thirteen lines,
 * past the end of a 26-line file. Every tier below therefore has to say which
 * one it is, all the way into the agent prompt.
 */

function infoWith(
  provenance: NonNullable<ElementInfo["provenance"]>,
): ElementInfo {
  return {
    tagName: "h1",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
    selector: "h1#title",
    provenance,
  };
}

const REACT_19_PROVENANCE = {
  sourceFile: "src/App.jsx",
  line: 26,
  column: 20,
  component: "App",
  method: "debug-stack",
} as const;

describe("react source anchor precision", () => {
  it("labels a React 19 owner-stack position as transformed, not authored", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: infoWith(REACT_19_PROVENANCE),
      id: "subject",
    });

    expect(anchor?.method).toBe("debug-stack");
    expect(redactReactSourceAnchor(anchor)).toMatchObject({
      line: 26,
      column: 20,
      method: "debug-stack",
      positionPrecision: "transformed",
    });
  });

  it("labels the authored tiers as authored and an untiered position as unknown", () => {
    const authored = reactSourceAnchorForPendingEdit({
      info: infoWith({
        ...REACT_19_PROVENANCE,
        line: 13,
        method: "debug-source",
      }),
      id: "subject",
    });
    expect(redactReactSourceAnchor(authored)?.positionPrecision).toBe(
      "authored",
    );

    const untiered = reactSourceAnchorForPendingEdit({
      info: infoWith({ ...REACT_19_PROVENANCE, method: undefined }),
      id: "subject",
    });
    expect(redactReactSourceAnchor(untiered)?.positionPrecision).toBe(
      "unknown",
    );
  });

  it("tells the coding agent not to trust a transformed line", () => {
    const transformed = buildReactSemanticHandoff({
      operation: "move",
      desiredChange: "Move the heading.",
      sourceAnchors: [
        reactSourceAnchorForPendingEdit({
          info: infoWith(REACT_19_PROVENANCE),
          id: "subject",
        })!,
      ],
      runtimeRelationship: { kind: "after", subjectAnchorIds: ["subject"] },
    });
    expect(transformed.ok).toBe(true);
    if (!transformed.ok) return;
    expect(transformed.handoff.sourceAnchors[0]).toMatchObject({
      positionPrecision: "transformed",
      method: "debug-stack",
    });
    expect(transformed.handoff.instructions.join("\n")).toContain(
      "positionPrecision",
    );

    // An authored anchor must NOT carry the caveat — a warning on every handoff
    // is a warning on none.
    const authored = buildReactSemanticHandoff({
      operation: "move",
      desiredChange: "Move the heading.",
      sourceAnchors: [
        reactSourceAnchorForPendingEdit({
          info: infoWith({
            ...REACT_19_PROVENANCE,
            line: 13,
            column: 7,
            method: "data-attribute",
          }),
          id: "subject",
        })!,
      ],
      runtimeRelationship: { kind: "after", subjectAnchorIds: ["subject"] },
    });
    expect(authored.ok).toBe(true);
    if (!authored.ok) return;
    expect(authored.handoff.sourceAnchors[0]?.positionPrecision).toBe(
      "authored",
    );
    expect(authored.handoff.instructions.join("\n")).not.toContain(
      "positionPrecision",
    );
  });

  it("refuses the deterministic writer rather than seeking a transformed line in the authored file", () => {
    const anchor = redactReactSourceAnchor(
      reactSourceAnchorForPendingEdit({
        info: infoWith(REACT_19_PROVENANCE),
        id: "subject",
      }),
    )!;

    // 26:20 is the TRANSFORMED position of the <h1> authored at 13:7. This
    // file puts a DIFFERENT <h1> exactly there, which is the case that matters:
    // without the precision gate the writer finds a tag, matches it, and edits
    // the wrong element with status "applied".
    const content = [
      "export default function App() {",
      "  return (",
      "    <main>",
      `      <h1 id="title">React Visual Edit Target</h1>`,
      "    </main>",
      "  );",
      "}",
      ...Array.from({ length: 18 }, () => "//"),
      `${" ".repeat(19)}<h1 id="somewhere-else">wrong element</h1>`,
    ].join("\n");
    expect(content.split("\n")[25]).toContain('id="somewhere-else"');

    const planned = planLocalJsxVisualEdit({
      content,
      anchor: {
        line: anchor.line!,
        column: anchor.column!,
        positionPrecision: anchor.positionPrecision,
      },
      intent: { kind: "textContent", value: "Renamed" },
    });

    expect(planned.result.status).toBe("needsAgent");
    expect(planned.result.changed).toBe(false);
  });
});
