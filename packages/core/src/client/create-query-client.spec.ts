import { describe, expect, it } from "vitest";

import {
  createAgentNativeQueryClient,
  isTerminalAuthFailure,
} from "./create-query-client.js";

describe("createAgentNativeQueryClient", () => {
  it("returns a QueryClient with house defaults", () => {
    const qc = createAgentNativeQueryClient();
    const defaults = qc.getDefaultOptions();

    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);

    const retry = defaults.queries?.retry;
    expect(typeof retry).toBe("function");
    if (typeof retry === "function") {
      expect(retry(0, { status: 401 })).toBe(false);
      expect(retry(0, { status: 403 })).toBe(false);
      expect(retry(0, { status: 404 })).toBe(false);
      expect(retry(0, new Error("network"))).toBe(true);
      expect(retry(1, new Error("network"))).toBe(false);
    }
  });

  it("merges caller overrides onto house defaults", () => {
    const qc = createAgentNativeQueryClient({
      defaultOptions: {
        queries: {
          staleTime: 20_000,
        },
      },
    });
    const defaults = qc.getDefaultOptions();

    expect(defaults.queries?.staleTime).toBe(20_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
  });

  it("keeps refetchOnWindowFocus false even when staleTime is overridden", () => {
    const qc = createAgentNativeQueryClient({
      defaultOptions: { queries: { staleTime: 60_000 } },
    });
    expect(qc.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  it("allows caller to opt into refetchOnWindowFocus explicitly", () => {
    const qc = createAgentNativeQueryClient({
      defaultOptions: { queries: { refetchOnWindowFocus: true } },
    });
    expect(qc.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
    expect(qc.getDefaultOptions().queries?.staleTime).toBe(30_000);
  });
});

describe("isTerminalAuthFailure", () => {
  it("is true for 401/403 and false otherwise", () => {
    expect(isTerminalAuthFailure({ status: 401 })).toBe(true);
    expect(isTerminalAuthFailure({ status: 403 })).toBe(true);
    expect(isTerminalAuthFailure({ status: 404 })).toBe(false);
    expect(isTerminalAuthFailure({ status: 500 })).toBe(false);
    expect(isTerminalAuthFailure(new Error("network"))).toBe(false);
    expect(isTerminalAuthFailure(undefined)).toBe(false);
  });
});
