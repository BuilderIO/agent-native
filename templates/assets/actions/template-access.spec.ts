import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const resolveMock = vi.hoisted(() => vi.fn());
const targetAccessMock = vi.hoisted(() => vi.fn());
const accessFilterMock = vi.hoisted(() => vi.fn());
const resolveAccessMock = vi.hoisted(() => vi.fn());
const eqMock = vi.hoisted(() =>
  vi.fn((column, value) => ({ op: "eq", column, value })),
);
const isNullMock = vi.hoisted(() =>
  vi.fn((column) => ({ op: "isNull", column })),
);
const orMock = vi.hoisted(() =>
  vi.fn((...conditions) => ({ op: "or", conditions })),
);

vi.mock("@agent-native/core/action", () => ({
  defineAction: (entry: unknown) => entry,
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  asc: vi.fn(),
  eq: eqMock,
  inArray: vi.fn((column, values) => ({ op: "in", column, values })),
  isNull: isNullMock,
  or: orMock,
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: accessFilterMock,
  resolveAccess: resolveAccessMock,
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
    assetLibraryShares: "library_shares",
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
import getTemplate from "./get-template.js";
import action from "./list-templates.js";

function queryResult(rows: unknown[]) {
  return {
    orderBy: vi.fn(async () => rows),
    limit: vi.fn(async () => rows),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
}

function createSequentialDb(rowSets: unknown[][]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => queryResult(rowSets.shift() ?? [])),
      })),
    })),
  };
}

describe("list-templates access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accessFilterMock.mockImplementation((table) => ({ op: "access", table }));
  });

  it("returns no other-owner templates when the caller has no library or template grants", async () => {
    getDbMock.mockReturnValue(createSequentialDb([[], []]));

    await expect(action.run({ scope: "all" })).resolves.toEqual({
      count: 0,
      templates: [],
    });
  });

  it("does not disclose a linked Brand Kit title without access to the kit", async () => {
    getDbMock.mockReturnValue(
      createSequentialDb([
        [],
        [
          {
            id: "shared-template",
            libraryId: "private-kit",
            title: "Shared template",
          },
        ],
        [],
      ]),
    );

    await expect(action.run({ scope: "all" })).resolves.toEqual({
      count: 1,
      templates: [
        expect.objectContaining({
          id: "shared-template",
          libraryId: "private-kit",
          libraryTitle: null,
        }),
      ],
    });
    expect(accessFilterMock).toHaveBeenCalledWith(
      expect.anything(),
      "library_shares",
    );
  });

  it("returns only associated templates for explicit library scope", async () => {
    getDbMock.mockReturnValue(
      createSequentialDb([
        [],
        [
          {
            id: "kit-template",
            libraryId: "kit-1",
            title: "Kit template",
          },
        ],
        [{ id: "kit-1", title: "Brand Kit" }],
      ]),
    );

    await expect(
      action.run({ scope: "library", libraryId: "kit-1" }),
    ).resolves.toMatchObject({
      count: 1,
      templates: [{ id: "kit-template", libraryId: "kit-1" }],
    });
    expect(eqMock).toHaveBeenCalledWith("template.library_id", "kit-1");
    expect(isNullMock).not.toHaveBeenCalled();
    expect(orMock).not.toHaveBeenCalled();
  });

  it("does not disclose the linked Brand Kit title from get-template", async () => {
    resolveMock.mockResolvedValue({
      role: "viewer",
      resource: {
        id: "shared-template",
        libraryId: "private-kit",
        title: "Shared template",
      },
    });
    resolveAccessMock.mockResolvedValue(null);

    await expect(getTemplate.run({ id: "shared-template" })).resolves.toEqual(
      expect.objectContaining({
        id: "shared-template",
        libraryTitle: null,
      }),
    );
    expect(resolveAccessMock).toHaveBeenCalledWith(
      "asset-library",
      "private-kit",
    );
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
