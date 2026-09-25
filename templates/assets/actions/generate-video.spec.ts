import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class RetryableVideoGenerationError extends Error {
    constructor(
      message: string,
      readonly provider?: "builder" | "gemini",
    ) {
      super(message);
    }
  }
  return {
    RetryableVideoGenerationError,
    assertCanDraft: vi.fn(async () => ({ role: "owner", canApprove: true })),
    compileVideoPrompt: vi.fn(() => "compiled prompt"),
    completeVideoGenerationRun: vi.fn(),
    db: {
      insert: vi.fn(),
      select: vi.fn(),
      update: vi.fn(),
    },
    draftScopeForLibrary: vi.fn(async () => ({})),
    failVideoGenerationRun: vi.fn(),
    getDb: vi.fn(),
    getObject: vi.fn(),
    getRequestOrgId: vi.fn(),
    getRequestUserEmail: vi.fn(),
    nanoid: vi.fn(() => "video-run-1"),
    nowIso: vi.fn(() => "2026-09-24T20:00:00.000Z"),
    parseJson: vi.fn((value: string | null | undefined, fallback: unknown) => {
      if (!value) return fallback;
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }),
    selectReferences: vi.fn(async () => []),
    prepareVideoGenerationProvider: vi.fn(),
    resolveOrgIdForEmail: vi.fn(async () => null),
    serializeGenerationRun: vi.fn((run) => run),
    startVideoGeneration: vi.fn(),
    stringifyJson: vi.fn((value: unknown) => JSON.stringify(value)),
    track: vi.fn(),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
}));
vi.mock("@agent-native/core/org", () => ({
  resolveOrgIdForEmail: mocks.resolveOrgIdForEmail,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
}));
vi.mock("nanoid", () => ({ nanoid: mocks.nanoid }));
vi.mock("../server/db/index.js", async () => ({
  getDb: mocks.getDb,
  schema: await import("../server/db/schema.js"),
}));
vi.mock("../server/lib/generation.js", () => ({
  DEFAULT_GENERATION_REFERENCE_LIMIT: 3,
  selectReferences: mocks.selectReferences,
}));
vi.mock("../server/lib/json.js", () => ({
  nowIso: mocks.nowIso,
  parseJson: mocks.parseJson,
  stringifyJson: mocks.stringifyJson,
}));
vi.mock("../server/lib/library-access.js", () => ({
  assertCanDraft: mocks.assertCanDraft,
  assertCanUseAssets: vi.fn(),
  draftScopeForLibrary: mocks.draftScopeForLibrary,
}));
vi.mock("../server/lib/storage.js", () => ({ getObject: mocks.getObject }));
vi.mock("../server/lib/video-generation.js", () => ({
  prepareVideoGenerationProvider: mocks.prepareVideoGenerationProvider,
  RetryableVideoGenerationError: mocks.RetryableVideoGenerationError,
  compileVideoPrompt: mocks.compileVideoPrompt,
  startVideoGeneration: mocks.startVideoGeneration,
}));
vi.mock("../server/lib/video-runs.js", () => ({
  completeVideoGenerationRun: mocks.completeVideoGenerationRun,
  failVideoGenerationRun: mocks.failVideoGenerationRun,
}));
vi.mock("./_helpers.js", () => ({
  serializeAsset: vi.fn((asset) => asset),
  serializeGenerationRun: mocks.serializeGenerationRun,
}));

import * as schema from "../server/db/schema.js";
import action from "./generate-video.js";

describe("generate-video", () => {
  const library = {
    id: "library-1",
    title: "Brand kit",
    styleBrief: "{}",
    customInstructions: "",
  };
  let insertedRun: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedRun = {};
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    mocks.getRequestOrgId.mockReturnValue(null);
    mocks.getDb.mockReturnValue(mocks.db);
    mocks.db.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => (table === schema.assetLibraries ? [library] : []),
        }),
      }),
    }));
    mocks.db.insert.mockImplementation(() => ({
      values: async (values: Record<string, unknown>) => {
        insertedRun = values;
      },
    }));
    mocks.db.update.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            Object.assign(insertedRun, values);
            return [{ ...insertedRun }];
          },
        }),
      }),
    }));
    mocks.prepareVideoGenerationProvider.mockResolvedValue({
      provider: "builder",
      auth: {
        authorization: "Bearer builder-session",
        spaceId: "space-1",
        userId: null,
      },
    });
    mocks.failVideoGenerationRun.mockResolvedValue(true);
    mocks.startVideoGeneration.mockRejectedValue(
      new mocks.RetryableVideoGenerationError(
        "Builder video generation start could not be confirmed.",
        "builder",
      ),
    );
  });

  it("returns a refreshable run after transient start failures", async () => {
    const result = await action.run({
      libraryId: "library-1",
      prompt: "A product reveal",
      source: "ui",
    });

    expect(result).toMatchObject({
      run: {
        id: "video-run-1",
        status: "processing",
        error: "Builder video generation start could not be confirmed.",
      },
      artifactType: "video",
    });
    expect(JSON.parse(String(insertedRun.metadata))).toMatchObject({
      provider: "builder",
      providerStatus: "retryable",
    });
    expect(insertedRun.status).toBe("processing");
    expect(mocks.failVideoGenerationRun).not.toHaveBeenCalled();
  });

  it("does not revive a run failed while the provider start was returning", async () => {
    mocks.db.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            table === schema.assetLibraries
              ? [library]
              : table === schema.assetGenerationRuns
                ? [insertedRun]
                : [],
        }),
      }),
    }));
    mocks.db.update.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const metadata =
              typeof values.metadata === "string"
                ? JSON.parse(values.metadata)
                : undefined;
            if (
              insertedRun.status === "failed" &&
              metadata?.providerStatus === "processing"
            ) {
              return [];
            }
            Object.assign(insertedRun, values);
            return [{ ...insertedRun }];
          },
        }),
      }),
    }));
    mocks.startVideoGeneration.mockImplementationOnce(async () => {
      insertedRun.status = "failed";
      insertedRun.error = "A concurrent refresh failed the run.";
      return { provider: "builder", generationId: "gen-1" };
    });

    const result = await action.run({
      libraryId: "library-1",
      prompt: "A product reveal",
      source: "ui",
    });

    expect(result).toMatchObject({
      run: {
        id: "video-run-1",
        status: "failed",
        error: "A concurrent refresh failed the run.",
      },
      artifactType: "video",
    });
    expect(insertedRun.status).toBe("failed");
  });

  it("starts with the same email-fallback organization saved on the run", async () => {
    mocks.getRequestOrgId.mockReturnValue(undefined);
    mocks.resolveOrgIdForEmail.mockResolvedValue("owner-org");
    mocks.startVideoGeneration.mockImplementationOnce(async () => {
      expect(insertedRun.status).toBe("processing");
      expect(JSON.parse(String(insertedRun.metadata))).toMatchObject({
        provider: "builder",
        providerStatus: "starting",
      });
      throw new mocks.RetryableVideoGenerationError(
        "Builder video generation start could not be confirmed.",
        "builder",
      );
    });

    await action.run({
      libraryId: "library-1",
      prompt: "A product reveal",
      source: "ui",
    });

    expect(insertedRun.orgId).toBe("owner-org");
    expect(mocks.prepareVideoGenerationProvider).toHaveBeenCalledWith({
      userEmail: "owner@example.test",
      orgId: "owner-org",
    });
  });
});
