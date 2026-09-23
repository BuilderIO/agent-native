import { describe, expect, it } from "vitest";

import {
  generateSearchBenchmarkRows,
  SEARCH_BENCHMARK_QUERIES,
  SEARCH_BENCHMARK_SEED,
  type SearchBenchmarkProfile,
  type SearchBenchmarkRow,
} from "./benchmark-search-fixture.js";

const options = {
  fixturePrefix: "synthetic-search-fixture",
  ownerEmail: "search-owner@example.test",
  outsiderEmail: "search-outsider@example.test",
  spaceId: "synthetic-personal-space",
  outsiderSpaceId: "synthetic-outsider-space",
};

function matches(row: SearchBenchmarkRow, query: string): boolean {
  const searchable = `${row.title} ${row.content}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((term) => searchable.includes(term));
}

function assertQueryCounts(
  profile: SearchBenchmarkProfile,
): SearchBenchmarkRow[] {
  const rows = [...generateSearchBenchmarkRows(profile, options)];
  const authorized = rows.filter(
    (row) => row.ownerEmail === options.ownerEmail,
  );
  const outsiders = rows.filter(
    (row) => row.ownerEmail === options.outsiderEmail,
  );

  expect(rows).toHaveLength(12_000);
  expect(new Set(rows.map((row) => row.id)).size).toBe(12_000);
  expect(authorized).toHaveLength(10_000);
  expect(outsiders).toHaveLength(2_000);
  expect(authorized.every((row) => row.spaceId === options.spaceId)).toBe(true);
  expect(
    outsiders.every((row) => row.spaceId === options.outsiderSpaceId),
  ).toBe(true);
  expect(rows.every((row) => row.visibility === "private")).toBe(true);
  expect(authorized[0]!.title).toBe("Task Priorities");
  expect(
    authorized[0]!.updatedAt < authorized[authorized.length - 1]!.updatedAt,
  ).toBe(true);
  expect(
    authorized.slice(1).every((row) => !/task|prio/i.test(row.title)),
  ).toBe(true);

  for (const searchCase of SEARCH_BENCHMARK_QUERIES) {
    const visibleMatches = authorized.filter((row) =>
      matches(row, searchCase.query),
    );
    expect(visibleMatches).toHaveLength(searchCase.expectedTotalItems);
    expect(
      searchCase.expectedFirstTitle === null
        ? visibleMatches.length === 0
        : visibleMatches.some(
            (row) => row.title === searchCase.expectedFirstTitle,
          ),
    ).toBe(true);
  }
  expect(outsiders.every((row) => matches(row, "task prio"))).toBe(true);
  expect(outsiders.every((row) => matches(row, "task"))).toBe(true);
  return rows;
}

describe("search benchmark fixture", () => {
  it("preserves the 10k short-body control and private distractors", () => {
    const rows = assertQueryCounts("A");
    expect(SEARCH_BENCHMARK_SEED).toBe(20260923);
    expect(rows[0]!.content).toBe("Current working projection.");
    expect(rows[1]!.content).toBe(
      `A working note about task assignments. ${"bounded filler ".repeat(30)}The explicit prio marker remains available.`,
    );
    expect(rows[9_999]!.id).toBe("synthetic-search-fixture-a-owner-09999");
    expect(rows[10_000]!.id).toBe("synthetic-search-fixture-a-outsider-00000");
  });

  it("makes the mixed-size body distribution and marker locations exact", () => {
    const rows = assertQueryCounts("B");
    const authorized = rows.slice(0, 10_000);
    const sizes = new Map<number, number>();
    for (const row of authorized) {
      sizes.set(row.content.length, (sizes.get(row.content.length) ?? 0) + 1);
    }
    expect(Object.fromEntries(sizes)).toEqual({
      400: 8_000,
      4000: 1_900,
      40000: 99,
      200000: 1,
    });

    for (const index of [0, 7_999, 8_000, 9_899, 9_900, 9_998, 9_999]) {
      const body = authorized[index]!.content;
      const first = body.indexOf("task prio");
      const middle = body.indexOf("task prio", first + 1);
      const last = body.lastIndexOf("task prio");
      expect(first).toBe(24);
      expect(middle).toBe(Math.floor(body.length / 2));
      expect(last).toBe(body.length - 24 - "task prio".length);
      expect(body.indexOf("task prio", last + 1)).toBe(-1);
    }
    expect(rows[9_999]!.content.match(/cedar/g)?.length).toBeGreaterThan(
      30_000,
    );
  });

  it("is deterministic and refuses a fixture without separate identities and spaces", () => {
    const first = generateSearchBenchmarkRows("B", options);
    const second = generateSearchBenchmarkRows("B", options);
    expect(first.next().value).toEqual(second.next().value);
    expect(first.next().value).toEqual(second.next().value);
    expect(() => [
      ...generateSearchBenchmarkRows("A", {
        ...options,
        outsiderEmail: options.ownerEmail,
      }),
    ]).toThrow("identities must differ");
    expect(() => [
      ...generateSearchBenchmarkRows("A", {
        ...options,
        outsiderSpaceId: options.spaceId,
      }),
    ]).toThrow("spaces must differ");
  });
});
