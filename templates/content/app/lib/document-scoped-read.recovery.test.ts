// Regression coverage for the reported flow: creating a page navigated to its
// editor before create-document committed, so the per-document draft read
// answered 403 for a row that was about to exist. With retry: false that error
// was terminal and the editor sat behind "Something went wrong" until the user
// clicked Retry by hand — reported as ~10 retries before it took.
//
// These exercise the exact options the production hook passes, through a real
// QueryClient, so React Query's retry semantics are part of what is asserted.
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { documentScopedReadRetryOptions } from "./document-scoped-read-retry";

// A row still settling after its own create, and one long past that window.
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
        // The create request is still committing for the first two reads.
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

    // A bounded budget, not an unbounded one: the failure has to surface.
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
  // assertAccess answers 403 for a revoked share exactly as it does for a row
  // that is not there yet, and these reads are invalidated on sync events — so
  // retrying a real denial would cost five unauthorized requests per poll.
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
