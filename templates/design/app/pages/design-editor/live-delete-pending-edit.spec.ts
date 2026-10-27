import { describe, expect, it } from "vitest";

import { shouldDeleteThroughLiveScreen } from "./code-layer-state";
import {
  formatPendingVisualStylePrompt,
  getPendingVisualEditCount,
  type PendingLiveStructureEdit,
} from "./pending-edits";
import { verifyPendingStructureRuntime } from "./pending-structure-verification";

function removalEdit(
  overrides: Partial<PendingLiveStructureEdit> = {},
): PendingLiveStructureEdit {
  return {
    kind: "structure",
    screenId: "home",
    filename: "home",
    screenName: "Home",
    selector: '[data-agent-native-node-id="subject"]',
    sourceId: "subject",
    sourceAnchor: {
      id: "subject",
      relPath: "app/routes/home.tsx",
      line: 12,
      column: 5,
      component: "Home",
      runtimeMultiplicity: 1,
      scope: "single-instance",
    },
    anchorSelector: "",
    placement: "after",
    removed: true,
    requestId: "delete-1",
    updatedAt: 2,
  };
}

describe("shouldDeleteThroughLiveScreen", () => {
  it("routes a Layers-panel-only selection on a live screen to the live delete path", () => {
    expect(
      shouldDeleteThroughLiveScreen({
        screenSourceType: "localhost",
        runtimeAliasGroups: [['[data-agent-native-node-id="rt-7"]']],
        liveSelectionSelectors: [],
      }),
    ).toBe(true);
  });

  it("routes an in-canvas selection on a live screen too", () => {
    expect(
      shouldDeleteThroughLiveScreen({
        screenSourceType: "localhost",
        runtimeAliasGroups: [],
        liveSelectionSelectors: ["#hero > button"],
      }),
    ).toBe(true);
  });

  it("leaves inline screens on the source-rewrite path", () => {
    expect(
      shouldDeleteThroughLiveScreen({
        screenSourceType: "inline",
        runtimeAliasGroups: [['[data-agent-native-node-id="rt-7"]']],
        liveSelectionSelectors: ["#hero > button"],
      }),
    ).toBe(false);
  });

  it("does not claim a live screen with nothing selected", () => {
    expect(
      shouldDeleteThroughLiveScreen({
        screenSourceType: "localhost",
        runtimeAliasGroups: [[]],
        liveSelectionSelectors: [""],
      }),
    ).toBe(false);
  });
});

describe("pending live removal reaches source", () => {
  it("counts the deletion on the Apply bar instead of reporting nothing to apply", () => {
    expect(getPendingVisualEditCount([], [removalEdit()])).toBe(1);
  });

  it("hands the deletion to the coding agent as a remove, not a half-captured move", () => {
    const prompt = formatPendingVisualStylePrompt({
      designId: "design-1",
      edits: [],
      liveEdits: [removalEdit()],
    });
    expect(prompt).toContain('"removed": true');
    expect(prompt).toContain('"operation": "remove"');
    expect(prompt).toContain('"kind": "remove"');
    expect(prompt).toContain("are DELETIONS, not moves");
    expect(prompt).not.toContain('"anchorSelector"');
    expect(prompt).not.toContain("semanticHandoffFailure");
  });

  it("reports the deletion as unapplied while the element is still rendered", () => {
    const stillThere = `<!doctype html><body><main>
      <div data-agent-native-node-id="subject">Subject</div>
    </main></body>`;
    expect(verifyPendingStructureRuntime(stillThere, removalEdit())).toEqual({
      ok: false,
      failure: "subject-still-present",
    });
  });

  it("proves the deletion once the source write removed the node", () => {
    const gone = `<!doctype html><body><main></main></body>`;
    expect(verifyPendingStructureRuntime(gone, removalEdit())).toEqual({
      ok: true,
    });
  });
});
