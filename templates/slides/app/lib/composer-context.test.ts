import { beforeEach, describe, expect, it, vi } from "vitest";
const callAction = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
}));
import {
  composerSourceKey,
  formatSlidesComposerContext,
  readSlidesComposerContext,
  type ComposerSource,
} from "./composer-context";

const figma = (figmaUrl: string): ComposerSource => ({
  source: "figma",
  id: "1:2",
  nodeId: "1:2",
  title: "Frame",
  figmaUrl,
});
beforeEach(() => vi.clearAllMocks());
describe("Slides composer reference contract", () => {
  it("keeps invalid saved URLs distinct and surfaces their read failure", async () => {
    const reference = figma("not a URL");
    expect(composerSourceKey(reference)).toBe("figma:unparsed:not a URL:1:2");
    expect(composerSourceKey(reference)).not.toBe(
      composerSourceKey(figma("another invalid URL")),
    );
    callAction.mockRejectedValue(new Error("Enter a valid Figma URL"));
    const [item] = await readSlidesComposerContext(
      { designSystemId: null, references: [reference] },
      "Empty source",
    );
    expect(item).toMatchObject({
      key: composerSourceKey(reference),
      status: "error",
      statusMessage: "Enter a valid Figma URL",
    });
  });
  it("separates the same frame in different Figma files and branches", () => {
    const keys = [
      "https://www.figma.com/design/FILE_A/Name",
      "https://www.figma.com/design/FILE_B/Name",
      "https://www.figma.com/design/PARENT/Name/branch/BRANCH_A",
      "https://www.figma.com/design/PARENT/Name/branch/BRANCH_B",
    ].map((url) => composerSourceKey(figma(url)));
    expect(new Set(keys).size).toBe(4);
    expect(keys.slice(2)).toEqual(["figma:BRANCH_A:1:2", "figma:BRANCH_B:1:2"]);
    expect(
      composerSourceKey(
        figma("https://www.figma.com/file/FILE_A/Renamed?node-id=1-2"),
      ),
    ).toBe(keys[0]);
  });
  it("reads local decks and peer Design/Figma only through the authenticated action", async () => {
    callAction.mockImplementation(async (_action, args) => ({
      id: args.id,
      title: args.id,
      context: "Visual reference data",
    }));
    const references: ComposerSource[] = [
      { source: "slides", id: "deck", title: "Deck" },
      { source: "design", id: "design", title: "Design" },
      figma("https://www.figma.com/design/FILE/Name"),
    ];
    const items = await readSlidesComposerContext(
      { designSystemId: null, references },
      "Empty source",
    );
    expect(items.map((item) => item.status)).toEqual([
      "ready",
      "ready",
      "ready",
    ]);
    expect(callAction.mock.calls.map((call) => call[0])).toEqual(
      Array(3).fill("read-composer-source"),
    );
    expect(callAction).toHaveBeenLastCalledWith(
      "read-composer-source",
      expect.objectContaining({
        source: "figma",
        operation: "read",
        nodeId: "1:2",
        figmaUrl: "https://www.figma.com/design/FILE/Name",
      }),
      { method: "GET" },
    );
  });
  it("retains concrete read failures and rejects missing/pending/error context", async () => {
    callAction.mockRejectedValue(new Error("Design connection unavailable"));
    const selection = {
      designSystemId: null,
      references: [
        { source: "design" as const, id: "design", title: "Design" },
      ],
    };
    const items = await readSlidesComposerContext(selection, "Empty source");
    expect(items[0]).toMatchObject({
      status: "error",
      statusMessage: "Design connection unavailable",
    });
    for (const input of [
      items,
      [],
      [{ ...items[0], status: "pending" as const }],
    ])
      expect(() =>
        formatSlidesComposerContext(selection, input, "Not ready"),
      ).toThrow("Not ready");
  });
  it("does not restore defaults for an explicit empty selection or silently accept stale extras", () => {
    const empty = { designSystemId: null, references: [] };
    expect(formatSlidesComposerContext(empty, [], "Not ready")).toContain(
      "Do not restore a workspace default",
    );
    expect(() =>
      formatSlidesComposerContext(
        empty,
        [{ key: "old", title: "Old", context: "Stale" }],
        "Not ready",
      ),
    ).toThrow("Not ready");
  });
});
