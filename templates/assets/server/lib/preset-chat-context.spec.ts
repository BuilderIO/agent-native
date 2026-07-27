import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => ({
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
}));

vi.mock("./json.js", () => ({
  parseJson: vi.fn((value: unknown, fallback: unknown) => {
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }),
}));

vi.mock("../db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assetGenerationPresets: { id: "presets.id" },
    assetLibraries: { id: "libraries.id" },
  },
}));

import { inArray } from "drizzle-orm";

import { preparePresetChatContext } from "./preset-chat-context.js";

function ref(refId: string) {
  return {
    type: "mention" as const,
    path: "",
    name: "",
    source: "assets",
    refType: "preset",
    refId,
  };
}

/** Feed each `select().from().where()` call the next queued row set. */
function createDb(rowSets: unknown[][]) {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => rowSets.shift() ?? []),
    })),
  }));
  return { select };
}

describe("preparePresetChatContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns nothing when no preset references are tagged", async () => {
    const result = await preparePresetChatContext({
      message: "make a hero",
      references: [
        {
          type: "mention",
          path: "",
          name: "",
          source: "a",
          refType: "brand-kit",
          refId: "lib-1",
        },
      ],
    });
    expect(result).toBeUndefined();
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("embeds the preset aesthetics and philosophy into the model message", async () => {
    getDbMock.mockReturnValue(
      createDb([
        [
          {
            id: "preset-1",
            libraryId: "lib-1",
            title: "Campaign Hero",
            description: "Bold launch banners",
            category: "hero",
            aspectRatio: "16:9",
            imageSize: "2K",
            model: "gemini-3-pro-image",
            promptTemplate: "Cinematic, aspirational, product front and center",
            textPolicy: "No embedded text",
            settings: JSON.stringify({ tier: "best", includeLogo: true }),
          },
        ],
        [
          {
            id: "lib-1",
            title: "Acme Brand",
            customInstructions: "Always feel premium",
            styleBrief: JSON.stringify({
              mood: "confident",
              palette: ["#0A0A0A", "#F5C518"],
              lighting: "dramatic rim light",
              doNot: ["clip art", "stock smiles"],
            }),
          },
        ],
      ]),
    );

    const result = await preparePresetChatContext({
      message: "make a launch hero for the new phone",
      references: [ref("preset-1")],
    });

    const message = (result as { message: string }).message;
    // User's original text is preserved.
    expect(message).toContain("make a launch hero for the new phone");
    // Preset identity + philosophy embedded.
    expect(message).toContain('Preset "Campaign Hero" (id: preset-1)');
    expect(message).toContain(
      "Cinematic, aspirational, product front and center",
    );
    // Brand aesthetics pulled from the library style brief.
    expect(message).toContain("mood: confident");
    expect(message).toContain("dramatic rim light");
    expect(message).toContain("Avoid: clip art; stock smiles.");
    // Logo intent from preset settings.
    expect(message).toContain("canonical logo is composited");
    // Instruction to internalize before generating + pass presetId.
    expect(message).toContain("Before generating anything, study");
    expect(message).toContain("pass the matching presetId");
  });

  it("de-duplicates repeated preset references", async () => {
    getDbMock.mockReturnValue(
      createDb([
        [
          {
            id: "preset-1",
            libraryId: "lib-1",
            title: "Solo",
            aspectRatio: "1:1",
            imageSize: "2K",
            model: "gemini-3.1-flash-image",
            settings: "{}",
          },
        ],
        [],
      ]),
    );

    await preparePresetChatContext({
      message: "go",
      references: [ref("preset-1"), ref("preset-1")],
    });

    // First inArray call is the preset lookup; it should get one deduped id.
    expect(vi.mocked(inArray).mock.calls[0][1]).toEqual(["preset-1"]);
  });
});
