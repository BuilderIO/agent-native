import { beforeEach, describe, expect, it, vi } from "vitest";

const assertOrgAdminMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const getRequestOrgIdMock = vi.hoisted(() => vi.fn());
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const schemaMock = vi.hoisted(() => ({
  assetTemplates: {
    id: "templates.id",
    ownerEmail: "templates.ownerEmail",
    orgId: "templates.orgId",
  },
  assetGenerationSessions: { presetId: "sessions.presetId" },
  assetGenerationRuns: { presetId: "runs.presetId" },
  assetTemplateShares: { resourceId: "shares.resourceId" },
}));
const ForbiddenAuditErrorMock = vi.hoisted(
  () =>
    class ForbiddenAuditError extends Error {
      readonly statusCode = 403;
    },
);

vi.mock("@agent-native/core/action", () => ({
  defineAction: (entry: unknown) => entry,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: getRequestOrgIdMock,
  getRequestUserEmail: getRequestUserEmailMock,
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
  isNull: vi.fn((column) => ({ op: "isNull", column })),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: schemaMock,
}));
vi.mock("../server/lib/json.js", () => ({
  parseJson: vi.fn((value: string, fallback: unknown) => {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }),
}));
vi.mock("../server/lib/org-admin.js", () => ({
  assertOrgAdmin: assertOrgAdminMock,
  ForbiddenAuditError: ForbiddenAuditErrorMock,
}));

import action, {
  listMigrationOrphansForAuditAdmin,
} from "./merge-duplicate-templates.js";

type Condition = {
  op: "and" | "eq" | "inArray" | "isNull";
  column?: string;
  value?: unknown;
  values?: unknown[];
  conditions?: Condition[];
};

type Candidate = {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  libraryId: string | null;
  collectionId: string | null;
  createdAt: string;
  updatedAt: string;
  settings: string;
};

function fieldForColumn(column: string): string {
  return column.slice(column.indexOf(".") + 1);
}

function matches(row: Record<string, unknown>, condition: Condition): boolean {
  if (condition.op === "and")
    return (condition.conditions ?? []).every((entry) => matches(row, entry));
  const value = row[fieldForColumn(condition.column ?? "")];
  if (condition.op === "isNull") return value == null;
  if (condition.op === "inArray")
    return condition.values?.includes(value) ?? false;
  return value === condition.value;
}

function createMergeDb(data: {
  templates: Candidate[];
  sessions?: Array<{ presetId: string }>;
  runs?: Array<{ presetId: string }>;
  shares?: Array<{ resourceId: string }>;
}) {
  const tableRows = (table: unknown): Array<Record<string, unknown>> => {
    if (table === schemaMock.assetTemplates) return data.templates;
    if (table === schemaMock.assetGenerationSessions)
      return data.sessions ?? [];
    if (table === schemaMock.assetGenerationRuns) return data.runs ?? [];
    if (table === schemaMock.assetTemplateShares) return data.shares ?? [];
    return [];
  };
  const select = vi.fn((selection?: Record<string, string>) => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(async (condition: Condition) => {
        const rows = tableRows(table).filter((row) => matches(row, condition));
        if (!selection) return rows;
        return rows.map((row) =>
          Object.fromEntries(
            Object.entries(selection).map(([key, column]) => [
              key,
              row[fieldForColumn(column)],
            ]),
          ),
        );
      }),
    })),
  }));
  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: Record<string, unknown>) => ({
      where: vi.fn(async (condition: Condition) => {
        for (const row of tableRows(table)) {
          if (matches(row, condition)) Object.assign(row, values);
        }
      }),
    })),
  }));
  const deletedIds: string[] = [];
  const deleteFrom = vi.fn((table: unknown) => ({
    where: vi.fn(async (condition: Condition) => {
      if (table !== schemaMock.assetTemplates) return;
      for (let index = data.templates.length - 1; index >= 0; index -= 1) {
        if (!matches(data.templates[index], condition)) continue;
        deletedIds.push(data.templates[index].id);
        data.templates.splice(index, 1);
      }
    }),
  }));
  return { delete: deleteFrom, deletedIds, select, update };
}

function candidate(
  id: string,
  orgId: string | null,
  createdAt: string,
): Candidate {
  return {
    id,
    ownerEmail: "owner@example.com",
    orgId,
    libraryId: `kit-${orgId ?? "local"}`,
    collectionId: null,
    createdAt,
    updatedAt: createdAt,
    settings: JSON.stringify({
      seedId: "social",
      source: "default-generation-preset",
    }),
  };
}

function dbWithRows(rows: unknown[]) {
  const where = vi.fn(async () => rows);
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where })),
    })),
    where,
  };
}

describe("merge-duplicate-templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue("owner@example.com");
    getRequestOrgIdMock.mockReturnValue("org-a");
    assertOrgAdminMock.mockRejectedValue(new ForbiddenAuditErrorMock());
  });

  it("only merges duplicates in the active organization", async () => {
    const crossKitDuplicate = candidate(
      "a-duplicate",
      "org-a",
      "2026-01-02T00:00:00.000Z",
    );
    crossKitDuplicate.libraryId = "kit-org-a-secondary";
    const templates = [
      candidate("a-oldest", "org-a", "2026-01-01T00:00:00.000Z"),
      crossKitDuplicate,
      candidate("b-oldest", "org-b", "2026-01-01T00:00:00.000Z"),
      candidate("b-duplicate", "org-b", "2026-01-02T00:00:00.000Z"),
    ];
    const db = createMergeDb({ templates });
    getDbMock.mockReturnValue(db);

    await expect(action.run({ dryRun: false })).resolves.toMatchObject({
      merged: [{ keptId: "a-oldest", deletedIds: ["a-duplicate"] }],
    });
    expect(db.deletedIds).toEqual(["a-duplicate"]);
    expect(templates.map((row) => row.id)).toEqual([
      "a-oldest",
      "b-oldest",
      "b-duplicate",
    ]);
  });

  it("keeps explicitly shared duplicates instead of dropping their grants", async () => {
    const templates = [
      candidate("oldest", "org-a", "2026-01-01T00:00:00.000Z"),
      candidate("shared-duplicate", "org-a", "2026-01-02T00:00:00.000Z"),
    ];
    const db = createMergeDb({
      templates,
      shares: [{ resourceId: "shared-duplicate" }],
    });
    getDbMock.mockReturnValue(db);

    await expect(action.run({ dryRun: false })).resolves.toMatchObject({
      merged: [],
      kept: [{ id: "shared-duplicate", reason: "Has explicit shares." }],
    });
    expect(db.deletedIds).toEqual([]);
    expect(templates).toHaveLength(2);
  });
});

describe("migration orphan reporting", () => {
  it("does not enumerate orphan IDs for a non-admin caller", async () => {
    assertOrgAdminMock.mockRejectedValue(new ForbiddenAuditErrorMock());
    const db = dbWithRows([{ id: "other-org-orphan" }]);

    await expect(listMigrationOrphansForAuditAdmin(db)).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("limits an audit admin's orphan report to the active organization", async () => {
    assertOrgAdminMock.mockResolvedValue({ orgId: "org-a" });
    const db = dbWithRows([{ id: "org-a-orphan" }]);

    await expect(listMigrationOrphansForAuditAdmin(db)).resolves.toEqual([
      { id: "org-a-orphan" },
    ]);
    expect(db.where).toHaveBeenCalledWith(
      expect.objectContaining({ op: "and" }),
    );
  });
});
