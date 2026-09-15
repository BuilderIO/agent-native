import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { defaultEmbeddingFamily } from "../embeddings/providers.js";
import { creativeContextMediaUrl } from "../media-url.js";
import {
  contextItems,
  contextPackMembers,
  embeddings,
} from "../schema/index.js";
import { creativeContextMigrations } from "../schema/migrations.js";
import { assertImmutableContextVersion } from "./content.js";
import { assertGenerationCreativeContextInvariants } from "./generation.js";
import { assertImmutablePackMembership } from "./packs.js";

describe("creative context durable invariants", () => {
  it("pins pack evidence and derivation edges to exact immutable versions", () => {
    expect(() => assertImmutableContextVersion("update")).toThrow(
      /must create a new version/,
    );
    expect(() => assertImmutablePackMembership("remove")).toThrow(
      /derive a new pack snapshot/,
    );
    const memberColumns = getTableColumns(contextPackMembers);
    expect(memberColumns.itemVersionId.notNull).toBe(true);
    expect(memberColumns.score).toBeDefined();
    expect(memberColumns.scoreMetadata).toBeDefined();
  });

  it("keeps inventory, curation, and vector identity first-class", () => {
    const itemColumns = getTableColumns(contextItems);
    expect(itemColumns.currentVersionId.notNull).toBe(true);
    expect(itemColumns.curationRank).toBeDefined();
    expect(itemColumns.colors).toBeDefined();
    const embeddingColumns = getTableColumns(embeddings);
    expect(embeddingColumns.family.notNull).toBe(true);
    expect(embeddingColumns.model.notNull).toBe(true);
    expect(embeddingColumns.version.notNull).toBe(true);
    expect(embeddingColumns.targetType.notNull).toBe(true);
    expect(embeddingColumns.targetId.notNull).toBe(true);
  });

  it("ships additive unique and access hot-path indexes", () => {
    const sql = creativeContextMigrations
      .map((migration) => migration.sql)
      .join("\n");
    expect(sql).toContain("creative_context_versions_item_number_uidx");
    expect(sql).toContain("creative_context_pack_members_pack_item_uidx");
    expect(sql).toContain("creative_context_source_shares_lookup_idx");
    expect(sql).toContain("creative_context_jobs_status_lease_idx");
  });

  it("never silently chooses among multiple embedding families", () => {
    const family = (id: string) => ({
      id,
      provider: id,
      model: id,
      version: "1",
      dimensions: 3,
      embed: async () => [[0, 0, 0]],
    });
    expect(defaultEmbeddingFamily([family("only")])?.id).toBe("only");
    expect(defaultEmbeddingFamily([family("a"), family("b")])).toBeNull();
  });

  it("builds access-scoped media URLs from ids, never blob handles", () => {
    const url = creativeContextMediaUrl({ mediaId: "ccm_private" });
    expect(url).toBe(
      "/_agent-native/creative-context/media?mediaId=ccm_private",
    );
    expect(url).not.toContain("creative-context-blob");
  });

  it("enforces opt-out and pack invariants at the generation storage boundary", () => {
    const generated = {
      elementId: "slide-1",
      influence: "generated" as const,
    };
    expect(() =>
      assertGenerationCreativeContextInvariants({
        contextMode: "off",
        contextPackId: null,
        reuseLabels: [],
        elementProvenance: [generated],
      }),
    ).not.toThrow();
    expect(() =>
      assertGenerationCreativeContextInvariants({
        contextMode: "off",
        contextPackId: "pack-1",
        reuseLabels: [],
        elementProvenance: [generated],
      }),
    ).toThrow(/off records cannot reference a pack/i);
    expect(() =>
      assertGenerationCreativeContextInvariants({
        contextMode: "off",
        contextPackId: null,
        reuseLabels: [],
        elementProvenance: [
          {
            elementId: "slide-1",
            influence: "reference-conditioned",
            itemId: "item-1",
            itemVersionId: "version-1",
          },
        ],
      }),
    ).toThrow(/without a context pack/i);
    expect(() =>
      assertGenerationCreativeContextInvariants({
        contextMode: "pinned",
        contextPackId: null,
        reuseLabels: [],
        elementProvenance: [generated],
      }),
    ).toThrow(/require a context pack/i);
  });
});
