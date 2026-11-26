import { describe, expect, it } from "vitest";

import { claimActionQueryForeground } from "./action-query-foreground.js";

function query(state: {
  data?: unknown;
  dataUpdateCount?: number;
  error?: unknown;
  fetchFailureCount?: number;
}) {
  return {
    isActive: () => true,
    state: {
      data: undefined,
      dataUpdateCount: 0,
      error: null,
      fetchFailureCount: 0,
      ...state,
    },
  } as never as Parameters<typeof claimActionQueryForeground>[0] & {
    state: Record<string, unknown>;
  };
}

describe("claimActionQueryForeground", () => {
  it("claims the first visible read of a query with nothing yet", () => {
    expect(claimActionQueryForeground(query({}))).toBe(true);
  });

  it("keeps a failed foreground read foreground on its retry until it has data", () => {
    const q = query({});
    expect(claimActionQueryForeground(q)).toBe(true);
    q!.state.fetchFailureCount = 1;
    q!.state.error = new Error("network");
    expect(claimActionQueryForeground(q)).toBe(true);
    expect(claimActionQueryForeground(q)).toBe(true);
  });

  it("stops claiming foreground once the read has failed more than three times", () => {
    const q = query({});
    expect(claimActionQueryForeground(q)).toBe(true);
    q!.state.error = new Error("network");
    for (const failures of [1, 2, 3]) {
      q!.state.fetchFailureCount = failures;
      expect(claimActionQueryForeground(q)).toBe(true);
    }
    q!.state.fetchFailureCount = 4;
    expect(claimActionQueryForeground(q)).toBe(false);
    expect(claimActionQueryForeground(q)).toBe(false);
  });

  it("goes back to background once the read has answered", () => {
    const q = query({});
    expect(claimActionQueryForeground(q)).toBe(true);
    q!.state.data = { items: [] };
    q!.state.dataUpdateCount = 1;
    expect(claimActionQueryForeground(q)).toBe(false);
    q!.state.fetchFailureCount = 1;
    q!.state.data = undefined;
    expect(claimActionQueryForeground(q)).toBe(false);
  });

  it("claims a cached query's first current-document read, then leaves later cycles background", () => {
    const q = query({ data: { items: [] }, dataUpdateCount: 1 });
    expect(claimActionQueryForeground(q)).toBe(true);
    q!.state.fetchFailureCount = 1;
    expect(claimActionQueryForeground(q)).toBe(true);
    q!.state.fetchFailureCount = 0;
    expect(claimActionQueryForeground(q)).toBe(false);
    q!.state.fetchFailureCount = 1;
    expect(claimActionQueryForeground(q)).toBe(false);
  });

  // A page painted from the cache (initialData) has `data` set before any
  // fetch has answered; its first read is still the person's.
  it("claims the first visible read of a query that only holds initialData", () => {
    const q = query({ data: { drafts: [] }, dataUpdateCount: 0 });
    expect(claimActionQueryForeground(q)).toBe(true);
  });

  it("keeps a failed first read of an initialData query foreground on its retries, then stops", () => {
    const q = query({ data: { drafts: [] }, dataUpdateCount: 0 });
    expect(claimActionQueryForeground(q)).toBe(true);
    q!.state.error = new Error("network");
    for (const failures of [1, 2, 3]) {
      q!.state.fetchFailureCount = failures;
      expect(claimActionQueryForeground(q)).toBe(true);
    }
    q!.state.fetchFailureCount = 4;
    expect(claimActionQueryForeground(q)).toBe(false);
  });

  it("claims foreground once per query: the next fetch of an initialData query is background", () => {
    const q = query({ data: { drafts: [] }, dataUpdateCount: 0 });
    expect(claimActionQueryForeground(q)).toBe(true);
    q!.state.dataUpdateCount = 1;
    expect(claimActionQueryForeground(q)).toBe(false);
  });

  it("does not claim for an inactive query holding initialData", () => {
    const q = query({ data: { drafts: [] }, dataUpdateCount: 0 });
    (q as unknown as { isActive: () => boolean }).isActive = () => false;
    expect(claimActionQueryForeground(q)).toBe(false);
  });
});

it("does not renew a failed first read's allowance on a later automatic fetch cycle", () => {
  const q = query({});
  expect(claimActionQueryForeground(q)).toBe(true);
  q!.state.fetchFailureCount = 1;
  expect(claimActionQueryForeground(q)).toBe(true);
  q!.state.fetchFailureCount = 0;
  expect(claimActionQueryForeground(q)).toBe(false);
  q!.state.fetchFailureCount = 1;
  expect(claimActionQueryForeground(q)).toBe(false);
});
