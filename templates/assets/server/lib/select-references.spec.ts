import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const getObjectMock = vi.hoisted(() => vi.fn());

const schemaMock = vi.hoisted(() => ({
  assetLibraries: {
    id: "assetLibraries.id",
    settings: "assetLibraries.settings",
  },
  assets: {
    libraryId: "assets.libraryId",
    id: "assets.id",
    mediaType: "assets.mediaType",
    role: "assets.role",
    status: "assets.status",
    mimeType: "assets.mimeType",
    collectionId: "assets.collectionId",
    generationRunId: "assets.generationRunId",
    metadata: "assets.metadata",
    createdAt: "assets.createdAt",
  },
}));

vi.mock("@agent-native/core/server", () => ({
  FeatureNotConfiguredError: class FeatureNotConfiguredError extends Error {
    readonly requiredCredential: string;

    constructor(opts: { requiredCredential: string; message?: string }) {
      super(opts.message ?? `Feature requires ${opts.requiredCredential}.`);
      this.name = "FeatureNotConfiguredError";
      this.requiredCredential = opts.requiredCredential;
    }
  },
  getBuilderImageGenerationBaseUrl: vi.fn(),
  resolveBuilderAuthHeader: vi.fn(),
  resolveSecret: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => undefined),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: vi.fn((...args) => ({ op: "and", args })),
  asc: vi.fn((column) => ({ op: "asc", column })),
  desc: vi.fn((column) => ({ op: "desc", column })),
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
  like: vi.fn((column, value) => ({ op: "like", column, value })),
  ne: vi.fn((column, value) => ({ op: "ne", column, value })),
  notInArray: vi.fn((column, values) => ({ op: "notInArray", column, values })),
  or: vi.fn((...args) => ({ op: "or", args })),
  sql: vi.fn((strings, ...values) => ({ op: "sql", strings, values })),
}));

vi.mock("../db/index.js", () => ({
  getDb: getDbMock,
  schema: schemaMock,
}));

vi.mock("./storage.js", () => ({
  getObject: getObjectMock,
}));

import { selectReferences } from "./generation.js";
import { unrestrictedDraftReadScope } from "./library-access.js";

type AssetRow = {
  id: string;
  role: string;
  mimeType: string;
  status: string;
  createdAt: string;
  objectKey: string;
  metadata: string;
  libraryId?: string;
  collectionId?: string | null;
  generationRunId?: string | null;
};

function createDb(settings: Record<string, unknown>, assets: AssetRow[]) {
  type QueryRecord = {
    table: unknown;
    where?: unknown;
    order: any[];
    limit?: number;
    returned?: number;
  };
  const queryLog: QueryRecord[] = [];
  const rowsForTable = (table: unknown) => {
    if (table === schemaMock.assetLibraries) {
      return [{ id: "library-1", settings: JSON.stringify(settings) }];
    }
    if (table === schemaMock.assets) return assets;
    return [];
  };
  const metadataFor = (row: AssetRow) => {
    try {
      return JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const evaluateSql = (expression: any, row: AssetRow): unknown => {
    const source = expression.strings.join("");
    if (/^\s*false\s*$/i.test(source) || source.includes("1 = 0")) {
      return false;
    }
    if (source.includes("IS DISTINCT FROM 'skeleton'")) {
      return evaluateSql(expression.values[0], row) !== "skeleton";
    }
    if (source.includes("IS DISTINCT FROM 'subject'")) {
      return evaluateSql(expression.values[0], row) !== "subject";
    }
    if (
      source.includes("'isStyleAnchor'") ||
      source.includes('"isStyleAnchor"')
    ) {
      return source.includes("::jsonb")
        ? metadataFor(row).isStyleAnchor === true
        : /"isStyleAnchor"\s*:\s*true/.test(row.metadata);
    }
    if (source.includes("'category'") || source.includes('"category"')) {
      return source.includes("::jsonb")
        ? (metadataFor(row).category ?? null)
        : (row.metadata.match(/"category"\s*:\s*"([^"]*)"/)?.[1] ?? null);
    }
    if (source.includes("'intent'") || source.includes('"intent"')) {
      return source.includes("::jsonb")
        ? (metadataFor(row).intent ?? null)
        : (row.metadata.match(/"intent"\s*:\s*"([^"]*)"/)?.[1] ?? null);
    }
    throw new Error(
      `Unexpected SQL expression in selectReferences fake: ${source}`,
    );
  };
  const valueForColumn = (column: any, row: AssetRow): unknown => {
    if (column?.op === "sql") return evaluateSql(column, row);
    const columnParts = String(column).split(".");
    const field = columnParts[columnParts.length - 1];
    if (field === "libraryId") return row.libraryId ?? "library-1";
    return (row as unknown as Record<string, unknown>)[field ?? ""];
  };
  const matches = (condition: any, row: any): boolean => {
    if (!condition) return true;
    if (typeof condition !== "object") {
      throw new Error(
        `Unexpected where condition in selectReferences fake: ${condition}`,
      );
    }
    if (condition.op === "and") {
      return condition.args.every((part: any) => matches(part, row));
    }
    if (condition.op === "or") {
      return condition.args.some((part: any) => matches(part, row));
    }
    if (condition.op === "eq") {
      return valueForColumn(condition.column, row) === condition.value;
    }
    if (condition.op === "ne") {
      return valueForColumn(condition.column, row) !== condition.value;
    }
    if (condition.op === "inArray") {
      return condition.values.includes(valueForColumn(condition.column, row));
    }
    if (condition.op === "notInArray") {
      return !condition.values.includes(valueForColumn(condition.column, row));
    }
    if (condition.op === "like") {
      const escaped = condition.value
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replaceAll("%", ".*")
        .replaceAll("_", ".");
      return new RegExp(`^${escaped}$`).test(
        String(valueForColumn(condition.column, row) ?? ""),
      );
    }
    if (condition.op === "gt" && condition.column === schemaMock.assets.id) {
      return row.id > condition.value;
    }
    if (condition.op === "sql") {
      return Boolean(evaluateSql(condition, row));
    }
    throw new Error(
      `Unexpected query condition in selectReferences fake: ${condition.op}`,
    );
  };
  const scoreForTest = (asset: AssetRow, expression: any) => {
    const terms = expression?.values as unknown[] | undefined;
    if (!terms || terms.length !== 10) {
      throw new Error(
        "Expected SQL score expression with ten eligibility terms",
      );
    }
    const weights = [120, 100, 30, 20, 10, 4, 3, 3, 5, -4];
    return terms.reduce<number>(
      (score, term, index) =>
        score + (matches(term, asset) ? (weights[index] ?? 0) : 0),
      0,
    );
  };
  return {
    queryLog,
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        let where: unknown;
        let order: any[] = [];
        const record: QueryRecord = { table, order };
        queryLog.push(record);
        const resultRows = () => {
          const rows = rowsForTable(table).filter((row) => matches(where, row));
          const scoreExpression = order.find(
            (item) =>
              item?.op === "desc" &&
              item.column?.op === "sql" &&
              item.column.strings.join("").includes("CASE WHEN"),
          )?.column;
          return scoreExpression
            ? rows.sort(
                (a: any, b: any) =>
                  scoreForTest(b, scoreExpression) -
                    scoreForTest(a, scoreExpression) ||
                  b.createdAt.localeCompare(a.createdAt) ||
                  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
              )
            : rows;
        };
        const query: any = {
          where: vi.fn((condition: unknown) => {
            where = condition;
            record.where = condition;
            return query;
          }),
          orderBy: vi.fn((...clauses: any[]) => {
            order = clauses;
            record.order = clauses;
            return query;
          }),
          limit: vi.fn(async (count: number) => {
            record.limit = count;
            const rows = resultRows().slice(0, count);
            record.returned = rows.length;
            return rows;
          }),
          then: (
            resolve: (value: unknown[]) => unknown,
            reject: (error: unknown) => unknown,
          ) => {
            const rows = resultRows();
            record.returned = rows.length;
            return Promise.resolve(rows).then(resolve, reject);
          },
        };
        return query;
      }),
    })),
  };
}

describe("selectReferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getObjectMock.mockImplementation(async (key: string) => Buffer.from(key));
  });

  it("uses subject first, anchors next, and deterministic fill", async () => {
    const assets: AssetRow[] = [
      {
        id: "subject",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "subject-bytes",
        metadata: JSON.stringify({ intent: "subject" }),
      },
      {
        id: "anchor-json",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-22T00:00:00.000Z",
        objectKey: "anchor-json-bytes",
        metadata: JSON.stringify({ category: "hero" }),
      },
      {
        id: "anchor-meta",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-21T00:00:00.000Z",
        objectKey: "anchor-meta-bytes",
        metadata: JSON.stringify({ isStyleAnchor: true }),
      },
      {
        id: "latest-fill",
        role: "logo_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-23T00:00:00.000Z",
        objectKey: "latest-fill-bytes",
        metadata: JSON.stringify({ category: "hero" }),
      },
      {
        id: "subject-upload-not-selected",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-25T00:00:00.000Z",
        objectKey: "unused-subject-bytes",
        metadata: JSON.stringify({ intent: "subject" }),
      },
      {
        id: "subject-role-not-selected",
        role: "subject_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-26T00:00:00.000Z",
        objectKey: "unused-subject-role-bytes",
        metadata: "{}",
      },
    ];
    getDbMock.mockReturnValue(
      createDb({ canonicalStyleAssetIds: ["anchor-json"] }, assets),
    );
    const randomSpy = vi.spyOn(Math, "random");

    const refs = await selectReferences({
      draftScope: unrestrictedDraftReadScope(),
      libraryId: "library-1",
      subjectAssetId: "subject",
      intent: "restyle",
      categories: ["hero"],
      limit: 4,
    });
    const refsAgain = await selectReferences({
      draftScope: unrestrictedDraftReadScope(),
      libraryId: "library-1",
      subjectAssetId: "subject",
      intent: "restyle",
      categories: ["hero"],
      limit: 4,
    });

    expect(refs.map((ref) => ref.id)).toEqual([
      "subject",
      "anchor-json",
      "anchor-meta",
      "latest-fill",
    ]);
    expect(refsAgain.map((ref) => ref.id)).toEqual(refs.map((ref) => ref.id));
    expect(refs[0]).toEqual(
      expect.objectContaining({
        id: "subject",
        role: "subject_reference",
        selectionReason: "subject",
      }),
    );
    expect(refs.map((ref) => ref.selectionReason)).toEqual([
      "subject",
      "anchor",
      "anchor",
      "scored",
    ]);
    expect(refs.some((ref) => ref.id === "subject-upload-not-selected")).toBe(
      false,
    );
    expect(refs.some((ref) => ref.id === "subject-role-not-selected")).toBe(
      false,
    );
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it("blends brand-kit style anchors when explicit refs are content-only attachments", async () => {
    const assets: AssetRow[] = [
      {
        id: "content-1",
        role: "subject_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "content-1-bytes",
        metadata: JSON.stringify({ intent: "subject" }),
      },
      {
        id: "anchor-1",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-22T00:00:00.000Z",
        objectKey: "anchor-1-bytes",
        metadata: JSON.stringify({ isStyleAnchor: true }),
      },
      {
        id: "style-2",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-21T00:00:00.000Z",
        objectKey: "style-2-bytes",
        metadata: "{}",
      },
    ];
    getDbMock.mockReturnValue(
      createDb({ canonicalStyleAssetIds: ["anchor-1"] }, assets),
    );

    const refs = await selectReferences({
      draftScope: unrestrictedDraftReadScope(),
      libraryId: "library-1",
      referenceAssetIds: ["content-1"],
      intent: "generate",
      limit: 4,
    });

    expect(refs[0]).toEqual(
      expect.objectContaining({
        id: "content-1",
        selectionReason: "explicit",
      }),
    );
    expect(refs.map((ref) => ref.id)).toContain("anchor-1");
    expect(refs.map((ref) => ref.id)).toContain("style-2");
  });

  it("keeps exact control when an explicit ref is a real style reference", async () => {
    const assets: AssetRow[] = [
      {
        id: "content-1",
        role: "subject_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "content-1-bytes",
        metadata: JSON.stringify({ intent: "subject" }),
      },
      {
        id: "style-picked",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-22T00:00:00.000Z",
        objectKey: "style-picked-bytes",
        metadata: "{}",
      },
      {
        id: "anchor-1",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-21T00:00:00.000Z",
        objectKey: "anchor-1-bytes",
        metadata: JSON.stringify({ isStyleAnchor: true }),
      },
    ];
    getDbMock.mockReturnValue(
      createDb({ canonicalStyleAssetIds: ["anchor-1"] }, assets),
    );

    const refs = await selectReferences({
      draftScope: unrestrictedDraftReadScope(),
      libraryId: "library-1",
      referenceAssetIds: ["content-1", "style-picked"],
      intent: "generate",
      limit: 4,
    });

    expect(refs.map((ref) => ref.id)).toEqual(["content-1", "style-picked"]);
  });

  it("keeps explicit reference IDs in caller order with subject prepended", async () => {
    const assets: AssetRow[] = [
      {
        id: "subject",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "subject-bytes",
        metadata: "{}",
      },
      {
        id: "explicit-a",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-22T00:00:00.000Z",
        objectKey: "explicit-a-bytes",
        metadata: "{}",
      },
      {
        id: "explicit-b",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-21T00:00:00.000Z",
        objectKey: "explicit-b-bytes",
        metadata: "{}",
      },
    ];
    getDbMock.mockReturnValue(createDb({}, assets));

    const refs = await selectReferences({
      draftScope: unrestrictedDraftReadScope(),
      libraryId: "library-1",
      subjectAssetId: "subject",
      referenceAssetIds: ["explicit-b", "explicit-a"],
      intent: "restyle",
      limit: 2,
    });

    expect(refs.map((ref) => ref.id)).toEqual([
      "subject",
      "explicit-b",
      "explicit-a",
    ]);
    expect(refs[0].role).toBe("subject_reference");
  });

  it("excludes active skeleton assets from explicit references", async () => {
    const assets: AssetRow[] = [
      {
        id: "skeleton-plate",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-22T00:00:00.000Z",
        objectKey: "skeleton-plate-bytes",
        metadata: "{}",
      },
      {
        id: "explicit-style",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-21T00:00:00.000Z",
        objectKey: "explicit-style-bytes",
        metadata: "{}",
      },
    ];
    getDbMock.mockReturnValue(createDb({}, assets));

    const refs = await selectReferences({
      draftScope: unrestrictedDraftReadScope(),
      libraryId: "library-1",
      referenceAssetIds: ["skeleton-plate", "explicit-style"],
      excludeAssetIds: ["skeleton-plate"],
      intent: "generate",
      limit: 4,
    });

    expect(refs.map((ref) => ref.id)).toEqual(["explicit-style"]);
  });

  it("excludes skeleton category assets from automatic references", async () => {
    const assets: AssetRow[] = [
      {
        id: "skeleton-plate",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "skeleton-plate-bytes",
        metadata: JSON.stringify({ category: "skeleton" }),
      },
      {
        id: "legacy-skeleton-plate",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-23T00:00:00.000Z",
        objectKey: "legacy-skeleton-plate-bytes",
        metadata: JSON.stringify({ category: "skeleton" }),
      },
      {
        id: "style-ref",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-21T00:00:00.000Z",
        objectKey: "style-ref-bytes",
        metadata: "{}",
      },
    ];
    getDbMock.mockReturnValue(createDb({}, assets));

    const refs = await selectReferences({
      draftScope: unrestrictedDraftReadScope(),
      libraryId: "library-1",
      intent: "generate",
      limit: 4,
    });

    expect(refs.map((ref) => ref.id)).toEqual(["style-ref"]);
  });

  it("globally ranks a best candidate beyond the first 100 rows and preserves forced refs", async () => {
    const assets: AssetRow[] = Array.from({ length: 100 }, (_, index) => ({
      id: `asset-${String(index).padStart(3, "0")}`,
      role: "style_reference",
      mimeType: "image/png",
      status: "reference",
      createdAt: "2026-05-24T00:00:00.000Z",
      objectKey: `bytes-${index}`,
      metadata: "{}",
    }));
    assets.push(
      {
        id: "asset-100-subject",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "subject-bytes",
        metadata: JSON.stringify({ intent: "subject" }),
      },
      {
        id: "asset-101-source",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "source-bytes",
        metadata: "{}",
      },
      {
        id: "asset-102-anchor",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "anchor-bytes",
        metadata: "{}",
      },
      {
        id: "asset-103-best",
        role: "logo_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "best-bytes",
        metadata: JSON.stringify({ category: "hero" }),
      },
    );
    const db = createDb(
      { canonicalStyleAssetIds: ["asset-102-anchor"] },
      assets,
    );
    getDbMock.mockReturnValue(db);

    const refs = await selectReferences({
      draftScope: unrestrictedDraftReadScope(),
      libraryId: "library-1",
      categories: ["hero"],
      intent: "generate",
      limit: 6,
      subjectAssetId: "asset-100-subject",
      sourceAssetId: "asset-101-source",
    });

    expect(refs.map((ref) => ref.id)).toEqual([
      "asset-100-subject",
      "asset-101-source",
      "asset-102-anchor",
      "asset-103-best",
      "asset-000",
      "asset-001",
    ]);
    expect(refs.map((ref) => ref.selectionReason)).toEqual([
      "subject",
      "source",
      "anchor",
      "scored",
      "scored",
      "scored",
    ]);
    const assetQueries = db.queryLog.filter(
      (query) => query.table === schemaMock.assets,
    );
    expect(
      assetQueries.map(({ limit, returned }) => [limit, returned]),
    ).toEqual([
      [undefined, 3],
      [12, 12],
      [5, 0],
    ]);
    expect(
      assetQueries.reduce((total, query) => total + (query.returned ?? 0), 0),
    ).toBe(15);
  });

  it("uses stable byte ordering for tied reference candidates", async () => {
    const assets: AssetRow[] = ["a-reference", "A-reference"].map((id) => ({
      id,
      role: "style_reference",
      mimeType: "image/png",
      status: "reference",
      createdAt: "2026-05-24T00:00:00.000Z",
      objectKey: `${id}-bytes`,
      metadata: "{}",
    }));
    getDbMock.mockReturnValue(createDb({}, assets));

    const refs = await selectReferences({
      draftScope: unrestrictedDraftReadScope(),
      libraryId: "library-1",
      intent: "generate",
      limit: 2,
    });

    expect(refs.map((ref) => ref.id)).toEqual(["A-reference", "a-reference"]);
  });

  it("does not score empty collection IDs as a collection match", async () => {
    const assets: AssetRow[] = [
      {
        id: "a-normal",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "normal-bytes",
        metadata: "{}",
        collectionId: "kit-1",
      },
      {
        id: "z-empty",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "empty-bytes",
        metadata: "{}",
        collectionId: "",
      },
    ];
    getDbMock.mockReturnValue(createDb({}, assets));

    const refs = await selectReferences({
      draftScope: unrestrictedDraftReadScope(),
      libraryId: "library-1",
      collectionId: "",
      intent: "generate",
      limit: 1,
    });

    expect(refs.map((ref) => ref.id)).toEqual(["a-normal"]);
  });

  it("reads category and intent from top-level metadata only", async () => {
    const assets: AssetRow[] = [
      {
        id: "a-nested-skeleton",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "nested-skeleton-bytes",
        metadata: JSON.stringify({ extra: { category: "skeleton" } }),
      },
      {
        id: "b-nested-subject",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "nested-subject-bytes",
        metadata: JSON.stringify({ extra: { intent: "subject" } }),
      },
    ];
    getDbMock.mockReturnValue(createDb({}, assets));

    const refs = await selectReferences({
      draftScope: unrestrictedDraftReadScope(),
      libraryId: "library-1",
      intent: "generate",
      limit: 2,
    });

    expect(refs.map((ref) => ref.id)).toEqual([
      "a-nested-skeleton",
      "b-nested-subject",
    ]);
  });

  it("does not let nested style-anchor keys crowd out a real top-level anchor", async () => {
    const assets: AssetRow[] = [
      ...Array.from(
        { length: 8 },
        (_, index): AssetRow => ({
          id: `a-nested-anchor-${String(index).padStart(2, "0")}`,
          role: "style_reference",
          mimeType: "image/png",
          status: "reference",
          createdAt: "2026-05-24T00:00:00.000Z",
          objectKey: `nested-anchor-${index}-bytes`,
          metadata: JSON.stringify({ extra: { isStyleAnchor: true } }),
        }),
      ),
      {
        id: "z-real-anchor",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "real-anchor-bytes",
        metadata: JSON.stringify({ isStyleAnchor: true }),
      },
    ];
    getDbMock.mockReturnValue(createDb({}, assets));

    const refs = await selectReferences({
      draftScope: unrestrictedDraftReadScope(),
      libraryId: "library-1",
      intent: "generate",
      limit: 1,
    });

    expect(refs.map((ref) => ref.id)).toEqual(["z-real-anchor"]);
    expect(refs[0].selectionReason).toBe("anchor");
  });
});
describe("selectReferences draft scope", () => {
  const candidate = (id: string, generationRunId: string): AssetRow => ({
    id,
    libraryId: "lib-1",
    role: "generated",
    mimeType: "image/png",
    status: "candidate",
    createdAt: "2026-05-24T00:00:00.000Z",
    objectKey: `${id}-bytes`,
    metadata: "{}",
    generationRunId,
  });
  const viewerScope = {
    unrestricted: false,
    approvableLibraryIds: new Set<string>(),
    ownRunIds: new Set(["run-mine"]),
    callerEmail: "viewer@example.test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getObjectMock.mockImplementation(async (key: string) => Buffer.from(key));
  });

  it("keeps another drafter's candidate out of the automatic pool", async () => {
    getDbMock.mockReturnValue(
      createDb({}, [
        candidate("mine", "run-mine"),
        candidate("theirs", "run-theirs"),
      ]),
    );

    const refs = await selectReferences({
      draftScope: viewerScope,
      libraryId: "lib-1",
      intent: "generate",
      limit: 5,
    });

    expect(refs.map((ref) => ref.id)).toEqual(["mine"]);
  });

  it("drops another drafter's candidate passed explicitly", async () => {
    getDbMock.mockReturnValue(
      createDb({}, [candidate("theirs", "run-theirs")]),
    );

    const refs = await selectReferences({
      draftScope: viewerScope,
      libraryId: "lib-1",
      referenceAssetIds: ["theirs"],
      intent: "generate",
      limit: 5,
    });

    expect(refs).toEqual([]);
  });
});
