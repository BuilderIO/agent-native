import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pages: new Map<
    string,
    { items: Array<{ name: string }>; nextPageToken?: string }
  >(),
  requests: [] as Array<{ after?: string; datasetId?: string }>,
}));

vi.mock("@agent-native/core/action", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fail: (message: string, options?: Record<string, unknown>) => {
      throw Object.assign(new Error(message), options);
    },
  };
});

vi.mock("@agent-native/core/server", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@agent-native/core/server",
  );
  return {
    ...actual,
    getRequestContext: () => ({ userEmail: "owner@example.com", orgId: "o1" }),
  };
});

vi.mock("../lib/org-bigquery-credentials.js", () => ({
  getOrganizationBigQueryCredentialReadiness: async () => "configured",
  requireOrganizationBigQueryProjectId: async () => "proj",
  withOrganizationBigQueryRequestContext: async (
    _context: unknown,
    run: () => unknown,
  ) => run(),
}));

vi.mock("../lib/provider-api.js", () => ({
  getAnalytics2ProviderApiRuntime: () => ({}),
}));

vi.mock("./data-connection-provider.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "./data-connection-provider.js",
  );
  return {
    ...actual,
    requestMetadata: async (
      _runtime: unknown,
      projectId: string,
      input: { after?: string; datasetId?: string },
    ) => {
      mocks.requests.push(input);
      const page = mocks.pages.get(input.after ?? "") ?? { items: [] };
      return {
        items: page.items.map((item) => ({
          id: `schema:${projectId}:${item.name}`,
          name: item.name,
          kind: "schema" as const,
          hasChildren: true,
        })),
        nextPageToken: page.nextPageToken,
      };
    },
  };
});

const { ORGANIZATION_BIGQUERY_SOURCE_ID } =
  await import("../../shared/bigquery-source-contract.js");
const { listConnectionDatasets } = await import("./data-connections.js");

const list = (input: { search?: string; after?: string }) =>
  listConnectionDatasets({
    connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
    first: 2,
    ...input,
  } as never);

beforeEach(() => {
  mocks.pages.clear();
  mocks.requests.length = 0;
});

describe("report 1795064725.728079: dataset search fills its page from later upstream pages", () => {
  it("returns a match that sits past the first upstream page without a manual Load more", async () => {
    mocks.pages.set("", {
      items: [{ name: "alpha" }, { name: "beta" }],
      nextPageToken: "p2",
    });
    mocks.pages.set("p2", {
      items: [{ name: "gamma" }, { name: "america_sales" }],
    });
    const page = await list({ search: "america" });
    expect(page.items.map((item) => item.name)).toEqual(["america_sales"]);
    expect(page.hasNextPage).toBe(false);
    expect(page.endCursor).toBeNull();
  });

  it("stops scanning at the cap and keeps the continuation instead of claiming no match", async () => {
    for (let index = 0; index < 10; index++)
      mocks.pages.set(index === 0 ? "" : `p${index}`, {
        items: [{ name: `none_${index}` }],
        nextPageToken: `p${index + 1}`,
      });
    const page = await list({ search: "america" });
    expect(page.items).toEqual([]);
    expect(page.hasNextPage).toBe(true);
    expect(page.endCursor).not.toBeNull();
    expect(mocks.requests).toHaveLength(4);
    const resumed = await list({
      search: "america",
      after: String(page.endCursor),
    });
    expect(mocks.requests.at(-1)?.after).toBe(`p${mocks.requests.length - 1}`);
    expect(resumed.hasNextPage).toBe(true);
  });
});

describe("report 1795064308.979369: an unfiltered listing never answers empty with a continuation after one scan", () => {
  it("reads past an empty upstream page that still has a next token", async () => {
    mocks.pages.set("", { items: [], nextPageToken: "p2" });
    mocks.pages.set("p2", { items: [{ name: "orders" }] });
    const page = await list({});
    expect(page.items.map((item) => item.name)).toEqual(["orders"]);
    expect(page.hasNextPage).toBe(false);
  });
});

describe("row 166: BigQuery dataset pagination exceeds 64 accessible datasets without error", () => {
  it("pages cleanly through 70 datasets across multiple upstream BigQuery pages", async () => {
    const names = Array.from(
      { length: 70 },
      (_, index) => `dataset_${String(index + 1).padStart(2, "0")}`,
    );
    mocks.pages.set("", {
      items: names.slice(0, 30).map((name) => ({ name })),
      nextPageToken: "page-2",
    });
    mocks.pages.set("page-2", {
      items: names.slice(30, 60).map((name) => ({ name })),
      nextPageToken: "page-3",
    });
    mocks.pages.set("page-3", {
      items: names.slice(60).map((name) => ({ name })),
    });

    const collected: string[] = [];
    let after: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await listConnectionDatasets({
        connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
        first: 30,
        ...(after ? { after } : {}),
      } as never);
      collected.push(...page.items.map((item) => item.name));
      if (!page.hasNextPage) break;
      after = page.endCursor ?? undefined;
    }

    expect(collected).toEqual(names);
    expect(collected).toHaveLength(70);
  });
});
