import { describe, expect, it } from "vitest";

import { parseSourceIndexBundle } from "./source-index-schema";
import {
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
        },
      ],
    });

    expect(sourceIndexDictionaryEntries(bundle)[0]).not.toHaveProperty(
      "semanticScope",
    );
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
});
