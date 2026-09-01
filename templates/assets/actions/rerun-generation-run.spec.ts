import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());
const resolveTemplateAccessMock = vi.hoisted(() => vi.fn());
const generateImageRunMock = vi.hoisted(() => vi.fn());
const libraryAccessMock = vi.hoisted(() =>
  vi.fn(async () => ({ role: "owner", canApprove: true })),
);

vi.mock("@agent-native/core/action", () => ({
  defineAction: (entry: unknown) => entry,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));
vi.mock("../server/lib/library-access.js", () => ({
  assertCanDraft: libraryAccessMock,
  assertCanApprove: libraryAccessMock,
  assertCanDraftAuthoredBy: libraryAccessMock,
  assertCanDeleteAsset: libraryAccessMock,
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ column, value })),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: { assetGenerationRuns: { id: "runs.id" } },
}));
vi.mock("../server/lib/json.js", () => ({
  parseJson: (value: string) => JSON.parse(value),
}));
vi.mock("../server/lib/preset-references.js", () => ({
  normalizePresetReferences: () => [],
}));
vi.mock("./_helpers.js", () => ({
  requireGenerationSessionInLibrary: vi.fn(),
}));
vi.mock("./_template-access.js", () => ({
  resolveTemplateAccess: resolveTemplateAccessMock,
}));
vi.mock("./generate-image.js", () => ({
  default: { run: generateImageRunMock },
}));

import action from "./rerun-generation-run.js";

describe("rerun-generation-run template access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    libraryAccessMock.mockResolvedValue({ role: "owner", canApprove: true });
    assertAccessMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [
              {
                id: "run-1",
                libraryId: "kit-1",
                presetId: "private-global-template",
                sessionId: null,
                prompt: "Generate",
                metadata: JSON.stringify({
                  settingsUsed: { boardAssignments: { subject: ["asset-1"] } },
                }),
                aspectRatio: "1:1",
                imageSize: "2K",
                model: "gemini-3.1-flash-image",
                groundingMode: "auto",
              },
            ]),
          })),
        })),
      })),
    });
  });

  it("does not read current template settings without template access", async () => {
    resolveTemplateAccessMock.mockRejectedValue(
      new Error("Template not found or not accessible."),
    );

    await expect(action.run({ runId: "run-1", source: "ui" })).rejects.toThrow(
      "not accessible",
    );
    expect(resolveTemplateAccessMock).toHaveBeenCalledWith(
      "private-global-template",
      "viewer",
    );
    expect(generateImageRunMock).not.toHaveBeenCalled();
  });
});
