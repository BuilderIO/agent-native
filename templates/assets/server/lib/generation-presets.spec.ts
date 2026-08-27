import { beforeEach, describe, expect, it, vi } from "vitest";

const nanoidMock = vi.hoisted(() => vi.fn());

vi.mock("nanoid", () => ({ nanoid: nanoidMock }));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  isNull: vi.fn((column) => ({ op: "isNull", column })),
}));
vi.mock("../db/index.js", () => ({
  schema: {
    assetTemplates: {
      settings: "settings",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
      libraryId: "libraryId",
    },
  },
}));

import { DEFAULT_GENERATION_PRESET_SEEDS } from "../../shared/generation-presets.js";
import {
  ensureDefaultTemplates,
  ensureDefaultTemplatesForScopes,
} from "./generation-presets.js";

type TemplateRow = {
  settings: string;
  ownerEmail: string;
  orgId: string | null;
  libraryId: string | null;
  [key: string]: unknown;
};

type Condition =
  | { op: "and"; conditions: Condition[] }
  | { op: "eq"; column: keyof TemplateRow; value: unknown }
  | { op: "isNull"; column: keyof TemplateRow };

function matches(row: TemplateRow, condition: Condition): boolean {
  if (condition.op === "and")
    return condition.conditions.every((entry) => matches(row, entry));
  if (condition.op === "isNull") return row[condition.column] == null;
  return row[condition.column] === condition.value;
}

function createDb(rows: TemplateRow[]) {
  const values = vi.fn(async (row: TemplateRow) => {
    rows.push(row);
  });
  return {
    insert: vi.fn(() => ({ values })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async (condition: Condition) =>
          rows
            .filter((row) => matches(row, condition))
            .map((row) => ({ settings: row.settings })),
        ),
      })),
    })),
    values,
  };
}

describe("ensureDefaultTemplates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let id = 0;
    nanoidMock.mockImplementation(() => `template-${++id}`);
  });

  it("creates global defaults even when associated defaults already exist", async () => {
    const rows: TemplateRow[] = [
      {
        ownerEmail: "owner@example.com",
        orgId: "org-b",
        libraryId: "kit-b",
        settings: JSON.stringify({
          seedId: DEFAULT_GENERATION_PRESET_SEEDS[0].seedId,
        }),
      },
    ];
    const db = createDb(rows);

    await ensureDefaultTemplates({
      db,
      ownerEmail: "owner@example.com",
      orgId: "org-b",
      now: "2026-08-27T00:00:00.000Z",
    });
    expect(
      rows.filter((row) => row.orgId === "org-b" && row.libraryId === null),
    ).toHaveLength(DEFAULT_GENERATION_PRESET_SEEDS.length);

    await ensureDefaultTemplates({
      db,
      ownerEmail: "owner@example.com",
      orgId: "org-b",
      now: "2026-08-27T00:00:00.000Z",
    });
    expect(
      rows.filter((row) => row.orgId === "org-b" && row.libraryId === null),
    ).toHaveLength(DEFAULT_GENERATION_PRESET_SEEDS.length);
    expect(rows.some((row) => row.libraryId === "kit-b")).toBe(true);
  });

  it("keeps local defaults separate from organization-scoped defaults", async () => {
    const rows: TemplateRow[] = [
      {
        ownerEmail: "owner@example.com",
        orgId: "org-a",
        libraryId: "kit-a",
        settings: JSON.stringify({
          seedId: DEFAULT_GENERATION_PRESET_SEEDS[0].seedId,
        }),
      },
    ];
    const db = createDb(rows);

    await ensureDefaultTemplates({
      db,
      ownerEmail: "owner@example.com",
      orgId: null,
      now: "2026-08-27T00:00:00.000Z",
    });

    expect(rows.filter((row) => row.orgId === null)).toHaveLength(
      DEFAULT_GENERATION_PRESET_SEEDS.length,
    );
  });

  it("backfills one idempotent global set for every existing owner scope", async () => {
    const legacy = {
      id: "legacy-associated-id",
      ownerEmail: "owner@example.com",
      orgId: "org-a",
      libraryId: "kit-a",
      settings: JSON.stringify({
        seedId: DEFAULT_GENERATION_PRESET_SEEDS[0].seedId,
        source: "default-generation-preset",
      }),
    } satisfies TemplateRow;
    const rows: TemplateRow[] = [legacy];
    const db = createDb(rows);
    const scopes = [
      { ownerEmail: "owner@example.com", orgId: "org-a" },
      { ownerEmail: "owner@example.com", orgId: "org-a" },
      { ownerEmail: "owner@example.com", orgId: "org-b" },
      { ownerEmail: "migration-orphan@invalid.local", orgId: "org-a" },
    ];

    await ensureDefaultTemplatesForScopes({
      db,
      scopes,
      now: "2026-08-27T00:00:00.000Z",
    });
    await ensureDefaultTemplatesForScopes({
      db,
      scopes,
      now: "2026-08-27T00:00:00.000Z",
    });

    expect(
      rows.filter((row) => row.orgId === "org-a" && row.libraryId === null),
    ).toHaveLength(DEFAULT_GENERATION_PRESET_SEEDS.length);
    expect(
      rows.filter((row) => row.orgId === "org-b" && row.libraryId === null),
    ).toHaveLength(DEFAULT_GENERATION_PRESET_SEEDS.length);
    expect(rows.find((row) => row.id === legacy.id)).toMatchObject({
      libraryId: "kit-a",
      settings: legacy.settings,
    });
  });
});
