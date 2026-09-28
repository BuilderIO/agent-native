import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { documentScopedReadRetryOptions } from "./document-scoped-read-retry";

const SETTLING = documentScopedReadRetryOptions(true);
const SETTLED = documentScopedReadRetryOptions(false);

const DRAFT_QUERY_KEY = [
  "action",
  "get-preview-document-draft",
  { documentId: "doc-1" },
] as const;

function statusError(status: number): Error {
  return Object.assign(new Error(`Action failed with ${status}`), { status });
}

let client: QueryClient | undefined;

function newClient(): QueryClient {
  client = new QueryClient();
  return client;
}

afterEach(() => {
  client?.clear();
  client = undefined;
});

describe("draft read during the page-creation window", () => {
  it("recovers on its own once the created row becomes visible", async () => {
    let attempts = 0;
    const result = await newClient().fetchQuery({
      queryKey: DRAFT_QUERY_KEY,
      queryFn: async () => {
        attempts += 1;
        if (attempts <= 2) throw statusError(403);
        return { draft: null };
      },
      ...SETTLING,
    });

    expect(attempts).toBe(3);
    expect(result).toEqual({ draft: null });
  });

  it("still fails loudly when the row never becomes visible", async () => {
    let attempts = 0;
    await expect(
      newClient().fetchQuery({
        queryKey: DRAFT_QUERY_KEY,
        queryFn: async () => {
          attempts += 1;
          throw statusError(403);
        },
        ...SETTLING,
      }),
    ).rejects.toThrow(/403/);

    expect(attempts).toBe(5);
  });

  it("does not widen retries to other failure classes", async () => {
    for (const status of [500, 502, 401]) {
      let attempts = 0;
      await expect(
        newClient().fetchQuery({
          queryKey: DRAFT_QUERY_KEY,
          queryFn: async () => {
            attempts += 1;
            throw statusError(status);
          },
          ...SETTLING,
        }),
      ).rejects.toThrow(String(status));
      expect(attempts).toBe(1);
    }
  });
});

describe("draft read for an established row", () => {
  it("surfaces a revoked share immediately instead of retrying it", async () => {
    let attempts = 0;
    await expect(
      newClient().fetchQuery({
        queryKey: DRAFT_QUERY_KEY,
        queryFn: async () => {
          attempts += 1;
          throw statusError(403);
        },
        ...SETTLED,
      }),
    ).rejects.toThrow(/403/);

    expect(attempts).toBe(1);
  });

  it("surfaces a deleted row immediately instead of retrying it", async () => {
    let attempts = 0;
    await expect(
      newClient().fetchQuery({
        queryKey: DRAFT_QUERY_KEY,
        queryFn: async () => {
          attempts += 1;
          throw statusError(404);
        },
        ...SETTLED,
      }),
    ).rejects.toThrow(/404/);

    expect(attempts).toBe(1);
  });
});
