import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveDeployEnvironment } from "./deploy-environment.js";

describe("resolveDeployEnvironment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes an explicit deployment environment", () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", " BETA ");

    expect(resolveDeployEnvironment()).toBe("beta");
  });

  it("rejects unsupported explicit deployment environments", () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "staging");

    expect(() => resolveDeployEnvironment()).toThrow(
      'AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT must be "local", "beta", "production", or "preview"',
    );
  });

  it.each(["deploy-preview", "branch-deploy"])(
    "uses Netlify CONTEXT for a %s feature deployment",
    (context) => {
      vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "");
      vi.stubEnv("SENTRY_ENVIRONMENT", "production");
      vi.stubEnv("CONTEXT", context);
      vi.stubEnv("NETLIFY_CONTEXT", "production");
      vi.stubEnv("BRANCH", "feature/auth");
      vi.stubEnv("VERCEL_ENV", "");
      vi.stubEnv("NODE_ENV", "production");

      expect(resolveDeployEnvironment()).toBe("preview");
    },
  );

  it("does not treat an arbitrary Sentry environment as a deployment lane", () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "");
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("CONTEXT", "");
    vi.stubEnv("NETLIFY_CONTEXT", "");
    vi.stubEnv("BRANCH", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(resolveDeployEnvironment()).toBe("production");
  });
});
