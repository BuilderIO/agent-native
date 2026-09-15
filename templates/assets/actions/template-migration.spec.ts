import { describe, expect, it, vi } from "vitest";

const resolveMock = vi.hoisted(() => vi.fn());
const targetAccessMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (entry: unknown) => entry,
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("../server/db/index.js", () => ({
  getDb: vi.fn(),
  schema: { assetTemplates: { id: "template.id" } },
}));
vi.mock("../server/lib/json.js", () => ({
  nowIso: () => "now",
  parseJson: JSON.parse,
}));
vi.mock("./_helpers.js", () => ({ serializeTemplate: (row: unknown) => row }));
vi.mock("./_template-access.js", () => ({
  resolveTemplateAccess: resolveMock,
  assertTemplateTargetLibraryAccess: targetAccessMock,
}));
vi.mock("./_template-input.js", () => ({
  templateHasPins: (settings: any) =>
    settings.presetReferences.flatMap((entry: any) => entry.assetIds),
}));

import action from "./associate-template.js";

describe("template association after migration", () => {
  it("refuses to move a migrated pinned template to global and names its pin", async () => {
    resolveMock.mockResolvedValue({
      resource: {
        id: "legacy-preset-id",
        libraryId: "kit-a",
        settings: JSON.stringify({
          presetReferences: [{ assetIds: ["pinned-asset"] }],
        }),
      },
    });
    await expect(
      action.run({ id: "legacy-preset-id", libraryId: null }),
    ).rejects.toThrow("pinned-asset");
    expect(targetAccessMock).toHaveBeenCalledWith(null);
  });
});
