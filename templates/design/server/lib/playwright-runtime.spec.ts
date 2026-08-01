/**
 * playwright-runtime.spec.ts
 *
 * Covers the Cloudflare arm of the shared browser-runtime indirection: how the
 * platform browser binding is read, what happens when it is absent, and the
 * adapter that presents Cloudflare's Playwright-compatible fork under the same
 * `{ chromium }` shape the Node arms return.
 *
 * The Node arms (bare `playwright`, then `@playwright/test`) are exercised by
 * the actions' own specs; nothing here launches a real browser.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  CLOUDFLARE_BROWSER_BINDING,
  CloudflareBrowserBindingError,
  cloudflareBrowserCauseMessage,
  createCloudflareBrowserRuntime,
  isMissingBrowserError,
  launchChromium,
  requireCloudflareBrowserBinding,
} from "./playwright-runtime.js";

const workerScope = globalThis as { __cf_env?: Record<string, unknown> };

afterEach(() => {
  delete workerScope.__cf_env;
});

// ---------------------------------------------------------------------------
// Binding resolution
// ---------------------------------------------------------------------------

describe("requireCloudflareBrowserBinding", () => {
  it("returns the bound binding", () => {
    const binding = { fetch: async () => new Response("") };
    expect(requireCloudflareBrowserBinding({ BROWSER: binding })).toBe(binding);
  });

  it("throws a binding-specific error when the Worker env is unreadable", () => {
    expect(() => requireCloudflareBrowserBinding(null)).toThrow(
      CloudflareBrowserBindingError,
    );
    try {
      requireCloudflareBrowserBinding(null);
    } catch (err) {
      expect((err as CloudflareBrowserBindingError).reason).toBe("no-env");
    }
  });

  it("names the unbound binding and how to bind it, not a generic browser failure", () => {
    let thrown: unknown;
    try {
      requireCloudflareBrowserBinding({ DB: {} });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CloudflareBrowserBindingError);
    const error = thrown as CloudflareBrowserBindingError;
    expect(error.reason).toBe("unbound");
    expect(error.binding).toBe(CLOUDFLARE_BROWSER_BINDING);
    expect(error.message).toContain(CLOUDFLARE_BROWSER_BINDING);
    expect(error.message).toContain("browser");
    expect(error.message).toContain("wrangler");
  });

  it("distinguishes a bound-but-unusable binding from an absent one", () => {
    let thrown: unknown;
    try {
      requireCloudflareBrowserBinding({ BROWSER: "not-a-fetcher" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CloudflareBrowserBindingError);
    expect((thrown as CloudflareBrowserBindingError).reason).toBe(
      "not-a-browser-binding",
    );
  });

  it("never resolves to a placeholder a caller could mistake for a browser", () => {
    // The whole point of criterion 4: an absent binding must not become a
    // value that launches into a blank page.
    expect(() => requireCloudflareBrowserBinding({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

describe("createCloudflareBrowserRuntime", () => {
  it("presents the fork's launch(binding) under the shared { chromium } shape", async () => {
    const binding = { fetch: async () => new Response("") };
    const browser = { close: async () => {} };
    const calls: unknown[] = [];
    const runtime = createCloudflareBrowserRuntime(async (endpoint) => {
      calls.push(endpoint);
      return browser as never;
    }, binding);

    await expect(runtime.chromium.launch()).resolves.toBe(browser);
    expect(calls).toEqual([binding]);
  });

  it("propagates a launch failure instead of returning a browser-shaped null", async () => {
    const runtime = createCloudflareBrowserRuntime(
      async () => {
        throw new Error("browser rendering session limit reached");
      },
      { fetch: async () => new Response("") },
    );

    await expect(runtime.chromium.launch()).rejects.toThrow(
      "browser rendering session limit reached",
    );
  });
});

// ---------------------------------------------------------------------------
// Cause reporting
// ---------------------------------------------------------------------------

describe("cloudflareBrowserCauseMessage", () => {
  it("returns the binding-specific cause for a binding error", () => {
    const message = cloudflareBrowserCauseMessage(
      new CloudflareBrowserBindingError("unbound"),
    );
    expect(message).toContain(CLOUDFLARE_BROWSER_BINDING);
    expect(message).not.toContain("does not bundle a Chromium binary");
  });

  it("returns null for an unrelated failure so the Node message still applies", () => {
    expect(
      cloudflareBrowserCauseMessage(new Error("Executable doesn't exist")),
    ).toBeNull();
  });

  it("reports a missing fork package as its own cause, naming the package", () => {
    const message = cloudflareBrowserCauseMessage(
      new CloudflareBrowserBindingError("fork-not-installed", {
        detail: "Cannot find module '@cloudflare/playwright'",
      }),
    );
    expect(message).toContain("@cloudflare/playwright");
    expect(message).toContain("Cannot find module");
  });
});

// ---------------------------------------------------------------------------
// launchChromium on a Worker
// ---------------------------------------------------------------------------

describe("launchChromium", () => {
  it("does not probe for a system Chrome binary on a Worker", async () => {
    workerScope.__cf_env = { BROWSER: { fetch: async () => new Response("") } };
    const attempts: unknown[] = [];
    const chromium = {
      launch: async (options: unknown) => {
        attempts.push(options);
        // Browser Rendering can fail with wording the missing-binary
        // classifier matches; the local-binary search must not answer for it.
        throw new Error("browser session not found");
      },
    } as unknown as import("@playwright/test").BrowserType;

    await expect(launchChromium(chromium)).rejects.toThrow(
      "browser session not found",
    );
    expect(attempts).toHaveLength(1);
  });
});

describe("isMissingBrowserError", () => {
  it("does not classify a Cloudflare binding error as a missing Chromium binary", () => {
    expect(
      isMissingBrowserError(new CloudflareBrowserBindingError("unbound")),
    ).toBe(false);
  });
});
