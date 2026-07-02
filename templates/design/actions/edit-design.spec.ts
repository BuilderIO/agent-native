import { describe, expect, it } from "vitest";

import action, { applySearchReplaceEdits } from "./edit-design.js";

describe("edit-design action schema", () => {
  it("accepts the legacy search/replace shape", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        filename: "index.html",
        edits: [{ search: "<h1>Hello</h1>", replace: "<h1>Hola</h1>" }],
      }).success,
    ).toBe(true);
  });

  it("accepts replace-file mode for broad copy-only edits", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        filename: "index.html",
        mode: "replace-file",
        replacementContent:
          "<!DOCTYPE html><html><body><h1>Hola</h1></body></html>",
      }).success,
    ).toBe(true);
  });

  it("accepts replace-file mode targeted by fileId", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        fileId: "file_variant_123",
        mode: "replace-file",
        replacementContent:
          "<!DOCTYPE html><html><body><h1>Chosen direction</h1></body></html>",
      }).success,
    ).toBe(true);
  });

  it("infers replace-file mode when replacementContent is provided", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        filename: "index.html",
        replacementContent:
          "<!DOCTYPE html><html><body><h1>Hola</h1></body></html>",
      }).success,
    ).toBe(true);
  });

  it("rejects calls without an edit operation", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        filename: "index.html",
      }).success,
    ).toBe(false);
  });

  it("rejects mixing search/replace edits with full-file replacement", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        filename: "index.html",
        edits: [{ search: "Hello", replace: "Hola" }],
        replacementContent:
          "<!DOCTYPE html><html><body><h1>Hola</h1></body></html>",
      }).success,
    ).toBe(false);
  });

  it("matches search/replace edits when only stable node ids differ", () => {
    const current = `<main><button data-agent-native-node-id="live-node">Buy</button></main>`;
    const { content, applied } = applySearchReplaceEdits(current, [
      {
        search: `<button data-agent-native-node-id="snapshot-node">Buy</button>`,
        replace: `<button>Start</button>`,
      },
    ]);

    expect(applied).toBe(1);
    expect(content).toBe(`<main><button>Start</button></main>`);
  });
});
