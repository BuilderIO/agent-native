import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { appendContentSizeReporter } from "./content-size-report";

const RULE_COUNT = 400;

function documentWithManyRules(): string {
  const rules = Array.from(
    { length: RULE_COUNT },
    (_, index) =>
      `.rule-${index} { color: #123456; padding: ${index % 7}px; margin: 1px; }`,
  ).join("\n");
  return appendContentSizeReporter(
    `<!doctype html><html><head><style>${rules}</style></head><body><main id="content" class="rule-1">Hello</main></body></html>`,
  );
}

async function settledPage(): Promise<{
  page: Page;
  close: () => Promise<void>;
}> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(documentWithManyRules());
  await page.waitForTimeout(1_200);
  await page.evaluate(() => {
    const counter = window as Window & { __reads?: number };
    counter.__reads = 0;
    const original = CSSStyleDeclaration.prototype.getPropertyValue;
    CSSStyleDeclaration.prototype.getPropertyValue = function (name) {
      counter.__reads! += 1;
      return original.call(this, name);
    };
  });
  return { page, close: () => browser.close() };
}

function styleReadsAfter(page: Page, mutate: () => void): Promise<number> {
  return page
    .evaluate(mutate)
    .then(() => page.waitForTimeout(150))
    .then(() =>
      page.evaluate(
        () => (window as Window & { __reads?: number }).__reads ?? 0,
      ),
    );
}

describe("content size reporter cost", () => {
  it("ignores the editor rescaling its chrome on <html>", async () => {
    const { page, close } = await settledPage();
    try {
      const reads = await styleReadsAfter(page, () => {
        document.documentElement.style.setProperty(
          "--agent-native-editor-chrome-scale-x",
          "2.5",
        );
      });
      expect(reads).toBe(0);
    } finally {
      await close();
    }
  });

  it("re-measures an authored change without re-walking settled stylesheets", async () => {
    const { page, close } = await settledPage();
    try {
      const reads = await styleReadsAfter(page, () => {
        document.getElementById("content")!.setAttribute("class", "rule-2");
      });
      expect(reads).toBeLessThan(RULE_COUNT);
      expect(
        await page.evaluate(
          () => getComputedStyle(document.getElementById("content")!).padding,
        ),
      ).toBe("2px");
    } finally {
      await close();
    }
  });

  it("still remaps viewport units in a stylesheet added after load", async () => {
    const { page, close } = await settledPage();
    try {
      await page.evaluate(() => {
        const style = document.createElement("style");
        style.textContent = ".late { height: 50vh; }";
        document.head.appendChild(style);
      });
      await page.waitForTimeout(150);
      const height = await page.evaluate(() => {
        const sheet = [...document.styleSheets].find((candidate) =>
          [...candidate.cssRules].some(
            (rule) => (rule as CSSStyleRule).selectorText === ".late",
          ),
        )!;
        return (sheet.cssRules[0] as CSSStyleRule).style.height;
      });
      expect(height).toContain("--agent-native-device-vh");
    } finally {
      await close();
    }
  });
});
