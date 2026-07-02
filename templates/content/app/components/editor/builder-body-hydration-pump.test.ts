import type { ContentDatabaseSource } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  builderBodyHydrationPumpKey,
  shouldPumpBuilderBodyHydration,
} from "./builder-body-hydration-pump";

function source(
  overrides: Partial<ContentDatabaseSource> = {},
): ContentDatabaseSource {
  const base: ContentDatabaseSource = {
    id: "builder-source",
    databaseId: "database",
    sourceType: "builder-cms",
    sourceName: "Blog",
    sourceTable: "blog-article",
    syncState: "idle",
    freshness: "fresh",
    lastRefreshedAt: null,
    lastSourceUpdatedAt: null,
    lastError: null,
    capabilities: {
      canRefresh: true,
      canCreateChangeSets: false,
      canWriteFields: false,
      canWriteBody: false,
      canPush: false,
      canPull: false,
      canPublish: false,
      canDelete: false,
      canStageLocalRevision: false,
      liveWritesEnabled: false,
      readOnlyRefresh: true,
    },
    metadata: {
      primaryKey: "id",
      titleField: "data.title",
      lastReadHasMore: false,
      sourceFetchState: "idle",
    },
    fields: [],
    rows: [],
    changeSets: [],
    bodyHydration: {
      pending: 457,
      hydrating: 0,
      hydrated: 40,
      error: 0,
      total: 497,
    },
  };
  return { ...base, ...overrides } as ContentDatabaseSource;
}

describe("Builder body hydration pump", () => {
  it("pumps active Builder body work after row continuation is complete", () => {
    expect(shouldPumpBuilderBodyHydration(source(), false, null)).toBe(true);
  });

  it("does not pump while rows are still continuing or a pump is pending", () => {
    expect(
      shouldPumpBuilderBodyHydration(
        source({ metadata: { ...source().metadata, lastReadHasMore: true } }),
        false,
        null,
      ),
    ).toBe(false);
    expect(shouldPumpBuilderBodyHydration(source(), true, null)).toBe(false);
  });

  it("uses the hydration counts as the backoff key", () => {
    const builderSource = source();
    const key = builderBodyHydrationPumpKey(builderSource);

    expect(key).toBe("builder-source:457:0:40:0:497");
    expect(shouldPumpBuilderBodyHydration(builderSource, false, key)).toBe(
      false,
    );
  });

  it("stops when no queued or hydrating bodies remain", () => {
    expect(
      shouldPumpBuilderBodyHydration(
        source({
          bodyHydration: {
            pending: 0,
            hydrating: 0,
            hydrated: 490,
            error: 7,
            total: 497,
          },
        }),
        false,
        null,
      ),
    ).toBe(false);
  });
});
