import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAppProductionUrl } from "./app-url.js";

const URL_ENV_KEYS = [
  "APP_URL",
  "WORKSPACE_OAUTH_ORIGIN",
  "VITE_WORKSPACE_OAUTH_ORIGIN",
  "BETTER_AUTH_URL",
  "VITE_BETTER_AUTH_URL",
];

describe("getAppProductionUrl without an h3 event", () => {
  beforeEach(() => {
    for (const key of URL_ENV_KEYS) vi.stubEnv(key, "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("URL", "https://netlify-site.example.test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the request origin before platform fallbacks", () => {
    expect(
      getAppProductionUrl(undefined, {
        requestOrigin: "https://beta.app.example.test/",
      }),
    ).toBe("https://beta.app.example.test");
  });

  it("still prefers a configured app URL", () => {
    vi.stubEnv("APP_URL", "https://app.example.test");
    expect(
      getAppProductionUrl(undefined, {
        requestOrigin: "https://beta.app.example.test",
      }),
    ).toBe("https://app.example.test");
  });
});
