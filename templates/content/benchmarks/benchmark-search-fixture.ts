export const SEARCH_BENCHMARK_SEED = 20260923;

export type SearchBenchmarkProfile = "A" | "B";

export interface SearchBenchmarkFixtureOptions {
  fixturePrefix: string;
  ownerEmail: string;
  outsiderEmail: string;
  spaceId: string;
  outsiderSpaceId: string;
}

export interface SearchBenchmarkRow {
  id: string;
  ownerEmail: string;
  spaceId: string;
  title: string;
  content: string;
  visibility: "private";
  updatedAt: string;
}

export const SEARCH_BENCHMARK_QUERIES = [
  {
    query: "task prio",
    expectedTotalItems: 10_000,
    expectedFirstTitle: "Task Priorities",
    searchFields: "all",
    limit: 20,
    offset: 0,
  },
  {
    query: "task",
    expectedTotalItems: 10_000,
    expectedFirstTitle: "Task Priorities",
    searchFields: "all",
    limit: 20,
    offset: 0,
  },
  {
    query: "Task Priorities",
    expectedTotalItems: 1,
    expectedFirstTitle: "Task Priorities",
    searchFields: "all",
    limit: 20,
    offset: 0,
  },
  {
    query: "zzzxqvnever",
    expectedTotalItems: 0,
    expectedFirstTitle: null,
    searchFields: "all",
    limit: 20,
    offset: 0,
  },
] as const;

const AUTHORIZED_COUNT = 10_000;
const OUTSIDER_COUNT = 2_000;
const CONTROL_BODY = `A working note about task assignments. ${"bounded filler ".repeat(30)}The explicit prio marker remains available.`;
const BODY_MARKER = "task prio";
const FILLER_WORDS = ["cedar", "willow", "maple"] as const;

function bodyLength(index: number): number {
  if (index < 8_000) return 400;
  if (index < 9_900) return 4_000;
  if (index < 9_999) return 40_000;
  return 200_000;
}

function mixedBody(index: number): string {
  const length = bodyLength(index);
  const filler =
    index === 9_999
      ? "cedar "
      : `${FILLER_WORDS[(SEARCH_BENCHMARK_SEED + index) % FILLER_WORDS.length]} `;
  const chars = `${filler.repeat(Math.ceil(length / filler.length))}`
    .slice(0, length)
    .split("");
  for (const position of [
    24,
    Math.floor(length / 2),
    length - 24 - BODY_MARKER.length,
  ]) {
    chars.splice(position, BODY_MARKER.length, ...BODY_MARKER);
  }
  return chars.join("");
}

function assertFixtureOptions(options: SearchBenchmarkFixtureOptions): void {
  for (const [name, value] of Object.entries(options)) {
    if (!value.trim()) throw new Error(`${name} must be nonempty`);
  }
  if (
    options.ownerEmail.toLowerCase() === options.outsiderEmail.toLowerCase()
  ) {
    throw new Error("Benchmark owner and outsider identities must differ");
  }
  if (options.spaceId === options.outsiderSpaceId) {
    throw new Error("Benchmark owner and outsider spaces must differ");
  }
}

export function* generateSearchBenchmarkRows(
  profile: SearchBenchmarkProfile,
  options: SearchBenchmarkFixtureOptions,
): IterableIterator<SearchBenchmarkRow> {
  assertFixtureOptions(options);
  if (profile !== "A" && profile !== "B") {
    throw new Error(`Unknown search benchmark profile: ${profile}`);
  }

  const profileId = profile.toLowerCase();
  for (let index = 0; index < AUTHORIZED_COUNT; index += 1) {
    yield {
      id: `${options.fixturePrefix}-${profileId}-owner-${index.toString().padStart(5, "0")}`,
      ownerEmail: options.ownerEmail,
      spaceId: options.spaceId,
      title: index === 0 ? "Task Priorities" : `Imported working note ${index}`,
      content:
        profile === "A"
          ? index === 0
            ? "Current working projection."
            : CONTROL_BODY
          : mixedBody(index),
      visibility: "private",
      updatedAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    };
  }

  for (let index = 0; index < OUTSIDER_COUNT; index += 1) {
    yield {
      id: `${options.fixturePrefix}-${profileId}-outsider-${index.toString().padStart(5, "0")}`,
      ownerEmail: options.outsiderEmail,
      spaceId: options.outsiderSpaceId,
      title: `Imported private note ${index}`,
      content: profile === "A" ? CONTROL_BODY : mixedBody(index),
      visibility: "private",
      updatedAt: new Date(Date.UTC(2026, 0, 2) + index * 1000).toISOString(),
    };
  }
}
