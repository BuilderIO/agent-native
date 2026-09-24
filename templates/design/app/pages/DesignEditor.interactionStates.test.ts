import { describe, expect, it } from "vitest";

import {
  extractManagedInteractionStateCss,
  readResolvedStateStyles,
  readStateStyles,
} from "../../shared/interaction-states";
import {
  applyInteractionStateStyleCommit,
  deriveStatePreviewTarget,
} from "./design-editor/pending-edits";

const BASE_HTML = `<!doctype html>
<html>
<head><title>Test</title></head>
<body>
<button data-agent-native-node-id="btn_1">Click me</button>
</body>
</html>`;

describe("applyInteractionStateStyleCommit (interaction-states phase 2)", () => {
  it("writes the real state rule and its forced-preview twin in one pass", () => {
    const nextContent = applyInteractionStateStyleCommit(
      BASE_HTML,
      "btn_1",
      "hover",
      { opacity: "0.5" },
    );

    expect(readStateStyles(nextContent, "btn_1", "hover")).toEqual({
      opacity: "0.5",
    });
    const css = extractManagedInteractionStateCss(nextContent) ?? "";
    expect(css).toContain('[data-agent-native-node-id="btn_1"]:hover');
    expect(css).toContain(
      '[data-agent-native-node-id="btn_1"][data-an-state-preview="hover"]',
    );
  });

  it("batches multiple properties into the same state rule", () => {
    const nextContent = applyInteractionStateStyleCommit(
      BASE_HTML,
      "btn_1",
      "hover",
      { opacity: "0.5", backgroundColor: "#111827" },
    );

    expect(readStateStyles(nextContent, "btn_1", "hover")).toEqual({
      opacity: "0.5",
      "background-color": "#111827",
    });
  });

  it("is idempotent — re-applying the same commit produces byte-identical output", () => {
    const once = applyInteractionStateStyleCommit(BASE_HTML, "btn_1", "hover", {
      opacity: "0.5",
    });
    const twice = applyInteractionStateStyleCommit(once, "btn_1", "hover", {
      opacity: "0.5",
    });
    expect(twice).toBe(once);
  });

  it("keeps other states/nodes untouched", () => {
    let content = applyInteractionStateStyleCommit(
      BASE_HTML,
      "btn_1",
      "hover",
      {
        opacity: "0.5",
      },
    );
    content = applyInteractionStateStyleCommit(content, "btn_1", "focus", {
      outline: "2px solid blue",
    });
    content = applyInteractionStateStyleCommit(content, "card_1", "active", {
      transform: "scale(0.98)",
    });

    expect(readStateStyles(content, "btn_1", "hover")).toEqual({
      opacity: "0.5",
    });
    expect(readStateStyles(content, "btn_1", "focus")).toEqual({
      outline: "2px solid blue",
    });
    expect(readStateStyles(content, "card_1", "active")).toEqual({
      transform: "scale(0.98)",
    });
  });

  it("overwrites a previously-set property for the same node/state", () => {
    let content = applyInteractionStateStyleCommit(
      BASE_HTML,
      "btn_1",
      "hover",
      {
        opacity: "0.5",
      },
    );
    content = applyInteractionStateStyleCommit(content, "btn_1", "hover", {
      opacity: "0.8",
    });
    expect(readStateStyles(content, "btn_1", "hover")).toEqual({
      opacity: "0.8",
    });
  });

  it("keeps a narrow-breakpoint state commit scoped instead of leaking it into the base state", () => {
    const content = applyInteractionStateStyleCommit(
      BASE_HTML,
      "btn_1",
      "hover",
      { opacity: "0.35" },
      767,
    );

    expect(readStateStyles(content, "btn_1", "hover")).toEqual({});
    expect(readResolvedStateStyles(content, "btn_1", "hover", 390)).toEqual({
      opacity: "0.35",
    });
    expect(readResolvedStateStyles(content, "btn_1", "hover", 1280)).toEqual(
      {},
    );
    expect(content).toContain("data-agent-native-state-breakpoints");
    expect(content).toContain("@media (max-width: 767px)");
  });
});

describe("deriveStatePreviewTarget (item 9 — hover-preview pipeline derivation)", () => {
  it("returns the target when an active state, screen id, and node id are all present", () => {
    expect(deriveStatePreviewTarget("hover", "screen_1", "btn_1")).toEqual({
      screenId: "screen_1",
      nodeId: "btn_1",
      state: "hover",
    });
  });

  it("returns null when there is no active interaction state", () => {
    expect(deriveStatePreviewTarget(null, "screen_1", "btn_1")).toBeNull();
  });

  it("returns null when the screen id cannot be resolved", () => {
    expect(deriveStatePreviewTarget("hover", null, "btn_1")).toBeNull();
    expect(deriveStatePreviewTarget("hover", undefined, "btn_1")).toBeNull();
  });

  it("returns null when the node id cannot be resolved (e.g. multi-selection)", () => {
    expect(deriveStatePreviewTarget("hover", "screen_1", null)).toBeNull();
    expect(deriveStatePreviewTarget("hover", "screen_1", undefined)).toBeNull();
  });

  it("returns null when nothing is resolvable at all", () => {
    expect(deriveStatePreviewTarget(null, null, null)).toBeNull();
  });
});
