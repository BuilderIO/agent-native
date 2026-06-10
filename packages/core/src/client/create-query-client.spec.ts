import { describe, expect, it } from "vitest";
import { createAgentNativeQueryClient } from "./create-query-client.js";

describe("createAgentNativeQueryClient", () => {
  it("returns a QueryClient with house defaults", () => {
    const qc = createAgentNativeQueryClient();
    const defaults = qc.getDefaultOptions();

    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);

    // retry is a function — verify it blocks auth failures and allows one retry
    const retry = defaults.queries?.retry;
    expect(typeof retry).toBe("function");
    if (typeof retry === "function") {
      // auth failure — never retry
      expect(retry(0, { status: 401 })).toBe(false);
      expect(retry(0, { status: 403 })).toBe(false);
      // transient error — first retry allowed
      expect(retry(0, new Error("network"))).toBe(true);
      // transient error — second retry blocked
      expect(retry(1, new Error("network"))).toBe(false);
    }
  });

  it("merges caller overrides onto house defaults", () => {
    const qc = createAgentNativeQueryClient({
      defaultOptions: {
        queries: {
          // Intentional override: brain uses 20 s
          staleTime: 20_000,
        },
      },
    });
    const defaults = qc.getDefaultOptions();

    // Overridden
    expect(defaults.queries?.staleTime).toBe(20_000);
    // House defaults preserved for unspecified fields
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
  });

  it("keeps refetchOnWindowFocus false even when staleTime is overridden", () => {
    const qc = createAgentNativeQueryClient({
      defaultOptions: { queries: { staleTime: 60_000 } },
    });
    expect(qc.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  it("allows caller to opt into refetchOnWindowFocus explicitly", () => {
    // Calendar/mail had refetchOnWindowFocus:true intentionally — allow override
    const qc = createAgentNativeQueryClient({
      defaultOptions: { queries: { refetchOnWindowFocus: true } },
    });
    expect(qc.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
    // Other house defaults still apply
    expect(qc.getDefaultOptions().queries?.staleTime).toBe(30_000);
  });
});
