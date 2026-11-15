import { describe, expect, it } from "vitest";

import { analyticsConfig } from "./analytics.js";

describe("analytics configuration", () => {
  it("defaults private-provider trust to empty lists and session replay to off", () => {
    expect(analyticsConfig.parse({})).toMatchObject({
      trustedPrivateProviderOrigins: { grafana: [], prometheus: [] },
      authSessionReplay: false,
      agentNativeEndpoint: "https://analytics.agent-native.com/track",
    });
    expect(
      analyticsConfig.parse({ trustedPrivateProviderOrigins: {} })
        .trustedPrivateProviderOrigins,
    ).toEqual({ grafana: [], prometheus: [] });
  });

  it("accepts exact HTTP origins for each provider without changing their values", () => {
    const trustedPrivateProviderOrigins = {
      grafana: ["https://grafana.example.test", "http://127.0.0.1:3000"],
      prometheus: ["http://prometheus.example.test:9090"],
    };
    expect(
      analyticsConfig.parse({ trustedPrivateProviderOrigins })
        .trustedPrivateProviderOrigins,
    ).toEqual(trustedPrivateProviderOrigins);
  });

  it.each([
    "https://grafana.example.test/",
    "https://grafana.example.test/dashboard",
    "https://grafana.example.test?view=1",
    "https://grafana.example.test#panel",
    "https://user@grafana.example.test",
    "https://user:pass@grafana.example.test",
    "ftp://grafana.example.test",
  ])(
    "rejects a non-exact or non-HTTP private-provider origin: %s",
    (origin) => {
      for (const provider of ["grafana", "prometheus"] as const) {
        expect(
          analyticsConfig.safeParse({
            trustedPrivateProviderOrigins: { [provider]: [origin] },
          }).success,
        ).toBe(false);
      }
    },
  );
});
