import { beforeEach, describe, expect, it, vi } from "vitest";
const callAction = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", () => ({ callAction }));
import { SlidesComposerContextSchema } from "../../shared/composer-context";
import {
  formatComposerContext,
  persistComposerSubmission,
  resolveComposerSource,
  snapshotComposerContext,
} from "./composer-context";

beforeEach(() => {
  callAction.mockReset();
});

describe("Slides prompt context", () => {
  it("preserves an owner-qualified system and content revision in the sent snapshot", () => {
    const reference = { id: "design-system", ownerApp: "design" as const, consumedRevision: 7 };
    const snapshot = snapshotComposerContext({ designSystemId: null, designSystemRef: reference, references: [] });
    reference.consumedRevision = 8;
    expect(snapshot.designSystemRef).toEqual({ id: "design-system", ownerApp: "design", consumedRevision: 7 });
    expect(formatComposerContext(snapshot, [{ key: "system:design-system", title: "Saved system", context: "Actual persisted tokens", status: "ready" }])).toContain('"consumedRevision":7');
  });
  it("keeps no system explicit and treats decks as supporting layout references", () => {
    const text = formatComposerContext(
      { designSystemId: null, references: [] },
      [
        {
          key: "slides:ref:",
          title: "Launch deck",
          context: "Two-column layouts",
        },
      ],
    );
    expect(text).toContain("Do not apply or restore a workspace default");
    expect(text).toContain("Never import, clone, replace, or append");
    expect(text).toContain("Two-column layouts");
  });
  it("rejects pending and failed context rather than omitting it", () => {
    for (const status of ["pending", "error"] as const)
      expect(() =>
        formatComposerContext({ designSystemId: null, references: [] }, [
          { key: "ref", title: "Reference", context: "", status },
        ]),
      ).toThrow("unfinished context");
  });
  it("preserves an immutable source selection after later removal", () => {
    const selection = {
      designSystemId: "brand",
      references: [
        { source: "slides" as const, id: "ref", title: "Reference" },
      ],
    };
    const snapshot = snapshotComposerContext(selection);
    selection.designSystemId = "replacement";
    selection.references[0].title = "Renamed";
    selection.references.length = 0;
    expect(snapshot).toEqual({
      designSystemId: "brand",
      references: [{ source: "slides", id: "ref", title: "Reference" }],
    });
  });
  it("reads a deck reference without import or replacement operations", async () => {
    callAction.mockResolvedValue({
      id: "ref",
      title: "Reference",
      context: "Grid layouts",
    });
    expect(
      await resolveComposerSource({
        source: "slides",
        id: "ref",
        title: "Reference",
      }),
    ).toMatchObject({ status: "ready", context: "Grid layouts" });
    expect(callAction).toHaveBeenCalledExactlyOnceWith(
      "read-composer-source",
      { source: "slides", operation: "read", id: "ref" },
      { method: "GET" },
    );
  });
  it("rejects empty or unavailable sources", async () => {
    callAction.mockResolvedValue({
      id: "ref",
      title: "Reference",
      context: "",
    });
    await expect(
      resolveComposerSource({
        source: "slides",
        id: "ref",
        title: "Reference",
      }),
    ).rejects.toThrow("no usable context");
    callAction.mockRejectedValue(new Error("Access denied"));
    await expect(
      resolveComposerSource({
        source: "slides",
        id: "ref",
        title: "Reference",
      }),
    ).rejects.toThrow("Access denied");
  });
  it("persists the sent snapshot on the target deck without replacing its original brief", async () => {
    callAction.mockImplementation(async (name: string) =>
      name === "get-deck"
        ? {
            generationContext: {
              originalPrompt: "Original brief",
              targetSlideCount: 6,
            },
          }
        : {},
    );
    await persistComposerSubmission(
      "target-deck",
      { designSystemId: null, references: [] },
      [{ key: "slides:ref:", title: "Ref", context: "Grid" }],
    );
    expect(callAction).toHaveBeenLastCalledWith("patch-deck", {
      deckId: "target-deck",
      operations: [
        {
          op: "patch-deck-fields",
          fields: {
            generationContext: {
              originalPrompt: "Original brief",
              targetSlideCount: 6,
              composerContext: { designSystemId: null, references: [] },
              contextItems: [
                { key: "slides:ref:", title: "Ref", context: "Grid" },
              ],
            },
          },
        },
      ],
    });
  });
  it("does not turn a failed persistence into successful submission", async () => {
    callAction.mockRejectedValue(new Error("Write failed"));
    await expect(
      persistComposerSubmission(
        "target",
        { designSystemId: null, references: [] },
        [],
      ),
    ).rejects.toThrow("Write failed");
  });
  it("validates persisted descriptors without confusing absent selection with explicit none", () => {
    expect(
      SlidesComposerContextSchema.safeParse({ references: [] }).success,
    ).toBe(false);
    expect(
      SlidesComposerContextSchema.parse({
        designSystemId: null,
        references: [],
      }).designSystemId,
    ).toBeNull();
  });
});
