// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveNotionSetupTarget } from "./use-notion";

describe("resolveNotionSetupTarget with unknown connection status", () => {
  const originalFetch = window.fetch;

  afterEach(() => {
    window.fetch = originalFetch;
  });

  it("does not start setup while the connection status is unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://api.notion.com/v1/oauth/authorize" }),
    });
    window.fetch = fetchMock as unknown as typeof fetch;

    await expect(resolveNotionSetupTarget(undefined)).resolves.toEqual({
      kind: "unavailable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
