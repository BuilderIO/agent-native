import { afterEach, expect, it, vi } from "vitest";

import { fetchConfiguredEndpoint } from "./configured-endpoint-fetch";

afterEach(() => vi.unstubAllGlobals());

it("keeps provider credentials on the configured origin across redirects", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "https://93.184.216.35/collect" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    fetchConfiguredEndpoint("https://93.184.216.34", "/api/org", {
      headers: { Authorization: "Bearer fake-token" },
    }),
  ).rejects.toThrow("Provider endpoint redirect changed origin");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
