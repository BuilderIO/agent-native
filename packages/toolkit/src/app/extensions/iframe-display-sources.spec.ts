import { EXTENSION_IFRAME_META_CSP } from "@agent-native/core/extensions/html-shell";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadExtensionIframeMetaCsp,
  resetExtensionIframeMetaCspForTests,
} from "./iframe-display-sources.js";

describe("loadExtensionIframeMetaCsp", () => {
  beforeEach(() => {
    resetExtensionIframeMetaCspForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the meta CSP from the server's configured sources once", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        imageSources: ["'self'", "https:"],
        mediaSources: ["'self'", "blob:"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const csp = await loadExtensionIframeMetaCsp();
    expect(csp).toContain("img-src 'self' https:;");
    expect(csp).toContain("media-src 'self' blob:;");
    expect(csp).toContain("connect-src 'self';");
    await expect(loadExtensionIframeMetaCsp()).resolves.toBe(csp);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/_agent-native/extensions/iframe/display-sources",
    );
  });

  it("falls back to the default policy for an invalid source list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          imageSources: ["'self'; connect-src *"],
          mediaSources: ["'self'"],
        }),
      ),
    );

    await expect(loadExtensionIframeMetaCsp()).resolves.toBe(
      EXTENSION_IFRAME_META_CSP,
    );
  });

  it("falls back to the default policy on a failed request and retries later", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(
        Response.json({
          imageSources: ["'self'", "https:"],
          mediaSources: ["'self'"],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadExtensionIframeMetaCsp()).resolves.toBe(
      EXTENSION_IFRAME_META_CSP,
    );
    await expect(loadExtensionIframeMetaCsp()).resolves.toContain(
      "img-src 'self' https:;",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
