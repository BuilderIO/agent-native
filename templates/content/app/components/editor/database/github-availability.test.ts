import type { ContentDatabaseSource } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  githubAvailability,
  githubBlockedExplanation,
  githubOffersNewCollection,
  githubRowDescription,
  type GitHubCollectionPlace,
} from "./github-availability";

const NOW = Date.parse("2026-10-20T12:00:00Z");

const emptyCollection: GitHubCollectionPlace = {
  databaseId: "database-1",
  documentId: "doc-1",
  spaceId: "space-1",
  parentId: null,
  systemRole: null,
  pageCount: 0,
  canEdit: true,
};

function source(
  sourceType: string,
  overrides: Partial<ContentDatabaseSource> = {},
): ContentDatabaseSource {
  return {
    id: `${sourceType}-1`,
    databaseId: "database-1",
    sourceType,
    sourceName: "Team wiki",
    metadata: {},
    ...overrides,
  } as unknown as ContentDatabaseSource;
}

const github = source("github", {
  sourceName: "acme/handbook/docs",
  metadata: {
    github: {
      owner: "acme",
      repo: "handbook",
      branch: "main",
      path: "docs",
      syncedAt: new Date(NOW - 5 * 60_000).toISOString(),
    },
  } as unknown as ContentDatabaseSource["metadata"],
});

describe("Whether a collection can take a GitHub folder", () => {
  it("is available on an empty collection someone can edit", () => {
    expect(githubAvailability(emptyCollection, [], true)).toEqual({
      kind: "available",
    });
    expect(githubAvailability(emptyCollection, [], undefined)).toEqual({
      kind: "available",
    });
    expect(githubAvailability(emptyCollection, [], null)).toEqual({
      kind: "available",
    });
  });

  it("asks for the connection only once GitHub says there isn't one", () => {
    expect(githubAvailability(emptyCollection, [], false)).toEqual({
      kind: "connect",
    });
  });

  it("checks the collection before the connection", () => {
    expect(
      githubAvailability({ ...emptyCollection, pageCount: 2 }, [], false),
    ).toEqual({ kind: "blocked", reason: "has-pages" });
  });

  it.each([
    [{ systemRole: "files" }, "files"],
    [{ systemRole: "workspaces" }, "system"],
    [{ canEdit: false }, "editors-only"],
    [{ pageCount: 1 }, "has-pages"],
  ] as const)("is blocked for %o", (overrides, reason) => {
    expect(
      githubAvailability({ ...emptyCollection, ...overrides }, [], true),
    ).toEqual({ kind: "blocked", reason });
  });

  it("names the app a collection already gets its pages from", () => {
    expect(
      githubAvailability(emptyCollection, [source("builder-cms")], true),
    ).toEqual({
      kind: "blocked",
      reason: "other-source",
      sourceName: "Builder",
    });
    expect(
      githubAvailability(emptyCollection, [source("notion-database")], true),
    ).toEqual({
      kind: "blocked",
      reason: "other-source",
      sourceName: "Notion",
    });
    expect(
      githubAvailability(emptyCollection, [source("local-folder")], true),
    ).toEqual({
      kind: "blocked",
      reason: "other-source",
      sourceName: "Team wiki",
    });
  });

  it("reports a linked folder ahead of anything else", () => {
    expect(
      githubAvailability(
        { ...emptyCollection, canEdit: false, pageCount: 12 },
        [github],
        false,
      ),
    ).toEqual({ kind: "linked", source: github });
  });
});

describe("A new collection instead", () => {
  it("is offered when this one is blocked and the space is known", () => {
    const blocked = { kind: "blocked", reason: "has-pages" } as const;
    expect(githubOffersNewCollection(blocked, emptyCollection)).toBe(true);
    expect(
      githubOffersNewCollection(blocked, {
        ...emptyCollection,
        spaceId: undefined,
      }),
    ).toBe(false);
  });

  it("isn't offered to readers or to collections that can link", () => {
    expect(
      githubOffersNewCollection(
        { kind: "blocked", reason: "editors-only" },
        emptyCollection,
      ),
    ).toBe(false);
    expect(
      githubOffersNewCollection({ kind: "available" }, emptyCollection),
    ).toBe(false);
  });
});

describe("What the GitHub row and step say", () => {
  it("says when a linked folder last updated", () => {
    expect(githubRowDescription({ kind: "linked", source: github }, NOW)).toBe(
      "docs folder · Updated 5 minutes ago",
    );
    const neverSynced = source("github", {
      metadata: {
        github: { owner: "acme", repo: "handbook", branch: "main", path: "" },
      } as unknown as ContentDatabaseSource["metadata"],
    });
    expect(
      githubRowDescription({ kind: "linked", source: neverSynced }, NOW),
    ).toBe("handbook folder · Not updated yet");
  });

  it("explains a collection with pages in the singular and plural", () => {
    expect(
      githubBlockedExplanation("has-pages", {
        ...emptyCollection,
        pageCount: 1,
      }),
    ).toBe(
      "A GitHub folder fills a whole collection, so it needs one with no pages. This one has 1 page.",
    );
    expect(
      githubBlockedExplanation("has-pages", {
        ...emptyCollection,
        pageCount: 1200,
      }),
    ).toContain("This one has 1200 pages.");
  });

  it("names the other source in its explanation", () => {
    expect(
      githubBlockedExplanation("other-source", emptyCollection, "Notion"),
    ).toBe("A collection gets its pages from one place. This one uses Notion.");
  });
});
