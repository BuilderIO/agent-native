import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeConfigFields } from "./describe.js";
import { extensionsConfig } from "./extensions.js";
import {
  defineAppConfig,
  getAppConfig,
  resetAppConfigForTests,
} from "./store.js";

const originalEnv = { ...process.env };

describe("extensions config", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    delete process.env.AGENT_NATIVE_EXTENSION_IFRAME_IMAGE_SOURCES;
    delete process.env.AGENT_NATIVE_EXTENSION_IFRAME_MEDIA_SOURCES;
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("loads nothing remote by default", () => {
    expect(getAppConfig().extensions.iframeImageSources).toEqual([
      "'self'",
      "data:",
      "blob:",
    ]);
    expect(getAppConfig().extensions.iframeMediaSources).toEqual([
      "'self'",
      "data:",
      "blob:",
    ]);
  });

  it("reads a comma-separated environment alias", () => {
    process.env.AGENT_NATIVE_EXTENSION_IFRAME_IMAGE_SOURCES =
      "'self', https:, data:, blob:";
    process.env.AGENT_NATIVE_EXTENSION_IFRAME_MEDIA_SOURCES = "'self', https:";

    expect(getAppConfig().extensions.iframeImageSources).toEqual([
      "'self'",
      "https:",
      "data:",
      "blob:",
    ]);
    expect(getAppConfig().extensions.iframeMediaSources).toEqual([
      "'self'",
      "https:",
    ]);
  });

  it("lets an explicit value win over the environment alias", () => {
    process.env.AGENT_NATIVE_EXTENSION_IFRAME_IMAGE_SOURCES = "'self', https:";
    defineAppConfig({
      extensions: { iframeImageSources: ["'self'", "data:"] },
    });

    expect(getAppConfig().extensions.iframeImageSources).toEqual([
      "'self'",
      "data:",
    ]);
  });

  it("accepts a single origin and a wildcard subdomain", () => {
    defineAppConfig({
      extensions: {
        iframeImageSources: [
          "'self'",
          "https://cdn.example.com",
          "https://*.assets.example.com",
          "https://cdn.example.com:8443",
          "https:",
        ],
      },
    });

    expect(getAppConfig().extensions.iframeImageSources).toHaveLength(5);
  });

  it("rejects a source expression that is not a single CSP token", () => {
    for (const source of [
      "'self'; script-src *",
      "'self' https://cdn.example.com",
      "https://cdn.example.com/path",
      "javascript:alert(1)",
      "",
    ]) {
      expect(() =>
        defineAppConfig({ extensions: { iframeImageSources: [source] } }),
      ).toThrow();
    }
  });

  it("rejects an empty list rather than emitting a bare directive", () => {
    expect(() =>
      defineAppConfig({ extensions: { iframeMediaSources: [] } }),
    ).toThrow();
  });

  // A browser drops a CSP source list that mixes 'none' with other
  // sources, so the combination would read as a deny-all that still
  // permits https.
  it("rejects 'none' combined with another source", () => {
    for (const sources of [
      ["'none'", "https:"],
      ["https:", "'none'"],
      ["'none'", "'self'", "data:"],
    ]) {
      expect(() =>
        defineAppConfig({ extensions: { iframeImageSources: sources } }),
      ).toThrow();
    }
  });

  it("accepts 'none' as the whole list", () => {
    defineAppConfig({ extensions: { iframeImageSources: ["'none'"] } });

    expect(getAppConfig().extensions.iframeImageSources).toEqual(["'none'"]);
  });

  it("documents a remote image or media origin as an egress permission", () => {
    const fields = describeConfigFields(extensionsConfig);
    const image = fields.find((field) => field.path === "iframeImageSources");
    const media = fields.find((field) => field.path === "iframeMediaSources");
    expect(image?.doc).toContain("explicit egress permission");
    expect(image?.doc).not.toContain("does not widen");
    expect(media?.doc).toContain("explicit egress permission");
    expect(media?.doc).not.toContain("does not widen");
  });

  // Zod hands back a declared default without re-running the field's
  // validation, so a default the source regex or the 'none' refinement
  // rejects would stay invisible until an app overrode it. Parse the
  // default through its own field.
  it("declares defaults its own validator accepts", () => {
    const config = getAppConfig().extensions;
    expect(
      extensionsConfig.shape.iframeImageSources.parse(
        config.iframeImageSources,
      ),
    ).toEqual(config.iframeImageSources);
    expect(
      extensionsConfig.shape.iframeMediaSources.parse(
        config.iframeMediaSources,
      ),
    ).toEqual(config.iframeMediaSources);
  });
});
