import { describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@agent-native/core/client/hooks", () => ({ callAction }));

import {
  formatComposerContext,
  formatComposerReferences,
  persistComposerContext,
  readSavedComposerReferences,
  snapshotComposerContext,
  sourceContextKey,
} from "./composer-context";

describe("Design composer context", () => {
  it("keeps a submitted snapshot unchanged after removal or later source edits", () => {
    const draft = [
      {
        key: "source",
        title: "Reference",
        context: "Original layout",
        status: "ready" as const,
      },
    ];
    const submitted = snapshotComposerContext(draft);
    draft[0].context = "Changed layout";
    draft.splice(0);
    expect(formatComposerContext(submitted)).toContain("Original layout");
    expect(Object.isFrozen(submitted)).toBe(true);
    expect(Object.isFrozen(submitted[0])).toBe(true);
  });

  it.each(["pending", "error"] as const)(
    "refuses %s context instead of silently dropping it",
    (status) => {
      expect(() =>
        snapshotComposerContext([
          { key: "unavailable", title: "Source", context: "", status },
        ]),
      ).toThrow();
    },
  );

  it("stores only source descriptors under the project and preserves explicit empty selection", async () => {
    const ref = {
      source: "figma" as const,
      id: "1:2",
      title: "Frame",
      url: "https://www.figma.com/design/example/Example?node-id=1-2",
    };
    await persistComposerContext("design-a", [
      {
        key: sourceContextKey(ref),
        title: "Frame",
        context: "Private resolved body",
        status: "ready",
      },
    ]);
    expect(callAction).toHaveBeenLastCalledWith("update-design", {
      id: "design-a",
      dataOperations: [{ op: "set", path: ["composerContext"], value: [ref] }],
    });
    await persistComposerContext("design-a", []);
    expect(callAction).toHaveBeenLastCalledWith("update-design", {
      id: "design-a",
      dataOperations: [{ op: "set", path: ["composerContext"], value: [] }],
    });
    expect(
      readSavedComposerReferences(JSON.stringify({ composerContext: [ref] })),
    ).toEqual([ref]);
  });

  it("distinguishes corrupted saved context from no references", () => {
    expect(readSavedComposerReferences("{}")).toEqual([]);
    expect(() => readSavedComposerReferences("not json")).toThrow();
    expect(() =>
      readSavedComposerReferences('{"composerContext":[{"source":"unknown"}]}'),
    ).toThrow();
  });

  it("includes structured mentions in the agent input", () => {
    expect(
      formatComposerReferences([
        {
          type: "mention",
          path: "/design/example",
          name: "Reference",
          source: "design",
          refId: "example",
        },
      ]),
    ).toContain('"refId":"example"');
  });
});
