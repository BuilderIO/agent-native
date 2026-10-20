import { describe, expect, it } from "vitest";

import applyVisualEdit from "./apply-visual-edit.js";
import editDesign from "./edit-design.js";
import exportPng from "./export-png.js";
import proposeNodeRewrite from "./propose-node-rewrite.js";
import showDesignQuestions from "./show-design-questions.js";

// Mirrors how the agent loop evaluates a flag: a boolean as-is, a predicate on the raw call input.
function retrySafe(flag: unknown, input: unknown): boolean {
  if (typeof flag === "boolean") return flag;
  if (typeof flag === "function") {
    return (flag as (input: unknown) => boolean)(input) === true;
  }
  return false;
}

const designFile = { kind: "design-file", designId: "design_1", fileId: "f_1" };
const target = { nodeId: "node_1" };

describe("retrySafe on Design write actions", () => {
  it("marks propose-node-rewrite and show-design-questions replay-safe", () => {
    expect(proposeNodeRewrite.retrySafe).toBe(true);
    expect(showDesignQuestions.retrySafe).toBe(true);
  });

  it("leaves export-png undeclared because every call uploads a new object", () => {
    expect(exportPng.retrySafe).toBeUndefined();
    expect(exportPng.readOnly).toBe(false);
  });

  describe("edit-design", () => {
    const edits = [{ search: "<h1>A</h1>", replace: "<h1>B</h1>" }];

    it("allows replace-file, which sets a fixed end state", () => {
      expect(
        retrySafe(editDesign.retrySafe, {
          designId: "design_1",
          replacementContent: "<html></html>",
        }),
      ).toBe(true);
      expect(
        retrySafe(editDesign.retrySafe, {
          designId: "design_1",
          mode: "replace-file",
          replacementContent: "<html></html>",
        }),
      ).toBe(true);
    });

    it("refuses search-replace, which can re-match its own replacement text", () => {
      expect(
        retrySafe(editDesign.retrySafe, { designId: "design_1", edits }),
      ).toBe(false);
      expect(
        retrySafe(editDesign.retrySafe, {
          designId: "design_1",
          mode: "search-replace",
          edits,
        }),
      ).toBe(false);
      expect(
        retrySafe(editDesign.retrySafe, {
          designId: "design_1",
          mode: "search-replace",
          edits,
          replacementContent: "<html></html>",
        }),
      ).toBe(false);
    });
  });

  describe("apply-visual-edit", () => {
    it("allows end-state intents on a design file", () => {
      expect(
        retrySafe(applyVisualEdit.retrySafe, {
          source: designFile,
          intent: {
            kind: "style",
            target,
            property: "color",
            value: "red",
          },
        }),
      ).toBe(true);
      expect(
        retrySafe(applyVisualEdit.retrySafe, {
          source: designFile,
          intent: [
            { kind: "textContent", target, value: "Hello" },
            { kind: "class", target, operation: "add", className: "p-2" },
          ],
        }),
      ).toBe(true);
    });

    it("refuses structural intents on a design file, alone or in a batch", () => {
      for (const kind of [
        "moveNode",
        "wrapNodes",
        "unwrap",
        "booleanSubtract",
        "deleteNode",
        "autoLayout",
      ]) {
        expect(
          retrySafe(applyVisualEdit.retrySafe, {
            source: designFile,
            intent: { kind, target, targetIds: ["node_1"], targetId: "node_1" },
          }),
          kind,
        ).toBe(false);
      }
      expect(
        retrySafe(applyVisualEdit.retrySafe, {
          source: designFile,
          intent: [
            { kind: "style", target, property: "color", value: "red" },
            { kind: "wrapNodes", targetIds: ["node_1"] },
          ],
        }),
      ).toBe(false);
    });

    it("refuses local-file sources even for style intents", () => {
      expect(
        retrySafe(applyVisualEdit.retrySafe, {
          source: { kind: "local-file", designId: "d", connectionId: "c" },
          intent: { kind: "style", target, property: "color", value: "red" },
        }),
      ).toBe(false);
    });

    it("allows preview-only sources, which never write", () => {
      expect(
        retrySafe(applyVisualEdit.retrySafe, {
          source: { kind: "inline-html", html: "<main></main>" },
          intent: { kind: "wrapNodes", targetIds: ["node_1"] },
        }),
      ).toBe(true);
    });

    it("reads JSON-string arguments the same way the schema does", () => {
      expect(
        retrySafe(applyVisualEdit.retrySafe, {
          source: JSON.stringify(designFile),
          intent: JSON.stringify({
            kind: "textContent",
            target,
            value: "Hello",
          }),
        }),
      ).toBe(true);
      expect(
        retrySafe(applyVisualEdit.retrySafe, {
          source: JSON.stringify(designFile),
          intent: JSON.stringify({ kind: "unwrap", targetId: "node_1" }),
        }),
      ).toBe(false);
    });

    it("fails closed on a missing or unparseable source", () => {
      expect(
        retrySafe(applyVisualEdit.retrySafe, {
          intent: { kind: "style", target, property: "color", value: "red" },
        }),
      ).toBe(false);
      expect(
        retrySafe(applyVisualEdit.retrySafe, {
          source: "not json",
          intent: { kind: "style", target, property: "color", value: "red" },
        }),
      ).toBe(false);
    });
  });
});
