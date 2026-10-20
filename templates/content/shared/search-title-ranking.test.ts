import { describe, expect, it, vi } from "vitest";

import {
  buildTitleSearchIndex,
  normalizeSearchTitle,
  rankTitlesByQuery,
  TITLE_MATCH_TIER,
  type TitleSearchCandidate,
} from "./search-title-ranking";

function candidate(
  id: string,
  title: string,
  updatedAt = "2026-01-01T00:00:00.000Z",
): TitleSearchCandidate {
  return { id, title, updatedAt };
}

// A wall-clock budget fails on CI, where every core runs a test worker: one
// ranking measured 448ms locally under that load against ~5ms idle. Time the
// ranking against a baseline in the same process instead, with the samples
// interleaved so a slow stretch hits both. Contention and GC only ever add
// time, so each side's fastest sample is its real cost; a median still tripped
// these tests under load. The first samples warm up the JIT for both paths.
function fastestInterleavedMs(measured: () => void, baseline: () => void) {
  let fastestMeasuredMs = Number.POSITIVE_INFINITY;
  let fastestBaselineMs = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < 18; sample += 1) {
    let start = performance.now();
    measured();
    const measuredMs = performance.now() - start;
    start = performance.now();
    baseline();
    const baselineMs = performance.now() - start;
    if (sample < 3) continue;
    fastestMeasuredMs = Math.min(fastestMeasuredMs, measuredMs);
    fastestBaselineMs = Math.min(fastestBaselineMs, baselineMs);
  }
  return { fastestMeasuredMs, fastestBaselineMs };
}

function rankIds(items: TitleSearchCandidate[], query: string) {
  return rankTitlesByQuery(buildTitleSearchIndex(items), query).map(
    (result) => result.candidate.id,
  );
}

describe("normalizeSearchTitle", () => {
  it("lowercases, trims, and collapses whitespace across scripts", () => {
    expect(normalizeSearchTitle("  Stellar   Road  ")).toBe("stellar road");
    expect(normalizeSearchTitle("CAFÉ Menu")).toBe("café menu");
    expect(normalizeSearchTitle("東京 メモ")).toBe("東京 メモ");
  });
});

describe("rankTitlesByQuery tiers", () => {
  const items = [
    candidate("exact", "Road"),
    candidate("prefix", "Roadmap"),
    candidate("word-prefix", "Stellar Road"),
    candidate("substring", "Crossroad"),
  ];

  it("orders exact, prefix, word-prefix, and substring titles from best to worst", () => {
    expect(rankIds(items, "road")).toEqual([
      "exact",
      "prefix",
      "word-prefix",
      "substring",
    ]);
  });

  it("assigns the documented tier numbers", () => {
    const ranked = rankTitlesByQuery(buildTitleSearchIndex(items), "road");
    const tierById = new Map(ranked.map((r) => [r.candidate.id, r.tier]));
    expect(tierById.get("exact")).toBe(TITLE_MATCH_TIER.exact);
    expect(tierById.get("prefix")).toBe(TITLE_MATCH_TIER.prefix);
    expect(tierById.get("word-prefix")).toBe(TITLE_MATCH_TIER.wordPrefix);
    expect(tierById.get("substring")).toBe(TITLE_MATCH_TIER.substring);
  });

  it("excludes titles that do not match at all and are too short to fuzzy match", () => {
    expect(rankIds([candidate("no-match", "Unrelated title")], "road")).toEqual(
      [],
    );
    expect(rankIds([candidate("short", "Roadmap")], "od")).toEqual([]);
  });
});

describe("rankTitlesByQuery operators", () => {
  it("excludes titles matching a negated term", () => {
    const items = [
      candidate("keep", "Launch plan"),
      candidate("drop", "Launch plan draft"),
    ];
    expect(rankIds(items, "launch -draft")).toEqual(["keep"]);
  });

  it("matches OR groups when either term is present", () => {
    const items = [
      candidate("has-draft", "Draft notes"),
      candidate("has-memo", "Memo notes"),
      candidate("neither", "Other notes"),
    ];
    expect(rankIds(items, "draft OR memo").sort()).toEqual([
      "has-draft",
      "has-memo",
    ]);
  });

  it("treats a quoted phrase as a contiguous substring", () => {
    const items = [
      candidate("contiguous", "Status hub report"),
      candidate("scattered", "Status report with hub"),
    ];
    expect(rankIds(items, '"status hub"')).toEqual(["contiguous"]);
  });

  it("requires every AND term to appear in the title", () => {
    const items = [
      candidate("both", "Stellar Road Notes"),
      candidate("one", "Stellar Notes"),
    ];
    expect(rankIds(items, "stellar road")).toEqual(["both"]);
  });
});

describe("rankTitlesByQuery fuzzy tier", () => {
  it("forgives a small typo in one word for queries of 4+ characters", () => {
    const items = [candidate("target", "Priorities")];
    const ranked = rankTitlesByQuery(buildTitleSearchIndex(items), "prorities");
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.tier).toBe(TITLE_MATCH_TIER.fuzzy);
  });

  it("forgives a typo while the word is still being typed", () => {
    expect(rankIds([candidate("target", "Roadmap review")], "raodm")).toEqual([
      "target",
    ]);
  });

  it("does not fuzzy match below the 4-character floor", () => {
    const items = [candidate("target", "Roadmap")];
    expect(rankIds(items, "od")).toEqual([]);
    expect(rankIds(items, "rdm")).toEqual([]);
  });

  it("does not treat scattered letters across a title as a typo", () => {
    const items = [candidate("noise", "tango delta notes 175")];
    expect(rankIds(items, "task")).toEqual([]);
    expect(rankIds(items, "tas")).toEqual([]);
  });

  it("does not fuzzy match a phrase, OR-group, or multi-term query", () => {
    const items = [candidate("scattered", "Status report with hub")];
    expect(rankIds(items, '"status hub"')).toEqual([]);
    expect(rankIds(items, "sttus OR hb")).toEqual([]);
    expect(rankIds(items, "sttus hb")).toEqual([]);
  });

  it("prefers a closer typo match over a looser one", () => {
    const items = [
      candidate("looser", "Task Priorities"),
      candidate("closer", "Priority list"),
    ];
    const ranked = rankTitlesByQuery(buildTitleSearchIndex(items), "prioirty");
    expect(ranked.every((r) => r.tier === TITLE_MATCH_TIER.fuzzy)).toBe(true);
    expect(ranked[0]!.candidate.id).toBe("closer");
  });

  it("prefers any exact/prefix/word/substring match over a fuzzy one", () => {
    const items = [
      candidate("fuzzy-only", "Prorities draft"),
      candidate("exact-ish", "Priorities"),
    ];
    const ranked = rankTitlesByQuery(
      buildTitleSearchIndex(items),
      "priorities",
    );
    expect(ranked[0]!.candidate.id).toBe("exact-ish");
  });
});

describe("rankTitlesByQuery tie-breaks", () => {
  it("breaks ties by updatedAt descending, then id ascending — matching the server's own order exactly, with no recency boost", () => {
    const items = [
      candidate("b-newer", "Roadmap", "2026-01-02T00:00:00.000Z"),
      candidate("a-older", "Roadmap", "2026-01-01T00:00:00.000Z"),
      candidate("c-older-tie", "Roadmap", "2026-01-01T00:00:00.000Z"),
    ];
    expect(rankIds(items, "roadmap")).toEqual([
      "b-newer",
      "a-older",
      "c-older-tie",
    ]);
  });
});

describe("rankTitlesByQuery performance", () => {
  it("ranks 10,000 titles through the typo tier within twice a rebuild", () => {
    const items: TitleSearchCandidate[] = Array.from(
      { length: 10_000 },
      (_, index) =>
        candidate(
          `doc-${index}`,
          `Quarterly planning notes ${index}`,
          new Date(2026, 0, 1, 0, 0, index).toISOString(),
        ),
    );
    const index = buildTitleSearchIndex(items);
    const ranked = rankTitlesByQuery(index, "plnaning");
    expect(ranked.length).toBe(10_000);
    expect(ranked[0]!.tier).toBe(TITLE_MATCH_TIER.fuzzy);

    const { fastestMeasuredMs, fastestBaselineMs } = fastestInterleavedMs(
      () => rankTitlesByQuery(index, "plnaning"),
      () => buildTitleSearchIndex(items),
    );
    // Every title reaches the edit-distance pass here, at about half a rebuild
    // idle and up to 1.2x under load, so the margin is wider than the
    // shared-tier test's. Twice a rebuild still means a several-fold slowdown.
    expect(fastestMeasuredMs).toBeLessThan(fastestBaselineMs * 2);
  });

  it("does no per-title normalizing or word splitting while ranking", () => {
    // Timing can't separate this regression from runner load on the typo
    // tier, so count the work instead: ranking a prebuilt index may normalize
    // and split the query, but never once per title.
    function stringWorkWhileRanking(count: number, query: string) {
      const index = buildTitleSearchIndex(
        Array.from({ length: count }, (_, i) =>
          candidate(`doc-${i}`, `Quarterly planning roadmap ${i}`),
        ),
      );
      const normalize = vi.spyOn(String.prototype, "normalize");
      const split = vi.spyOn(String.prototype, "split");
      try {
        rankTitlesByQuery(index, query);
        return normalize.mock.calls.length + split.mock.calls.length;
      } finally {
        normalize.mockRestore();
        split.mockRestore();
      }
    }
    for (const query of ["road", "plnaning"]) {
      expect(stringWorkWhileRanking(1_000, query)).toBe(
        stringWorkWhileRanking(1, query),
      );
    }
  });

  it("skips typo matching when shared-tier matches already fill the limit", () => {
    const items = [
      ...Array.from({ length: 25 }, (_, index) =>
        candidate(`road-${index}`, `Road notes ${index}`),
      ),
      candidate("typo-only", "Raod trip"),
    ];
    const index = buildTitleSearchIndex(items);
    expect(
      rankTitlesByQuery(index, "road", { limit: 20 }).some(
        (result) => result.candidate.id === "typo-only",
      ),
    ).toBe(false);
    expect(
      rankTitlesByQuery(index, "road").some(
        (result) => result.candidate.id === "typo-only",
      ),
    ).toBe(true);
  });

  it("ranks 10,000 titles in less time than renormalizing them", () => {
    const titles = [
      "Task Priorities",
      "Quarterly Roadmap",
      "Engineering Notes",
      "Design Review",
      "Stellar Road Handbook",
    ];
    const items: TitleSearchCandidate[] = Array.from(
      { length: 10_000 },
      (_, index) =>
        candidate(
          `doc-${index}`,
          `${titles[index % titles.length]} ${index}`,
          new Date(2026, 0, 1, 0, 0, index).toISOString(),
        ),
    );
    const index = buildTitleSearchIndex(items);
    expect(rankTitlesByQuery(index, "road").length).toBeGreaterThan(0);

    const { fastestMeasuredMs, fastestBaselineMs } = fastestInterleavedMs(
      () => rankTitlesByQuery(index, "road"),
      () => buildTitleSearchIndex(items),
    );
    // Ranking runs on every keystroke against a prebuilt index, at about a
    // third of a rebuild. Costing more than one renormalizing pass means
    // per-keystroke work has grown several-fold.
    expect(fastestMeasuredMs).toBeLessThan(fastestBaselineMs);
  });
});
