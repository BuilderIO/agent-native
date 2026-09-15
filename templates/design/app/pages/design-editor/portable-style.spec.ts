// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Regression coverage for the cross-screen alt-drag duplicate bug: a dropped
 * copy carried an unrelated ~50-property computed-style dump (position,
 * width, height, opacity, z-index, transform:none, ...) instead of just the
 * appearance the source inherited from its old stylesheet context, and
 * `position` in that dump raced the drop's own placement write. See
 * app/pages/design-editor/commands/cross-screen-element-drop.ts (the
 * `applyPortableStyleSnapshotToHtml` call) and editor-chrome.bridge.ts's
 * `collectPortableComputedStyles`, which now diffs against a bare-tag probe
 * before including a property. The final tests below exercise actual capture
 * and rendered application in Chromium; the earlier tests also pin the
 * DOM-independent apply contract.
 */
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
    // Appearance properties land...
    expect(el.style.color).toBe("rgb(10, 20, 30)");
    expect(el.style.fontFamily).toBe("Georgia");
    // ...but position/left/top, which the drop itself owns, are untouched.
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
  // A source dropped inside a styled parent (dark card: white text, serif
  // font) that never authored those properties itself — they were inherited.
  // Once diffed against tag defaults, a correct snapshot carries only the
  // inherited appearance (color, fontFamily), never position/box properties.
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
              // Same size as the source is correct duplicate/move semantics
              // ("same appearance, only position differs") and must survive.
              width: "60px",
              height: "60px",
              // A stale/legacy snapshot might still carry this — the apply
              // boundary must drop it regardless of what collection sends,
              // since the drop itself already decided where this node sits.
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
    // The drop already placed this node absolutely — the snapshot must not
    // have touched position/left/top.
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
    // `undefined` means "nothing to carry" (isDocumentRootElement / no root /
    // not asked for) — this is the ordinary case for e.g. a paste or a drop
    // whose source never had a portable-style snapshot at all, and this
    // function's job is only to apply what it was given, safely, never to
    // decide whether the move itself should proceed.
    //
    // A CAPTURE FAILURE (the bare-tag probe iframe couldn't be created) is a
    // different value entirely — the bridge marks it with the
    // `styleSnapshotCaptureFailed` flag alongside `styleSnapshot: null` — and
    // is refused at the command boundary in cross-screen-element-drop.ts
    // BEFORE this function is ever called, so a capture failure never reaches
    // here as a plain `undefined`. See
    // "runCrossScreenElementDrop — portable style capture failure" in
    // cross-screen-element-drop.spec.ts for that refusal contract.
    const result = applyPortableStyleSnapshotToHtml(
      DEST_BARE_SCREEN,
      "dropped",
      undefined,
    );
    expect(result).toBe(DEST_BARE_SCREEN);
  });
});

// Exercise the actual source capture and apply functions in Chromium.
const requireFromDesign = createRequire(
  path.resolve(process.cwd(), "package.json"),
);
const requireFromPlaywright = createRequire(
  requireFromDesign.resolve("@playwright/test"),
);
const { chromium } = requireFromPlaywright("playwright");
const { transformSync } = requireFromDesign("esbuild");
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
  return transformSync(readFileSync(PORTABLE_STYLE_SOURCE, "utf8"), {
    loader: "ts",
    format: "cjs",
  }).code;
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
        // Supplying the legacy fourth argument makes this regression fail on
        // the old head-equality short-circuit. The new three-argument API
        // ignores it; the real drop caller no longer supplies it.
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
