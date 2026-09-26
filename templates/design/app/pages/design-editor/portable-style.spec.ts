// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyPortableStyles,
  applyPortableStyleSnapshotToHtml,
} from "./portable-style";

describe("applyPortableStyles", () => {
  it("never sets position, even when a (malformed) snapshot includes it", () => {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.left = "40px";
    el.style.top = "20px";
    applyPortableStyles(el, {
      position: "static",
      color: "rgb(10, 20, 30)",
      fontFamily: "Georgia",
    });
    expect(el.style.color).toBe("rgb(10, 20, 30)");
    expect(el.style.fontFamily).toBe("Georgia");
    expect(el.style.position).toBe("absolute");
    expect(el.style.left).toBe("40px");
    expect(el.style.top).toBe("20px");
  });

  it("still filters editor-internal CSS custom properties", () => {
    const el = document.createElement("div");
    applyPortableStyles(el, {
      "--design-editor-accent-color": "red",
      "--brand-primary-500": "blue",
    });
    expect(el.style.getPropertyValue("--design-editor-accent-color")).toBe("");
    expect(el.style.getPropertyValue("--brand-primary-500")).toBe("blue");
  });
});

describe("applyPortableStyleSnapshotToHtml", () => {
  const DEST_BARE_SCREEN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="dropped" style="position:absolute;left:12px;top:8px;"></div>
</body></html>`;

  it("applies only the carried appearance properties, never position/box properties", () => {
    const result = applyPortableStyleSnapshotToHtml(
      DEST_BARE_SCREEN,
      "dropped",
      {
        version: 1,
        rootSourceId: "dropped",
        nodes: [
          {
            sourceId: "dropped",
            path: [],
            styles: {
              color: "rgb(255, 255, 255)",
              fontFamily: "Georgia",
              width: "60px",
              height: "60px",
              position: "static",
            },
          },
        ],
      },
    );
    const doc = new DOMParser().parseFromString(result, "text/html");
    const dropped = doc.querySelector(
      '[data-agent-native-node-id="dropped"]',
    ) as HTMLElement;
    expect(dropped.style.color).toBe("rgb(255, 255, 255)");
    expect(dropped.style.fontFamily).toBe("Georgia");
    expect(dropped.style.width).toBe("60px");
    expect(dropped.style.height).toBe("60px");
    expect(dropped.style.position).toBe("absolute");
    expect(dropped.style.left).toBe("12px");
    expect(dropped.style.top).toBe("8px");
  });

  it("is a no-op when the snapshot has nothing left after filtering", () => {
    const result = applyPortableStyleSnapshotToHtml(
      DEST_BARE_SCREEN,
      "dropped",
      {
        version: 1,
        rootSourceId: "dropped",
        nodes: [
          { sourceId: "dropped", path: [], styles: { position: "absolute" } },
        ],
      },
    );
    expect(result).toBe(DEST_BARE_SCREEN);
  });

  it("is a safe no-op for a LEGITIMATELY absent snapshot (nothing to carry) — not a lost/corrupted node", () => {
    const result = applyPortableStyleSnapshotToHtml(
      DEST_BARE_SCREEN,
      "dropped",
      undefined,
    );
    expect(result).toBe(DEST_BARE_SCREEN);
  });

  it("recognizes a raw legacy Group wrapper when carrying portable styles", () => {
    const content = `<!doctype html><html><body><div data-agent-native-node-id="an-legacygroup" layer-name="Group" data-agent-native-preserve-styles="true"></div></body></html>`;
    const result = applyPortableStyleSnapshotToHtml(content, "an-legacygroup", {
      version: 1,
      rootSourceId: "an-legacygroup",
      nodes: [
        {
          sourceId: "an-legacygroup",
          path: [],
          styles: { color: "rgb(255, 255, 255)" },
        },
      ],
    });

    expect(result).toContain('layer-name="Group"');
    expect(result).toContain('data-agent-native-preserve-styles="true"');
    expect(result).not.toContain('data-agent-native-clone-root="true"');
  });
});

const requireFromDesign = createRequire(
  path.resolve(process.cwd(), "package.json"),
);
const requireFromPlaywright = createRequire(
  requireFromDesign.resolve("@playwright/test"),
);
const { chromium } = requireFromPlaywright("playwright");
const { buildSync, transformSync } = requireFromDesign("esbuild");
const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_SOURCE =
  process.env.PORTABLE_CAPTURE_SOURCE ||
  path.resolve(
    SPEC_DIR,
    "../../components/design/bridge/editor-chrome.bridge.ts",
  );
const PORTABLE_STYLE_SOURCE =
  process.env.PORTABLE_STYLE_MODULE_SOURCE ||
  path.join(SPEC_DIR, "portable-style.ts");
const CAPTURE_START = "var PORTABLE_STYLE_PROPERTIES = [";
const CAPTURE_END = "// Raw authored (not computed)";

function extractCapture(sourcePath: string): string {
  const source = readFileSync(sourcePath, "utf8");
  const start = source.indexOf(CAPTURE_START);
  const end = source.indexOf(CAPTURE_END, start);
  if (start < 0 || end < 0)
    throw new Error(`Typed OM capture block not found in ${sourcePath}`);
  return transformSync(source.slice(start, end), { loader: "ts" }).code;
}

function loadPortableStyleSource(): string {
  const result = buildSync({
    entryPoints: [PORTABLE_STYLE_SOURCE],
    absWorkingDir: SPEC_DIR,
    alias: { "@shared": path.resolve(SPEC_DIR, "../../../shared") },
    bundle: true,
    format: "cjs",
    platform: "browser",
    write: false,
  });
  return result.outputFiles[0]?.text ?? "";
}

describe("portable-style source capture and rendered Chromium behavior", () => {
  let browser: any;
  let page: any;
  let captureSource: string;
  let portableStyleSource: string;

  beforeAll(async () => {
    captureSource = extractCapture(BRIDGE_SOURCE);
    portableStyleSource = loadPortableStyleSource();
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  });

  afterAll(async () => browser?.close());

  async function capture(rootSelector: string) {
    return page.evaluate(
      ({
        captureSource,
        rootSelector,
      }: {
        captureSource: string;
        rootSelector: string;
      }) => {
        const collect = new Function(
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
        return collect(document.querySelector(rootSelector));
      },
      { captureSource, rootSelector },
    );
  }

  async function apply(
    html: string,
    nodeId: string,
    snapshot: unknown,
    sourceHtml?: string,
  ) {
    return page.evaluate(
      ({
        portableStyleSource,
        html,
        nodeId,
        snapshot,
        sourceHtml,
      }: {
        portableStyleSource: string;
        html: string;
        nodeId: string;
        snapshot: unknown;
        sourceHtml?: string;
      }) => {
        const moduleObject: {
          exports: Record<string, (...args: any[]) => string>;
        } = { exports: {} };
        new Function("module", "exports", portableStyleSource)(
          moduleObject,
          moduleObject.exports,
        );
        return sourceHtml === undefined
          ? moduleObject.exports.applyPortableStyleSnapshotToHtml(
              html,
              nodeId,
              snapshot,
            )
          : moduleObject.exports.applyPortableStyleSnapshotToHtml(
              html,
              nodeId,
              snapshot,
              sourceHtml,
            );
      },
      { portableStyleSource, html, nodeId, snapshot, sourceHtml },
    );
  }

  it("carries inherited appearance when matching head markup has different body context", async () => {
    const head = `<head><style>.dark .card { color: white; }</style></head>`;
    const sourceHtml = `<!doctype html><html>${head}<body class="dark"><div class="card" data-agent-native-node-id="dropped"></div></body></html>`;
    const destHtml = `<!doctype html><html>${head}<body><div class="card" data-agent-native-node-id="dropped" style="position:absolute;left:12px;top:8px"></div></body></html>`;
    await page.setContent(sourceHtml);
    const snapshot = await capture('[data-agent-native-node-id="dropped"]');
    expect(snapshot.nodes[0].styles.color).toBe("rgb(255, 255, 255)");
    const applied = await apply(destHtml, "dropped", snapshot, sourceHtml);
    await page.setContent(applied);
    const rendered = await page
      .locator('[data-agent-native-node-id="dropped"]')
      .evaluate((el: Element) => getComputedStyle(el).color);
    expect(rendered).toBe("rgb(255, 255, 255)");
    expect(
      await page
        .locator('[data-agent-native-node-id="dropped"]')
        .evaluate((el: Element) => (el as HTMLElement).style.position),
    ).toBe("absolute");
  });

  it("keeps auto, percent, and calc responsive to a breakpoint-driven containing block; rem is canonical px", async () => {
    const html = `<!doctype html><html><head><style>
      html { font-size: 16px; }
      .responsive { width: 80vw; }
      @media (min-width: 600px) { .responsive { width: 60vw; } }
      .percent { width: 50%; }
      .calculated { width: calc(100% - 20px); }
      .rem-size { width: 10rem; }
    </style></head><body><div class="responsive"><section id="dropped" data-agent-native-node-id="dropped">
      <div id="percent" class="percent"></div><div id="calculated" class="calculated"></div>
      <div id="natural-auto"></div><div id="rem" class="rem-size"></div>
    </section></div></body></html>`;
    await page.setViewportSize({ width: 400, height: 800 });
    await page.setContent(html);
    const snapshot = await capture("#dropped");
    const byId = new Map<string, { styles: Record<string, string> }>(
      snapshot.nodes.map((node: any) => [node.sourceId, node]),
    );
    expect(byId.get("percent")?.styles.width).toBe("50%");
    expect(byId.get("calculated")?.styles.width).toBe("calc(100% - 20px)");
    expect(byId.get("natural-auto")?.styles).not.toHaveProperty("width");
    expect(byId.get("rem")?.styles.width).toBe("160px");

    const applied = await apply(html, "dropped", snapshot);
    await page.setContent(applied);
    const widthsAt = async (width: number) => {
      await page.setViewportSize({ width, height: 800 });
      return page.evaluate(() =>
        Object.fromEntries(
          ["dropped", "percent", "calculated", "natural-auto", "rem"].map(
            (id) => {
              const el = document.getElementById(id)!;
              return [id, Math.round(el.getBoundingClientRect().width)];
            },
          ),
        ),
      );
    };
    const narrow = await widthsAt(400);
    const wide = await widthsAt(800);
    expect(narrow).toMatchObject({
      dropped: 320,
      percent: 160,
      calculated: 300,
      "natural-auto": 320,
      rem: 160,
    });
    expect(wide).toMatchObject({
      dropped: 480,
      percent: 240,
      calculated: 460,
      "natural-auto": 480,
      rem: 160,
    });
    // This proves relative values still respond to container/viewport sizing;
    // it does not promise replay of future stylesheet declaration changes.
  });
});
