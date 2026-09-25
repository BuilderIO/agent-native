// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const requireFromDesign = createRequire(
  path.resolve(process.cwd(), "package.json"),
);
const { chromium } = requireFromDesign("@playwright/test");
const { transformSync } = requireFromDesign("esbuild");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = path.join(HERE, "editor-chrome.bridge.ts");
const SOURCE_PATH = process.env.PORTABLE_STYLE_BRIDGE_SOURCE || DEFAULT_SOURCE;
const START_MARKER = "var PORTABLE_STYLE_PROPERTIES = [";
const END_MARKER = "// Raw authored (not computed)";

function extractCaptureSource(sourcePath: string): string {
  const source = readFileSync(sourcePath, "utf8");
  const start = source.indexOf(START_MARKER);
  const end = source.indexOf(END_MARKER, start);
  if (start < 0 || end < 0) {
    throw new Error(`Portable style capture block not found in ${sourcePath}`);
  }
  return transformSync(source.slice(start, end), { loader: "ts" }).code;
}

describe("portable style Typed OM capture from bridge source", () => {
  let browser: any;
  let page: any;
  let captureSource: string;

  beforeAll(async () => {
    captureSource = extractCaptureSource(SOURCE_PATH);
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setContent(`<!doctype html>
      <html><head><style>
        html { font-size: 16px; }
        #parent { width: 400px; height: 240px; }
        .auto-important { width: auto !important; height: auto !important; }
        .pixel-important { width: 320px !important; height: 120px !important; }
        .rem-important { width: 1px !important; height: 1px !important; }
        .nested-host { & > .nested-rule { width: 37%; height: calc(25% + 3px); } }
        .percent { width: 50%; height: 50%; }
        .calculated { width: calc(50% - 12px); height: calc(50% - 8px); }
        .rem-sized { width: 10rem; height: 5rem; }
      </style></head><body>
        <style>@import url("data:text/css,.imported%7Bwidth%3A280px%3Bheight%3A90px%7D");</style>
        <div id="parent">
          <div id="auto-inline" class="auto-important" style="width:auto;height:auto"></div>
          <div id="auto-overrides-inline" class="auto-important" style="width:220px;height:90px"></div>
          <div id="important-beats-inline" class="pixel-important" style="width:auto;height:auto"></div>
          <div id="inline-rem-beats-important" class="rem-important" style="width:10rem!important;height:5rem!important"></div>
          <div id="percent" class="percent"></div>
          <div id="calculated" class="calculated"></div>
          <div id="rem" class="rem-sized"></div>
          <div id="imported" class="imported"></div>
          <div id="adopted"></div>
          <section id="nested"><i id="nested-first"><b id="nested-grandchild"></b></i><div id="nested-child" class="percent"></div></section>
          <section id="nested-css" class="nested-host"><div id="nested-css-child" class="nested-rule"></div></section>
          <span id="natural-auto"></span>
        </div>
      </body></html>`);
    await page.waitForFunction(() => {
      const imported = document.querySelector("#imported") as Element;
      return imported.computedStyleMap().get("width")?.toString() === "280px";
    });
    await page.evaluate(() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync("#adopted { width: 260px; height: 80px; }");
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    });
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function stylesFor(
    selector: string,
  ): Promise<Record<string, string> | null> {
    return page.evaluate(
      ({
        selector,
        captureSource,
      }: {
        selector: string;
        captureSource: string;
      }) => {
        const capture = new Function(
          "window",
          "document",
          "dndLog",
          "getSourceId",
          "getSelector",
          "isDocumentRootElement",
          `${captureSource}\nreturn collectPortableStyleSnapshot;`,
        )(
          window,
          document,
          () => undefined,
          (el: Element) => el.id || undefined,
          (el: Element) => el.tagName.toLowerCase(),
          () => false,
        );
        const snapshot = capture(document.querySelector(selector));
        return snapshot?.nodes?.[0]?.styles ?? null;
      },
      { selector, captureSource },
    );
  }

  async function nativeSize(selector: string, property: "width" | "height") {
    return page
      .locator(selector)
      .evaluate((element: Element, property: "width" | "height") => {
        const value = (
          element as Element & { computedStyleMap: () => StylePropertyMap }
        )
          .computedStyleMap()
          .get(property);
        return value == null ? null : String(value).trim();
      }, property);
  }

  it("captures the winning computed size, including explicit auto", async () => {
    const auto = await stylesFor("#auto-inline");
    expect(auto?.width).toBe(await nativeSize("#auto-inline", "width"));
    expect(auto?.height).toBe(await nativeSize("#auto-inline", "height"));
    expect(auto?.width).toBe("auto");
    expect(auto?.height).toBe("auto");

    const overriddenInline = await stylesFor("#auto-overrides-inline");
    expect(overriddenInline?.width).toBe("auto");
    expect(overriddenInline?.height).toBe("auto");
    const naturalAuto = await stylesFor("#natural-auto");
    expect(naturalAuto).not.toHaveProperty("width");
    expect(naturalAuto).not.toHaveProperty("height");

    const important = await stylesFor("#important-beats-inline");
    expect(important?.width).toBe(
      await nativeSize("#important-beats-inline", "width"),
    );
    expect(important?.height).toBe(
      await nativeSize("#important-beats-inline", "height"),
    );
    expect(important?.width).toBe("320px");
    expect(important?.height).toBe("120px");
  });

  it("captures native canonical values for inline important, %, calc, rem, import, adoption, and nested nodes", async () => {
    const cases = [
      ["#inline-rem-beats-important", "160px", "80px"],
      ["#percent", "50%", "50%"],
      ["#calculated", "calc(50% - 12px)", "calc(50% - 8px)"],
      ["#rem", "160px", "80px"],
      ["#imported", "280px", "90px"],
      ["#adopted", "260px", "80px"],
      ["#nested-child", "50%", "50%"],
      ["#nested-css-child", "37%", "calc(25% + 3px)"],
    ] as const;
    for (const [selector, expectedWidth, expectedHeight] of cases) {
      const styles = await stylesFor(selector);
      expect(styles?.width, `${selector} width`).toBe(
        await nativeSize(selector, "width"),
      );
      expect(styles?.height, `${selector} height`).toBe(
        await nativeSize(selector, "height"),
      );
      expect(styles?.width, `${selector} width`).toBe(expectedWidth);
      expect(styles?.height, `${selector} height`).toBe(expectedHeight);
    }

    const nestedSnapshot = await page.evaluate(
      ({ captureSource }: { captureSource: string }) => {
        const capture = new Function(
          "window",
          "document",
          "dndLog",
          "getSourceId",
          "getSelector",
          "isDocumentRootElement",
          `${captureSource}\nreturn collectPortableStyleSnapshot;`,
        )(
          window,
          document,
          () => undefined,
          (el: Element) => el.id || undefined,
          (el: Element) => el.tagName.toLowerCase(),
          () => false,
        );
        return capture(document.querySelector("#nested"));
      },
      { captureSource },
    );
    expect(
      nestedSnapshot.nodes.map((node: { sourceId?: string }) => node.sourceId),
    ).toEqual(["nested", "nested-first", "nested-grandchild", "nested-child"]);
    expect(
      nestedSnapshot.nodes.map((node: { path: number[] }) => node.path),
    ).toEqual([[], [0], [0, 0], [1]]);
    expect(nestedSnapshot.nodes[3].styles.width).toBe(
      await nativeSize("#nested-child", "width"),
    );
  });

  it(
    "captures complete snapshots through the clipboard limit and refuses larger trees before style reads",
    { timeout: 30_000 },
    async () => {
      const counts = await page.evaluate(
        ({ captureSource }: { captureSource: string }) => {
          const capture = new Function(
            "window",
            "document",
            "dndLog",
            "getSourceId",
            "getSelector",
            "isDocumentRootElement",
            `${captureSource}\nreturn collectPortableStyleSnapshot;`,
          )(
            window,
            document,
            () => undefined,
            (el: Element) => el.id || undefined,
            (el: Element) => el.tagName.toLowerCase(),
            () => false,
          );
          function makeTree(descendantCount: number, markLast = false) {
            const root = document.createElement("div");
            for (let index = 0; index < descendantCount; index += 1) {
              const child = document.createElement("span");
              if (markLast && index === descendantCount - 1) {
                child.style.color = "rgb(1, 2, 3)";
              }
              root.appendChild(child);
            }
            document.body.appendChild(root);
            const snapshot = capture(root);
            root.remove();
            return snapshot;
          }
          const atLimit = makeTree(79);
          const eightyOne = makeTree(80, true);
          const clipboardLimit = makeTree(4999);
          const tooLargeRoot = document.createElement("div");
          for (let index = 0; index < 5000; index += 1) {
            tooLargeRoot.appendChild(document.createElement("span"));
          }
          document.body.appendChild(tooLargeRoot);
          const originalDescriptor = Object.getOwnPropertyDescriptor(
            window,
            "getComputedStyle",
          )!;
          const originalGetComputedStyle = window.getComputedStyle.bind(window);
          let computedStyleReads = 0;
          Object.defineProperty(window, "getComputedStyle", {
            configurable: true,
            value: (...args: Parameters<typeof window.getComputedStyle>) => {
              computedStyleReads += 1;
              return originalGetComputedStyle(...args);
            },
          });
          let overLimit;
          try {
            overLimit = capture(tooLargeRoot);
          } finally {
            Object.defineProperty(
              window,
              "getComputedStyle",
              originalDescriptor,
            );
            tooLargeRoot.remove();
          }
          return {
            atLimit: atLimit?.nodes?.length ?? null,
            eightyOne: eightyOne?.nodes?.length ?? null,
            lastColor: eightyOne?.nodes?.at(-1)?.styles?.color,
            lastPath: eightyOne?.nodes?.at(-1)?.path,
            clipboardLimit: clipboardLimit?.nodes?.length ?? null,
            clipboardLastPath: clipboardLimit?.nodes?.at(-1)?.path,
            overLimitIsNull: overLimit === null,
            computedStyleReads,
          };
        },
        { captureSource },
      );
      expect(counts.atLimit).toBe(80);
      expect(counts.eightyOne).toBe(81);
      expect(counts.lastColor).toBe("rgb(1, 2, 3)");
      expect(counts.lastPath).toEqual([79]);
      expect(counts.clipboardLimit).toBe(5000);
      expect(counts.clipboardLastPath).toEqual([4998]);
      expect(counts.overLimitIsNull).toBe(true);
      expect(counts.computedStyleReads).toBe(0);
    },
  );

  it.each([
    [
      "root",
      (el: Element) =>
        Object.defineProperty(el, "computedStyleMap", { value: undefined }),
    ],
    [
      "descendant",
      (el: Element) =>
        Object.defineProperty(el, "computedStyleMap", { value: undefined }),
    ],
  ])(
    "continues the style snapshot when Typed OM is unavailable on the %s",
    async (patchTarget, patchElement) => {
      const result = await page.evaluate(
        ({
          captureSource,
          patchElement,
          patchTarget,
        }: {
          captureSource: string;
          patchElement: string;
          patchTarget: string;
        }) => {
          const capture = new Function(
            "window",
            "document",
            "dndLog",
            "getSourceId",
            "getSelector",
            "isDocumentRootElement",
            "patchElement",
            `${captureSource}\nreturn collectPortableStyleSnapshot;`,
          )(
            window,
            document,
            () => undefined,
            (el: Element) => el.id || undefined,
            (el: Element) => el.tagName.toLowerCase(),
            () => false,
            patchElement,
          );
          const target = document
            .querySelector("#important-beats-inline")!
            .cloneNode(true) as Element;
          target.id = `failure-${Math.random()}`;
          (target as HTMLElement).style.color = "rgb(1, 2, 3)";
          const child = document.createElement("span");
          child.style.cssText =
            "width: 77px; height: 31px; color: rgb(4, 5, 6)";
          target.appendChild(child);
          document.body.appendChild(target);
          const patched =
            patchTarget === "descendant" ? target.firstElementChild! : target;
          new Function("el", `(${patchElement})(el);`)(patched);
          const snapshot = capture(target);
          const inlineWidth = (target as HTMLElement).style.width;
          target.remove();
          return { snapshot, inlineWidth };
        },
        { captureSource, patchElement: patchElement.toString(), patchTarget },
      );
      expect(result.snapshot?.nodes).toHaveLength(2);
      expect(result.snapshot?.nodes[0]?.styles.color).toBe("rgb(1, 2, 3)");
      expect(result.snapshot?.nodes[1]?.styles.color).toBe("rgb(4, 5, 6)");
      expect(result.inlineWidth).toBe("auto");
      expect(result.snapshot?.nodes[0]?.styles.width).toBe(
        patchTarget === "root" ? undefined : "320px",
      );
    },
  );

  it.each([
    [
      "throwing API",
      (el: Element) =>
        Object.defineProperty(el, "computedStyleMap", {
          value: () => {
            throw new Error("blocked");
          },
        }),
    ],
    [
      "missing value",
      (el: Element) =>
        Object.defineProperty(el, "computedStyleMap", {
          value: () => ({
            get: (property: string) =>
              property === "width" ? null : { toString: () => "auto" },
          }),
        }),
    ],
  ])(
    "refuses the snapshot when Typed OM has %s",
    async (_name, patchElement) => {
      const result = await page.evaluate(
        ({
          captureSource,
          patchElement,
        }: {
          captureSource: string;
          patchElement: string;
        }) => {
          const capture = new Function(
            "window",
            "document",
            "dndLog",
            "getSourceId",
            "getSelector",
            "isDocumentRootElement",
            `${captureSource}\nreturn collectPortableStyleSnapshot;`,
          )(
            window,
            document,
            () => undefined,
            (el: Element) => el.id || undefined,
            (el: Element) => el.tagName.toLowerCase(),
            () => false,
          );
          const target = document
            .querySelector("#important-beats-inline")!
            .cloneNode(true) as Element;
          target.id = `failure-${Math.random()}`;
          document.body.appendChild(target);
          new Function("el", `(${patchElement})(el);`)(target);
          const snapshot = capture(target);
          target.remove();
          return snapshot;
        },
        { captureSource, patchElement: patchElement.toString() },
      );
      expect(result).toBeNull();
    },
  );
});
