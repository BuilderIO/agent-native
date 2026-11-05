import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: vi.fn(),
}));
vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: vi.fn(),
  workspaceMemberIdentityFromContext: (context: unknown) => context,
}));
vi.mock("../server/db/index.js", () => ({ getDb: vi.fn() }));
vi.mock("../server/lib/factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: vi.fn(),
}));
vi.mock("../server/lib/factory-scope.js", () => ({
  factoryIdSchema: z.string(),
  orgFactoryItemFilter: vi.fn(),
  readTriageConfigRow: vi.fn(),
  requireExistingFactory: vi.fn(),
}));
vi.mock("../server/triage/github-client.js", () => ({
  createGitHubClient: vi.fn(),
  GitHubRequestError: class extends Error {},
}));
vi.mock("../server/triage/audit.js", () => ({ recordFactoryAudit: vi.fn() }));

import type { GitHubOpenItemPage } from "../server/triage/github-client.js";

interface Entry {
  author: string;
  createdAt: string;
}

const entry = (n: number, author = "a"): Entry => ({
  author,
  createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
});

/** Newest first, three to a page, as GitHub lists open items. */
function pages(all: Entry[], perPage = 3) {
  const newestFirst = [...all].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const asked: number[] = [];
  const fetchPage = async (
    page: number,
  ): Promise<GitHubOpenItemPage<Entry>> => {
    asked.push(page);
    const start = (page - 1) * perPage;
    return {
      items: newestFirst.slice(start, start + perPage),
      unparsed: 0,
      hasMore: newestFirst.length > start + perPage,
    };
  };
  return { fetchPage, asked };
}

const everyone = () => true;
const nothingQueued = () => false;

let collectOpenItems: typeof import("./poll-github-sources.js").collectOpenItems;

beforeEach(async () => {
  ({ collectOpenItems } = await import("./poll-github-sources.js"));
});

describe("collectOpenItems from a workflow source's start", () => {
  const all = Array.from({ length: 10 }, (_, index) => entry(index + 1));

  it("stops at the first page that reaches the start, because the pages are newest first", async () => {
    const { fetchPage, asked } = pages(all);
    const start = Date.parse(entry(7).createdAt);

    const collected = await collectOpenItems(
      fetchPage,
      (item) => item.author,
      everyone,
      nothingQueued,
      25,
      (item) => Date.parse(item.createdAt) > start,
    );

    expect(collected.items.map((item) => item.createdAt)).toEqual([
      entry(10).createdAt,
      entry(9).createdAt,
      entry(8).createdAt,
    ]);
    // Page one is 10, 9, 8; page two begins with 7, which is not after the start.
    expect(asked).toEqual([1, 2]);
    expect(collected.hasMore).toBe(false);
  });

  it("does not count an item before the start as one an author filter skipped", async () => {
    const { fetchPage } = pages(all);
    const start = Date.parse(entry(8).createdAt);

    const collected = await collectOpenItems(
      fetchPage,
      () => "someone-excluded",
      () => false,
      nothingQueued,
      25,
      (item) => Date.parse(item.createdAt) > start,
    );

    expect(collected.items).toEqual([]);
    expect(collected.authorFiltered).toBe(2);
  });

  it("says there is more when the pages it read were all after the start and the list went on", async () => {
    const { fetchPage } = pages(all);

    const collected = await collectOpenItems(
      fetchPage,
      (item) => item.author,
      everyone,
      nothingQueued,
      2,
      () => true,
    );

    expect(collected.hasMore).toBe(true);
  });

  it("reads the list as it always did when no start is given", async () => {
    const { fetchPage, asked } = pages(all);

    const collected = await collectOpenItems(
      fetchPage,
      (item) => item.author,
      everyone,
      nothingQueued,
      25,
    );

    expect(collected.items).toHaveLength(10);
    expect(asked).toEqual([1, 2, 3, 4]);
  });
});
