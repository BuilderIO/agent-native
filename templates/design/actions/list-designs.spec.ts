import { beforeEach, describe, expect, it, vi } from "vitest";

interface DesignRow {
  id: string;
  title: string;
  description: string | null;
  projectType: string;
  designSystemId: string | null;
  visibility: string;
  ownerEmail: string;
  createdAt: string;
  updatedAt: string;
}

interface FileRow {
  designId: string;
  filename: string;
  content: string;
  fileType: string;
}

const mocks = vi.hoisted(() => {
  const schema = {
    designs: {
      id: "designs.id",
      title: "designs.title",
      description: "designs.description",
      projectType: "designs.projectType",
      designSystemId: "designs.designSystemId",
      visibility: "designs.visibility",
      ownerEmail: "designs.ownerEmail",
      createdAt: "designs.createdAt",
      updatedAt: "designs.updatedAt",
    },
    designShares: "designShares",
    designFiles: {
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      content: "designFiles.content",
      fileType: "designFiles.fileType",
    },
  };

  return {
    schema,
    requestUserEmail: "owner@example.com" as string | null,
    designRows: [] as DesignRow[],
    fileRows: [] as FileRow[],
    accessFilter: vi.fn(() => ({ kind: "access" })),
    designWhereCalls: [] as unknown[],
    fileWhereCalls: [] as unknown[],
    selectProjections: [] as unknown[],
    pageCalls: [] as Array<{ limit: number; offset: number }>,
  };
});

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.requestUserEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  desc: (column: unknown) => ({ kind: "desc", column }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({
    kind: "inArray",
    column,
    values,
  }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings: [...strings],
    values,
  }),
}));

function findNode(
  value: unknown,
  kind: string,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ((value as { kind?: string }).kind === kind) {
    return value as Record<string, unknown>;
  }
  for (const child of Object.values(value)) {
    const found = findNode(child, kind);
    if (found) return found;
  }
  return undefined;
}

function predicateValues(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  const ownValues = Object.prototype.hasOwnProperty.call(value, "values")
    ? (value as { values?: unknown }).values
    : undefined;
  return [
    ...(Array.isArray(ownValues) ? ownValues : []),
    ...Object.values(value).flatMap(predicateValues),
  ];
}

function filteredDesignRows(predicate: unknown): DesignRow[] {
  let rows = mocks.designRows;
  const values = predicateValues(predicate);
  const searchPattern = values.find(
    (value): value is string =>
      typeof value === "string" && value.startsWith("%") && value.endsWith("%"),
  );
  if (searchPattern) {
    const search = searchPattern.slice(1, -1).replace(/\\([\\%_])/g, "$1");
    rows = rows.filter((row) => row.title.toLowerCase().includes(search));
  }
  if (JSON.stringify(predicate).includes("ownerEmail")) {
    const owner = values.find(
      (value): value is string =>
        typeof value === "string" && value.includes("@"),
    );
    if (owner) {
      rows = rows.filter(
        (row) => row.ownerEmail.trim().toLowerCase() === owner,
      );
    }
  }
  return rows;
}

const db = {
  select: (projection: unknown) => {
    mocks.selectProjections.push(projection);
    return {
      from: (table: unknown) => ({
        where: (predicate: unknown) => {
          if (table === mocks.schema.designs) {
            mocks.designWhereCalls.push(predicate);
            const rows = filteredDesignRows(predicate);
            if (
              projection &&
              typeof projection === "object" &&
              "count" in projection
            ) {
              return Promise.resolve([{ count: rows.length }]);
            }
            return {
              orderBy: () => {
                const query = {
                  limit: (limit: number) => ({
                    offset: (offset: number) => {
                      mocks.pageCalls.push({ limit, offset });
                      return Promise.resolve(
                        rows.slice(offset, offset + limit),
                      );
                    },
                  }),
                  then: (
                    resolve: (value: DesignRow[]) => unknown,
                    reject: (reason: unknown) => unknown,
                  ) => Promise.resolve(rows).then(resolve, reject),
                };
                return query;
              },
            };
          }

          mocks.fileWhereCalls.push(predicate);
          const ids = findNode(predicate, "inArray")?.values as
            | string[]
            | undefined;
          return Promise.resolve(
            ids
              ? mocks.fileRows.filter((row) => ids.includes(row.designId))
              : mocks.fileRows,
          );
        },
      }),
    };
  },
};

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: mocks.schema,
}));

import action from "./list-designs.js";

function design(
  id: string,
  title: string,
  ownerEmail = "owner@example.com",
): DesignRow {
  return {
    id,
    title,
    description: null,
    projectType: "prototype",
    designSystemId: null,
    visibility: "private",
    ownerEmail,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

beforeEach(() => {
  mocks.requestUserEmail = "owner@example.com";
  mocks.designRows = [];
  mocks.fileRows = [];
  mocks.designWhereCalls = [];
  mocks.fileWhereCalls = [];
  mocks.selectProjections = [];
  mocks.pageCalls = [];
  vi.clearAllMocks();
});

describe("list-designs", () => {
  it("returns a bounded page with total count metadata without selecting data", async () => {
    mocks.designRows = [
      design("design-1", "One"),
      design("design-2", "Two"),
      design("design-3", "Three"),
      design("design-4", "Four"),
      design("design-5", "Five"),
    ];

    const result = await action.run({
      page: 2,
      pageSize: 2,
      includePreview: "false",
    });

    expect(result.designs.map((item) => item.id)).toEqual([
      "design-3",
      "design-4",
    ]);
    expect(result).toMatchObject({
      count: 5,
      totalCount: 5,
      hasMore: true,
      page: 2,
      pageSize: 2,
      totalPages: 3,
    });
    expect(mocks.pageCalls).toEqual([{ limit: 2, offset: 2 }]);
    const designProjection = mocks.selectProjections.find(
      (projection) =>
        projection && typeof projection === "object" && "id" in projection,
    );
    expect(designProjection).not.toHaveProperty("data");
  });

  it("keeps no-argument callers on a bounded lightweight page", async () => {
    mocks.designRows = [design("design-1", "One"), design("design-2", "Two")];

    const result = await action.run({});

    expect(result.designs.map((item) => item.id)).toEqual([
      "design-1",
      "design-2",
    ]);
    expect(result).toMatchObject({
      count: 2,
      totalCount: 2,
      hasMore: false,
      page: 1,
      pageSize: 12,
      totalPages: 1,
    });
    expect(mocks.pageCalls).toEqual([{ limit: 12, offset: 0 }]);
  });

  it("applies Mine to the authenticated owner while retaining access scoping", async () => {
    mocks.designRows = [
      design("mine", "Mine", "Owner@Example.com"),
      design("shared", "Shared", "teammate@example.com"),
    ];

    const result = await action.run({
      createdBy: "me",
      page: 1,
      pageSize: 10,
      includePreview: "false",
    });

    expect(result.designs.map((item) => item.id)).toEqual(["mine"]);
    expect(mocks.accessFilter).toHaveBeenCalledWith(
      mocks.schema.designs,
      mocks.schema.designShares,
    );
    expect(JSON.stringify(mocks.designWhereCalls[0])).toContain(
      "owner@example.com",
    );
  });

  it("filters titles before pagination and only queries previews for the current page", async () => {
    mocks.designRows = [
      design("design-1", "Alpha one"),
      design("design-2", "Beta"),
      design("design-3", "Alpha two"),
    ];
    mocks.fileRows = [
      {
        designId: "design-1",
        filename: "index.html",
        content: "<main>one</main>",
        fileType: "html",
      },
      {
        designId: "design-3",
        filename: "index.html",
        content: "<main>two</main>",
        fileType: "html",
      },
    ];

    const result = await action.run({
      search: "alpha",
      page: 2,
      pageSize: 1,
      includePreview: "true",
    });

    expect(result.designs).toMatchObject([
      { id: "design-3", previewHtml: "<main>two</main>" },
    ]);
    expect(result).toMatchObject({
      count: 2,
      totalCount: 2,
      hasMore: false,
      page: 2,
      totalPages: 2,
    });
    expect(JSON.stringify(mocks.designWhereCalls[0])).toContain("%alpha%");
    expect(JSON.stringify(mocks.fileWhereCalls[0])).toContain("design-3");
    expect(JSON.stringify(mocks.fileWhereCalls[0])).not.toContain("design-1");
  });
});
