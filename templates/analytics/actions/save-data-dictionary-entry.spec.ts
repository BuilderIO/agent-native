import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { resolveDictionaryTrustDefaults } from "./data-dictionary-trust";
import { cliBoolean } from "./schema-helpers";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(() => "org_test"),
  getRequestUserEmail: vi.fn(() => "user@example.test"),
  getOrgSetting: vi.fn(
    async (_orgId: string, _key: string) =>
      null as Record<string, unknown> | null,
  ),
  getUserSetting: vi.fn(
    async (_email: string, _key: string) =>
      null as Record<string, unknown> | null,
  ),
  putOrgSetting: vi.fn(async () => undefined),
  putUserSetting: vi.fn(async () => undefined),
  readSourceIndex: vi.fn(async () => ({ status: "not-configured" })),
  sourceIndexDictionaryEntries: vi.fn(() => []),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: mocks.getOrgSetting,
  getUserSetting: mocks.getUserSetting,
  putOrgSetting: mocks.putOrgSetting,
  putUserSetting: mocks.putUserSetting,
}));

vi.mock("../server/lib/source-index-store.js", () => ({
  readSourceIndex: mocks.readSourceIndex,
  sourceIndexDictionaryEntries: mocks.sourceIndexDictionaryEntries,
}));

const { default: action } = await import("./save-data-dictionary-entry");

describe("save-data-dictionary-entry schema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrgSetting.mockResolvedValue(null);
    mocks.getUserSetting.mockResolvedValue(null);
    mocks.readSourceIndex.mockResolvedValue({ status: "not-configured" });
    mocks.sourceIndexDictionaryEntries.mockReturnValue([]);
  });

  it("parses CLI boolean strings explicitly", async () => {
    const schema = z.object({
      approved: cliBoolean.optional(),
      aiGenerated: cliBoolean.optional(),
    });
    const result = await schema["~standard"].validate({
      approved: "true",
      aiGenerated: "false",
    });

    expect(result).toEqual({
      value: {
        approved: true,
        aiGenerated: false,
      },
    });
  });

  it("defaults entries to unapproved until someone reviews them", () => {
    expect(resolveDictionaryTrustDefaults({})).toEqual({
      approved: false,
      aiGenerated: false,
    });
  });

  it("defaults AI-generated entries to unapproved suggestions", () => {
    expect(resolveDictionaryTrustDefaults({ aiGenerated: true })).toEqual({
      approved: false,
      aiGenerated: true,
    });
  });

  it("preserves existing review state unless explicitly changed", () => {
    expect(
      resolveDictionaryTrustDefaults(
        {},
        { approved: false, aiGenerated: true },
      ),
    ).toEqual({
      approved: false,
      aiGenerated: true,
    });
    expect(
      resolveDictionaryTrustDefaults(
        { approved: true },
        { approved: false, aiGenerated: true },
      ),
    ).toEqual({
      approved: true,
      aiGenerated: true,
    });
    expect(
      resolveDictionaryTrustDefaults(
        {},
        { approved: true, aiGenerated: false },
      ),
    ).toEqual({
      approved: true,
      aiGenerated: false,
    });
  });

  it("persists a deprecated source-index lifecycle when saving the entry", async () => {
    const args = {
      id: "index-model-deprecated",
      metric: "Legacy model",
      definition: "A retired model.",
      status: "deprecated" as const,
    };

    expect(action.schema.parse(args)).toMatchObject({
      status: "deprecated",
    });
    await action.run(args, {} as never);

    expect(mocks.putOrgSetting).toHaveBeenCalledWith(
      "org_test",
      "data-dict-index-model-deprecated",
      expect.objectContaining({ status: "deprecated" }),
    );
  });

  it("keeps an existing deprecated lifecycle when an update omits status", async () => {
    mocks.getOrgSetting.mockResolvedValue({
      status: "deprecated",
      approved: false,
      aiGenerated: true,
    });

    await action.run(
      {
        id: "index-model-deprecated",
        metric: "Legacy model",
        definition: "A retired model.",
      },
      {} as never,
    );

    expect(mocks.putOrgSetting).toHaveBeenCalledWith(
      "org_test",
      "data-dict-index-model-deprecated",
      expect.objectContaining({ status: "deprecated" }),
    );
  });

  it("uses the live source lifecycle over saved and submitted status", async () => {
    mocks.getOrgSetting.mockResolvedValue({ status: "active" });
    mocks.readSourceIndex.mockResolvedValue({
      status: "available",
      bundle: { generatedAt: "2026-10-10T00:00:00.000Z" },
    });
    mocks.sourceIndexDictionaryEntries.mockReturnValue([
      { id: "index-model-deprecated", status: "deprecated" },
    ]);

    await action.run(
      {
        id: "index-model-deprecated",
        metric: "Legacy model",
        definition: "A retired model.",
        status: "active",
      },
      {} as never,
    );

    expect(mocks.putOrgSetting).toHaveBeenCalledWith(
      "org_test",
      "data-dict-index-model-deprecated",
      expect.objectContaining({ status: "deprecated" }),
    );
  });

  it("defaults a new entry to active", async () => {
    await action.run(
      { id: "current-model", metric: "Current model", definition: "Current." },
      {} as never,
    );

    expect(mocks.putOrgSetting).toHaveBeenCalledWith(
      "org_test",
      "data-dict-current-model",
      expect.objectContaining({ status: "active" }),
    );
  });
});
