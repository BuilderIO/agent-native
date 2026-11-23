import { getAppProductionUrl } from "@agent-native/core/server";
import { getRuntimeConfigReport } from "@agent-native/core/shared/runtime-config";
import { describe, expect, it, vi } from "vitest";

const productionBuildEnv = {
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "test-only-secret".repeat(4),
  DATABASE_URL: "postgres://localhost/analytics",
};

describe("Analytics production build diagnostics", () => {
  it("uses the configured auth origin when serving an explicitly local production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:4400");
    try {
      expect(getAppProductionUrl()).toBe("http://localhost:4400");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("still ignores a loopback auth origin on a hosted deployment", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("URL", "https://analytics.example.test");
    vi.stubEnv("APP_URL", "http://localhost:4400");
    try {
      expect(getAppProductionUrl()).toBe("https://analytics.example.test");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(["http://localhost:4400", "http://[::1]:4400"])(
    "accepts %s in an explicitly local production build",
    (url) => {
      const env = {
        ...productionBuildEnv,
        AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT: "local",
        BETTER_AUTH_URL: url,
      };
      expect(getRuntimeConfigReport(env, {}, { phase: "build" })).toMatchObject(
        {
          ok: true,
          issues: [],
        },
      );
      const report = getRuntimeConfigReport(
        env,
        {},
        {
          phase: "runtime",
          missingDeploySettings: {
            databaseSource: null,
            authSecretKey: null,
            a2aSecretMissing: false,
          },
        },
      );

      expect(report).toMatchObject({ ok: true, issues: [], prompt: "" });
    },
  );

  it.each(["http://localhost:4400", "http://[::1]:4400"])(
    "names the configured loopback URL setting in a deployed production build (%s)",
    (url) => {
      const report = getRuntimeConfigReport({
        ...productionBuildEnv,
        BETTER_AUTH_URL: url,
      });

      expect(report.issues).toMatchObject([
        { code: "invalid-auth-url", envKeys: ["BETTER_AUTH_URL"] },
      ]);
      expect(report.issues[0]?.title).toContain("BETTER_AUTH_URL");
    },
  );

  it("rejects a malformed APP_URL in a local production build", () => {
    const report = getRuntimeConfigReport({
      ...productionBuildEnv,
      AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT: "local",
      APP_URL: "localhost:4400",
      BETTER_AUTH_URL: "http://localhost:4400",
    });

    expect(report.issues).toMatchObject([
      { code: "invalid-auth-url", envKeys: ["APP_URL"] },
    ]);
  });
});
