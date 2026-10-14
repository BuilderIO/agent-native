import { describe, expect, it } from "vitest";

import { parseSourceIndexBundle } from "./source-index-schema";
import {
  mergeSourceIndexBundles,
  SOURCE_INDEX_STALE_AFTER_DAYS,
  sourceIndexDictionaryEntries,
  sourceIndexFreshness,
} from "./source-index-store";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("sourceIndexFreshness", () => {
  it("marks a revision-stamped index stale after the refresh window", () => {
    const now = Date.parse("2026-10-09T12:00:00.000Z");

    expect(
      sourceIndexFreshness(
        new Date(now - SOURCE_INDEX_STALE_AFTER_DAYS * DAY_MS).toISOString(),
        now,
      ),
    ).toEqual({ ageDays: 90, staleAfterDays: 90, stale: true });
  });

  it("does not call a newer index stale or report a future timestamp as negative age", () => {
    const now = Date.parse("2026-10-09T12:00:00.000Z");

    expect(
      sourceIndexFreshness(new Date(now - 89 * DAY_MS).toISOString(), now),
    ).toEqual({ ageDays: 89, staleAfterDays: 90, stale: false });
    expect(
      sourceIndexFreshness(new Date(now + DAY_MS).toISOString(), now),
    ).toEqual({ ageDays: 0, staleAfterDays: 90, stale: false });
  });

  it("rejects an invalid generated timestamp instead of reporting fresh", () => {
    expect(() => sourceIndexFreshness("invalid", Date.now())).toThrow(
      "source index timestamp is invalid",
    );
  });
});

describe("parseSourceIndexBundle scan summary compatibility", () => {
  it("leaves unresolved call-site counts unavailable for earlier summaries", () => {
    const bundle = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-09T12:00:00.000Z",
      sources: [{ id: "dbt", revision: "abcdef123456" }],
      entries: [
        {
          id: "model-users",
          metric: "model:users",
          definition: "User profile records.",
          source: "dbt",
        },
      ],
      scanSummary: {
        unsafeEntriesOmitted: 1,
        unsafeFieldsOmitted: 2,
        truncatedFields: 3,
      },
    });

    expect(bundle.scanSummary?.unresolvedTrackingCallSites).toBeUndefined();
  });

  it("rejects duplicate source IDs before a merge can remove another source", () => {
    expect(() =>
      parseSourceIndexBundle({
        schemaVersion: 1,
        generatedAt: "2026-10-09T12:00:00.000Z",
        sources: [
          { id: "shared", sourceKind: "dbt", revision: "abcdef123456" },
          { id: "shared", sourceKind: "code", revision: "abcdef654321" },
        ],
        entries: [
          {
            id: "dbt-model",
            metric: "model:users",
            definition: "User profile records.",
            source: "shared",
            sourceKind: "dbt",
          },
          {
            id: "code-event",
            metric: "event:signup",
            definition: "Signup tracking call.",
            source: "shared",
            sourceKind: "code",
          },
        ],
      }),
    ).toThrow("duplicate source index source ID");
  });

  it("rejects orphan entries and source-kind mismatches", () => {
    const base = {
      schemaVersion: 1,
      generatedAt: "2026-10-09T12:00:00.000Z",
      sources: [
        { id: "tracking-code", sourceKind: "code", revision: "abcdef123456" },
      ],
      entries: [
        {
          id: "signup-event",
          metric: "event:signup",
          definition: "Signup tracking call.",
          source: "tracking-code",
          sourceKind: "code",
        },
      ],
    };

    expect(() =>
      parseSourceIndexBundle({
        ...base,
        entries: [{ ...base.entries[0], source: "missing-source" }],
      }),
    ).toThrow("must reference a declared source");
    expect(() =>
      parseSourceIndexBundle({
        ...base,
        entries: [{ ...base.entries[0], sourceKind: "dbt" }],
      }),
    ).toThrow("must match the declared source kind");
  });

  it("requires inferred membership roles to name projected membership keys", () => {
    expect(() =>
      parseSourceIndexBundle({
        schemaVersion: 1,
        generatedAt: "2026-10-09T12:00:00.000Z",
        sources: [{ id: "dbt", revision: "abcdef123456" }],
        entries: [
          {
            id: "model-aliased-members",
            metric: "model:aliased_members",
            definition: "Parser-inferred membership keys.",
            source: "dbt",
            sourceKind: "dbt",
            table: "aliased_members",
            sqlProjectedColumns: "member_key, workspace_key",
            inferredMembershipKeys: ["member_key", "workspace_key"],
            inferredMembershipKeyRoles: {
              user: "user_id",
              organization: "organization_id",
            },
          },
        ],
      }),
    ).toThrow("membership identity columns must be present");
  });
});

describe("sourceIndexDictionaryEntries", () => {
  it("leaves unknown scope unset so search can infer it from the source", () => {
    const bundle = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-09T12:00:00.000Z",
      sources: [{ id: "dbt", revision: "abcdef123456" }],
      entries: [
        {
          id: "model-users",
          metric: "model:users",
          definition: "User profile records.",
          source: "dbt",
          sourceKind: "dbt",
          semanticScope: "unknown",
          table: "users",
          sqlProjectedColumns: "user_id, organization_id",
          inferredMembershipKeys: ["user_id", "organization_id"],
          inferredMembershipKeyRoles: {
            user: "user_id",
            organization: "organization_id",
          },
        },
      ],
    });

    expect(sourceIndexDictionaryEntries(bundle)[0]).not.toHaveProperty(
      "semanticScope",
    );
    expect(sourceIndexDictionaryEntries(bundle)[0]).toMatchObject({
      sqlProjectedColumns: "user_id, organization_id",
      inferredMembershipKeys: ["user_id", "organization_id"],
      inferredMembershipKeyRoles: {
        user: "user_id",
        organization: "organization_id",
      },
    });
  });

  it("defaults index entries to active and preserves deprecated status", () => {
    const bundle = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-09T12:00:00.000Z",
      sources: [{ id: "dbt", revision: "abcdef123456" }],
      entries: [
        {
          id: "model-active",
          metric: "model:active",
          definition: "Active model.",
          source: "dbt",
        },
        {
          id: "model-deprecated",
          metric: "model:deprecated",
          definition: "Deprecated model.",
          source: "dbt",
          status: "deprecated",
        },
      ],
    });

    expect(
      sourceIndexDictionaryEntries(bundle).map((entry) => ({
        id: entry.id,
        status: entry.status,
        approved: entry.approved,
      })),
    ).toEqual([
      { id: "index-model-active", status: "active", approved: false },
      {
        id: "index-model-deprecated",
        status: "deprecated",
        approved: false,
      },
    ]);
  });

  it("stamps generated entries with the index freshness used for retrieval", () => {
    const bundle = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-07-01T00:00:00.000Z",
      sources: [{ id: "dbt", revision: "abcdef123456" }],
      entries: [
        {
          id: "workspace-members",
          metric: "Workspace members",
          definition: "One row per workspace member.",
          source: "dbt",
        },
      ],
    });

    expect(
      sourceIndexDictionaryEntries(bundle, {
        ageDays: 104,
        staleAfterDays: 90,
        stale: true,
      })[0],
    ).toMatchObject({
      sourceIndexAgeDays: 104,
      sourceIndexStaleAfterDays: 90,
      sourceIndexStale: true,
      approved: false,
    });
  });

  it("keeps each source's freshness separate in a merged index", () => {
    const now = Date.parse("2026-10-13T00:00:00.000Z");
    const bundle = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-12T00:00:00.000Z",
      sources: [
        {
          id: "dbt",
          revision: "abcdef123456",
          generatedAt: "2026-10-12T00:00:00.000Z",
        },
        {
          id: "tracking-code",
          revision: "fedcba654321",
          generatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      entries: [
        {
          id: "active-users",
          metric: "active users",
          definition: "Current dbt definition.",
          source: "dbt",
        },
        {
          id: "signup-event",
          metric: "signup event",
          definition: "Older tracking definition.",
          source: "tracking-code",
        },
      ],
    });

    expect(sourceIndexDictionaryEntries(bundle, undefined, now)).toMatchObject([
      {
        sourceIndexGeneratedAt: "2026-10-12T00:00:00.000Z",
        sourceIndexStale: false,
      },
      {
        sourceIndexGeneratedAt: "2026-01-01T00:00:00.000Z",
        sourceIndexStale: true,
      },
    ]);
  });
});

describe("mergeSourceIndexBundles", () => {
  it("replaces matching sources while preserving other sources and entries", () => {
    const current = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-01T00:00:00.000Z",
      sources: [
        {
          id: "dbt",
          sourceKind: "dbt",
          revision: "111111111111",
          generatedAt: "2026-10-01T00:00:00.000Z",
        },
        { id: "tracking-code", sourceKind: "code", revision: "222222222222" },
        {
          id: "sigma",
          sourceKind: "sigma",
          contentFingerprint: "a".repeat(64),
        },
      ],
      entries: [
        {
          id: "old-users",
          metric: "old users",
          definition: "Old dbt source content.",
          source: "dbt",
          sourceKind: "dbt",
        },
        {
          id: "signup-event",
          metric: "signup event",
          definition: "Tracking event from code.",
          source: "tracking-code",
        },
        {
          id: "dashboard-example",
          metric: "dashboard example",
          definition: "Reviewed Sigma example.",
          source: "sigma",
        },
      ],
      scanSummary: {
        unsafeEntriesOmitted: 3,
        unsafeFieldsOmitted: 4,
        truncatedFields: 5,
      },
    });
    const update = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-12T00:00:00.000Z",
      sources: [{ id: "dbt", sourceKind: "dbt", revision: "333333333333" }],
      entries: [
        {
          id: "new-users",
          metric: "new users",
          definition: "Updated dbt source content.",
          source: "dbt",
          sourceKind: "dbt",
        },
      ],
      scanSummary: {
        unsafeEntriesOmitted: 6,
        unsafeFieldsOmitted: 7,
        truncatedFields: 8,
      },
    });

    const merged = mergeSourceIndexBundles(current, update);

    expect(merged).toMatchObject({
      generatedAt: "2026-10-12T00:00:00.000Z",
      sources: [
        { id: "tracking-code", generatedAt: current.generatedAt },
        { id: "sigma", generatedAt: current.generatedAt },
        {
          id: "dbt",
          revision: "333333333333",
          generatedAt: update.generatedAt,
        },
      ],
      entries: [
        { id: "signup-event", source: "tracking-code" },
        { id: "dashboard-example", source: "sigma" },
        { id: "new-users", source: "dbt" },
      ],
    });
    expect(merged.entries).not.toContainEqual(
      expect.objectContaining({ id: "old-users" }),
    );
    expect(merged).not.toHaveProperty("scanSummary");
  });

  it("keeps colliding entry IDs unique across preserved sources", () => {
    const current = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-01T00:00:00.000Z",
      sources: [
        { id: "tracking-code", sourceKind: "code", revision: "222222222222" },
      ],
      entries: [
        {
          id: "users",
          metric: "users from code",
          definition: "Existing event source.",
          source: "tracking-code",
          sourceKind: "code",
        },
      ],
    });
    const update = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-12T00:00:00.000Z",
      sources: [{ id: "dbt", sourceKind: "dbt", revision: "333333333333" }],
      entries: [
        {
          id: "users",
          metric: "users from dbt",
          definition: "New dbt model.",
          source: "dbt",
          sourceKind: "dbt",
        },
      ],
    });

    const merged = mergeSourceIndexBundles(current, update);
    expect(merged.entries).toHaveLength(2);
    expect(new Set(merged.entries.map((entry) => entry.id)).size).toBe(2);
    expect(merged.entries).toContainEqual(
      expect.objectContaining({
        id: "users",
        source: "tracking-code",
        definition: "Existing event source.",
      }),
    );
    expect(merged.entries).toContainEqual(
      expect.objectContaining({
        source: "dbt",
        definition: "New dbt model.",
      }),
    );
  });

  it("preserves a previous dbt repository when a configured repo changes", () => {
    const current = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-09-01T00:00:00.000Z",
      sources: [
        {
          id: "analytics-dbt",
          sourceKind: "dbt",
          repositoryRef: "old-org/analytics-dbt",
          revision: "111111111111",
          generatedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      entries: [
        {
          id: "active-users",
          metric: "active users",
          definition: "Definition from the previous repository.",
          source: "analytics-dbt",
          sourceKind: "dbt",
        },
      ],
    });
    const update = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-12T00:00:00.000Z",
      sources: [
        {
          id: "analytics-dbt",
          sourceKind: "dbt",
          repositoryRef: "new-org/analytics-dbt",
          revision: "222222222222",
          generatedAt: "2026-10-12T00:00:00.000Z",
        },
      ],
      entries: [
        {
          id: "active-users",
          metric: "active users",
          definition: "Definition from the current repository.",
          source: "analytics-dbt",
          sourceKind: "dbt",
        },
      ],
    });

    const firstMerge = mergeSourceIndexBundles(current, update);
    const currentRepository = firstMerge.sources.find(
      (source) => source.repositoryRef === "new-org/analytics-dbt",
    );
    expect(currentRepository).toBeDefined();
    expect(currentRepository?.id).not.toBe("analytics-dbt");
    expect(firstMerge.sources).toHaveLength(2);
    expect(firstMerge.entries).toHaveLength(2);
    expect(firstMerge.entries).toContainEqual(
      expect.objectContaining({
        id: "active-users",
        source: "analytics-dbt",
        definition: "Definition from the previous repository.",
        status: "deprecated",
      }),
    );
    expect(firstMerge.entries).toContainEqual(
      expect.objectContaining({
        source: currentRepository?.id,
        definition: "Definition from the current repository.",
      }),
    );

    const refreshed = mergeSourceIndexBundles(firstMerge, update);
    expect(refreshed.sources).toHaveLength(2);
    expect(refreshed.entries).toHaveLength(2);
    expect(
      refreshed.sources.filter(
        (source) => source.repositoryRef === "new-org/analytics-dbt",
      ),
    ).toHaveLength(1);
  });

  it("keeps renamed-repository entries but marks the previous source deprecated", () => {
    const current = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-09-01T00:00:00.000Z",
      sources: [
        {
          id: "old-analytics-dbt",
          sourceKind: "dbt",
          repositoryRef: "acme/old-analytics-dbt",
          revision: "111111111111",
        },
        {
          id: "builder-internal",
          sourceKind: "code",
          revision: "222222222222",
        },
      ],
      entries: [
        {
          id: "old-users",
          metric: "model:users",
          definition: "Previous dbt repository definition.",
          source: "old-analytics-dbt",
          sourceKind: "dbt",
        },
        {
          id: "signup-event",
          metric: "event:signup",
          definition: "Tracking event from code.",
          source: "builder-internal",
          sourceKind: "code",
        },
      ],
    });
    const update = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-12T00:00:00.000Z",
      sources: [
        {
          id: "analytics-dbt",
          sourceKind: "dbt",
          repositoryRef: "acme/analytics-dbt",
          revision: "333333333333",
        },
      ],
      entries: [
        {
          id: "new-users",
          metric: "model:users",
          definition: "Current dbt repository definition.",
          source: "analytics-dbt",
          sourceKind: "dbt",
        },
      ],
    });

    const merged = mergeSourceIndexBundles(current, update);

    expect(merged.entries).toContainEqual(
      expect.objectContaining({
        id: "old-users",
        source: "old-analytics-dbt",
        status: "deprecated",
        definition: "Previous dbt repository definition.",
      }),
    );
    expect(merged.entries).toContainEqual(
      expect.objectContaining({
        id: "signup-event",
        source: "builder-internal",
        definition: "Tracking event from code.",
      }),
    );
    expect(merged.entries).toContainEqual(
      expect.objectContaining({
        id: "new-users",
        source: "analytics-dbt",
        status: "active",
      }),
    );
  });

  it("does not replace a source ID that belongs to another source type", () => {
    const current = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-01T00:00:00.000Z",
      sources: [{ id: "dbt", sourceKind: "code", revision: "222222222222" }],
      entries: [
        {
          id: "users-event",
          metric: "users event",
          definition: "Tracking code source with a colliding ID.",
          source: "dbt",
          sourceKind: "code",
        },
      ],
    });
    const update = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-12T00:00:00.000Z",
      sources: [{ id: "dbt", sourceKind: "dbt", revision: "333333333333" }],
      entries: [
        {
          id: "users-model",
          metric: "users model",
          definition: "New dbt model.",
          source: "dbt",
          sourceKind: "dbt",
        },
      ],
    });

    expect(() => mergeSourceIndexBundles(current, update)).toThrow(
      "conflicting or unknown source types",
    );
  });

  it("does not reuse a repository-qualified ID owned by another source type", () => {
    const current = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-01T00:00:00.000Z",
      sources: [
        {
          id: "analytics-dbt",
          sourceKind: "dbt",
          repositoryRef: "old-org/analytics-dbt",
          revision: "111111111111",
        },
        {
          id: "analytics-dbt-new-org-analytics-dbt-2b503b89",
          sourceKind: "code",
          repositoryRef: "new-org/analytics-dbt",
          revision: "222222222222",
        },
      ],
      entries: [
        {
          id: "old-dbt-entry",
          metric: "model:users",
          definition: "Previous dbt source definition.",
          source: "analytics-dbt",
          sourceKind: "dbt",
        },
        {
          id: "code-entry",
          metric: "event:signup",
          definition: "Tracking source definition.",
          source: "analytics-dbt-new-org-analytics-dbt-2b503b89",
          sourceKind: "code",
        },
      ],
    });
    const update = parseSourceIndexBundle({
      schemaVersion: 1,
      generatedAt: "2026-10-12T00:00:00.000Z",
      sources: [
        {
          id: "analytics-dbt",
          sourceKind: "dbt",
          repositoryRef: "new-org/analytics-dbt",
          revision: "333333333333",
        },
      ],
      entries: [
        {
          id: "new-dbt-entry",
          metric: "model:users",
          definition: "Current dbt source definition.",
          source: "analytics-dbt",
          sourceKind: "dbt",
        },
      ],
    });

    expect(() => mergeSourceIndexBundles(current, update)).toThrow(
      "already assigned to another repository",
    );
  });
});
