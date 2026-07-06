/**
 * Guard tests for the bridge compile-time pipeline.
 *
 * Three invariants enforced here:
 *
 * 1. NO runtime imports — every *.bridge.ts source must be free of
 *    `import … from` and `require(` statements (type-only imports that are
 *    erased by tsc are caught here too; authors should simply not import
 *    anything rather than relying on the "type-only erasure" loophole, since
 *    the esbuild step would bundle them inline anyway).
 *
 * 2. BRIDGE TSCONFIG CLEAN — `tsc -p bridge/tsconfig.json` must exit 0,
 *    proving every *.bridge.ts is valid under the scoped DOM-only environment
 *    with no app path aliases. This catches app type leaks at CI time.
 *
 * 3. FRESHNESS — the committed .generated/bridge/*.generated.ts content must
 *    exactly match what re-running codegen produces right now. If a *.bridge.ts
 *    was edited without re-running codegen, this test fails with a diff.
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const designRoot = resolve(__dirname, "../../../..");
const bridgeDir = __dirname;
const generatedDir = join(designRoot, ".generated", "bridge");

// ── helpers ────────────────────────────────────────────────────────────────

function getBridgeFiles(): string[] {
  return readdirSync(bridgeDir)
    .filter((f) => f.endsWith(".bridge.ts"))
    .sort();
}

function generatedPath(bridgeFilename: string): string {
  const name = bridgeFilename.replace(/\.bridge\.ts$/, "");
  return join(generatedDir, `${name}.generated.ts`);
}

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("bridge-guard"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false");
}

// Same hydration but with text editing enabled, for the text-editing-session
// behavioral tests below (T2/T3/T5/T11/T12/T19/T20/T21).
function hydratedEditorChromeBridgeScriptWithTextEditing(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("bridge-guard"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false");
}

// ── test 1: no runtime imports ─────────────────────────────────────────────

describe("bridge source files", () => {
  const bridgeFiles = getBridgeFiles();

  it("has at least one *.bridge.ts file", () => {
    expect(bridgeFiles.length).toBeGreaterThan(0);
  });

  for (const filename of bridgeFiles) {
    it(`${filename} — no runtime import/require statements`, () => {
      const src = readFileSync(join(bridgeDir, filename), "utf-8");

      // Strip line comments so we don't flag commented-out examples.
      const stripped = src.replace(/\/\/[^\n]*/g, "");

      // Strip block comments.
      const noComments = stripped.replace(/\/\*[\s\S]*?\*\//g, "");

      const hasImport = /\bimport\s+(?:type\s+)?(?:\*|{|[a-zA-Z_$])/.test(
        noComments,
      );
      const hasRequire = /\brequire\s*\(/.test(noComments);

      expect(
        hasImport || hasRequire,
        `${filename} contains a runtime import or require — bridge files must be self-contained (DOM globals only).\n` +
          `If you need a type import for documentation purposes, write it as a JSDoc comment instead.`,
      ).toBe(false);
    });
  }
});

// ── test 2: bridge tsconfig clean ──────────────────────────────────────────

it(
  "bridge tsconfig — tsc -p bridge/tsconfig.json exits clean",
  { timeout: 30_000 },
  () => {
    const tsconfigPath = join(bridgeDir, "tsconfig.json");
    let output = "";
    let failed = false;
    try {
      output = execSync(`pnpm exec tsc --noEmit -p "${tsconfigPath}"`, {
        cwd: designRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err: unknown) {
      failed = true;
      const e = err as { stdout?: string; stderr?: string; message?: string };
      output = (e.stdout ?? "") + (e.stderr ?? "") + (e.message ?? "");
    }

    expect(failed, `bridge tsconfig type-check failed:\n${output}`).toBe(false);
  },
);

// ── test 3: generated output is fresh ──────────────────────────────────────

describe("generated bridge modules", () => {
  const bridgeFiles = getBridgeFiles();

  for (const filename of bridgeFiles) {
    it(`${filename} → .generated/bridge/${filename.replace(".bridge.ts", ".generated.ts")} is up to date`, async () => {
      const outPath = generatedPath(filename);

      // Ensure a generated file exists at all.
      expect(
        existsSync(outPath),
        `Missing generated file for ${filename}. Run: pnpm exec tsx app/components/design/bridge/codegen.ts`,
      ).toBe(true);

      const committed = readFileSync(outPath, "utf-8");

      // Re-run codegen for just this bridge file into a temp path and compare.
      const tempPath = outPath + ".tmp";
      try {
        // Import codegen internals directly rather than spawning a subprocess,
        // so we can compare output cheaply within the test runner.
        const esbuild = await import("esbuild");

        const srcFile = join(bridgeDir, filename);
        const result = await esbuild.build({
          entryPoints: [srcFile],
          bundle: true,
          format: "iife",
          platform: "browser",
          target: "es2020",
          write: false,
          external: [],
        });

        if (result.errors.length > 0) {
          const msgs = await esbuild.formatMessages(result.errors, {
            kind: "error",
          });
          throw new Error(`esbuild error for ${filename}:\n${msgs.join("\n")}`);
        }

        const compiled = result.outputFiles[0]?.text ?? "";

        // Build the expected generated module src using the same logic as codegen.ts.
        const name = filename.replace(/\.bridge\.ts$/, "");
        const camelCaseName = name.replace(
          /[-_]([a-z])/g,
          (_: string, c: string) => c.toUpperCase(),
        );
        const escaped = compiled
          .replace(/\\/g, "\\\\")
          .replace(/`/g, "\\`")
          .replace(/\$\{/g, "\\${");

        const expected =
          `// AUTO-GENERATED by bridge/codegen.ts — do not edit manually.\n` +
          `// Run: pnpm exec tsx app/components/design/bridge/codegen.ts\n` +
          `\n` +
          `/** Compiled IIFE string for ${name}.bridge.ts — inject into an iframe via srcdoc or a <script> tag. */\n` +
          `export const ${camelCaseName}BridgeScript: string = \`${escaped}\`;\n`;

        writeFileSync(tempPath, expected, "utf-8");

        expect(
          committed,
          `Generated file for ${filename} is stale. Re-run:\n  pnpm exec tsx app/components/design/bridge/codegen.ts`,
        ).toBe(expected);
      } finally {
        if (existsSync(tempPath)) rmSync(tempPath);
      }
    });
  }
});

it(
  "editor chrome bridge lets plain wheel scroll the underlying app shell",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
      #app-shell { width: 100%; height: 100%; overflow-y: auto; overflow-x: hidden; }
      .hero { height: 280px; background: #eef; }
      .content { height: 2200px; padding: 32px; }
    </style>
  </head>
  <body>
    <div id="app-shell" data-agent-native-node-id="app-shell">
      <section class="hero" data-agent-native-node-id="hero">Top</section>
      <main class="content" data-agent-native-node-id="content">Deep content</main>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const before = await page
        .locator("#app-shell")
        .evaluate((el) => el.scrollTop);
      await page.mouse.move(450, 350);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(80);
      const after = await page
        .locator("#app-shell")
        .evaluate((el) => el.scrollTop);

      await page.locator("#app-shell").evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.evaluate(() => {
        const shield = document.querySelector(
          '[data-agent-native-edit-overlay="shield"]',
        );
        shield?.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: 450,
            clientY: 350,
            deltaY: 500,
            metaKey: true,
          }),
        );
      });
      await page.waitForTimeout(30);
      const afterMetaWheel = await page
        .locator("#app-shell")
        .evaluate((el) => el.scrollTop);

      expect(after).toBeGreaterThan(before);
      expect(afterMetaWheel).toBe(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge coalesces selection-overlay refreshes across a scroll-event burst",
  { timeout: 30_000 },
  async () => {
    // Regression coverage for the selected-scroll freeze: with an element
    // selected, every scroll event used to run the full overlay pipeline
    // (positionOverlay + selection chrome, with synchronous layout reads)
    // once per event. Trackpads emit several scroll/wheel events per frame,
    // so on layout-heavy pages scrolling froze only while a selection was
    // active. The listener must now coalesce to ≤1 refreshOverlays() per
    // frame (scheduleRefreshOverlays), while still tracking the element.
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; }
      body { height: 4000px; background: white; }
      #target { position: absolute; left: 300px; top: 240px; width: 160px; height: 80px; background: #e9eef8; }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target">Target</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      // Select the target with a plain click (shield pointerdown/up → select).
      await page.mouse.click(380, 280);
      await page.waitForFunction(() => {
        const sel = document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        ) as HTMLElement | null;
        return !!sel && sel.style.display === "block";
      });

      const result = await page.evaluate(async () => {
        const sel = document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        ) as HTMLElement;
        let styleWrites = 0;
        const observer = new MutationObserver((records) => {
          styleWrites += records.length;
        });
        observer.observe(sel, {
          attributes: true,
          attributeFilter: ["style"],
        });

        // Synchronous burst: 30 scroll events with the scroll position moving
        // between each, the way a fast trackpad delivers several per frame.
        // Uncoalesced handling repositions the overlay once per event (4+
        // style writes each → 120+ records); coalesced handling collapses the
        // burst into ≤1 refresh per frame.
        const scroller = document.scrollingElement || document.documentElement;
        for (let i = 0; i < 30; i++) {
          scroller.scrollTop = i * 7;
          window.dispatchEvent(new Event("scroll"));
        }

        // Let the coalesced rAF refresh (plus any browser-generated scroll
        // events from the scrollTop writes) settle across a few frames.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        observer.disconnect();

        const target = document.getElementById("target")!;
        const targetTop = target.getBoundingClientRect().top;
        const overlayTop = parseFloat(sel.style.top || "NaN");
        return { styleWrites, targetTop, overlayTop };
      });

      // Coalesced: a handful of style writes for the whole burst (only
      // style.top actually changes per refresh, and the burst collapses to
      // ≤1 refresh per frame across the settling frames). The uncoalesced
      // regression repositions once per event → ~30 writes.
      expect(result.styleWrites).toBeLessThan(15);
      // The overlay must still track the element's post-scroll position.
      expect(Math.abs(result.overlayTop - result.targetTop)).toBeLessThan(1.5);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge keeps marquee selection alive across host clear-selection replay",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #target { position: absolute; left: 280px; top: 260px; width: 120px; height: 90px; background: #e9eef8; }
    </style>
  </head>
  <body>
    <div id="target">Target</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const marquee = page.locator(
        '[data-agent-native-edit-overlay="marquee-selection"]',
      );
      await page.mouse.move(32, 32);
      await page.mouse.down();
      await page.mouse.move(120, 110);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="marquee-selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.evaluate(() => {
        window.postMessage({ type: "clear-selection" }, "*");
      });
      await page.waitForTimeout(30);
      const duringReplay = await marquee.evaluate(
        (el) => window.getComputedStyle(el).display,
      );

      await page.mouse.up();
      await page.waitForTimeout(30);
      const afterPointerUp = await marquee.evaluate(
        (el) => window.getComputedStyle(el).display,
      );

      expect(duringReplay).toBe("block");
      expect(afterPointerUp).toBe("none");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge cancels an active element drag on Escape",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.addEventListener("message", (event: MessageEvent) => {
          (window as any).__bridgeMessages.push(event.data);
        });
      });

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #target {
        position: absolute;
        left: 120px;
        top: 140px;
        width: 120px;
        height: 48px;
        border: 0;
        border-radius: 8px;
        background: #6366f1;
        color: white;
      }
    </style>
  </head>
  <body>
    <button id="target" data-agent-native-node-id="target-button">Target</button>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(180, 164);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
      });
      await page.mouse.move(180, 164);
      await page.mouse.down();
      await page.mouse.move(260, 224, { steps: 8 });
      await page.waitForFunction(() => {
        const target = document.querySelector<HTMLElement>("#target");
        return target?.style.left !== "120px";
      });

      await page.keyboard.press("Escape");
      await page.mouse.move(300, 260);
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target");
        const computed = target ? window.getComputedStyle(target) : null;
        return {
          left: computed?.left,
          top: computed?.top,
          messageTypes: ((window as any).__bridgeMessages ?? []).map(
            (message: { type?: string }) => message.type,
          ),
        };
      });

      expect(result.left).toBe("120px");
      expect(result.top).toBe("140px");
      expect(result.messageTypes).not.toContain("visual-style-change");
      expect(result.messageTypes).not.toContain("visual-structure-change");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge keeps the previous primary outlined during shift-click multi-select",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      .box { position: absolute; width: 120px; height: 80px; background: #e9eef8; }
      #first { left: 120px; top: 140px; }
      #second { left: 320px; top: 140px; }
    </style>
  </head>
  <body>
    <div id="first" class="box" data-agent-native-node-id="first">First</div>
    <div id="second" class="box" data-agent-native-node-id="second">Second</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: "#first",
            selectorCandidates: ["#first"],
          },
          "*",
        );
      });
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.keyboard.down("Shift");
      await page.mouse.click(340, 160);
      await page.keyboard.up("Shift");

      const previousPrimaryHasPassiveOverlay = await page.evaluate(() => {
        const first = document.querySelector("#first");
        if (!first) return false;
        const firstRect = first.getBoundingClientRect();
        return Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-agent-native-edit-overlay="multi-selection"]',
          ),
        ).some((overlay) => {
          if (window.getComputedStyle(overlay).display === "none") return false;
          const rect = overlay.getBoundingClientRect();
          return (
            Math.abs(rect.left - firstRect.left) < 1 &&
            Math.abs(rect.top - firstRect.top) < 1 &&
            Math.abs(rect.width - firstRect.width) < 1 &&
            Math.abs(rect.height - firstRect.height) < 1
          );
        });
      });

      expect(previousPrimaryHasPassiveOverlay).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Figma-parity in-iframe editing behavior ────────────────────────────────

it(
  "editor chrome bridge shows a live position badge and locks to the dominant axis while Shift is held during a move drag",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #target { position: absolute; left: 200px; top: 200px; width: 80px; height: 60px; background: #e9eef8; }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target">Target</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(240, 230);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      // The bridge's shield-driven drag only calls startMove() once a
      // pointermove first crosses the 3px drag threshold — that threshold-
      // crossing event becomes startMove's own internal reference point, so
      // only pointermoves AFTER it actually translate the element. Move past
      // the threshold first (no steps, so it fires as one discrete event),
      // then issue a second, separate move that startMove's own onMove
      // handler will actually apply.
      await page.mouse.move(240, 230);
      await page.mouse.down();
      await page.mouse.move(250, 240);
      await page.mouse.move(280, 270);

      const draggedPosition = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        return { left: target.style.left, top: target.style.top };
      });
      // startMove's reference point is (250, 240); the next move to
      // (280, 270) is a further +30/+30 delta from origin (200, 200).
      expect(draggedPosition).toEqual({ left: "230px", top: "230px" });

      const badgeText = await page.evaluate(() => {
        const badge = document.querySelector<HTMLElement>(
          "[data-agent-native-transform-badge]",
        );
        return badge && window.getComputedStyle(badge).display !== "none"
          ? badge.textContent
          : null;
      });
      expect(badgeText).toBe("230, 230");

      await page.keyboard.down("Shift");
      await page.mouse.move(400, 400);
      const lockedPosition = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        return { left: target.style.left, top: target.style.top };
      });
      // Dominant axis lock: the larger-magnitude delta wins and the other
      // axis is zeroed EVERY move event (deltas are always computed fresh
      // from the drag's original reference point (250, 240), not
      // incrementally from the previous frame). Moving to (400, 400) is
      // dx=150/dy=160 from that reference — dy is dominant, so dx is zeroed
      // and left snaps back to the origin (200px) while top moves the full
      // dy (200 origin + 160 = 360px).
      expect(lockedPosition.left).toBe("200px");
      expect(lockedPosition.top).toBe("360px");
      await page.keyboard.up("Shift");

      await page.mouse.up();
      await page.waitForTimeout(30);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge snaps a dragged element to a sibling's edge and shows a snap guide, bypassed while Cmd/Ctrl is held",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      .box { position: absolute; width: 100px; height: 80px; background: #e9eef8; }
      #anchor { left: 400px; top: 200px; }
      #target { left: 120px; top: 200px; }
    </style>
  </head>
  <body>
    <div id="anchor" class="box" data-agent-native-node-id="anchor">Anchor</div>
    <div id="target" class="box" data-agent-native-node-id="target">Target</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(170, 240);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      // The bridge's shield-driven drag only calls startMove() once a
      // pointermove first crosses the 3px drag threshold, and that
      // threshold-crossing event becomes startMove's own internal reference
      // point (not the literal mousedown point) — every later delta is
      // computed from there. Cross the threshold first with a small,
      // dedicated move, then compute the final move relative to that same
      // reference point so the target's left edge lands 3px from #anchor's
      // left edge (400px) — within the 6px snap threshold.
      await page.mouse.move(170, 240);
      await page.mouse.down();
      await page.mouse.move(174, 244); // crosses the 3px threshold; becomes the reference point
      // origin left is 120px; target left = 397px (3px from anchor's 400px)
      // needs dx = 397 - 120 = 277 from the (174, 244) reference point.
      await page.mouse.move(174 + 277, 244);

      const snappedLeft = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        return target.style.left;
      });
      expect(snappedLeft).toBe("400px");

      const guideVisible = await page.evaluate(() => {
        const guides = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-agent-native-edit-overlay="snap-guide"]',
          ),
        );
        return guides.some(
          (guide) => window.getComputedStyle(guide).display === "block",
        );
      });
      expect(guideVisible).toBe(true);

      // Holding Cmd/Ctrl bypasses snapping entirely (Figma behavior) — nudge
      // one px further (still well within snap range if snapping were
      // active) and hold Meta so the raw (unsnapped) position is used.
      await page.keyboard.down("Meta");
      await page.mouse.move(174 + 278, 244);
      const bypassedLeft = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        return target.style.left;
      });
      expect(bypassedLeft).not.toBe("400px");
      const guideHiddenDuringBypass = await page.evaluate(() => {
        const guides = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-agent-native-edit-overlay="snap-guide"]',
          ),
        );
        return guides.every(
          (guide) => window.getComputedStyle(guide).display === "none",
        );
      });
      expect(guideHiddenDuringBypass).toBe(true);
      await page.keyboard.up("Meta");

      await page.mouse.up();
      await page.waitForTimeout(30);

      const guidesClearedAfterDrop = await page.evaluate(() => {
        const guides = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-agent-native-edit-overlay="snap-guide"]',
          ),
        );
        return guides.every(
          (guide) => window.getComputedStyle(guide).display === "none",
        );
      });
      expect(guidesClearedAfterDrop).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge renders the hover outline thinner than the selection outline",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      .box { position: absolute; width: 100px; height: 80px; background: #e9eef8; }
      #first { left: 120px; top: 140px; }
      #second { left: 320px; top: 140px; }
    </style>
  </head>
  <body>
    <div id="first" class="box" data-agent-native-node-id="first">First</div>
    <div id="second" class="box" data-agent-native-node-id="second">Second</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      // Select #first so the selection overlay is showing its border width.
      await page.mouse.click(170, 180);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      // Hover #second so the highlight (hover) overlay is also showing.
      await page.mouse.move(370, 180);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="highlight"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      // Read the inline style.borderWidth property directly (the source of
      // truth applyEditorChromeScale writes to) rather than getComputedStyle
      // — these bare overlay divs have no border-style set in this minimal
      // test page, so the computed border-top-width resolves to 0px
      // regardless of the border-width value, independent of this change.
      const widths = await page.evaluate(() => {
        const selection = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        )!;
        const highlight = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="highlight"]',
        )!;
        return {
          selection: parseFloat(selection.style.borderWidth),
          highlight: parseFloat(highlight.style.borderWidth),
        };
      });

      expect(widths.highlight).toBeLessThan(widths.selection);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge double-click on a non-text element selects the hit-tested child instead of doing nothing",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #group { position: absolute; left: 100px; top: 100px; width: 240px; height: 160px; background: #f5f5f5; }
      #icon { position: absolute; left: 20px; top: 20px; width: 60px; height: 60px; background: #6366f1; }
    </style>
  </head>
  <body>
    <div id="group" data-agent-native-node-id="group">
      <div id="icon" data-agent-native-node-id="icon"></div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      // First click selects the outer group (an ordinary single click).
      await page.mouse.click(115, 115);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      const selectedAfterSingleClick = await page.evaluate(() => {
        (window as any).__selectedIds = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "element-select") {
            (window as any).__selectedIds.push(event.data.payload?.sourceId);
          }
        });
        return true;
      });
      expect(selectedAfterSingleClick).toBe(true);

      // Double-click on the icon (a plain, non-text <div> — findTextEditTarget
      // returns null for it since it has no text content) should descend the
      // selection to #icon instead of leaving #group selected / doing nothing.
      await page.mouse.dblclick(140, 140);
      await page.waitForTimeout(50);

      const selectedId = await page.evaluate(() => {
        const ids = (window as any).__selectedIds as string[];
        return ids[ids.length - 1];
      });
      expect(selectedId).toBe("icon");

      const stillNotTextEditing = await page.evaluate(
        () => !document.querySelector("[data-agent-native-text-editing]"),
      );
      expect(stillNotTextEditing).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── K-scale tool parity + gradient edit overlay ────────────────────────────

it(
  "editor chrome bridge K-scale tool proportionally scales border width and font size during resize; a normal resize leaves them untouched",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #target {
        position: absolute; left: 200px; top: 200px; width: 100px; height: 100px;
        background: #e9eef8; border: 2px solid #333; font-size: 16px;
      }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target">Target</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(250, 250);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      // First: a NORMAL resize (scale-tool-mode disabled, the default) must
      // never touch borderWidth/fontSize — only the box changes.
      const seHandle = page.locator('[data-agent-native-edit-handle="se"]');
      const seBox = await seHandle.boundingBox();
      if (!seBox) throw new Error("resize handle not found");
      const handleCenterX = seBox.x + seBox.width / 2;
      const handleCenterY = seBox.y + seBox.height / 2;
      await page.mouse.move(handleCenterX, handleCenterY);
      await page.mouse.down();
      await page.mouse.move(handleCenterX + 100, handleCenterY + 100);
      await page.mouse.up();

      const afterNormalResize = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        return {
          width: target.style.width,
          borderWidth: target.style.borderWidth,
          fontSize: target.style.fontSize,
        };
      });
      expect(afterNormalResize.width).toBe("200px");
      // Never set by a normal resize — stays whatever the CSS/inline value
      // was before (empty inline style, since only the stylesheet set it).
      expect(afterNormalResize.borderWidth).toBe("");
      expect(afterNormalResize.fontSize).toBe("");

      // Now enable the K-scale tool and resize again from the new 200x200
      // box back down by half — border (2px) and font (16px) must scale
      // down proportionally with the box (0.5x).
      await page.evaluate(() => {
        window.postMessage({ type: "scale-tool-mode", enabled: true }, "*");
      });

      const seBox2 = await seHandle.boundingBox();
      if (!seBox2) throw new Error("resize handle not found after resize");
      const handle2X = seBox2.x + seBox2.width / 2;
      const handle2Y = seBox2.y + seBox2.height / 2;
      await page.mouse.move(handle2X, handle2Y);
      await page.mouse.down();
      await page.mouse.move(handle2X - 100, handle2Y - 100);
      await page.mouse.up();

      const afterScaleResize = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        return {
          width: target.style.width,
          height: target.style.height,
          borderWidth: target.style.borderWidth,
          fontSize: target.style.fontSize,
        };
      });
      expect(afterScaleResize.width).toBe("100px");
      expect(afterScaleResize.height).toBe("100px");
      expect(afterScaleResize.borderWidth).toBe("1px");
      expect(afterScaleResize.fontSize).toBe("8px");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge renders gradient edit handles for gradient-edit-target and emits gradient-edit-change while dragging an endpoint",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // Stops at 20%/80% (not 0%/100%) so their round markers don't sit
      // exactly on top of the start/end endpoint squares — Figma-parity
      // overlap-at-the-edge is real (both this bridge and
      // MultiScreenCanvas's GradientEditOverlay render stops after
      // endpoints, so a 0%/100% stop marker legitimately wins the hit-test
      // over the endpoint square beneath it), so this test exercises the
      // endpoint drag from a gradient shape where the endpoint square is the
      // topmost element at its own location.
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #target {
        position: absolute; left: 200px; top: 200px; width: 100px; height: 100px;
        background: linear-gradient(90deg, #000 20%, #fff 80%);
      }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target">Target</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      // No target set yet — the gradient overlay must be fully inert.
      const hiddenBeforeTarget = await page.evaluate(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="gradient"]',
        );
        return !overlay || window.getComputedStyle(overlay).display === "none";
      });
      expect(hiddenBeforeTarget).toBe(true);

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "gradient-edit-target",
            nodeId: "target",
            cssValue: "linear-gradient(90deg, #000000 20%, #ffffff 80%)",
          },
          "*",
        );
      });

      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="gradient"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      const handleCount = await page.evaluate(
        () =>
          document.querySelectorAll("[data-gradient-endpoint]").length +
          document.querySelectorAll("[data-gradient-stop]").length,
      );
      // Two endpoints (start/end) + two stops for a 2-stop gradient.
      expect(handleCount).toBe(4);

      const endHandleLocator = page.locator('[data-gradient-endpoint="end"]');
      await endHandleLocator.waitFor({ state: "visible", timeout: 5_000 });
      const endHandleBox = await endHandleLocator.boundingBox();
      if (!endHandleBox) throw new Error("end handle not found");

      const changes: Array<{ phase: string; cssValue: string }> = [];
      await page.exposeFunction("__onGradientChange", (msg: unknown) => {
        changes.push(msg as { phase: string; cssValue: string });
      });
      await page.evaluate(() => {
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "gradient-edit-change") {
            (window as any).__onGradientChange({
              phase: event.data.phase,
              cssValue: event.data.cssValue,
            });
          }
        });
      });

      const startX = endHandleBox.x + endHandleBox.width / 2;
      const startY = endHandleBox.y + endHandleBox.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // Drag the end handle straight DOWN (screen space) to directly below
      // the box center — local point (50, 100) on the 100x100 box, i.e.
      // exactly "south" of center, which this app's angle convention
      // (0 = north, clockwise) maps to exactly 180deg. The overlay's local
      // origin is the box's top-left (matches endHandleBox's own on-screen
      // box), so moving to screen y = boxTop + 100 (== boxTop + height)
      // lands exactly on that point regardless of the endpoint's starting
      // local x — dragging to the box's horizontal center, not just "60px
      // further down from wherever the handle started", is what actually
      // produces a clean 180deg (see angleFromDraggedEndpoint: it measures
      // the angle from box CENTER to the dragged point, not from the
      // endpoint's previous position).
      const overlayBox = await page
        .locator('[data-agent-native-edit-overlay="gradient"]')
        .boundingBox();
      if (!overlayBox) throw new Error("gradient overlay not found");
      const southX = overlayBox.x + overlayBox.width / 2;
      const southY = overlayBox.y + overlayBox.height;
      await page.mouse.move(southX, southY);
      await page.mouse.up();
      await page.waitForTimeout(50);

      expect(changes.length).toBeGreaterThan(0);
      const preview = changes.find((c) => c.phase === "preview");
      const commit = changes.find((c) => c.phase === "commit");
      expect(preview).toBeTruthy();
      expect(commit).toBeTruthy();
      expect(commit!.cssValue).toMatch(/^linear-gradient\(180deg/);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge drags a gradient stop marker to a new position and emits preview/commit",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #target {
        position: absolute; left: 200px; top: 200px; width: 100px; height: 100px;
        background: linear-gradient(90deg, #000 0%, #fff 100%);
      }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target">Target</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "gradient-edit-target",
            nodeId: "target",
            cssValue: "linear-gradient(90deg, #000000 0%, #ffffff 100%)",
          },
          "*",
        );
      });
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="gradient"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      const changes: Array<{ phase: string; cssValue: string }> = [];
      await page.exposeFunction("__onGradientChange2", (msg: unknown) => {
        changes.push(msg as { phase: string; cssValue: string });
      });
      await page.evaluate(() => {
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "gradient-edit-change") {
            (window as any).__onGradientChange2({
              phase: event.data.phase,
              cssValue: event.data.cssValue,
            });
          }
        });
      });

      // The 0%-position stop sits exactly at the line's start endpoint (90deg
      // on a 100x100 box: start = local (0, 50)). Drag it toward the box
      // center (local (50, 50), the line's ~50% point) so it lands roughly
      // mid-ramp instead of at either edge.
      const startStop = page.locator("[data-gradient-stop]").first();
      await startStop.waitFor({ state: "visible", timeout: 5_000 });
      const stopBox = await startStop.boundingBox();
      if (!stopBox) throw new Error("stop handle not found");
      const sx = stopBox.x + stopBox.width / 2;
      const sy = stopBox.y + stopBox.height / 2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx + 50, sy);
      await page.mouse.up();
      await page.waitForTimeout(50);

      expect(changes.length).toBeGreaterThan(0);
      const commit = changes.find((c) => c.phase === "commit");
      expect(commit).toBeTruthy();
      // The dragged stop moved from 0% to roughly 50% (dragged half the
      // 100px-wide line) while the other stop (100%) is untouched.
      expect(commit!.cssValue).toMatch(/#000000 (4[5-9]|5[0-5])%/);
      expect(commit!.cssValue).toContain("#ffffff 100%");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge clears the gradient overlay on gradient-edit-clear and stays inert with zero hit-test interference when no target is set",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #target {
        position: absolute; left: 200px; top: 200px; width: 100px; height: 100px;
        background: linear-gradient(90deg, #000 0%, #fff 100%);
      }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target">Target</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "gradient-edit-target",
            nodeId: "target",
            cssValue: "linear-gradient(90deg, #000000 0%, #ffffff 100%)",
          },
          "*",
        );
      });
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="gradient"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.evaluate(() => {
        window.postMessage({ type: "gradient-edit-clear" }, "*");
      });

      const hiddenAfterClear = await page.evaluate(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="gradient"]',
        );
        return !overlay || window.getComputedStyle(overlay).display === "none";
      });
      expect(hiddenAfterClear).toBe(true);

      // Regular click-to-select must still work normally afterward — the
      // (now-hidden, pointer-events:none-by-default) gradient overlay must
      // not swallow hit-testing.
      await page.mouse.click(250, 250);
      const selected = await page.evaluate(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      expect(selected).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── interaction-state forced preview (phase 2) ─────────────────────────────

it(
  "editor chrome bridge sets/clears data-an-state-preview on state-preview messages, activating the twin CSS rule",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // A real persisted managed block: the real `:hover` rule plus its
      // `duplicateStatePreviewRules`-generated twin, exactly as
      // shared/interaction-states.ts would emit it. The bridge itself does
      // no CSS generation — it only flips the plain attribute the twin rule
      // is keyed on.
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style data-agent-native-states>
[data-agent-native-node-id="btn_1"]:hover {
  background-color: rgb(17, 24, 39);
}

[data-agent-native-node-id="btn_1"][data-an-state-preview="hover"] {
  background-color: rgb(17, 24, 39);
}
    </style>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      [data-agent-native-node-id="btn_1"] { position: absolute; left: 120px; top: 140px; width: 120px; height: 48px; background: rgb(99, 102, 241); }
    </style>
  </head>
  <body>
    <button data-agent-native-node-id="btn_1">Click me</button>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const initialBackground = await page
        .locator('[data-agent-native-node-id="btn_1"]')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(initialBackground).toBe("rgb(99, 102, 241)");

      // Force the Hover state preview on: the twin attribute-selector rule
      // activates without any real :hover — no pointer is over the element.
      await page.evaluate(() => {
        window.postMessage(
          { type: "state-preview", nodeId: "btn_1", state: "hover" },
          "*",
        );
      });
      await page.waitForFunction(() => {
        const el = document.querySelector(
          '[data-agent-native-node-id="btn_1"]',
        )!;
        return getComputedStyle(el).backgroundColor === "rgb(17, 24, 39)";
      });
      const attr = await page
        .locator('[data-agent-native-node-id="btn_1"]')
        .getAttribute("data-an-state-preview");
      expect(attr).toBe("hover");

      // Clearing (state: null / omitted) removes the attribute and the
      // element reverts to its base (non-preview) styling.
      await page.evaluate(() => {
        window.postMessage(
          { type: "state-preview", nodeId: "btn_1", state: null },
          "*",
        );
      });
      await page.waitForFunction(() => {
        const el = document.querySelector(
          '[data-agent-native-node-id="btn_1"]',
        )!;
        return getComputedStyle(el).backgroundColor === "rgb(99, 102, 241)";
      });
      const attrAfterClear = await page
        .locator('[data-agent-native-node-id="btn_1"]')
        .getAttribute("data-an-state-preview");
      expect(attrAfterClear).toBeNull();
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge moves the state-preview attribute off the previous node when a new state-preview message targets a different node",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      .box { position: absolute; width: 100px; height: 80px; background: #e9eef8; }
      #first { left: 120px; top: 140px; }
      #second { left: 320px; top: 140px; }
    </style>
  </head>
  <body>
    <div id="first" class="box" data-agent-native-node-id="first">First</div>
    <div id="second" class="box" data-agent-native-node-id="second">Second</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.evaluate(() => {
        window.postMessage(
          { type: "state-preview", nodeId: "first", state: "hover" },
          "*",
        );
      });
      await page.waitForFunction(
        () =>
          document
            .querySelector("#first")
            ?.getAttribute("data-an-state-preview") === "hover",
      );

      // Selection moved to #second — the bridge must clear #first's
      // attribute before setting #second's, so only one element ever
      // force-previews a state at a time.
      await page.evaluate(() => {
        window.postMessage(
          { type: "state-preview", nodeId: "second", state: "focus" },
          "*",
        );
      });
      await page.waitForFunction(
        () =>
          document
            .querySelector("#second")
            ?.getAttribute("data-an-state-preview") === "focus",
      );
      const firstAttrAfterHandoff = await page
        .locator("#first")
        .getAttribute("data-an-state-preview");
      expect(firstAttrAfterHandoff).toBeNull();
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── text editing session behavior (T2/T3/T5/T11/T12/T19/T20/T21) ──────────

describe("editor chrome bridge — text editing session", () => {
  async function beginTextEditOnTarget(page: import("@playwright/test").Page) {
    await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>("#target")!;
      const rect = target.getBoundingClientRect();
      window.postMessage(
        {
          type: "begin-text-edit",
          nodeId: "target",
          force: true,
        },
        "*",
      );
      // begin-text-edit resolves the node by data-agent-native-node-id, but
      // we still need the rect for later mouse coordinate math in some tests.
      (window as any).__targetRect = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    });
    await page.waitForSelector("[data-agent-native-text-editing]");
  }

  async function launchTextEditPage(
    browser: import("@playwright/test").Browser,
  ) {
    const pageErrors: string[] = [];
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #target {
        position: absolute;
        left: 120px;
        top: 140px;
        width: 240px;
        height: 60px;
        min-width: 240px;
        min-height: 60px;
        background: #e9eef8;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target" style="min-width:240px;min-height:60px">Hello world</div>
  </body>
</html>`);
    await page.addScriptTag({
      content: hydratedEditorChromeBridgeScriptWithTextEditing(),
    });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    return { page, pageErrors };
  }

  it(
    "T2: Enter inserts a line break instead of committing; Escape commits",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        await beginTextEditOnTarget(page);

        await page.keyboard.press("Enter");
        await page.waitForTimeout(30);
        const stillEditing = await page.evaluate(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );
        const hasBreak = await page.evaluate(() => {
          const target = document.querySelector("#target")!;
          return (
            target.innerHTML.includes("<br") ||
            (target.textContent || "").includes("\n")
          );
        });
        expect(stillEditing).toBe(true);
        expect(hasBreak).toBe(true);

        await page.keyboard.press("Escape");
        await page.waitForTimeout(30);
        const editingAfterEscape = await page.evaluate(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );
        expect(editingAfterEscape).toBe(false);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T3: composing keydown (IME) does not trigger Escape/Enter handling",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        await beginTextEditOnTarget(page);

        await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>(
            "[data-agent-native-text-editing]",
          )!;
          const ev = new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
            composed: true,
          });
          Object.defineProperty(ev, "isComposing", { value: true });
          target.dispatchEvent(ev);
        });
        await page.waitForTimeout(30);
        const stillEditingAfterComposingEnter = await page.evaluate(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );
        // A composing Enter must not be treated as commit — session stays open.
        expect(stillEditingAfterComposingEnter).toBe(true);

        await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>(
            "[data-agent-native-text-editing]",
          )!;
          const ev = new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
            composed: true,
          });
          Object.defineProperty(ev, "keyCode", { value: 229 });
          target.dispatchEvent(ev);
        });
        await page.waitForTimeout(30);
        const stillEditingAfterComposingEscape = await page.evaluate(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );
        expect(stillEditingAfterComposingEscape).toBe(true);

        // A real (non-composing) Escape still commits normally.
        await page.keyboard.press("Escape");
        await page.waitForTimeout(30);
        const editingAfterRealEscape = await page.evaluate(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );
        expect(editingAfterRealEscape).toBe(false);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T5: double-click on an <img> does not make it contenteditable",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const pageErrors: string[] = [];
        const page = await browser.newPage({
          viewport: { width: 900, height: 700 },
        });
        page.on("pageerror", (err) => pageErrors.push(err.message));
        await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      #pic { position: absolute; left: 100px; top: 100px; width: 120px; height: 90px; }
    </style>
  </head>
  <body>
    <img id="pic" data-agent-native-node-id="pic" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7" />
  </body>
</html>`);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScriptWithTextEditing(),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

        await page.mouse.dblclick(160, 145);
        await page.waitForTimeout(50);

        const imgIsContentEditable = await page.evaluate(() => {
          const img = document.querySelector("#pic")!;
          return img.getAttribute("contenteditable");
        });
        const anyTextEditingActive = await page.evaluate(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );
        expect(imgIsContentEditable).toBeNull();
        expect(anyTextEditingActive).toBe(false);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T12: repeated range style application on the same range reuses one span (no nesting)",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        await beginTextEditOnTarget(page);

        // Select all text inside the target so applyTextRangeStyle has a range.
        await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>(
            "[data-agent-native-text-editing]",
          )!;
          const range = document.createRange();
          range.selectNodeContents(target);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
        });

        for (let i = 0; i < 3; i += 1) {
          await page.evaluate(
            (fontSize) => {
              window.postMessage(
                {
                  type: "style-change",
                  selector: '[data-agent-native-node-id="target"]',
                  selectorCandidates: ['[data-agent-native-node-id="target"]'],
                  property: "fontSize",
                  value: fontSize,
                },
                "*",
              );
            },
            `${20 + i}px`,
          );
          await page.waitForTimeout(20);
          // Re-select the (now single, reused) span's contents so the next
          // iteration's range still targets the same element, mirroring a
          // real repeated-scrub gesture.
          await page.evaluate(() => {
            const target = document.querySelector<HTMLElement>(
              "[data-agent-native-text-editing]",
            )!;
            const span = target.querySelector("span");
            if (!span) return;
            const range = document.createRange();
            range.selectNodeContents(span);
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
          });
        }

        await page.keyboard.press("Escape");
        await page.waitForTimeout(30);

        const spanNestingDepth = await page.evaluate(() => {
          const target = document.querySelector("#target")!;
          let depth = 0;
          let node: Element | null = target.querySelector("span");
          while (node && node.tagName === "SPAN") {
            depth += 1;
            const child = node.children[0];
            node = child && child.tagName === "SPAN" ? child : null;
          }
          return depth;
        });
        const spanCount = await page.evaluate(
          () => document.querySelectorAll("#target span").length,
        );

        expect(spanCount).toBe(1);
        expect(spanNestingDepth).toBe(1);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T19: refreshOverlays preserves the session's captured min-width/min-height",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        await beginTextEditOnTarget(page);

        // Trigger a refreshOverlays() cycle via a hover message (goes through
        // the same overlay refresh path) rather than reaching into bridge
        // internals directly.
        await page.evaluate(() => {
          window.postMessage({ type: "clear-selection" }, "*");
        });
        await page.waitForTimeout(30);

        const minWidth = await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>(
            "[data-agent-native-text-editing]",
          );
          return target ? target.style.minWidth : null;
        });
        const minHeight = await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>(
            "[data-agent-native-text-editing]",
          );
          return target ? target.style.minHeight : null;
        });

        // The session captured "240px"/"60px" from the inline style at
        // begin-text-edit time (hasTextCharacters is true since "Hello
        // world" is present) — refreshOverlays must not have clobbered them
        // to the empty-text "1px"/"1em" defaults.
        expect(minWidth).toBe("240px");
        expect(minHeight).toBe("60px");
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T21: Cmd/Ctrl+B and Cmd/Ctrl+I toggle bold/italic within the edit session",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        await beginTextEditOnTarget(page);

        await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>(
            "[data-agent-native-text-editing]",
          )!;
          const range = document.createRange();
          range.selectNodeContents(target);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
        });

        const modifier = process.platform === "darwin" ? "Meta" : "Control";
        await page.keyboard.down(modifier);
        await page.keyboard.press("b");
        await page.keyboard.up(modifier);
        await page.waitForTimeout(30);

        const hasBold = await page.evaluate(() => {
          const target = document.querySelector("#target")!;
          return /<b>|<strong>|font-weight/i.test(target.innerHTML);
        });
        expect(hasBold).toBe(true);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T4: a forced document replacement during an active edit commits it and removes the session's listeners (no leaked selectionchange)",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        await beginTextEditOnTarget(page);

        // Type something so there is uncommitted text to lose if finish()
        // is skipped.
        await page.keyboard.type(" typed");
        await page.waitForTimeout(20);

        const listenerCountBefore = await page.evaluate(() => {
          const w = window as any;
          w.__selectionChangeCount = w.__selectionChangeCount || 0;
          return w.__selectionChangeCount;
        });

        // Count how many times "selectionchange" fires on document AFTER the
        // forced replacement — if the session's document-level listener
        // leaked, firing a selectionchange post-replacement would still be
        // observed by the stale closure (indirectly detectable via the
        // editing state never clearing). We assert the more direct,
        // observable contract instead: after a forced replace-document-content,
        // no element on the page should still carry
        // data-agent-native-text-editing, and a fresh dblclick-driven edit
        // session must be startable immediately (which would be blocked if
        // activeTextEditEl were left stale).
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "replace-document-content",
              content: `<!doctype html><html><body><div id="target" data-agent-native-node-id="target" style="position:absolute;left:120px;top:140px;width:240px;height:60px;min-width:240px;min-height:60px;white-space:pre-wrap;background:#e9eef8">Hello world</div></body></html>`,
              forceFullDocument: true,
            },
            "*",
          );
        });
        await page.waitForTimeout(50);

        const stillEditingAfterReplace = await page.evaluate(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );
        expect(stillEditingAfterReplace).toBe(false);

        // A fresh begin-text-edit must succeed right after — this would fail
        // silently (activeTextEditEl && activeTextEditEl === textTarget
        // early-return, or a stuck state) if the previous session's teardown
        // didn't run.
        await page.evaluate(() => {
          window.postMessage(
            { type: "begin-text-edit", nodeId: "target", force: true },
            "*",
          );
        });
        await page.waitForSelector("[data-agent-native-text-editing]", {
          timeout: 2000,
        });
        const editingAgain = await page.evaluate(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );
        expect(editingAgain).toBe(true);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T13: a runtime content update dropped during an active edit is applied once the edit ends",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        await beginTextEditOnTarget(page);

        // A non-force replace-document-content during an active edit must be
        // buffered rather than dropped silently.
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "replace-document-content",
              content: `<!doctype html><html><body><div id="target" data-agent-native-node-id="target" style="position:absolute;left:120px;top:140px;width:240px;height:60px;background:#123456">Replaced</div><div id="marker-el" data-testid="applied-marker"></div></body></html>`,
              forceFullDocument: false,
            },
            "*",
          );
        });
        await page.waitForTimeout(30);

        const notYetApplied = await page.evaluate(
          () => !document.querySelector("#marker-el"),
        );
        expect(notYetApplied).toBe(true);

        await page.keyboard.press("Escape");
        await page.waitForTimeout(50);

        const appliedAfterFinish = await page.evaluate(
          () => !!document.querySelector("#marker-el"),
        );
        expect(appliedAfterFinish).toBe(true);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T11: a style-change targeting the re-anchored ancestor selector still applies as a range style to the active edit session",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const pageErrors: string[] = [];
        const page = await browser.newPage({
          viewport: { width: 900, height: 700 },
        });
        page.on("pageerror", (err) => pageErrors.push(err.message));
        // A component wrapper (source-backed, stable id) that is NOT itself
        // purely inline-editable (it has a <button> sibling alongside the
        // text), containing a "leaf" <p> that IS purely inline-editable.
        // findTextEditTarget's upward walk stops at #leaf (the outermost
        // node that still hasOnlyInlineEditableChildren) rather than
        // continuing to #wrapper — mirroring a real case where the actual
        // contenteditable target is a runtime-only descendant nested inside
        // a larger stable-source component.
        await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      #wrapper { position: absolute; left: 100px; top: 100px; width: 300px; height: 120px; }
    </style>
  </head>
  <body>
    <div id="wrapper" data-agent-native-node-id="wrapper">
      <p id="leaf">Some editable text</p>
      <button id="action-btn">Not editable</button>
    </div>
  </body>
</html>`);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScriptWithTextEditing(),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

        // Begin editing the leaf paragraph directly (not the wrapper).
        await page.evaluate(() => {
          const leaf = document.querySelector<HTMLElement>("#leaf")!;
          const rect = leaf.getBoundingClientRect();
          leaf.dispatchEvent(
            new MouseEvent("dblclick", {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + 5,
              clientY: rect.top + rect.height / 2,
            }),
          );
        });
        await page.waitForSelector("[data-agent-native-text-editing]");

        const editingLeaf = await page.evaluate(
          () => document.querySelector("[data-agent-native-text-editing]")?.id,
        );
        expect(editingLeaf).toBe("leaf");

        await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>(
            "[data-agent-native-text-editing]",
          )!;
          const range = document.createRange();
          range.selectNodeContents(target);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
        });

        // Send a style-change keyed to the WRAPPER's selector (simulating a
        // selectedEl anchored to the source-backed ancestor rather than the
        // actual contenteditable leaf).
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "style-change",
              selector: '[data-agent-native-node-id="wrapper"]',
              selectorCandidates: ['[data-agent-native-node-id="wrapper"]'],
              property: "color",
              value: "rgb(255, 0, 0)",
            },
            "*",
          );
        });
        await page.waitForTimeout(30);

        const wrapperColor = await page.evaluate(
          () =>
            window.getComputedStyle(document.querySelector("#wrapper")!).color,
        );
        const leafHasRangeStyle = await page.evaluate(() => {
          const leaf = document.querySelector("#leaf")!;
          const span = leaf.querySelector("span");
          return span ? window.getComputedStyle(span).color : null;
        });

        // The wrapper itself must NOT have been restyled wholesale...
        expect(wrapperColor).not.toBe("rgb(255, 0, 0)");
        // ...the range style must have landed inside the active edit leaf.
        expect(leafHasRangeStyle).toBe("rgb(255, 0, 0)");
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T20: rapid keystrokes during an edit session coalesce chrome-update postMessages instead of firing one per event",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        await beginTextEditOnTarget(page);

        await page.evaluate(() => {
          (window as any).__textEditingStateCount = 0;
          window.addEventListener("message", (event: MessageEvent) => {
            if (event.data?.type === "text-editing-state") {
              (window as any).__textEditingStateCount += 1;
            }
          });
        });

        // Fire many rapid input events within the same tick/frame — without
        // rAF-coalescing this would post one text-editing-state per event.
        const keystrokeCount = 12;
        await page.evaluate((count) => {
          const target = document.querySelector<HTMLElement>(
            "[data-agent-native-text-editing]",
          )!;
          for (let i = 0; i < count; i += 1) {
            target.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }, keystrokeCount);

        // Let a couple of animation frames elapse so any coalesced rAF tick
        // fires.
        await page.waitForTimeout(80);

        const postedCount = await page.evaluate(
          () => (window as any).__textEditingStateCount,
        );

        expect(postedCount).toBeGreaterThan(0);
        expect(postedCount).toBeLessThan(keystrokeCount);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );
});
