import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { buildSync } from "esbuild";
import { expect, it } from "vitest";

const bundled = buildSync({
  entryPoints: [
    fileURLToPath(new URL("./foreign-design-clipboard.ts", import.meta.url)),
  ],
  bundle: true,
  format: "iife",
  globalName: "ForeignClipboard",
  platform: "browser",
  target: "es2020",
  write: false,
}).outputFiles[0]?.text;

it("materializes a foreign screen through the actual opaque-frame hydration", async () => {
  if (!bundled) throw new Error("Clipboard materializer bundle missing");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body>Editor</body></html>");
    await page.addScriptTag({ content: bundled });
    const result = await page.evaluate(async () => {
      const phases: string[] = [];
      window.addEventListener("message", (event: MessageEvent) => {
        if (typeof event.data?.type === "string") phases.push(event.data.type);
      });
      const importer = (
        window as typeof window & {
          ForeignClipboard: {
            renderForeignDesignScreen: (html: string) => Promise<string>;
          };
        }
      ).ForeignClipboard;
      const html = await importer.renderForeignDesignScreen(
        `<!doctype html><html><head><script>window.addEventListener('load',function(){var style=document.createElement('style');document.head.append(style);style.sheet.insertRule('.generated { color: rgb(1, 2, 3); }');var child=document.createElement('p');child.className='generated';child.textContent='Rendered child';document.body.append(child);});</script></head><body><main x-data="{}">Screen</main></body></html>`,
      );
      return {
        html,
        phases,
        frames: document.querySelectorAll("iframe").length,
      };
    });
    expect(result.html).toContain("Rendered child");
    expect(result.html).toContain(".generated { color: rgb(1, 2, 3); }");
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("x-data");
    expect(result.phases).toContain("agent-native:clipboard-render-ready");
    expect(result.phases).toContain("agent-native:runtime-layer-snapshot");
    expect(result.frames).toBe(0);
  } finally {
    await browser.close();
  }
}, 40000);

it("waits for materialized lazy images and their authored load opacity transition", async () => {
  if (!bundled) throw new Error("Clipboard materializer bundle missing");
  const browser = await chromium.launch({ headless: true });
  let release: (() => void) | undefined;
  const responseReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested: (() => void) | undefined;
  const imageRequested = new Promise<void>((resolve) => {
    requested = resolve;
  });
  try {
    const page = await browser.newPage();
    await page.route(
      "https://images.example.test/portrait.svg",
      async (route) => {
        requested?.();
        await responseReady;
        await route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
        });
      },
    );
    await page.setContent("<!doctype html><html><body>Editor</body></html>");
    await page.addScriptTag({ content: bundled });
    const capture = page.evaluate(async () => {
      const importer = (
        window as typeof window & {
          ForeignClipboard: {
            renderForeignDesignScreen: (html: string) => Promise<string>;
          };
        }
      ).ForeignClipboard;
      return await importer.renderForeignDesignScreen(
        `<!doctype html><html><body><script>window.addEventListener('load',function(){var image=document.createElement('img');image.loading='lazy';image.style.cssText='width:20px;height:20px;opacity:0;transition:opacity 0.1s';image.onload=function(){this.style.opacity='1';};image.src='https://images.example.test/portrait.svg';document.body.append(image);});</script></body></html>`,
      );
    });
    await imageRequested;
    await page.evaluate(async () => {
      for (let frame = 0; frame < 8; frame += 1)
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
    });
    if (!release) throw new Error("Missing image response resolver");
    release();
    const html = await capture;
    const result = await page.evaluate((value) => {
      const doc = new DOMParser().parseFromString(value, "text/html");
      const image = doc.querySelector("img");
      return {
        opacity: image?.style.opacity,
        src: image?.getAttribute("src"),
        onload: image?.getAttribute("onload"),
      };
    }, html);
    expect(result).toEqual({
      opacity: "1",
      src: "https://images.example.test/portrait.svg",
      onload: null,
    });
  } finally {
    release?.();
    await browser.close();
  }
}, 40000);
