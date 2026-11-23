import { generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Continuation pages must respect what is left of the query's global row
 * budget. The old tree resolved a continuation "complete" with 2 rows when the
 * remaining budget was 1 (saved query returnedRows 19999), so these checks hold
 * the rebuilt query seam to the budget instead of the page size alone.
 */
const state = vi.hoisted(() => ({
  credentials: new Map<string, string>(),
  queryRequests: [] as string[],
  queryResponses: [] as Record<string, unknown>[],
  failures: [] as {
    errorCode?: string;
    statusCode?: number;
    message: string;
  }[],
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => ({
    userEmail: "qa@example.invalid",
    orgId: "qa-budget-workspace",
  }),
}));
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  resolveWorkspaceConnectionCredentialForApp: async ({
    connectionId,
    key,
  }: {
    connectionId: string;
    key: string;
  }) => ({
    available: state.credentials.has(`${connectionId}:${key}`),
    value: state.credentials.get(`${connectionId}:${key}`),
  }),
}));
vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  fail: (
    message: string,
    options?: { errorCode?: string; statusCode?: number },
  ) => {
    state.failures.push({
      message,
      ...(options?.errorCode ? { errorCode: options.errorCode } : {}),
      ...(options?.statusCode ? { statusCode: options.statusCode } : {}),
    });
    const error = Object.assign(new Error(message), options ?? {});
    throw error;
  },
}));

import {
  executeQueryPage,
  runtimeForConnection,
} from "./data-connection-provider";

function key(email: string) {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return JSON.stringify({
    client_email: email,
    private_key: privateKey,
    project_id: "qa-project",
  });
}

beforeEach(() => {
  state.credentials.clear();
  state.queryRequests = [];
  state.queryResponses = [];
  state.failures = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        const fields = new URLSearchParams(String(init?.body));
        const jwt = fields.get("assertion");
        if (!jwt) throw new Error("Missing assertion");
        const payload = JSON.parse(
          Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"),
        ) as { iss: string };
        return new Response(
          JSON.stringify({
            access_token: `QA-TOKEN-${payload.iss}`,
            expires_in: 3600,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.startsWith("https://bigquery.googleapis.com/")) {
        state.queryRequests.push(url);
        const response = state.queryResponses.shift();
        if (!response) throw new Error("Missing query response fixture");
        return new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("Unexpected network request in the query budget fixture");
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const jobReference = {
  projectId: "qa-project",
  jobId: "qa-budget-job",
  location: "US",
};
const schema = { fields: [{ name: "amount", type: "INT64" }] };

async function budgetRuntime(name: string) {
  state.credentials.set(`${name}:ref`, key(`${name}@example.invalid`));
  return runtimeForConnection(name, "ref");
}

describe("warehouse query row budget", () => {
  it("asks a continuation page for only the remaining global row budget", async () => {
    const runtime = await budgetRuntime("connection-budget");
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema,
        rows: [{ f: [{ v: "1" }] }],
        totalRows: "20001",
      },
    ];
    const page = await executeQueryPage(runtime, "qa-project", {
      job: jobReference,
      pageToken: "member-page-token-budget",
      first: 1000,
      remainingRows: 1,
    });
    expect(page.rows).toEqual([["1"]]);
    expect(page.status).toBe("complete");
    expect(state.queryRequests.at(-1)).toContain("maxResults=1");
  });

  it("rejects a continuation page that exceeds the remaining global row budget", async () => {
    const runtime = await budgetRuntime("connection-over-budget");
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema,
        rows: [{ f: [{ v: "1" }] }, { f: [{ v: "2" }] }],
        totalRows: "20001",
      },
    ];
    await expect(
      executeQueryPage(runtime, "qa-project", {
        job: jobReference,
        pageToken: "member-page-token-budget",
        first: 1000,
        remainingRows: 1,
      }),
    ).rejects.toMatchObject({
      errorCode: "bigquery_result_page_limit_exceeded",
      statusCode: 502,
    });
    expect(state.queryRequests.at(-1)).toContain("maxResults=1");
  });

  it("refuses a continuation once the global row budget is spent", async () => {
    const runtime = await budgetRuntime("connection-spent");
    const before = state.queryRequests.length;
    await expect(
      executeQueryPage(runtime, "qa-project", {
        job: jobReference,
        pageToken: "member-page-token-spent",
        first: 1000,
        remainingRows: 0,
      }),
    ).rejects.toMatchObject({
      errorCode: "bigquery_result_page_limit_exceeded",
      statusCode: 502,
    });
    expect(state.queryRequests).toHaveLength(before);
  });

  it("keeps the full page size when the budget leaves room for it", async () => {
    const runtime = await budgetRuntime("connection-roomy");
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema,
        rows: [{ f: [{ v: "1" }] }, { f: [{ v: "2" }] }],
        totalRows: "2",
      },
    ];
    const page = await executeQueryPage(runtime, "qa-project", {
      job: jobReference,
      first: 2,
      remainingRows: 10,
    });
    expect(page.rows).toHaveLength(2);
    expect(state.queryRequests.at(-1)).toContain("maxResults=2");
    expect(state.queryRequests.at(-1)).not.toContain("maxResults=10");
  });
});
