import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { absoluteUrl } from "./json.js";

const ORIGINAL_ENV = {
  APP_BASE_PATH: process.env.APP_BASE_PATH,
  VITE_APP_BASE_PATH: process.env.VITE_APP_BASE_PATH,
  APP_URL: process.env.APP_URL,
  URL: process.env.URL,
  DEPLOY_URL: process.env.DEPLOY_URL,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("absoluteUrl", () => {
  beforeEach(() => {
    restoreEnv();
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    delete process.env.APP_URL;
    delete process.env.URL;
    delete process.env.DEPLOY_URL;
    delete process.env.BETTER_AUTH_URL;
  });

  afterEach(() => {
    restoreEnv();
  });

  it("prefixes app-relative URLs with APP_BASE_PATH", () => {
    process.env.APP_BASE_PATH = "/assets";

    expect(absoluteUrl("/api/assets/asset-1/content?variant=thumb")).toBe(
      "/assets/api/assets/asset-1/content?variant=thumb",
    );
    expect(absoluteUrl("/library-presets/soft-travel-3d/bag-clay.webp")).toBe(
      "/assets/library-presets/soft-travel-3d/bag-clay.webp",
    );
  });

  it("does not double-prefix URLs that already include APP_BASE_PATH", () => {
    process.env.APP_BASE_PATH = "/assets";

    expect(absoluteUrl("/assets/api/assets/asset-1/content")).toBe(
      "/assets/api/assets/asset-1/content",
    );
  });

  it("keeps the mounted path when building absolute URLs", () => {
    process.env.APP_BASE_PATH = "/assets";
    process.env.APP_URL = "http://localhost:8080";

    expect(absoluteUrl("/api/assets/asset-1/content")).toBe(
      "http://localhost:8080/assets/api/assets/asset-1/content",
    );
  });
});
