import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveDeployEnvironment } from "./deploy-environment.js";

describe("resolveDeployEnvironment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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
});
