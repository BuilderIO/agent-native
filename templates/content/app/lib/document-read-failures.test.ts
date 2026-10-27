import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { documentQueryKey } from "./document-query";
import {
  lastDocumentReadFailure,
  trackDocumentReadFailures,
} from "./document-read-failures";

describe("lastDocumentReadFailure", () => {
  it("keeps a read's failure until the read itself succeeds", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    trackDocumentReadFailures(queryClient);
    const queryKey = documentQueryKey("document-a");
    const refused = Object.assign(new Error("forbidden"), { status: 403 });

    await expect(
      queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          throw refused;
        },
      }),
    ).rejects.toBe(refused);
    expect(lastDocumentReadFailure(queryClient, queryKey)).toBe(refused);

    queryClient.setQueryData(queryKey, { id: "document-a" });
    expect(lastDocumentReadFailure(queryClient, queryKey)).toBe(refused);

    await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => ({ id: "document-a" }),
    });
    expect(lastDocumentReadFailure(queryClient, queryKey)).toBeUndefined();
  });

  it("forgets a failure when its query leaves the cache", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    trackDocumentReadFailures(queryClient);
    const queryKey = documentQueryKey("document-a");

    await expect(
      queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          throw new Error("read failed");
        },
      }),
    ).rejects.toThrow("read failed");
    queryClient.removeQueries({ queryKey, exact: true });

    expect(lastDocumentReadFailure(queryClient, queryKey)).toBeUndefined();
  });
});
