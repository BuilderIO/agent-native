// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForExportReady } from "./export-capture";

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
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      waitForExportReady(document, { timeoutMs: 200 }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
