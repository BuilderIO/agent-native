import { describe, expect, it, vi } from "vitest";

import {
  assertUniqueSlackChannelForFactory,
  builderSlackUserIdSchema,
  factoryAutomationLeafName,
  factoryConfigRowId,
  readAutomationFactoryId,
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
