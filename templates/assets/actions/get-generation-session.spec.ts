import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const requireLibraryMock = vi.hoisted(() => vi.fn());
const accessibleTemplateFilterMock = vi.hoisted(() => vi.fn());
const schemaMock = vi.hoisted(() => ({
  assetGenerationSessions: { id: "sessions.id" },
  assetGenerationSessionItems: {
    sessionId: "items.sessionId",
    sortOrder: "items.sortOrder",
    createdAt: "items.createdAt",
  },
  assetTemplates: { id: "templates.id" },
  assets: { id: "assets.id" },
  assetGenerationRuns: { id: "runs.id" },
}));

const draftScopeMock = vi.hoisted(() => ({
  unrestricted: true,
  approvableLibraryIds: new Set<string>(),
  ownRunIds: new Set<string>(),
  callerEmail: "viewer@example.test",
}));

vi.mock("../server/lib/library-access.js", () => ({
  // This spec covers template access; the draft rules have their own tests.
  resolveDraftReadScope: vi.fn(async () => draftScopeMock),
  canReadSession: vi.fn(() => true),
  canReadDraftAsset: vi.fn(() => true),
  canReadRun: vi.fn(() => true),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (entry: unknown) => entry,
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  asc: vi.fn((column) => ({ op: "asc", column })),
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: schemaMock,
}));
vi.mock("./_helpers.js", () => ({
  requireLibrary: requireLibraryMock,
  serializeAsset: (row: unknown) => row,
  serializeTemplate: (row: unknown) => row,
  serializeGenerationRun: (row: unknown) => row,
  serializeGenerationSession: (row: unknown) => row,
}));
vi.mock("./_template-access.js", () => ({
  accessibleTemplateFilter: accessibleTemplateFilterMock,
}));

import action from "./get-generation-session.js";

function queryResult(rows: unknown[]) {
  return {
    limit: vi.fn(async () => rows),
    orderBy: vi.fn(async () => rows),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
}

function createDb(templateRows: unknown[]) {
  const session = {
    id: "session-1",
    libraryId: "kit-1",
    presetId: "private-global-template",
  };
  const where = vi.fn((table: unknown) =>
    vi.fn(() => {
      if (table === schemaMock.assetGenerationSessions)
        return queryResult([session]);
      if (table === schemaMock.assetGenerationSessionItems)
        return queryResult([]);
      if (table === schemaMock.assetTemplates) return queryResult(templateRows);
      return queryResult([]);
    }),
  );
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({ where: where(table) })),
    })),
  };
}

describe("get-generation-session template access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireLibraryMock.mockResolvedValue({ id: "kit-1" });
    accessibleTemplateFilterMock.mockResolvedValue({
      op: "template-access",
    });
  });

  it("returns no template details when the session viewer lacks template access", async () => {
    getDbMock.mockReturnValue(createDb([]));

    await expect(action.run({ id: "session-1" })).resolves.toMatchObject({
      session: { id: "session-1" },
      preset: null,
    });
    expect(accessibleTemplateFilterMock).toHaveBeenCalledOnce();
  });

  it("returns the attached template when it is accessible", async () => {
    getDbMock.mockReturnValue(
      createDb([
        {
          id: "private-global-template",
          title: "Shared template",
          promptTemplate: "Private prompt",
        },
      ]),
    );

    await expect(action.run({ id: "session-1" })).resolves.toMatchObject({
      preset: {
        id: "private-global-template",
        promptTemplate: "Private prompt",
      },
    });
  });
});
