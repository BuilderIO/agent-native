import {
  defineAppConfig,
  resetAppConfigForTests,
} from "@agent-native/core/app-config";
import { afterEach, expect, it, vi } from "vitest";

import { fetchConfiguredEndpoint } from "./configured-endpoint-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppConfigForTests();
});

it("permits only an explicitly configured private Grafana origin", async () => {
  const origin = "http://127.0.0.1:19100";
  const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    fetchConfiguredEndpoint("grafana", origin, "/api/org"),
  ).rejects.toThrow(/SSRF blocked/i);
  expect(fetchMock).not.toHaveBeenCalled();

  defineAppConfig({
    analytics: { trustedPrivateProviderOrigins: { grafana: [origin] } },
  });
  await expect(
    fetchConfiguredEndpoint("grafana", origin, "/api/org"),
  ).resolves.toHaveProperty("status", 200);
  await expect(
    fetchConfiguredEndpoint("prometheus", origin, "/api/v1/query"),
  ).rejects.toThrow(/SSRF blocked/i);
  await expect(
    fetchConfiguredEndpoint("gong", origin, "/v2/users"),
  ).rejects.toThrow(/SSRF blocked/i);
  await expect(
    fetchConfiguredEndpoint("grafana", "http://127.0.0.1:19101", "/api/org"),
  ).rejects.toThrow(/SSRF blocked/i);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("rejects private-origin configuration containing a path", () => {
  expect(() =>
    defineAppConfig({
      analytics: {
        trustedPrivateProviderOrigins: {
          grafana: ["http://127.0.0.1:19100/other"],
        },
      },
    }),
  ).toThrow();
});

it("keeps provider credentials on the configured origin across redirects", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "https://93.184.216.35/collect" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    fetchConfiguredEndpoint("grafana", "https://93.184.216.34", "/api/org", {
      headers: { Authorization: "Bearer fake-token" },
    }),
  ).rejects.toThrow("Provider endpoint redirect changed origin");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
