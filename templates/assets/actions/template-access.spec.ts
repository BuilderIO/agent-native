import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const resolveMock = vi.hoisted(() => vi.fn());
const targetAccessMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (entry: unknown) => entry,
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn((column, value) => ({ column, value })),
  inArray: vi.fn((column, values) => ({ op: "in", column, values })),
  isNull: vi.fn(),
  or: vi.fn((...conditions) => ({ op: "or", conditions })),
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ op: "template-access" })),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assetTemplates: {
      libraryId: "template.library_id",
      sortOrder: "template.sort",
      title: "template.title",
      collectionId: "template.collection",
    },
    assetLibraries: { id: "library.id", title: "library.title" },
  },
}));
vi.mock("./_template-access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_template-access.js")>()),
  resolveTemplateAccess: resolveMock,
  assertTemplateTargetLibraryAccess: targetAccessMock,
}));
vi.mock("./_helpers.js", () => ({ serializeTemplate: (row: unknown) => row }));
vi.mock("../server/lib/json.js", () => ({
  nowIso: () => "now",
  parseJson: (value: string) => JSON.parse(value),
}));
vi.mock("./_template-input.js", () => ({
  templateHasPins: (settings: any) =>
    settings.presetReferences.flatMap((item: any) => item.assetIds),
}));

import associate from "./associate-template.js";
import action from "./list-templates.js";

describe("list-templates access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns no other-owner templates when the caller has no library or template grants", async () => {
    const otherOwnerTemplates = [
      { id: "other-template", ownerEmail: "other@example.com" },
    ];
    let call = 0;
    const where = vi.fn((condition) => ({
      orderBy: vi.fn(async () => {
        call += 1;
        return call === 1
          ? []
          : condition.op === "template-access"
            ? []
            : otherOwnerTemplates;
      }),
    }));
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    });

    await expect(action.run({ scope: "all" })).resolves.toEqual({
      count: 0,
      templates: [],
    });
    expect(where).toHaveBeenCalledTimes(2);
  });

  it("refuses to make a pinned template global and names the pins", async () => {
    resolveMock.mockResolvedValue({
      resource: {
        id: "template-1",
        libraryId: "kit-1",
        settings: JSON.stringify({
          presetReferences: [{ assetIds: ["asset-1"] }],
        }),
      },
    });

    await expect(
      associate.run({ id: "template-1", libraryId: null }),
    ).rejects.toThrow("asset-1");
    expect(targetAccessMock).toHaveBeenCalledWith(null);
  });
});
