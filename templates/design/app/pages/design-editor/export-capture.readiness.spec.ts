// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForExportReady } from "./export-capture";

/**
 * Regression coverage for the PNG/SVG/PDF export readiness race: a capture
 * taken before webfonts resolve and before a CDN-injected stylesheet lands
 * produces the field-reported "low quality / broken layout" export. See the
 * `waitForExportReady` docblock in `export-capture.ts` for the full story.
 *
 * Uses the ambient `document` (has a real `defaultView` under the happy-dom
 * test environment) rather than `document.implementation.createHTMLDocument`,
 * which produces a detached document with no `defaultView` — exactly the
 * "no-op" case one of these tests exercises on purpose.
 */
describe("waitForExportReady", () => {
  const originalFontsDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "fonts",
  );

  afterEach(() => {
    if (originalFontsDescriptor) {
      Object.defineProperty(document, "fonts", originalFontsDescriptor);
    }
    document
      .querySelectorAll("style[data-export-readiness-test]")
      .forEach((el) => el.remove());
  });

  it("resolves once document.fonts.ready resolves and stylesheet rules stabilize", async () => {
    const style = document.createElement("style");
    style.setAttribute("data-export-readiness-test", "true");
    style.textContent = ".a { color: red; }";
    document.head.appendChild(style);

    let resolveFonts: () => void = () => {};
    const fontsReady = new Promise<void>((resolve) => {
      resolveFonts = resolve;
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: fontsReady },
    });

    let settled = false;
    const wait = waitForExportReady(document, { timeoutMs: 3000 }).then(() => {
      settled = true;
    });

    // Must not resolve while fonts are still "loading", however long the
    // stylesheet-stabilization poll takes on its own.
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    resolveFonts();
    await wait;
    expect(settled).toBe(true);
  });

  it("never hangs past timeoutMs when fonts never resolve", async () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: new Promise<void>(() => {}) }, // never resolves
    });

    const start = Date.now();
    await waitForExportReady(document, { timeoutMs: 150 });
    const elapsed = Date.now() - start;
    // Bounded: should not wait anywhere close to "forever". Generous upper
    // bound to avoid CI flakiness while still catching a real hang.
    expect(elapsed).toBeLessThan(2000);
  });

  it("is a no-op when the document has no defaultView", async () => {
    const doc = document.implementation.createHTMLDocument("test");
    expect(doc.defaultView).toBeFalsy();
    await expect(waitForExportReady(doc)).resolves.toBeUndefined();
  });

  it("does not consume the full timeout for a stable stylesheet-free document", async () => {
    document
      .querySelectorAll('link[rel~="stylesheet"],script[src],style')
      .forEach((element) => element.remove());
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    const start = Date.now();
    await waitForExportReady(document, { timeoutMs: 2000 });
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("tolerates document.fonts.ready rejecting instead of resolving", async () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.reject(new Error("font load failed")) },
    });
    // Swallow the unhandled-rejection warning from the raw promise itself;
    // the function under test must still resolve cleanly.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      waitForExportReady(document, { timeoutMs: 200 }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
