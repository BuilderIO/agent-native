import { describe, expect, it, vi } from "vitest";

import {
  assertUniqueSlackChannelForFactory,
  assignCreatedByIfMissing,
  builderSlackUserIdSchema,
  factoryAutomationLeafName,
  factoryConfigRowId,
  readAutomationFactoryId,
  requireExistingFactory,
  triageConfigUpdateRowId,
} from "./factory-scope.js";

describe("triageConfigUpdateRowId", () => {
  it("uses the loaded config row id for legacy fallback rows", () => {
    expect(
      triageConfigUpdateRowId({ id: "org-1" }, "org-1", "product-feedback"),
    ).toBe("org-1");
  });

  it("falls back to the scoped config id when no row is loaded", () => {
    expect(
      triageConfigUpdateRowId(undefined, "org-1", "product-feedback"),
    ).toBe(factoryConfigRowId("org-1", "product-feedback"));
  });
});

describe("assertUniqueSlackChannelForFactory", () => {
  function dbWithFactoryIds(factoryIds: Array<string | null>) {
    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () =>
            factoryIds.map((factoryId) => ({ factoryId })),
          ),
        })),
      })),
    };
  }

  it("rejects a channel held by an unscoped legacy row", async () => {
    await expect(
      assertUniqueSlackChannelForFactory(
        dbWithFactoryIds([null]) as never,
        "org-1",
        "product-feedback",
        "C123",
      ),
    ).rejects.toThrow(
      "That Slack channel is already used by another Factory in this workspace.",
    );
  });

  it("allows the channel already held by the selected factory", async () => {
    await expect(
      assertUniqueSlackChannelForFactory(
        dbWithFactoryIds(["product-feedback"]) as never,
        "org-1",
        "product-feedback",
        "C123",
      ),
    ).resolves.toBeUndefined();
  });
});

describe("readAutomationFactoryId", () => {
  it("uses the nested resource path when frontmatter was stripped", () => {
    expect(
      readAutomationFactoryId(
        {},
        "---\ndomain: factory\n---\n",
        "jobs/factories/enzo-test-factory-3/factory-slack-feedback.md",
      ),
    ).toBe("enzo-test-factory-3");
  });

  it("uses the path when stale frontmatter names another factory", () => {
    expect(
      readAutomationFactoryId(
        {},
        "---\nfactoryId: product-feedback\n---\n",
        "jobs/factories/enzo-test-factory-3/factory-slack-feedback.md",
      ),
    ).toBe("enzo-test-factory-3");
  });

  it("keeps frontmatter fallback for legacy flat paths", () => {
    expect(
      readAutomationFactoryId(
        {},
        "---\nfactoryId: support-triage\n---\n",
        "jobs/factory-slack-feedback.md",
      ),
    ).toBe("support-triage");
  });
});

describe("factoryAutomationLeafName", () => {
  it("keeps the leaf of a nested Factory trigger name", () => {
    expect(
      factoryAutomationLeafName(
        "factories/enzo-test-factory-3/factory-slack-feedback",
      ),
    ).toBe("factory-slack-feedback");
  });

  it("keeps a flat Factory trigger name", () => {
    expect(factoryAutomationLeafName("factory-slack-feedback")).toBe(
      "factory-slack-feedback",
    );
  });
});

describe("assignCreatedByIfMissing", () => {
  it("leaves an existing createdBy in place", () => {
    const content = "---\ncreatedBy: teammate@example.com\n---\nObserve.\n";
    expect(
      assignCreatedByIfMissing(content, "settings-saver@example.com"),
    ).toBe(content);
  });

  it("stamps createdBy when the field is missing", () => {
    expect(
      assignCreatedByIfMissing(
        "---\ndomain: factory\n---\nObserve.\n",
        "owner@example.com",
      ),
    ).toContain("createdBy: owner@example.com");
  });
});

describe("builderSlackUserIdSchema", () => {
  it("accepts empty, user, and workspace Slack member ids", () => {
    expect(builderSlackUserIdSchema.parse("")).toBe("");
    expect(builderSlackUserIdSchema.parse("U096KN3EL2Y")).toBe("U096KN3EL2Y");
    expect(builderSlackUserIdSchema.parse("W01234567")).toBe("W01234567");
  });

  it("rejects values that later Settings saves would also reject", () => {
    expect(() => builderSlackUserIdSchema.parse("not-a-slack-id")).toThrow(
      /U01234567/,
    );
    expect(() => builderSlackUserIdSchema.parse("U".padEnd(33, "0"))).toThrow();
  });
});

describe("requireExistingFactory", () => {
  it("allows the virtual default Factory without a definition row", async () => {
    const db = { select: vi.fn() };
    await expect(
      requireExistingFactory(db as never, "org-1", "product-feedback"),
    ).resolves.toBeUndefined();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects a missing user-created Factory", async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
    };
    await expect(
      requireExistingFactory(db as never, "org-1", "support-triage"),
    ).rejects.toThrow("Factory not found.");
  });
});
