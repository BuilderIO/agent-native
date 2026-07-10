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
import { embeddedWheelBridgeScript } from "../../../../.generated/bridge/embedded-wheel.generated";
import { hitTestBridgeScript } from "../../../../.generated/bridge/hit-test.generated";
import { buildCodeLayerProjection } from "../../../../shared/code-layer";

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

function hydratedEditorChromeBridgeScript(
  runtimeLayerSnapshotEnabled = false,
  screenId = "bridge-guard",
): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify(screenId))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace(
      "__RUNTIME_LAYER_SNAPSHOT_ENABLED__",
      runtimeLayerSnapshotEnabled ? "true" : "false",
    );
}

function hydratedBoardEditorChromeBridgeScriptWithOffset(
  x: number,
  y: number,
): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("board"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "true")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", String(x))
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", String(y))
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false");
}

// Same hydration but with a caller-supplied editor-chrome scale, for the
// zoomed-overview regression tests below (the host shrinks the iframe via
// CSS transform at low canvas zoom and sends the compensating scale so the
// bridge can keep its own chrome — borders, handles, insertion guide — at a
// constant on-screen size; see chromeLineScale()).
function hydratedEditorChromeBridgeScriptWithScale(scale: number): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", String(scale))
    .replace("__EDITOR_CHROME_SCALE_Y__", String(scale))
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("bridge-guard"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false");
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
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false");
}

function hydratedEmbeddedCanvasGestureBridgeScript(options?: {
  wheel?: boolean;
  forwardSpaceKey?: boolean;
  editingSafety?: boolean;
}): string {
  return embeddedWheelBridgeScript
    .replace(
      "__EMBEDDED_WHEEL_FORWARDING_ENABLED__",
      options?.wheel ? "true" : "false",
    )
    .replace(
      "__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__",
      options?.forwardSpaceKey ? "true" : "false",
    )
    .replace(
      "__EDITING_SAFETY_ENABLED__",
      options?.editingSafety ? "true" : "false",
    );
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
  "embedded canvas gesture bridge preserves app input unless a Figma pan gesture is active",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(`<!doctype html>
<html>
  <body>
    <button id="surface" type="button" style="width:240px;height:160px">App button</button>
    <input id="typing" />
    <script>
      window.__bridgeMessages = [];
      window.__appPointerDowns = 0;
      window.addEventListener("message", (event) => {
        window.__bridgeMessages.push(event.data);
      });
      document.querySelector("#surface").addEventListener("pointerdown", () => {
        window.__appPointerDowns += 1;
      });
    </script>
  </body>
</html>`);
      await page.addScriptTag({
        content: hydratedEmbeddedCanvasGestureBridgeScript({
          forwardSpaceKey: true,
        }),
      });

      const surface = page.locator("#surface");
      const box = await surface.boundingBox();
      expect(box).not.toBeNull();
      const centerX = box!.x + box!.width / 2;
      const centerY = box!.y + box!.height / 2;

      // Ordinary Interact-mode left clicks remain native app interactions.
      await surface.click();
      expect(
        await page.evaluate(() =>
          Number(
            (window as Window & { __appPointerDowns?: number })
              .__appPointerDowns,
          ),
        ),
      ).toBe(1);

      // Overview/focused transitions now keep one installed gesture script
      // and change wheel routing in place. This keeps the localhost bridge
      // key stable across Full view instead of forcing a new registration.
      await page.mouse.move(centerX, centerY);
      await page.mouse.wheel(0, 40);
      expect(
        (
          await page.evaluate(
            () =>
              (
                window as Window & {
                  __bridgeMessages?: Array<{ type?: string }>;
                }
              ).__bridgeMessages ?? [],
          )
        ).filter((message) => message.type === "embedded-canvas-wheel"),
      ).toHaveLength(0);
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "embedded-canvas-gesture-mode",
            wheelEnabled: true,
            spaceKeyForwardingEnabled: true,
          },
          "*",
        );
      });
      await page.waitForTimeout(0);
      await page.mouse.wheel(0, 40);
      await page.waitForFunction(() =>
        (
          (
            window as Window & {
              __bridgeMessages?: Array<{ type?: string }>;
            }
          ).__bridgeMessages ?? []
        ).some((message) => message.type === "embedded-canvas-wheel"),
      );

      // Middle-button drag is always a canvas pan and never reaches app code.
      await page.mouse.move(centerX, centerY);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(centerX + 32, centerY + 18);
      await page.mouse.up({ button: "middle" });
      await page.waitForFunction(
        () =>
          (
            (
              window as Window & {
                __bridgeMessages?: Array<{ type?: string }>;
              }
            ).__bridgeMessages ?? []
          ).filter((message) => message.type === "embedded-canvas-pan")
            .length >= 3,
      );
      expect(
        await page.evaluate(() =>
          Number(
            (window as Window & { __appPointerDowns?: number })
              .__appPointerDowns,
          ),
        ),
      ).toBe(1);

      // The host synchronizes hand/Space state in-place; arming it makes a
      // left drag pan without rebuilding/reloading the iframe document.
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "embedded-canvas-pan-mode",
            leftButtonEnabled: true,
          },
          "*",
        );
      });
      await page.waitForTimeout(0);
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + 24, centerY + 12);
      await page.mouse.up();
      expect(
        await page.evaluate(() =>
          Number(
            (window as Window & { __appPointerDowns?: number })
              .__appPointerDowns,
          ),
        ),
      ).toBe(1);

      // Space stays text inside a real input, but outside typing contexts it
      // forwards the same keydown/keyup contract DesignEditor already uses.
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "embedded-canvas-pan-mode",
            leftButtonEnabled: false,
          },
          "*",
        );
      });
      await page.locator("#typing").focus();
      await page.keyboard.type(" ");
      expect(await page.locator("#typing").inputValue()).toBe(" ");

      await surface.focus();
      await page.keyboard.down("Space");
      await page.keyboard.up("Space");
      await page.waitForFunction(() =>
        (
          (
            window as Window & {
              __bridgeMessages?: Array<{ type?: string }>;
            }
          ).__bridgeMessages ?? []
        ).some((message) => message.type === "design-hotkey-up"),
      );

      const messages = await page.evaluate(
        () =>
          (
            window as Window & {
              __bridgeMessages?: Array<Record<string, unknown>>;
            }
          ).__bridgeMessages ?? [],
      );
      const panMessages = messages.filter(
        (message) => message.type === "embedded-canvas-pan",
      );
      expect(panMessages.map((message) => message.phase)).toEqual([
        "start",
        "move",
        "end",
        "start",
        "move",
        "end",
      ]);
      expect(
        messages.filter((message) => message.type === "design-hotkey"),
      ).toHaveLength(1);
      expect(
        messages.filter((message) => message.type === "design-hotkey-up"),
      ).toHaveLength(1);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "embedded canvas gesture bridge recovers from host focus loss mid-pan",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage({
        viewport: { width: 500, height: 400 },
      });
      await page.setContent(`<!doctype html><html><body>
        <div id="surface" style="width:300px;height:240px"></div>
        <script>
          window.__panMessages = [];
          window.addEventListener("message", (event) => {
            if (event.data?.type === "embedded-canvas-pan") {
              window.__panMessages.push(event.data);
            }
          });
        </script>
      </body></html>`);
      await page.addScriptTag({
        content: hydratedEmbeddedCanvasGestureBridgeScript(),
      });
      const box = await page.locator("#surface").boundingBox();
      expect(box).not.toBeNull();
      const x = box!.x + 100;
      const y = box!.y + 100;

      await page.mouse.move(x, y);
      await page.mouse.down({ button: "middle" });
      await page.waitForFunction(() =>
        (
          (
            window as Window & {
              __panMessages?: Array<{ phase?: string }>;
            }
          ).__panMessages ?? []
        ).some((message) => message.phase === "start"),
      );
      // DesignCanvas sends this on the real top-level window blur. The child
      // must release pointer capture and clear activePointerId even if the
      // browser omitted pointercancel while the app lost focus.
      await page.evaluate(() => {
        window.postMessage({ type: "embedded-canvas-pan-cancel" }, "*");
      });
      await page.waitForFunction(() =>
        (
          (
            window as Window & {
              __panMessages?: Array<{ phase?: string }>;
            }
          ).__panMessages ?? []
        ).some((message) => message.phase === "cancel"),
      );
      await page.mouse.up({ button: "middle" });

      // A second drag must start normally; a stale activePointerId used to
      // make every future pointerdown return early after Cmd+Tab.
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(x + 20, y + 10);
      await page.mouse.up({ button: "middle" });
      await page.waitForFunction(
        () =>
          (
            (
              window as Window & {
                __panMessages?: Array<{ phase?: string }>;
              }
            ).__panMessages ?? []
          ).filter((message) => message.phase === "start").length === 2,
      );

      const phases = await page.evaluate(() =>
        (
          (
            window as Window & {
              __panMessages?: Array<{ phase?: string }>;
            }
          ).__panMessages ?? []
        ).map((message) => message.phase),
      );
      expect(phases).toEqual(["start", "cancel", "start", "move", "end"]);
    } finally {
      await browser.close();
    }
  },
);

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
      /* #anchor is a leaf <img> (not a nestable container per
         isContainerDropTarget's BRIDGE_LEAF_TAGS) so this test exercises
         plain edge-snapping in isolation from the "drop onto a rectangle
         nests as a child" behavior covered by the dedicated nesting tests
         below — those use plain <div> targets on purpose. */
      #anchor { left: 400px; top: 200px; }
      #target { left: 120px; top: 200px; }
    </style>
  </head>
  <body>
    <img id="anchor" class="box" data-agent-native-node-id="anchor" alt="Anchor" />
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

// ── Resize origin must seed from RENDERED px, not the raw CSS value ───────
//
// startResize used to read `resizeEl.style.width || cs.width` — the raw
// inline style string wins whenever one is set, and readPx() just runs it
// through parseFloat. For a non-px value like "100%" that parses to the
// number 100 and is silently treated as 100px, so growing a `width: 100%;
// height: 160px` element's SE corner by (+50, +30) produced height 190px
// (correct) but width 150px (100 + 50) instead of the ~408px the box was
// actually rendered at — a shrink instead of a grow. The fix reads
// getComputedStyle().width/height instead, which always resolves to the
// element's used-value pixel size regardless of the authored unit (%, em,
// rem, vh, vw, calc(), auto) and is unaffected by rotation.
it(
  "editor chrome bridge resize seeds the origin from rendered pixels for every non-px CSS width/height unit (%, vw/vh, rem, em, calc)",
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
      html, body { margin: 0; width: 100%; height: 100%; font-size: 16px; }
      body { background: white; }
      #wrap {
        position: absolute; left: 0; top: 0; width: 400px; height: 400px;
      }
      #target {
        position: absolute; left: 20px; top: 20px; height: 100px;
        font-size: 20px; background: #e9eef8; border: none;
      }
    </style>
  </head>
  <body>
    <div id="wrap"><div id="target" data-agent-native-node-id="target">Target</div></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const DELTA = 40;
      const widthUnits = ["50%", "20vw", "3rem", "2em", "calc(50% + 20px)"];
      for (const unit of widthUnits) {
        await page.evaluate(
          ({ unit }) => {
            const target = document.querySelector<HTMLElement>("#target")!;
            target.style.width = unit;
            target.style.height = "100px";
          },
          { unit },
        );
        // Re-click to (re)select and force the overlay to reposition against
        // the just-changed rendered box before reading the handle position.
        await page.mouse.click(30, 30);
        await page.waitForFunction(() => {
          const overlay = document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="selection"]',
          );
          return (
            overlay && window.getComputedStyle(overlay).display === "block"
          );
        });

        const before = await page.evaluate(
          () =>
            document.querySelector("#target")!.getBoundingClientRect().width,
        );

        const eHandle = page.locator('[data-agent-native-edge-handle="e"]');
        const eBox = await eHandle.boundingBox();
        if (!eBox)
          throw new Error(`"e" edge handle not found for unit ${unit}`);
        const cx = eBox.x + eBox.width / 2;
        const cy = eBox.y + eBox.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + DELTA, cy);
        await page.mouse.up();

        const after = await page.evaluate(
          () =>
            document.querySelector("#target")!.getBoundingClientRect().width,
        );
        expect(after - before, `unit=${unit}`).toBeGreaterThan(DELTA - 2);
        expect(after - before, `unit=${unit}`).toBeLessThan(DELTA + 2);
      }

      // Reset width to a fixed px baseline and run the same matrix for height
      // via the pure-vertical "s" edge handle.
      const heightUnits = ["50%", "20vh", "3rem", "2em", "calc(50% + 20px)"];
      for (const unit of heightUnits) {
        await page.evaluate(
          ({ unit }) => {
            const target = document.querySelector<HTMLElement>("#target")!;
            target.style.width = "100px";
            target.style.height = unit;
          },
          { unit },
        );
        await page.mouse.click(30, 30);
        await page.waitForFunction(() => {
          const overlay = document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="selection"]',
          );
          return (
            overlay && window.getComputedStyle(overlay).display === "block"
          );
        });

        const before = await page.evaluate(
          () =>
            document.querySelector("#target")!.getBoundingClientRect().height,
        );

        const sHandle = page.locator('[data-agent-native-edge-handle="s"]');
        const sBox = await sHandle.boundingBox();
        if (!sBox)
          throw new Error(`"s" edge handle not found for unit ${unit}`);
        const cx = sBox.x + sBox.width / 2;
        const cy = sBox.y + sBox.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx, cy + DELTA);
        await page.mouse.up();

        const after = await page.evaluate(
          () =>
            document.querySelector("#target")!.getBoundingClientRect().height,
        );
        expect(after - before, `unit=${unit}`).toBeGreaterThan(DELTA - 2);
        expect(after - before, `unit=${unit}`).toBeLessThan(DELTA + 2);
      }

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Live repro: SE-corner resize of a `width:100%; height:160px` element ──
it(
  "editor chrome bridge SE-corner resize of a width:100% element grows width from its rendered size, not from a shrunk parsed-percentage value",
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
      #wrap { position: absolute; left: 0; top: 0; width: 500px; height: 400px; }
    </style>
  </head>
  <body>
    <div id="wrap"><div id="target" data-agent-native-node-id="target" style="position: absolute; left: 20px; top: 20px; width: 100%; height: 160px; background: #e9eef8;">Target</div></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const renderedBefore = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        return {
          width: target.getBoundingClientRect().width,
          height: target.getBoundingClientRect().height,
        };
      });
      // Sanity check the fixture: width:100% inside a 500px wrap renders at
      // 500px, well above the old parseFloat("100%") -> 100 misread.
      expect(renderedBefore.width).toBeCloseTo(500, 0);
      expect(renderedBefore.height).toBeCloseTo(160, 0);

      await page.mouse.click(30, 30);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      const seHandle = page.locator('[data-agent-native-edit-handle="se"]');
      const seBox = await seHandle.boundingBox();
      if (!seBox) throw new Error("resize handle not found");
      const cx = seBox.x + seBox.width / 2;
      const cy = seBox.y + seBox.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 50, cy + 30);
      await page.mouse.up();

      const after = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        return {
          width: target.style.width,
          height: target.style.height,
          renderedWidth: target.getBoundingClientRect().width,
        };
      });
      // Height (a plain px value the whole time) behaves as before.
      expect(after.height).toBe("190px");
      // Width must grow from the rendered ~500px, landing at ~550px — NOT
      // shrink to 150px (the pre-fix 100 + 50 parseFloat("100%") result).
      expect(after.width).not.toBe("150px");
      expect(after.renderedWidth).toBeGreaterThan(500);
      expect(after.renderedWidth).toBeCloseTo(550, 0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Commit semantics: only the dragged axis is written back ───────────────
it(
  "editor chrome bridge resize commits only the axis the user actually dragged, leaving a percentage width untouched on a pure vertical drag",
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
      #wrap { position: absolute; left: 0; top: 0; width: 500px; height: 400px; }
    </style>
  </head>
  <body>
    <div id="wrap"><div id="target" data-agent-native-node-id="target" style="position: absolute; left: 20px; top: 20px; width: 100%; height: 160px; background: #e9eef8;">Target</div></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(30, 30);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      // Pure vertical drag: the "s" EDGE handle (not a corner), so width
      // should never enter into the gesture at all.
      const sHandle = page.locator('[data-agent-native-edge-handle="s"]');
      const sBox = await sHandle.boundingBox();
      if (!sBox) throw new Error("resize handle not found");
      const cx = sBox.x + sBox.width / 2;
      const cy = sBox.y + sBox.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy + 30);
      await page.mouse.up();

      const after = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        return {
          width: target.style.width,
          height: target.style.height,
          renderedWidth: target.getBoundingClientRect().width,
        };
      });
      // Height is the dragged axis — committed as px.
      expect(after.height).toBe("190px");
      // Width was NEVER dragged — must still be the original percentage
      // string, not silently rewritten to a px value.
      expect(after.width).toBe("100%");
      expect(after.renderedWidth).toBeCloseTo(500, 0);
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

it(
  "editor chrome bridge previews localhost interaction states by selector and clears temporary styles without touching base inline styles",
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
  <body>
    <button id="runtime-button" style="color: rgb(0, 0, 255); opacity: 1">Runtime</button>
    <button id="escaped-target">Escaped</button>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "state-preview",
            selector: "#runtime-button",
            selectorCandidates: ["#runtime-button"],
            nodeId: "runtime-only-source-id",
            state: "focus-visible",
            previewStyles: {
              color: "rgb(255, 0, 0)",
              opacity: "0.4",
            },
          },
          "*",
        );
      });
      await page.waitForTimeout(50);
      expect(
        await page.locator("#runtime-button").evaluate((el) => ({
          color: getComputedStyle(el).color,
          opacity: getComputedStyle(el).opacity,
          previewKey: el.getAttribute("data-an-state-preview-key"),
        })),
      ).toMatchObject({ color: "rgb(255, 0, 0)", opacity: "0.4" });
      expect(
        await page
          .locator("#runtime-button")
          .getAttribute("data-an-state-preview"),
      ).toBe("focus-visible");

      // A discard/undo sends empty values for the state-scoped properties.
      // The bridge removes only its temporary CSSOM rule; the app's authored
      // inline styles remain byte-for-byte untouched.
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "interaction-state-style-preview",
            selector: "#runtime-button",
            state: "focus-visible",
            styles: { color: "", opacity: "" },
          },
          "*",
        );
      });
      await page.waitForTimeout(50);
      expect(
        await page.locator("#runtime-button").evaluate((el) => ({
          color: getComputedStyle(el).color,
          opacity: getComputedStyle(el).opacity,
        })),
      ).toEqual({ color: "rgb(0, 0, 255)", opacity: "1" });
      expect(
        await page.locator("#runtime-button").getAttribute("style"),
      ).toContain("color: rgb(0, 0, 255)");

      // Runtime ids are arbitrary source strings. Backslashes and quotes must
      // be escaped as CSS attribute-selector data, never parsed as selector
      // syntax or allowed to make the exact target silently unreachable.
      await page.evaluate(() => {
        document
          .querySelector("#escaped-target")!
          .setAttribute("data-agent-native-node-id", 'runtime\\"quoted');
        window.postMessage(
          {
            type: "state-preview",
            nodeId: 'runtime\\"quoted',
            state: "hover",
            previewStyles: { opacity: "0.25" },
          },
          "*",
        );
      });
      await page.waitForTimeout(50);
      expect(
        await page
          .locator("#escaped-target")
          .evaluate((el) => getComputedStyle(el).opacity),
      ).toBe("0.25");
      expect(
        await page
          .locator("#escaped-target")
          .getAttribute("data-an-state-preview"),
      ).toBe("hover");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── padding-handle hit-area / hover-hatch / value-box (Steve test batch 3,
// item 6) and the restored drop-insertion line (item 4) ────────────────────

it(
  "editor chrome bridge padding handle: only the handle line drags padding, elsewhere in the padding band moves the element",
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
      body { background: #0b0b0f; }
      #card {
        position: absolute; left: 200px; top: 150px;
        width: 360px; height: 220px;
        padding: 48px;
        background: #17181d;
        box-sizing: border-box;
      }
      #card .inner { background: #26272d; height: 100%; }
    </style>
  </head>
  <body>
    <div id="card" data-agent-native-node-id="card">
      <div class="inner" data-agent-native-node-id="inner">inner</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      // Select #card via a click inside its padding band (not inside .inner,
      // so #card itself — the element with a resizable-padding child — is
      // the hit target).
      await page.mouse.click(220, 170);
      await page.waitForFunction(() => {
        const sel = document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        ) as HTMLElement | null;
        return !!sel && sel.style.display === "block";
      });

      // Pointerdown far from the handle line (near the corner of the
      // padding-top band) must MOVE the element, not resize padding.
      const beforeMoveRect = await page.evaluate(() => {
        const r = document.getElementById("card")!.getBoundingClientRect();
        return { left: r.left, top: r.top };
      });
      await page.mouse.move(210, 170);
      await page.mouse.down();
      await page.mouse.move(250, 175, { steps: 5 });
      await page.mouse.up();

      const afterMoveStyle = await page.locator("#card").getAttribute("style");
      // The element must not have resized any padding from this drag.
      expect(afterMoveStyle).not.toMatch(/padding/);
      const afterMoveRect = await page.evaluate(() => {
        const r = document.getElementById("card")!.getBoundingClientRect();
        return { left: r.left, top: r.top };
      });
      // It must actually have moved (a real move-drag happened, not a no-op).
      expect(afterMoveRect.left).not.toBe(beforeMoveRect.left);
      expect(afterMoveRect.top).not.toBe(beforeMoveRect.top);

      // Recompute the handle-line position for the now-moved element and
      // pointerdown exactly on it — this must resize padding, not move.
      const cardRect = await page.evaluate(() => {
        const r = document.getElementById("card")!.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      const midX = cardRect.left + cardRect.width / 2;
      const lineY = cardRect.top + 24; // padding-top / 2

      await page.mouse.move(midX, lineY);
      await page.waitForTimeout(80);
      await page.mouse.down();
      await page.mouse.move(midX, lineY + 20, { steps: 5 });
      await page.mouse.up();

      const afterPaddingDragStyle = await page
        .locator("#card")
        .getAttribute("style");
      expect(afterPaddingDragStyle).toMatch(/padding-top:\s*68px/);
      // The element itself must not have moved from the padding drag (its
      // left/top must stay exactly where the earlier move-drag left them).
      const afterPaddingDragRect = await page.evaluate(() => {
        const r = document.getElementById("card")!.getBoundingClientRect();
        return { left: r.left, top: r.top };
      });
      expect(afterPaddingDragRect.left).toBe(afterMoveRect.left);
      expect(afterPaddingDragRect.top).toBe(afterMoveRect.top);

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge padding handle: hatch + value box show on hover, hatch hides while dragging",
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
      body { background: #0b0b0f; }
      #card {
        position: absolute; left: 200px; top: 150px;
        width: 360px; height: 220px;
        padding: 48px;
        background: #17181d;
        box-sizing: border-box;
      }
      #card .inner { background: #26272d; height: 100%; }
    </style>
  </head>
  <body>
    <div id="card" data-agent-native-node-id="card">
      <div class="inner" data-agent-native-node-id="inner">inner</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(220, 170);
      await page.waitForFunction(() => {
        const sel = document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        ) as HTMLElement | null;
        return !!sel && sel.style.display === "block";
      });

      const midX = 200 + 360 / 2;
      const lineY = 150 + 24;

      await page.mouse.move(midX, lineY);
      await page.waitForTimeout(150);

      const hoverState = await page.evaluate(() => {
        const hatch = document.querySelector(
          '[data-agent-native-spacing-hatch="padding"]',
        ) as HTMLElement | null;
        const badge = document.querySelector(
          "[data-agent-native-spacing-badge]",
        ) as HTMLElement | null;
        return {
          hatchHasFill:
            !!hatch && hatch.style.background.indexOf("repeating") !== -1,
          badgeDisplay: badge ? getComputedStyle(badge).display : null,
          badgeText: badge ? badge.textContent : null,
        };
      });
      expect(hoverState.hatchHasFill).toBe(true);
      expect(hoverState.badgeDisplay).toBe("block");
      expect(hoverState.badgeText).toBe("48px");

      // Start the padding drag — hatch must disappear immediately, badge
      // must keep updating live with the in-progress value.
      await page.mouse.down();
      await page.mouse.move(midX, lineY + 20, { steps: 5 });
      await page.waitForTimeout(80);

      const dragState = await page.evaluate(() => {
        const hatch = document.querySelector(
          '[data-agent-native-spacing-hatch="padding"]',
        ) as HTMLElement | null;
        const badge = document.querySelector(
          "[data-agent-native-spacing-badge]",
        ) as HTMLElement | null;
        return {
          hatchHasFill:
            !!hatch && hatch.style.background.indexOf("repeating") !== -1,
          badgeDisplay: badge ? getComputedStyle(badge).display : null,
          badgeText: badge ? badge.textContent : null,
        };
      });
      expect(dragState.hatchHasFill).toBe(false);
      expect(dragState.badgeDisplay).toBe("block");
      expect(dragState.badgeText).toBe("68px");

      await page.mouse.up();
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge restores the drop-insertion line for in-screen flow reorder, scaled for zoomed-out overview",
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
      body { background: #0b0b0f; }
      #list {
        position: absolute; left: 100px; top: 100px;
        display: flex; flex-direction: column; gap: 12px;
        width: 300px;
      }
      .item { height: 60px; background: #1d1e24; box-sizing: border-box; }
    </style>
  </head>
  <body>
    <div id="list" data-agent-native-node-id="list">
      <div class="item" id="item1" data-agent-native-node-id="item1">One</div>
      <div class="item" id="item2" data-agent-native-node-id="item2">Two</div>
      <div class="item" id="item3" data-agent-native-node-id="item3">Three</div>
    </div>
  </body>
</html>`);
      // Scale 0.3 simulates a zoomed-out overview: the host shrinks this
      // iframe to 30% via CSS transform, so any hardcoded (unscaled) chrome
      // thickness would render at 30% of its already-thin size on screen —
      // this is the actual regression (a bright line that renders sub-pixel
      // and reads as "missing" at typical overview zoom).
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithScale(0.3),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const item1Rect = await page.evaluate(() => {
        const r = document.getElementById("item1")!.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      const startX = item1Rect.left + item1Rect.width / 2;
      const startY = item1Rect.top + item1Rect.height / 2;
      await page.mouse.click(startX, startY);
      await page.waitForFunction(() => {
        const sel = document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        ) as HTMLElement | null;
        return !!sel && sel.style.display === "block";
      });

      const item3Rect = await page.evaluate(() => {
        const r = document.getElementById("item3")!.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX, item3Rect.top + item3Rect.height - 5, {
        steps: 10,
      });
      await page.waitForTimeout(100);

      const guideState = await page.evaluate(() => {
        const guide = document.querySelector(
          "[data-agent-native-insertion-guide]",
        ) as HTMLElement | null;
        return {
          display: guide ? getComputedStyle(guide).display : null,
          heightPx: guide ? parseFloat(guide.style.height || "0") : 0,
        };
      });
      expect(guideState.display).toBe("block");
      // At chromeLineScale() ≈ 1/0.3 ≈ 3.33, the guide thickness must scale
      // up proportionally (2 * 3.33 ≈ 6.67px) so that once the host shrinks
      // the iframe back down by 0.3, the on-screen line stays a constant,
      // clearly visible ~2px — not the pre-fix hardcoded 2px, which would
      // have rendered at an illegible ~0.6px on screen at this zoom.
      expect(guideState.heightPx).toBeGreaterThan(5);

      await page.mouse.up();
      await page.waitForTimeout(100);

      const finalOrder = await page.evaluate(() =>
        Array.from(document.getElementById("list")!.children).map((c) => c.id),
      );
      expect(finalOrder).toEqual(["item2", "item3", "item1"]);

      const guideAfterDrop = await page.evaluate(() => {
        const guide = document.querySelector(
          "[data-agent-native-insertion-guide]",
        ) as HTMLElement | null;
        return guide ? getComputedStyle(guide).display : null;
      });
      expect(guideAfterDrop).toBe("none");

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge clamps selection-handle inward hit reach on small elements at low zoom while keeping large-element handle geometry bit-identical",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: #0b0b0f; }
      #row {
        position: absolute; left: 100px; top: 100px;
        display: flex; gap: 16px;
      }
      #chip, .sib { width: 64.8px; height: 36px; background: #2a6df4; }
      #frame {
        position: absolute; left: 100px; top: 320px;
        width: 600px; height: 300px; background: #1d1e24;
      }
    </style>
  </head>
  <body>
    <div id="row" data-agent-native-node-id="row">
      <div id="chip" data-agent-native-node-id="chip"></div>
      <div class="sib" data-agent-native-node-id="sib1"></div>
    </div>
    <div id="frame" data-agent-native-node-id="frame"></div>
  </body>
</html>`);
      // Scale 0.19 reproduces the dnd finding's 19% overview zoom: the
      // bridge's chrome scale is 1/0.19 ≈ 5.26, so a nominal 10px edge bar
      // becomes ~52.6 local px thick with ~26.3px of inward reach per side.
      // Pre-clamp, the opposing N/S bars of the selected 64.8x36px chip
      // overlapped and jointly covered its ENTIRE 36px height (probe showed
      // elementsFromPoint at the chip center hitting the S then N handle
      // spans, never the body), so the chip could never be grabbed for a
      // move drag — every center press resolved to a resize.
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithScale(0.19),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const chipRect = await page.evaluate(() => {
        const r = document.getElementById("chip")!.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      const chipCenterX = chipRect.left + chipRect.width / 2;
      const chipCenterY = chipRect.top + chipRect.height / 2;
      await page.mouse.click(chipCenterX, chipCenterY);
      await page.waitForFunction(() => {
        const sel = document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        ) as HTMLElement | null;
        return (
          !!sel &&
          sel.style.display === "block" &&
          parseFloat(sel.style.width || "0") < 100
        );
      });
      // Handle spans carry 150ms width/height/offset transitions — let them
      // settle before measuring rendered hit-zone rects.
      await page.waitForTimeout(250);

      const chipZoneState = await page.evaluate(
        ({ cx, cy }) => {
          const covering: string[] = [];
          document
            .querySelectorAll(
              "[data-agent-native-edge-handle],[data-agent-native-edit-handle]",
            )
            .forEach((handle) => {
              const r = handle.getBoundingClientRect();
              const inside =
                cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
              if (!inside) return;
              covering.push(
                handle.getAttribute("data-agent-native-edge-handle") ||
                  "corner:" +
                    handle.getAttribute("data-agent-native-edit-handle"),
              );
            });
          const topmost = document.elementsFromPoint(cx, cy)[0] as
            | Element
            | undefined;
          return {
            covering,
            topmostIsHandle:
              !!topmost &&
              (topmost.hasAttribute("data-agent-native-edge-handle") ||
                topmost.hasAttribute("data-agent-native-edit-handle")),
          };
        },
        { cx: chipCenterX, cy: chipCenterY },
      );
      // The chip's center must be pressable as a BODY point: no edge/corner
      // handle hit zone may cover it (inward reach is clamped to 25% of the
      // chip's own dimension per axis), and the topmost element under the
      // point must not be a handle span.
      expect(chipZoneState.covering).toEqual([]);
      expect(chipZoneState.topmostIsHandle).toBe(false);

      // Large frame (600x300 at the same zoom): the nominal inward reach
      // (~26.3px) is far below 25% of either dimension, so the clamp must
      // not engage — the handle geometry must be bit-identical to the
      // historical unclamped formulas (edge bars 10*scale thick centered on
      // the edge via a -5*scale offset; corner squares 7*scale with a
      // -4*scale offset).
      const frameRect = await page.evaluate(() => {
        const r = document.getElementById("frame")!.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      await page.mouse.click(
        frameRect.left + frameRect.width / 2,
        frameRect.top + frameRect.height / 2,
      );
      await page.waitForFunction(() => {
        const sel = document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        ) as HTMLElement | null;
        return (
          !!sel &&
          sel.style.display === "block" &&
          parseFloat(sel.style.width || "0") > 500
        );
      });

      const largeGeometry = await page.evaluate(() => {
        // Serialize the historical formulas through the same CSSOM path the
        // bridge writes through, so any browser rounding in style-value
        // serialization applies identically to expected and actual.
        const s = 1 / Math.max(0.05, 0.19); // chromeScaleX()/chromeScaleY()
        const probe = document.createElement("span");
        // Serialize through `left` (not width/height) so NEGATIVE offsets
        // round-trip too — CSS rejects negative lengths for width/height.
        const ser = (value: number): string => {
          probe.style.left = "";
          probe.style.left = value + "px";
          return probe.style.left;
        };
        const expected = {
          edgeThickness: ser(10 * s),
          edgeOffset: ser(-5 * s),
          cornerSize: ser(7 * s),
          cornerOffset: ser(-4 * s),
        };
        const edges: { pos: string; thickness: string; offset: string }[] = [];
        document
          .querySelectorAll("[data-agent-native-edge-handle]")
          .forEach((edge) => {
            const el = edge as HTMLElement;
            const pos = el.getAttribute("data-agent-native-edge-handle") || "";
            edges.push({
              pos,
              thickness:
                pos === "n" || pos === "s" ? el.style.height : el.style.width,
              offset:
                pos === "n"
                  ? el.style.top
                  : pos === "s"
                    ? el.style.bottom
                    : pos === "w"
                      ? el.style.left
                      : el.style.right,
            });
          });
        const corners: {
          pos: string;
          width: string;
          height: string;
          offsetX: string;
          offsetY: string;
        }[] = [];
        document
          .querySelectorAll("[data-agent-native-edit-handle]")
          .forEach((handle) => {
            const el = handle as HTMLElement;
            const pos = el.getAttribute("data-agent-native-edit-handle") || "";
            corners.push({
              pos,
              width: el.style.width,
              height: el.style.height,
              offsetX: pos.indexOf("w") !== -1 ? el.style.left : el.style.right,
              offsetY: pos.indexOf("n") !== -1 ? el.style.top : el.style.bottom,
            });
          });
        return { expected, edges, corners };
      });
      expect(largeGeometry.edges).toHaveLength(4);
      expect(largeGeometry.corners).toHaveLength(4);
      for (const edge of largeGeometry.edges) {
        expect(edge.thickness, `edge ${edge.pos} thickness`).toBe(
          largeGeometry.expected.edgeThickness,
        );
        expect(edge.offset, `edge ${edge.pos} offset`).toBe(
          largeGeometry.expected.edgeOffset,
        );
      }
      for (const corner of largeGeometry.corners) {
        expect(corner.width, `corner ${corner.pos} width`).toBe(
          largeGeometry.expected.cornerSize,
        );
        expect(corner.height, `corner ${corner.pos} height`).toBe(
          largeGeometry.expected.cornerSize,
        );
        expect(corner.offsetX, `corner ${corner.pos} x offset`).toBe(
          largeGeometry.expected.cornerOffset,
        );
        expect(corner.offsetY, `corner ${corner.pos} y offset`).toBe(
          largeGeometry.expected.cornerOffset,
        );
      }

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
    "T25: a forced document replacement cannot collapse to the selected subtree",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        await beginTextEditOnTarget(page);

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "replace-document-content",
              content: `<!doctype html><html><body><div id="target" data-agent-native-node-id="target">Hello world</div><div id="duplicate" data-agent-native-node-id="duplicate">Duplicated sibling</div></body></html>`,
              forceFullDocument: true,
            },
            "*",
          );
        });
        await page.waitForTimeout(50);

        const replaced = await page.evaluate(() => ({
          target: document.querySelector("#target")?.textContent,
          duplicate: document.querySelector("#duplicate")?.textContent,
        }));
        expect(replaced).toEqual({
          target: "Hello world",
          duplicate: "Duplicated sibling",
        });
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

  it(
    "T22: begin-text-edit for a node that lands in the DOM later still activates (bounded retry window)",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);

        // Post the command BEFORE the node exists — the creation race.
        await page.evaluate(() => {
          window.postMessage(
            { type: "begin-text-edit", nodeId: "late-node", force: true },
            "*",
          );
        });
        await page.waitForTimeout(250);
        const editingBeforeNodeExists = await page.evaluate(
          () => !!document.querySelector("[data-agent-native-text-editing]"),
        );
        expect(editingBeforeNodeExists).toBe(false);

        // The node arrives via the (simulated) persist round trip.
        await page.evaluate(() => {
          document.body.insertAdjacentHTML(
            "beforeend",
            '<div id="late" data-agent-native-node-id="late-node" style="position:absolute;left:500px;top:400px;min-width:8px;min-height:20px"></div>',
          );
        });
        await page.waitForSelector("[data-agent-native-text-editing]");

        const activation = await page.evaluate(() => {
          const editing = document.querySelector<HTMLElement>(
            "[data-agent-native-text-editing]",
          );
          return {
            id: editing?.id,
            focused: document.activeElement === editing,
            contenteditable: editing?.getAttribute("contenteditable"),
          };
        });
        expect(activation.id).toBe("late");
        expect(activation.focused).toBe(true);
        expect(activation.contenteditable).toBe("true");

        // Keystrokes land in the new node, not anywhere else.
        await page.keyboard.type("hey");
        const typed = await page.evaluate(
          () => document.querySelector("#late")?.textContent,
        );
        expect(typed).toBe("hey");
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T23: Escape exits a STALE session (edited node detached by a patch) and restores the shield",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        // Chromium fires blur when the FOCUSED node is removed, which would
        // end the session cleanly — but the real leak happens when the node
        // is patched away while focus sits elsewhere (the overnight repro).
        // Suppress the session's blur commit to force that exact state.
        await page.evaluate(() => {
          document
            .querySelector<HTMLElement>("#target")!
            .addEventListener(
              "blur",
              (ev) => ev.stopImmediatePropagation(),
              true,
            );
        });
        await beginTextEditOnTarget(page);

        // Simulate a document patch replacing the edited node: its blur and
        // keydown listeners die with it, so only document-level recovery can
        // end the session.
        await page.evaluate(() => {
          document.querySelector("#target")!.remove();
        });
        const shieldDisabledDuringLeak = await page.evaluate(
          () =>
            document.querySelector<HTMLElement>(
              '[data-agent-native-edit-overlay="shield"]',
            )!.style.pointerEvents,
        );
        expect(shieldDisabledDuringLeak).toBe("none");

        await page.keyboard.press("Escape");
        await page.waitForTimeout(30);

        const afterEscape = await page.evaluate(() => ({
          editing: !!document.querySelector("[data-agent-native-text-editing]"),
          shieldPointerEvents: document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="shield"]',
          )!.style.pointerEvents,
        }));
        expect(afterEscape.editing).toBe(false);
        expect(afterEscape.shieldPointerEvents).not.toBe("none");
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T23: a pointerdown self-heals a stale session and the very next gesture can drag again",
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
      #target { position: absolute; left: 120px; top: 140px; width: 240px; height: 60px; background: #e9eef8; }
      #other { position: absolute; left: 500px; top: 400px; width: 100px; height: 80px; background: #ddd; }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target">Hello world</div>
    <div id="other" data-agent-native-node-id="other">Other</div>
  </body>
</html>`);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScriptWithTextEditing(),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
        // Force the true leak state: suppress the session's blur commit so
        // removing the node cannot end the session via Chromium's
        // blur-on-remove behavior (see the Escape-variant test above).
        await page.evaluate(() => {
          document
            .querySelector<HTMLElement>("#target")!
            .addEventListener(
              "blur",
              (ev) => ev.stopImmediatePropagation(),
              true,
            );
        });
        await page.evaluate(() => {
          window.postMessage(
            { type: "begin-text-edit", nodeId: "target", force: true },
            "*",
          );
        });
        await page.waitForSelector("[data-agent-native-text-editing]");

        // Detach the edited node — the pre-fix behavior left activeTextEditEl
        // pointing at the orphan forever, blocking every drag until reload.
        await page.evaluate(() => {
          document.querySelector("#target")!.remove();
        });
        const shieldDuringLeak = await page.evaluate(
          () =>
            document.querySelector<HTMLElement>(
              '[data-agent-native-edit-overlay="shield"]',
            )!.style.pointerEvents,
        );
        expect(shieldDuringLeak).toBe("none");

        // First click recovers the session (document-level pointerdown).
        await page.mouse.click(50, 50);
        await page.waitForTimeout(30);
        const shieldRestored = await page.evaluate(
          () =>
            document.querySelector<HTMLElement>(
              '[data-agent-native-edit-overlay="shield"]',
            )!.style.pointerEvents,
        );
        expect(shieldRestored).not.toBe("none");

        // The next gesture is a working drag again.
        await page.mouse.click(550, 440);
        await page.waitForFunction(() => {
          const overlay = document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="selection"]',
          );
          return (
            overlay && window.getComputedStyle(overlay).display === "block"
          );
        });
        await page.mouse.move(550, 440);
        await page.mouse.down();
        await page.mouse.move(560, 450);
        await page.mouse.move(590, 480);
        await page.mouse.up();
        const draggedPosition = await page.evaluate(() => {
          const other = document.querySelector<HTMLElement>("#other")!;
          return { left: other.style.left, top: other.style.top };
        });
        expect(draggedPosition).toEqual({ left: "530px", top: "430px" });
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T23: a runtime content update is not buffered forever behind a stale session",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        // Same leak-state setup as the Escape-variant test above.
        await page.evaluate(() => {
          document
            .querySelector<HTMLElement>("#target")!
            .addEventListener(
              "blur",
              (ev) => ev.stopImmediatePropagation(),
              true,
            );
        });
        await beginTextEditOnTarget(page);
        await page.evaluate(() => {
          document.querySelector("#target")!.remove();
        });

        // A NON-force update while a session is nominally active used to be
        // buffered until the session ended — which a detached session never
        // does, freezing this surface's content until a full reload.
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "replace-document-content",
              content:
                "<!doctype html><html><head></head><body><div id='fresh' data-agent-native-node-id='fresh'>Fresh content</div></body></html>",
              selectedSelector: "",
              selectorCandidates: [],
              forceFullDocument: false,
            },
            "*",
          );
        });
        await page.waitForTimeout(50);

        const applied = await page.evaluate(() => ({
          fresh: !!document.querySelector("#fresh"),
          editing: !!document.querySelector("[data-agent-native-text-editing]"),
          shieldPointerEvents: document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="shield"]',
          )!.style.pointerEvents,
        }));
        expect(applied.fresh).toBe(true);
        expect(applied.editing).toBe(false);
        expect(applied.shieldPointerEvents).not.toBe("none");
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T24: while a session is active but unfocused, the next keydown refocuses the editable instead of falling through",
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
      #target { position: absolute; left: 120px; top: 140px; width: 240px; height: 60px; background: #e9eef8; }
      #steal { position: absolute; left: 600px; top: 500px; width: 60px; height: 30px; }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target">Hello world</div>
    <div id="steal" tabindex="-1"></div>
  </body>
</html>`);
        // Suppress the bridge's blur commit BEFORE the session starts so we
        // can force the exact race state: session active, focus elsewhere.
        // (Registration order matters: this capture listener runs before the
        // session's own, so stopImmediatePropagation starves it.)
        await page.evaluate(() => {
          document
            .querySelector<HTMLElement>("#target")!
            .addEventListener(
              "blur",
              (ev) => ev.stopImmediatePropagation(),
              true,
            );
        });
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScriptWithTextEditing(),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
        await page.evaluate(() => {
          window.postMessage(
            { type: "begin-text-edit", nodeId: "target", force: true },
            "*",
          );
        });
        await page.waitForSelector("[data-agent-native-text-editing]");

        await page.evaluate(() => {
          document.querySelector<HTMLElement>("#steal")!.focus();
        });
        const raceState = await page.evaluate(() => ({
          activeId: document.activeElement?.id,
          editing: !!document.querySelector("[data-agent-native-text-editing]"),
        }));
        expect(raceState.activeId).toBe("steal");
        expect(raceState.editing).toBe(true);

        // The race window: a keystroke while the editable is unfocused must
        // pull focus back into the editable, never fall through to hotkeys.
        await page.keyboard.press("a");
        await page.waitForTimeout(30);
        const afterKey = await page.evaluate(() => ({
          activeId: document.activeElement?.id,
          text: document.querySelector("#target")?.textContent,
        }));
        expect(afterKey.activeId).toBe("target");
        expect(afterKey.text).toBe("Hello worlda");

        // Escape must exit deterministically from the same unfocused state.
        await page.evaluate(() => {
          document.querySelector<HTMLElement>("#steal")!.focus();
        });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(30);
        const afterEscape = await page.evaluate(() => ({
          editing: !!document.querySelector("[data-agent-native-text-editing]"),
          shieldPointerEvents: document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="shield"]',
          )!.style.pointerEvents,
        }));
        expect(afterEscape.editing).toBe(false);
        expect(afterEscape.shieldPointerEvents).not.toBe("none");
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );
});

// ── Nest-on-drop into plain rectangles (Figma "drop into a frame" parity) ───
//
// Product decision: dragging a rectangle onto another rectangle, or text onto
// a rectangle, nests the dragged element as a child with auto-layout — a
// plain <div> now counts as a valid nesting container, not just an existing
// flex/grid element. See autoLayoutInsertionTargetForPoint's updated policy
// comment in editor-chrome.bridge.ts.

function collectBridgeMessages(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    (window as any).__bridgeMessages = [];
    window.addEventListener("message", (event: MessageEvent) => {
      (window as any).__bridgeMessages.push(event.data);
    });
  });
}

async function readBridgeMessages(page: import("@playwright/test").Page) {
  return page.evaluate(
    () => (window as any).__bridgeMessages as Array<Record<string, unknown>>,
  );
}

it(
  "editor chrome bridge nests a dragged rectangle into a plain rectangle target and converts it to auto-layout",
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
      #frame {
        position: absolute; left: 300px; top: 100px;
        width: 320px; height: 240px; background: #f4f4f8;
      }
      #dragme {
        position: absolute; left: 40px; top: 40px;
        width: 80px; height: 60px; background: #6366f1;
      }
    </style>
  </head>
  <body>
    <div id="frame" data-agent-native-node-id="frame">Frame</div>
    <div id="dragme" data-agent-native-node-id="dragme">Drag me</div>
  </body>
</html>`);
      // React 19's development Fiber stack is the source of truth for local
      // TSX nodes that do not carry explicit data-source-* attributes. The
      // structure-change contract must preserve the DROP ANCHOR's provenance,
      // not only the dragged node's payload, so the host can resolve both AST
      // anchors without guessing from a selector after the optimistic reparent.
      await page.locator("#frame").evaluate((element) => {
        Object.defineProperty(element, "__reactFiber$structureanchor", {
          configurable: true,
          enumerable: true,
          value: {
            _debugStack: {
              stack:
                "Error\n    at SettingsFrame (http://127.0.0.1:7331/app/components/SettingsFrame.tsx:42:7)",
            },
            return: null,
          },
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      // Select #dragme (center at 80, 70) and drag it onto #frame's center
      // (460, 220) — a plain, non-auto-layout rectangle target.
      await page.mouse.click(80, 70);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.mouse.move(80, 70);
      await page.mouse.down();
      await page.mouse.move(90, 80, { steps: 4 }); // cross the 3px threshold
      await page.mouse.move(460, 220, { steps: 8 });

      // While hovering the frame, the insertion guide should show an
      // "inside" (accent border/fill) affordance — same idiom as dropping
      // into a genuine auto-layout container. Checked via the inline style
      // string (not computed style): this bare test page never defines
      // --design-editor-accent-color, and some engines drop the whole
      // `border` shorthand's computed value when a var() inside it is
      // unresolved, which would make a computed-style assertion a false
      // negative independent of the actual bridge behavior.
      const insideGuideVisible = await page.evaluate(() => {
        const guide = document.querySelector<HTMLElement>(
          "[data-agent-native-insertion-guide]",
        );
        if (!guide) return false;
        return (
          window.getComputedStyle(guide).display === "block" &&
          guide.style.border.includes("solid")
        );
      });
      expect(insideGuideVisible).toBe(true);

      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>("#frame")!;
        const dragged = document.querySelector<HTMLElement>("#dragme")!;
        const frameStyle = window.getComputedStyle(frame);
        return {
          draggedParentId: dragged.parentElement?.id,
          frameDisplay: frameStyle.display,
          frameFlexDirection: frameStyle.flexDirection,
        };
      });

      expect(result.draggedParentId).toBe("frame");
      expect(result.frameDisplay).toBe("flex");
      expect(result.frameFlexDirection).toBe("column");
      // Note: clearing the moved child's absolute position/left/top is a
      // host-side effect (DesignEditor.tsx's handleVisualStructureChange
      // calls removeAbsolutePositioningFromNodeInHtml whenever dropMode is
      // "flow-insert", which this drop already asserts below) driven by the
      // structure-change message the bridge posts — there is no host
      // attached in this bridge-only Playwright page to round-trip that
      // patched HTML back into the iframe, so the optimistic DOM here still
      // shows the pre-strip inline left/top. The message-level assertions
      // below are what prove the bridge asked for the strip.

      const messages = await readBridgeMessages(page);
      const styleMessage = messages.find(
        (m) =>
          m.type === "visual-style-change" &&
          (m as any).selector?.includes("frame"),
      ) as any;
      const structureMessage = messages.find(
        (m) => m.type === "visual-structure-change",
      ) as any;
      expect(styleMessage).toBeTruthy();
      expect(styleMessage.styles.display).toBe("flex");
      expect(styleMessage.styles["flex-direction"]).toBe("column");
      expect(structureMessage).toBeTruthy();
      expect(structureMessage.dropMode).toBe("flow-insert");
      expect(structureMessage.placement).toBe("inside");
      expect(structureMessage.anchorPayload).toMatchObject({
        tagName: "div",
        id: "frame",
        sourceId: "frame",
        selector: '[data-agent-native-node-id="frame"]',
        provenance: {
          sourceFile: "app/components/SettingsFrame.tsx",
          line: 42,
          column: 7,
          component: "SettingsFrame",
        },
      });
      expect(structureMessage.anchorPayload.computedStyles.display).toBe(
        "flex",
      );
      // The style conversion must be posted before the structural move so the
      // host applies them in order against its synchronous content refs.
      expect(messages.indexOf(styleMessage)).toBeLessThan(
        messages.indexOf(structureMessage),
      );
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge nests dragged text into a plain rectangle target the same way",
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
      #frame {
        position: absolute; left: 300px; top: 100px;
        width: 320px; height: 240px; background: #f4f4f8;
      }
      #label {
        position: absolute; left: 40px; top: 40px;
        width: 120px; height: 24px;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <div id="frame" data-agent-native-node-id="frame">Frame</div>
    <p id="label" data-agent-native-node-id="label">Hello world</p>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      await page.mouse.click(100, 52);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.mouse.move(100, 52);
      await page.mouse.down();
      await page.mouse.move(110, 62, { steps: 4 });
      await page.mouse.move(460, 220, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>("#frame")!;
        const label = document.querySelector<HTMLElement>("#label")!;
        return {
          labelParentId: label.parentElement?.id,
          frameDisplay: window.getComputedStyle(frame).display,
        };
      });

      expect(result.labelParentId).toBe("frame");
      expect(result.frameDisplay).toBe("flex");

      // Clearing the moved node's absolute position is a host-side effect of
      // the "flow-insert" dropMode (see the rectangle-onto-rectangle test's
      // comment above) — assert the message that drives it instead of the
      // unattached bridge-only page's optimistic DOM state.
      const messages = await readBridgeMessages(page);
      const structureMessage = messages.find(
        (m) => m.type === "visual-structure-change",
      ) as any;
      expect(structureMessage).toBeTruthy();
      expect(structureMessage.dropMode).toBe("flow-insert");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge rebases left/top into the new parent's space on an absolute-container nest drop",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // #container is a canvas rectangle primitive (data-an-primitive):
      // dropping onto it resolves to dropMode "absolute-container", which
      // keeps the member position:absolute — the member's inline left/top
      // must therefore be converted from its OLD containing-block space
      // (screen root) into the container's padding-edge space, or it renders
      // displaced by exactly the container's origin after the reparent.
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #container {
        position: absolute; left: 400px; top: 200px;
        width: 220px; height: 160px; background: #f4f4f8;
        border: 2px solid #cccccc;
      }
      #note {
        position: absolute; left: 60px; top: 400px;
        width: 100px; height: 40px; background: #6366f1;
      }
    </style>
  </head>
  <body>
    <div id="container" data-an-primitive="rectangle" data-agent-native-node-id="container"></div>
    <div id="note" data-agent-native-node-id="note">Note</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      // Select #note (center 110, 420) and drag it into #container.
      await page.mouse.click(110, 420);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await page.mouse.move(110, 420);
      await page.mouse.down();
      await page.mouse.move(120, 430); // crosses the 3px threshold → reference
      await page.mouse.move(510, 280); // container interior

      // Capture the member's on-screen position at the drop instant.
      const preDropRect = await page.evaluate(() => {
        const rect = document.querySelector("#note")!.getBoundingClientRect();
        return { left: rect.left, top: rect.top };
      });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const note = document.querySelector<HTMLElement>("#note")!;
        const container = document.querySelector<HTMLElement>("#container")!;
        const noteRect = note.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        return {
          parentId: note.parentElement?.id,
          position: window.getComputedStyle(note).position,
          styleLeft: parseFloat(note.style.left),
          styleTop: parseFloat(note.style.top),
          rectLeft: noteRect.left,
          rectTop: noteRect.top,
          // Container padding-edge origin (border box + 2px border).
          containerPaddingLeft: containerRect.left + 2,
          containerPaddingTop: containerRect.top + 2,
        };
      });

      expect(result.parentId).toBe("container");
      // Absolute-container drops keep free positioning (no flow strip)...
      expect(result.position).toBe("absolute");
      // ...the on-screen position survives the reparent bit-for-bit...
      expect(Math.abs(result.rectLeft - preDropRect.left)).toBeLessThan(1);
      expect(Math.abs(result.rectTop - preDropRect.top)).toBeLessThan(1);
      // ...because left/top were rebased to the container's padding edge —
      // small parent-relative numbers, not screen-root coordinates.
      expect(
        Math.abs(
          result.styleLeft - (result.rectLeft - result.containerPaddingLeft),
        ),
      ).toBeLessThan(1);
      expect(
        Math.abs(
          result.styleTop - (result.rectTop - result.containerPaddingTop),
        ),
      ).toBeLessThan(1);
      expect(result.styleLeft).toBeGreaterThanOrEqual(0);
      expect(result.styleLeft).toBeLessThan(220);
      expect(result.styleTop).toBeGreaterThanOrEqual(0);
      expect(result.styleTop).toBeLessThan(160);

      // The structure message reports the drop and the TRUE on-screen rect —
      // the host's persistence math (sourceRect − anchorRect) depends on it.
      const messages = await readBridgeMessages(page);
      const structureMessage = messages.find(
        (m) => m.type === "visual-structure-change",
      ) as any;
      expect(structureMessage).toBeTruthy();
      expect(structureMessage.dropMode).toBe("absolute-container");
      expect(structureMessage.placement).toBe("inside");
      expect(
        Math.abs(structureMessage.sourceRect.x - preDropRect.left),
      ).toBeLessThan(1);
      expect(
        Math.abs(structureMessage.sourceRect.y - preDropRect.top),
      ).toBeLessThan(1);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge rebases left/top correctly through TWO levels of nested containing blocks under a non-zero board offset",
  { timeout: 30_000 },
  async () => {
    // Coverage gap flagged by review: rebaseAbsoluteMemberForContainerDrop's
    // old/new containing-block origin math (editor-chrome.bridge.ts, the
    // "Absolute-container nest rebase" block above) is only exercised with
    // the member and the drop container each ONE level of nesting below the
    // single translated board-root node (see the "removes the finite board
    // render offset" test above, where #note/#container sit directly on
    // body). Here #note's containing block (#outer) is nested inside #screen
    // (the translated root), and the drop target (#inner) is nested a level
    // deeper still, inside #outer — a genuine two-level-nested containing
    // block chain. Since the board's render-time translate is applied once,
    // at #screen, both #outer's and #inner's getBoundingClientRect() already
    // bake in that single offset regardless of how deep they sit beneath
    // #screen, so the "subtract boardOffset once" math in
    // rebaseAbsoluteMemberForContainerDrop should hold at any nesting depth,
    // not just one level. This asserts that holds.
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
      body { position: relative; }
      body > [data-agent-native-node-id="screen"] { translate: 4096px 4096px; }
      #screen {
        position: absolute; left: -4096px; top: -4096px;
        width: 900px; height: 700px;
      }
      #outer {
        position: absolute; left: 300px; top: 100px;
        width: 400px; height: 300px; background: #f4f4f8;
        border: 2px solid #999999;
      }
      #inner {
        position: absolute; left: 20px; top: 20px;
        width: 200px; height: 140px; background: #eeeeee;
        border: 2px solid #888888; overflow: hidden;
      }
      #note {
        position: absolute; left: 40px; top: 180px;
        width: 80px; height: 40px; background: #6366f1;
      }
    </style>
  </head>
  <body>
    <div id="screen" data-agent-native-node-id="screen">
      <div id="outer" data-an-primitive="frame" data-agent-native-node-id="outer">
        <div id="inner" data-an-primitive="frame" data-agent-native-node-id="inner"></div>
        <div id="note" data-agent-native-node-id="note">Note</div>
      </div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({
        content: hydratedBoardEditorChromeBridgeScriptWithOffset(4096, 4096),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      // #note renders at roughly (342, 282)-(422, 322) on screen
      // (outer's origin ~(300,100) + 2px border + note's own left/top).
      await page.mouse.click(382, 302);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await page.mouse.move(382, 302);
      await page.mouse.down();
      await page.mouse.move(392, 312); // crosses the 3px threshold → reference
      await page.mouse.move(420, 190); // #inner's interior

      const preDropRect = await page.evaluate(() => {
        const rect = document.querySelector("#note")!.getBoundingClientRect();
        return { left: rect.left, top: rect.top };
      });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const note = document.querySelector<HTMLElement>("#note")!;
        const inner = document.querySelector<HTMLElement>("#inner")!;
        const noteRect = note.getBoundingClientRect();
        const innerRect = inner.getBoundingClientRect();
        return {
          parentId: note.parentElement?.id,
          position: window.getComputedStyle(note).position,
          styleLeft: Number.parseFloat(note.style.left),
          styleTop: Number.parseFloat(note.style.top),
          rectLeft: noteRect.left,
          rectTop: noteRect.top,
          // #inner's padding-edge origin (border box + 2px border).
          innerPaddingLeft: innerRect.left + 2,
          innerPaddingTop: innerRect.top + 2,
        };
      });

      expect(result.parentId).toBe("inner");
      expect(result.position).toBe("absolute");
      // The on-screen position survives the reparent bit-for-bit through both
      // nesting levels...
      expect(Math.abs(result.rectLeft - preDropRect.left)).toBeLessThan(1);
      expect(Math.abs(result.rectTop - preDropRect.top)).toBeLessThan(1);
      // ...because left/top were rebased into #inner's padding-edge space —
      // small parent-relative numbers, not #outer- or #screen-relative ones.
      expect(
        Math.abs(
          result.styleLeft - (result.rectLeft - result.innerPaddingLeft),
        ),
      ).toBeLessThan(1);
      expect(
        Math.abs(result.styleTop - (result.rectTop - result.innerPaddingTop)),
      ).toBeLessThan(1);
      expect(result.styleLeft).toBeGreaterThanOrEqual(0);
      expect(result.styleLeft).toBeLessThan(200);
      expect(result.styleTop).toBeGreaterThanOrEqual(0);
      expect(result.styleTop).toBeLessThan(140);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge removes the finite board render offset when nesting into a frame",
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
      body { position: relative; }
      body > [data-agent-native-node-id] { translate: 4096px 4096px; }
      #container {
        position: absolute; left: -3696px; top: -3896px;
        width: 220px; height: 160px; background: #f4f4f8;
        border: 2px solid #cccccc; overflow: hidden;
      }
      #note {
        position: absolute; left: -4036px; top: -3696px;
        width: 100px; height: 40px; background: #6366f1;
      }
    </style>
  </head>
  <body>
    <div id="container" data-an-primitive="frame" data-agent-native-node-id="container"></div>
    <div id="note" data-agent-native-node-id="note">Note</div>
  </body>
</html>`);
      await page.addScriptTag({
        content: hydratedBoardEditorChromeBridgeScriptWithOffset(4096, 4096),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      await page.mouse.click(110, 420);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await page.mouse.move(110, 420);
      await page.mouse.down();
      await page.mouse.move(120, 430);
      await page.mouse.move(510, 280);
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const note = document.querySelector<HTMLElement>("#note")!;
        const container = document.querySelector<HTMLElement>("#container")!;
        const noteRect = note.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        return {
          parentId: note.parentElement?.id,
          styleLeft: Number.parseFloat(note.style.left),
          styleTop: Number.parseFloat(note.style.top),
          rectLeft: noteRect.left,
          rectTop: noteRect.top,
          containerLeft: containerRect.left,
          containerTop: containerRect.top,
        };
      });

      expect(result.parentId).toBe("container");
      expect(result.styleLeft).toBeGreaterThanOrEqual(0);
      expect(result.styleLeft).toBeLessThan(220);
      expect(result.styleTop).toBeGreaterThanOrEqual(0);
      expect(result.styleTop).toBeLessThan(160);
      expect(result.rectLeft).toBeGreaterThanOrEqual(result.containerLeft);
      expect(result.rectTop).toBeGreaterThanOrEqual(result.containerTop);
      const messages = await readBridgeMessages(page);
      const structureMessage = messages.find(
        (message) => message.type === "visual-structure-change",
      ) as any;
      expect(structureMessage?.dropMode).toBe("absolute-container");
      expect(structureMessage?.anchorSourceId).toBe("container");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge respects the insertion index when dropping between existing children of a converted container",
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
      #frame {
        position: absolute; left: 300px; top: 100px;
        width: 320px; height: 240px; background: #f4f4f8;
        margin: 0; padding: 0;
      }
      /* Genuine flex children — normal flow, no absolute positioning, so
         layout (and this test's insertion-index assertion) is driven purely
         by flex-direction:column + gap, matching what a real converted
         container looks like. */
      .child {
        width: 100px; height: 60px; background: #a5b4fc;
        margin: 0;
      }
      #dragme {
        position: absolute; left: 40px; top: 400px;
        width: 80px; height: 60px; background: #6366f1;
      }
    </style>
  </head>
  <body>
    <div id="frame" data-agent-native-node-id="frame">
      <div id="childA" class="child" data-agent-native-node-id="childA">A</div>
      <div id="childB" class="child" data-agent-native-node-id="childB">B</div>
    </div>
    <div id="dragme" data-agent-native-node-id="dragme">Drag me</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      // #frame is already display:flex (auto-layout) here via inline style
      // set after load, so this test isolates "respect insertion index"
      // from the "convert to auto-layout" behavior covered above.
      await page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>("#frame")!;
        frame.style.display = "flex";
        frame.style.flexDirection = "column";
        frame.style.gap = "8px";
      });

      // Aim inside childB near its top edge (not the gap between childA and
      // childB): autoLayoutInsertionTargetForPoint resolves the insertion
      // side by comparing the pointer against the HIT child's own center —
      // hitting the gap itself resolves to the frame container (an
      // elementFromPoint miss on both children) and appends at the end
      // instead, which isn't what this test is exercising. Read the real
      // rendered rect instead of hardcoding it, so this isn't coupled to
      // guessing the box model.
      const point = await page.evaluate(() => {
        const b = document.querySelector("#childB")!.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + 5 };
      });

      await page.mouse.click(80, 430);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.mouse.move(80, 430);
      await page.mouse.down();
      await page.mouse.move(90, 420, { steps: 4 });
      // Drop near childB's top edge so the insertion lands before childB
      // (i.e. between childA and childB), not at either end.
      await page.mouse.move(point.x, point.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const order = await page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>("#frame")!;
        return Array.from(frame.children).map((c) => c.id);
      });

      expect(order).toEqual(["childA", "dragme", "childB"]);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge does NOT nest a dragged element onto a leaf (image/text) target",
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
      #leaf {
        position: absolute; left: 300px; top: 100px;
        width: 200px; height: 150px;
      }
      #dragme {
        position: absolute; left: 40px; top: 40px;
        width: 80px; height: 60px; background: #6366f1;
      }
    </style>
  </head>
  <body>
    <img id="leaf" data-agent-native-node-id="leaf" alt="Leaf" />
    <div id="dragme" data-agent-native-node-id="dragme">Drag me</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      await page.mouse.click(80, 70);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.mouse.move(80, 70);
      await page.mouse.down();
      await page.mouse.move(90, 80, { steps: 4 });
      await page.mouse.move(400, 175, { steps: 8 }); // center of #leaf

      const insertionGuideVisible = await page.evaluate(() => {
        const guide = document.querySelector<HTMLElement>(
          "[data-agent-native-insertion-guide]",
        );
        return guide
          ? window.getComputedStyle(guide).display === "block"
          : false;
      });
      expect(insertionGuideVisible).toBe(false);

      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const dragged = document.querySelector<HTMLElement>("#dragme")!;
        return {
          parentId: dragged.parentElement?.id,
          // Position comes from the "#dragme" CSS class rule, not an inline
          // style, so read the computed value rather than dragged.style.
          position: window.getComputedStyle(dragged).position,
          left: dragged.style.left,
          top: dragged.style.top,
        };
      });

      // No valid nesting target — the element stays a direct body child at
      // its dropped absolute position (free placement), never reparented
      // into the leaf.
      expect(result.parentId).not.toBe("leaf");
      expect(result.position).toBe("absolute");
      expect(result.left).toBe("360px");
      expect(result.top).toBe("145px");

      const messages = await readBridgeMessages(page);
      expect(messages.some((m) => m.type === "visual-structure-change")).toBe(
        false,
      );
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Multi-select group move (Figma parity) ──────────────────────────────────
//
// Dragging any member of a 2+ selection moves the WHOLE group: same delta per
// member on the absolute path, consecutive insertion on group drops, selection
// preserved afterwards. A plain click (no drag) on a member still collapses
// the selection to that element.

it(
  "editor chrome bridge moves every multi-selected member by the same delta and keeps the selection",
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
      .box { position: absolute; width: 120px; height: 80px; }
      #boxA { left: 60px; top: 60px; background: #6366f1; }
      #boxB { left: 260px; top: 60px; background: #22c55e; }
    </style>
  </head>
  <body>
    <div id="boxA" class="box" data-agent-native-node-id="boxA">A</div>
    <div id="boxB" class="box" data-agent-native-node-id="boxB">B</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      // Select A, then shift-click B into the selection.
      await page.mouse.click(120, 100);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await page.keyboard.down("Shift");
      await page.mouse.click(320, 100);
      await page.keyboard.up("Shift");
      await page.waitForFunction(() => {
        const passive = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="multi-selection"]',
        );
        return passive && window.getComputedStyle(passive).display !== "none";
      });

      // Drag B (the primary) by +100/+50 from the threshold reference.
      await page.mouse.move(320, 100);
      await page.mouse.down();
      await page.mouse.move(324, 104, { steps: 2 }); // crosses the threshold; becomes reference
      await page.mouse.move(424, 154, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const a = document.querySelector<HTMLElement>("#boxA")!;
        const b = document.querySelector<HTMLElement>("#boxB")!;
        const passive = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="multi-selection"]',
        );
        return {
          aLeft: a.style.left,
          aTop: a.style.top,
          bLeft: b.style.left,
          bTop: b.style.top,
          multiSelectionStillVisible: Boolean(
            passive && window.getComputedStyle(passive).display !== "none",
          ),
        };
      });

      // Same +100/+50 delta applied to BOTH members (offsets preserved).
      expect(result.aLeft).toBe("160px");
      expect(result.aTop).toBe("110px");
      expect(result.bLeft).toBe("360px");
      expect(result.bTop).toBe("110px");
      // Selection stays intact after the drop.
      expect(result.multiSelectionStillVisible).toBe(true);

      // Persistence: one visual-style-change per member, in order.
      const messages = await readBridgeMessages(page);
      const styleChanges = messages.filter(
        (m) => m.type === "visual-style-change" && (m as any).styles?.left,
      ) as any[];
      expect(styleChanges.length).toBe(2);
      expect(styleChanges[0].selector).toContain("boxA");
      expect(styleChanges[1].selector).toContain("boxB");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge drops a multi-selected group consecutively into a container with one auto-layout conversion",
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
      .box { position: absolute; width: 100px; height: 60px; }
      #boxA { left: 60px; top: 60px; background: #6366f1; }
      #boxB { left: 220px; top: 60px; background: #22c55e; }
      #target {
        position: absolute; left: 480px; top: 300px;
        width: 280px; height: 200px; background: #f4f4f8;
      }
    </style>
  </head>
  <body>
    <div id="boxA" class="box" data-agent-native-node-id="boxA">A</div>
    <div id="boxB" class="box" data-agent-native-node-id="boxB">B</div>
    <div id="target" data-agent-native-node-id="target"></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      await page.mouse.click(110, 90);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await page.keyboard.down("Shift");
      await page.mouse.click(270, 90);
      await page.keyboard.up("Shift");
      await page.waitForFunction(() => {
        const passive = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="multi-selection"]',
        );
        return passive && window.getComputedStyle(passive).display !== "none";
      });

      // Drag B onto the plain #target rectangle's center.
      await page.mouse.move(270, 90);
      await page.mouse.down();
      await page.mouse.move(280, 100, { steps: 2 });
      await page.mouse.move(620, 400, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        return {
          childIds: Array.from(target.children).map((c) => c.id),
          targetDisplay: window.getComputedStyle(target).display,
          targetFlexDirection: window.getComputedStyle(target).flexDirection,
        };
      });

      // Both members nested CONSECUTIVELY, in document order (A before B even
      // though B was the dragged member).
      expect(result.childIds).toEqual(["boxA", "boxB"]);
      expect(result.targetDisplay).toBe("flex");
      expect(result.targetFlexDirection).toBe("column");

      const messages = await readBridgeMessages(page);
      const conversionMessages = messages.filter(
        (m) =>
          m.type === "visual-style-change" &&
          (m as any).styles?.display === "flex",
      );
      const structureMessages = messages.filter(
        (m) => m.type === "visual-structure-change",
      );
      const marqueeMessages = messages.filter(
        (m) => m.type === "agent-native:layer-marquee-selection",
      ) as any[];
      // Auto-layout conversion fires exactly ONCE for the container.
      expect(conversionMessages.length).toBe(1);
      // One structure change per member.
      expect(structureMessages.length).toBe(2);
      // Selection restored (final marquee-selection message carries both).
      const lastMarquee = marqueeMessages[marqueeMessages.length - 1];
      expect(lastMarquee).toBeTruthy();
      expect(lastMarquee.payload.length).toBe(2);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge round-trips flow child through freeform root, flow, and absolute container",
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
      body { position: relative; background: white; }
      .flow { position: absolute; top: 40px; width: 220px; min-height: 150px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; background: #f5f5f5; }
      #flowA { left: 40px; }
      #flowB { left: 340px; }
      #item { width: 100px; height: 44px; background: #6366f1; color: white; }
      #absoluteFrame { position: absolute; left: 340px; top: 300px; width: 240px; height: 180px; background: #eef2ff; }
    </style>
  </head>
  <body>
    <div id="flowA" class="flow" data-agent-native-node-id="flowA">
      <div id="item" data-agent-native-node-id="item">Move me</div>
    </div>
    <div id="flowB" class="flow" data-agent-native-node-id="flowB"></div>
    <div id="absoluteFrame" data-agent-native-node-id="absoluteFrame" data-an-primitive="frame"></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const dragTo = async (x: number, y: number) => {
        const box = (await page.locator("#item").boundingBox())!;
        const startX = box.x + box.width / 2;
        const startY = box.y + box.height / 2;
        await page.mouse.click(startX, startY);
        await page.waitForTimeout(30);
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX + 5, startY + 5, { steps: 2 });
        await page.mouse.move(x, y, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(50);
      };

      // Flow -> freeform root: release-point placement with the original
      // pointer offset preserved.
      await dragTo(760, 560);
      const rootResult = await page.evaluate(() => {
        const item = document.querySelector<HTMLElement>("#item")!;
        const rect = item.getBoundingClientRect();
        return {
          parentId: item.parentElement?.id || item.parentElement?.tagName,
          position: window.getComputedStyle(item).position,
          left: rect.left,
          top: rect.top,
        };
      });
      expect(rootResult.parentId).toBe("BODY");
      expect(rootResult.position).toBe("absolute");
      expect(rootResult.left).toBeCloseTo(710, 0);
      expect(rootResult.top).toBeCloseTo(538, 0);

      // Absolute root -> flow: absolute position props are stripped and the
      // element occupies a real flow slot.
      await dragTo(450, 105);
      const flowResult = await page.evaluate(() => {
        const item = document.querySelector<HTMLElement>("#item")!;
        return {
          parentId: item.parentElement?.id,
          position: window.getComputedStyle(item).position,
          left: item.style.left,
          top: item.style.top,
        };
      });
      expect(flowResult.parentId).toBe("flowB");
      expect(["static", "relative"]).toContain(flowResult.position);
      expect(flowResult.left).toBe("");
      expect(flowResult.top).toBe("");

      // Flow -> absolute frame keeps the visual release point and absolute
      // semantics inside the new containing block.
      await dragTo(460, 390);
      const frameResult = await page.evaluate(() => {
        const item = document.querySelector<HTMLElement>("#item")!;
        const rect = item.getBoundingClientRect();
        return {
          parentId: item.parentElement?.id,
          position: window.getComputedStyle(item).position,
          left: rect.left,
          top: rect.top,
        };
      });
      expect(frameResult.parentId).toBe("absoluteFrame");
      expect(frameResult.position).toBe("absolute");
      expect(frameResult.left).toBeCloseTo(410, 0);
      expect(frameResult.top).toBeCloseTo(368, 0);

      // Absolute frame -> flow completes the round trip.
      await dragTo(145, 105);
      const roundTripResult = await page.evaluate(() => {
        const item = document.querySelector<HTMLElement>("#item")!;
        return {
          parentId: item.parentElement?.id,
          position: window.getComputedStyle(item).position,
        };
      });
      expect(roundTripResult.parentId).toBe("flowA");
      expect(["static", "relative"]).toContain(roundTripResult.position);

      const messages = await readBridgeMessages(page);
      const structureMessages = messages.filter(
        (message) => message.type === "visual-structure-change",
      ) as Array<{ dropMode?: string; placement?: string }>;
      expect(structureMessages.map((message) => message.dropMode)).toEqual([
        "absolute-container",
        "flow-insert",
        "absolute-container",
        "flow-insert",
      ]);
      expect(
        structureMessages.every((message) => message.placement === "inside"),
      ).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge honors Space retain-parent and Control Ignore-auto-layout modifiers",
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
      body { position: relative; background: white; }
      .flow { position: absolute; top: 40px; width: 220px; min-height: 180px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; background: #f5f5f5; }
      #flowA { left: 40px; }
      #flowB { left: 340px; }
      .item { width: 100px; height: 44px; color: white; }
      #spaceItem { background: #6366f1; }
      #controlItem { background: #22c55e; }
    </style>
  </head>
  <body>
    <div id="flowA" class="flow" data-agent-native-node-id="flowA">
      <div id="spaceItem" class="item" data-agent-native-node-id="spaceItem">Space</div>
      <div id="controlItem" class="item" data-agent-native-node-id="controlItem">Control</div>
    </div>
    <div id="flowB" class="flow" data-agent-native-node-id="flowB"></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const spaceBox = (await page.locator("#spaceItem").boundingBox())!;
      const spaceStartX = spaceBox.x + spaceBox.width / 2;
      const spaceStartY = spaceBox.y + spaceBox.height / 2;
      await page.mouse.click(spaceStartX, spaceStartY);
      await page.mouse.move(spaceStartX, spaceStartY);
      await page.mouse.down();
      await page.keyboard.down("Space");
      await page.mouse.move(760, 560, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.up("Space");
      await page.waitForTimeout(50);

      const retained = await page.evaluate(() => {
        const item = document.querySelector<HTMLElement>("#spaceItem")!;
        return {
          parentId: item.parentElement?.id,
          position: window.getComputedStyle(item).position,
        };
      });
      expect(retained.parentId).toBe("flowA");
      expect(["static", "relative"]).toContain(retained.position);

      const controlBox = (await page.locator("#controlItem").boundingBox())!;
      const controlStartX = controlBox.x + controlBox.width / 2;
      const controlStartY = controlBox.y + controlBox.height / 2;
      await page.mouse.click(controlStartX, controlStartY);
      await page.mouse.move(controlStartX, controlStartY);
      await page.mouse.down();
      await page.keyboard.down("Control");
      await page.mouse.move(450, 115, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.up("Control");
      await page.waitForTimeout(50);

      const ignored = await page.evaluate(() => {
        const item = document.querySelector<HTMLElement>("#controlItem")!;
        return {
          parentId: item.parentElement?.id,
          position: window.getComputedStyle(item).position,
        };
      });
      expect(ignored.parentId).toBe("flowB");
      expect(ignored.position).toBe("absolute");

      const messages = await readBridgeMessages(page);
      const structureMessages = messages.filter(
        (message) => message.type === "visual-structure-change",
      ) as Array<{ dropMode?: string }>;
      expect(structureMessages[structureMessages.length - 1]?.dropMode).toBe(
        "absolute-container",
      );
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge still collapses the selection on a plain click (no drag) on a group member",
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
      .box { position: absolute; width: 120px; height: 80px; }
      #boxA { left: 60px; top: 60px; background: #6366f1; }
      #boxB { left: 260px; top: 60px; background: #22c55e; }
    </style>
  </head>
  <body>
    <div id="boxA" class="box" data-agent-native-node-id="boxA">A</div>
    <div id="boxB" class="box" data-agent-native-node-id="boxB">B</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(120, 100);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await page.keyboard.down("Shift");
      await page.mouse.click(320, 100);
      await page.keyboard.up("Shift");
      await page.waitForFunction(() => {
        const passive = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="multi-selection"]',
        );
        return passive && window.getComputedStyle(passive).display !== "none";
      });

      // Plain click (no movement) on member A: collapses the selection to A
      // (existing disambiguation) — the collapse is signaled to the host as a
      // non-additive element-select for A, and no move messages fire.
      await collectBridgeMessages(page);
      await page.mouse.click(120, 100);
      await page.waitForTimeout(30);

      const messages = await readBridgeMessages(page);
      const selects = messages.filter(
        (m) => m.type === "element-select",
      ) as any[];
      expect(selects.length).toBeGreaterThan(0);
      const lastSelect = selects[selects.length - 1];
      expect(lastSelect.payload.selector).toContain("boxA");
      expect(Boolean(lastSelect.intent?.additive)).toBe(false);
      expect(
        messages.some(
          (m) =>
            m.type === "visual-structure-change" ||
            m.type === "visual-style-change",
        ),
      ).toBe(false);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Zoom-invariant chrome (constant screen size) ────────────────────────────
//
// The host CSS-scales the whole iframe by the canvas zoom and reports that
// scale to the bridge; every piece of editor chrome must multiply its
// intrinsic sizes by the inverse so the APPARENT size on screen is constant
// at any zoom — zoomed out (scale < 1) AND zoomed in (scale > 1, where the
// old Math.max(1, …) floors made chrome render chunky).

it(
  "editor chrome bridge renders selection border, handles, and the spacing badge at constant screen size across zoom levels",
  { timeout: 60_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const observed: Array<{
        scale: number;
        screenSelBorder: number;
        screenHandle: number;
        screenBadgeFont: number;
        badgeShown: boolean;
      }> = [];
      for (const scale of [0.19, 1, 2.67]) {
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
      #frame {
        position: absolute; left: 200px; top: 100px;
        width: 400px; height: 300px; background: #eef1f8;
        box-sizing: border-box;
        display: flex; flex-direction: column; gap: 12px; padding: 24px;
      }
      .child { height: 60px; background: #a5b4fc; }
    </style>
  </head>
  <body>
    <div id="frame" data-agent-native-node-id="frame">
      <div class="child" data-agent-native-node-id="c1">A</div>
      <div class="child" data-agent-native-node-id="c2">B</div>
    </div>
  </body>
</html>`);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScriptWithScale(scale),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

        await page.mouse.click(400, 112);
        await page.waitForFunction(() => {
          const overlay = document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="selection"]',
          );
          return (
            overlay && window.getComputedStyle(overlay).display === "block"
          );
        });
        // Hover the top padding handle line (band center) so the "Npx" value
        // box shows — must work at every zoom level.
        await page.mouse.move(500, 300, { steps: 3 });
        await page.mouse.move(400, 112, { steps: 6 });
        await page.waitForTimeout(120);

        const s = await page.evaluate(() => {
          const sel = document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="selection"]',
          )!;
          const handle = document.querySelector<HTMLElement>(
            "[data-agent-native-edit-handle]",
          );
          const badge = document.querySelector<HTMLElement>(
            "[data-agent-native-spacing-badge]",
          )!;
          return {
            selBorder: parseFloat(sel.style.borderWidth),
            handleW: parseFloat(handle ? handle.style.width : "0"),
            badgeFont: parseFloat(window.getComputedStyle(badge).fontSize),
            badgeShown: window.getComputedStyle(badge).display === "block",
          };
        });
        observed.push({
          scale,
          screenSelBorder: s.selBorder * scale,
          screenHandle: s.handleW * scale,
          screenBadgeFont: s.badgeFont * scale,
          badgeShown: s.badgeShown,
        });
        await page.close();
      }

      for (const o of observed) {
        // Constant apparent size: 1.5px selection border, 7px corner handles,
        // 10px badge font — at 19%, 100%, and 267% zoom alike.
        expect(o.badgeShown, `badge hidden at scale ${o.scale}`).toBe(true);
        expect(Math.abs(o.screenSelBorder - 1.5)).toBeLessThan(0.05);
        expect(Math.abs(o.screenHandle - 7)).toBeLessThan(0.05);
        expect(Math.abs(o.screenBadgeFont - 10)).toBeLessThan(0.05);
      }
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Board-text auto-color adaptation on nest ────────────────────────────────
//
// Board-drawn text carries an auto-applied inline default color (#fff on the
// dark canvas). Nesting it into a light container must adapt that AUTO color
// to inherit — but never touch a color the user explicitly chose.

it(
  "editor chrome bridge adapts the board-default white text color to inherit when nesting into a light container",
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
      body { background: #202020; }
      #frame {
        position: absolute; left: 400px; top: 120px;
        width: 320px; height: 240px; background: #eef1f8;
      }
    </style>
  </head>
  <body>
    <div id="frame" data-agent-native-node-id="frame"></div>
    <div id="autoText" data-agent-native-node-id="autoText" data-an-primitive="text"
      style="position: absolute; left: 40px; top: 60px; width: 140px; height: 24px; color: #ffffff; font-size: 16px;">Board text</div>
    <div id="userText" data-agent-native-node-id="userText" data-an-primitive="text"
      style="position: absolute; left: 40px; top: 420px; width: 140px; height: 24px; color: rgb(255, 0, 0); font-size: 16px;">Red text</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      // Drag the auto-white board text into the light frame.
      await page.mouse.click(110, 72);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await page.mouse.move(110, 72);
      await page.mouse.down();
      await page.mouse.move(120, 82, { steps: 2 });
      await page.mouse.move(560, 240, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      // Drag the user-red text into the light frame too.
      await page.mouse.click(110, 432);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await page.mouse.move(110, 432);
      await page.mouse.down();
      await page.mouse.move(120, 442, { steps: 2 });
      await page.mouse.move(560, 240, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const autoText = document.querySelector<HTMLElement>("#autoText")!;
        const userText = document.querySelector<HTMLElement>("#userText")!;
        return {
          autoParent: autoText.parentElement?.id,
          autoColor: autoText.style.color,
          userParent: userText.parentElement?.id,
          userColor: userText.style.color,
        };
      });

      expect(result.autoParent).toBe("frame");
      // Auto default white adapted to inherit (visible on the light frame).
      expect(result.autoColor).toBe("inherit");
      expect(result.userParent).toBe("frame");
      // Explicit user color NEVER clobbered.
      expect(result.userColor).toBe("rgb(255, 0, 0)");

      const messages = await readBridgeMessages(page);
      const colorMessages = messages.filter(
        (m) =>
          m.type === "visual-style-change" &&
          (m as any).styles?.color === "inherit",
      ) as any[];
      expect(colorMessages.length).toBe(1);
      expect(colorMessages[0].selector).toContain("autoText");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Real-usage regressions from the user's AI-generated design (Batch 5) ────

it(
  "editor chrome bridge shows a between-children insertion line when hovering a container gap and drops at that slot (B5-4)",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // Mirrors the user's AI-generated screen shape: a block container with
      // spaced flow children (like Tailwind's space-y-2 list) and NO
      // data-agent-native-node-id anywhere.
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #list { position: absolute; left: 100px; top: 80px; width: 400px; padding: 8px; }
      .row { height: 60px; background: #a5b4fc; border-radius: 8px; }
      .row + .row { margin-top: 16px; }
    </style>
  </head>
  <body>
    <div id="list">
      <div class="row" id="rowA">A</div>
      <div class="row" id="rowB">B</div>
      <div class="row" id="rowC">C</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      // Select row C, then drag it into the GAP between rows A and B — the
      // pointer sits over the container's own background there, which used
      // to resolve to placement "inside" (append after last, no line).
      await page.mouse.click(300, 270); // row C center (rows at 88/164/240, each 60 tall)
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await page.mouse.move(300, 270);
      await page.mouse.down();
      await page.mouse.move(306, 264, { steps: 2 });
      await page.mouse.move(300, 156, { steps: 6 }); // gap between A (ends 148) and B (starts 164)
      await page.waitForTimeout(50);

      const guide = await page.evaluate(() => {
        const g = document.querySelector<HTMLElement>(
          "[data-agent-native-insertion-guide]",
        );
        if (!g) return null;
        return {
          display: window.getComputedStyle(g).display,
          height: parseFloat(g.style.height),
          width: parseFloat(g.style.width),
        };
      });
      await page.mouse.up();
      await page.waitForTimeout(50);

      // The affordance while hovering the gap must be an insertion LINE
      // (thin horizontal bar), not the container-fill "inside" highlight.
      expect(guide).toBeTruthy();
      expect(guide!.display).toBe("block");
      expect(guide!.height).toBeLessThan(10);
      expect(guide!.width).toBeGreaterThan(100);

      // The drop lands BETWEEN A and B (not appended after C's old slot).
      const order = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("#list .row")).map(
          (el) => el.id,
        ),
      );
      expect(order).toEqual(["rowA", "rowC", "rowB"]);

      const msg = (await readBridgeMessages(page)).filter(
        (m) => m.type === "visual-structure-change",
      ) as any[];
      expect(msg.length).toBe(1);
      expect(msg[0].dropMode).toBe("flow-insert");
      expect(["before", "after"]).toContain(msg[0].placement);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge keeps the padding value box visible across a same-selection host replay (B5-15)",
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
      #frame {
        position: absolute; left: 200px; top: 100px;
        width: 400px; height: 300px; background: #eef1f8;
        box-sizing: border-box;
        display: flex; flex-direction: column; gap: 12px; padding: 24px;
      }
      .child { height: 60px; background: #a5b4fc; }
    </style>
  </head>
  <body>
    <div id="frame" data-agent-native-node-id="frame">
      <div class="child" data-agent-native-node-id="c1">A</div>
      <div class="child" data-agent-native-node-id="c2">B</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(400, 112);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      // Hover the top padding handle so the "Npx" value box shows.
      await page.mouse.move(500, 300, { steps: 3 });
      await page.mouse.move(400, 112, { steps: 6 });
      await page.waitForTimeout(80);
      const before = await page.evaluate(() => {
        const b = document.querySelector<HTMLElement>(
          "[data-agent-native-spacing-badge]",
        )!;
        return window.getComputedStyle(b).display + ":" + b.textContent;
      });
      expect(before).toBe("block:24px");

      // Simulate the host's application-state poll replaying the SAME
      // selection while the cursor rests on the handle — the old handler
      // reset the hover state on EVERY replay, so the value box vanished
      // within a poll tick in real usage ("the value box never shows").
      const after = await page.evaluate(async () => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="frame"]',
            selectorCandidates: ['[data-agent-native-node-id="frame"]'],
          },
          "*",
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
        const b = document.querySelector<HTMLElement>(
          "[data-agent-native-spacing-badge]",
        )!;
        return window.getComputedStyle(b).display + ":" + b.textContent;
      });
      expect(after).toBe("block:24px");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge reads React jsxDEV source provenance from the development Fiber stack",
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
  <head><style>html,body{margin:0;width:100%;height:100%}h1{margin:80px;width:320px;height:60px}</style></head>
  <body><h1 id="react-heading">How can I help?</h1></body>
</html>`);
      await page.locator("#react-heading").evaluate((element) => {
        element.setAttribute("onerror", "window.__snapshotAttack=1");
        element.setAttribute("srcdoc", "<script>bad()</script>");
        element.setAttribute("formaction", "javascript:bad()");
        const iframe = document.createElement("iframe");
        iframe.id = "malicious-snapshot-frame";
        iframe.srcdoc = "<p>frame</p>";
        element.appendChild(iframe);
      });
      await page.locator("#react-heading").evaluate((element) => {
        Object.defineProperty(element, "__reactFiber$bridgeguard", {
          configurable: true,
          enumerable: true,
          value: {
            _debugStack: {
              stack:
                "Error\n    at ChatRoute (http://127.0.0.1:7331/app/routes/_index.tsx:78:35)",
            },
            return: null,
          },
        });
      });
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(true),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "agent-native:runtime-layer-snapshot",
        ),
      );

      const runtimeSnapshot = await page.evaluate(
        () =>
          ((window as any).__bridgeMessages ?? []).find(
            (message: any) =>
              message.type === "agent-native:runtime-layer-snapshot",
          )?.payload,
      );
      expect(runtimeSnapshot.nodeCount).toBeGreaterThan(0);
      expect(runtimeSnapshot.documentId).toMatch(/^runtime-/);
      expect(runtimeSnapshot.html).toContain("How can I help?");
      expect(runtimeSnapshot.html).toContain(
        'data-source-file="app/routes/_index.tsx"',
      );
      expect(runtimeSnapshot.html).not.toMatch(
        /<iframe|\sonerror=|\ssrcdoc=|javascript:/i,
      );
      const runtimeIdentity = await page.evaluate((snapshotHtml) => {
        const live = document.querySelector("#react-heading");
        const snapshot = new DOMParser().parseFromString(
          snapshotHtml,
          "text/html",
        );
        return {
          liveNodeId: live?.getAttribute("data-agent-native-node-id"),
          snapshotNodeId: snapshot
            .querySelector("#react-heading")
            ?.getAttribute("data-agent-native-node-id"),
          runtimeOnlyDescendants: snapshot.querySelectorAll(
            "body *[data-an-runtime-layer-only]",
          ).length,
        };
      }, runtimeSnapshot.html);
      expect(runtimeIdentity.liveNodeId).toMatch(/^runtime-/);
      expect(runtimeIdentity.snapshotNodeId).toBe(runtimeIdentity.liveNodeId);
      expect(runtimeIdentity.runtimeOnlyDescendants).toBe(0);

      await page.mouse.click(160, 105);
      await page.waitForTimeout(60);
      const provenance = await page.evaluate(() => {
        const selections = ((window as any).__bridgeMessages ?? []).filter(
          (message: any) => message.type === "element-select",
        );
        return selections.at(-1)?.payload?.provenance ?? null;
      });

      expect(provenance).toEqual({
        sourceFile: "app/routes/_index.tsx",
        line: 78,
        column: 35,
        component: "ChatRoute",
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "runtime layers qualify shared React shell identities by screen so hover and selection keep the correct route owner",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const screens = [
        { id: "route-home", route: "/" },
        { id: "route-settings", route: "/settings" },
      ];
      const runtimeScreens = await Promise.all(
        screens.map(async (screen) => {
          const page = await browser.newPage({
            viewport: { width: 900, height: 700 },
          });
          page.on("pageerror", (error) =>
            pageErrors.push(`${screen.route}: ${error.message}`),
          );
          await page.setContent(`<!doctype html>
<html>
  <head><style>html,body{margin:0;width:100%;height:100%}h1{margin:80px;width:320px;height:60px}</style></head>
  <body><h1 id="shared-shell-heading">Shared shell</h1></body>
</html>`);
          await page.locator("#shared-shell-heading").evaluate((element) => {
            Object.defineProperty(element, "__reactFiber$sharedshell", {
              configurable: true,
              enumerable: true,
              value: {
                _debugStack: {
                  stack:
                    "Error\n    at AppShell (http://127.0.0.1:7331/app/components/AppShell.tsx:42:17)",
                },
                return: null,
              },
            });
          });
          await page.addScriptTag({
            content: hydratedEditorChromeBridgeScript(true, screen.id),
          });
          await page.waitForSelector(
            '[data-agent-native-edit-overlay="shield"]',
          );
          await collectBridgeMessages(page);
          await page.waitForFunction(() =>
            ((window as any).__bridgeMessages ?? []).some(
              (message: any) =>
                message.type === "agent-native:runtime-layer-snapshot",
            ),
          );
          const snapshot = await page.evaluate(
            () =>
              ((window as any).__bridgeMessages ?? []).find(
                (message: any) =>
                  message.type === "agent-native:runtime-layer-snapshot",
              )?.payload,
          );
          await page.mouse.move(160, 105);
          await page.waitForTimeout(60);
          await page.mouse.click(160, 105);
          await page.waitForTimeout(60);
          const messages = await readBridgeMessages(page);
          const hover = messages.find(
            (message) => message.type === "element-hover",
          ) as { payload?: { sourceId?: string } } | undefined;
          const selections = messages.filter(
            (message) => message.type === "element-select",
          ) as Array<{ payload?: { sourceId?: string } }>;
          return {
            ...screen,
            snapshotHtml: snapshot.html as string,
            nodeId: await page
              .locator("#shared-shell-heading")
              .getAttribute("data-agent-native-node-id"),
            hoverSourceId: hover?.payload?.sourceId,
            selectionSourceId:
              selections[selections.length - 1]?.payload?.sourceId,
          };
        }),
      );

      const [home, settings] = runtimeScreens;
      expect(home.nodeId).toMatch(/^runtime-/);
      expect(settings.nodeId).toMatch(/^runtime-/);
      expect(home.nodeId).not.toBe(settings.nodeId);
      expect(home.hoverSourceId).toBe(home.nodeId);
      expect(home.selectionSourceId).toBe(home.nodeId);
      expect(settings.hoverSourceId).toBe(settings.nodeId);
      expect(settings.selectionSourceId).toBe(settings.nodeId);

      const owners = new Map<string, string>();
      const projectedLayerIds = new Map<string, string>();
      runtimeScreens.forEach((screen) => {
        const projection = buildCodeLayerProjection(screen.snapshotHtml);
        projection.nodes.forEach((node) => owners.set(node.id, screen.id));
        const runtimeNode = projection.nodes.find(
          (node) =>
            node.dataAttributes["data-agent-native-node-id"] === screen.nodeId,
        );
        expect(runtimeNode).toBeDefined();
        projectedLayerIds.set(screen.id, runtimeNode!.id);
      });
      expect(projectedLayerIds.get("route-home")).not.toBe(
        projectedLayerIds.get("route-settings"),
      );
      expect(owners.get(projectedLayerIds.get("route-home")!)).toBe(
        "route-home",
      );
      expect(owners.get(projectedLayerIds.get("route-settings")!)).toBe(
        "route-settings",
      );
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "runtime Layers ignores animation churn but refreshes semantic layout and tree mutations",
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
<html><body><main id="app"><div id="animated">Card</div></main></body></html>`);
      await collectBridgeMessages(page);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(true),
      });
      await page.waitForFunction(
        () =>
          ((window as any).__bridgeMessages ?? []).filter(
            (message: any) =>
              message.type === "agent-native:runtime-layer-snapshot",
          ).length === 1,
      );

      // These are typical animation/runtime-state writes. Neither changes the
      // hierarchy, layer name, or container classification, so a large burst
      // must stay inside the initial one-snapshot budget.
      await page.locator("#animated").evaluate((element) => {
        const html = element as HTMLElement;
        for (let index = 0; index < 250; index += 1) {
          html.style.transform = `translateX(${index}px)`;
          html.style.opacity = String((index % 100) / 100);
          html.setAttribute("class", `motion-frame-${index}`);
        }
        const transientChrome = document.createElement("div");
        transientChrome.setAttribute(
          "data-agent-native-edit-overlay",
          "transient-test",
        );
        document.body.appendChild(transientChrome);
        transientChrome.remove();
      });
      await page.waitForTimeout(350);
      expect(
        await page.evaluate(
          () =>
            ((window as any).__bridgeMessages ?? []).filter(
              (message: any) =>
                message.type === "agent-native:runtime-layer-snapshot",
            ).length,
        ),
      ).toBe(1);

      // Continuous text/child churn used to serialize the full DOM every
      // 200ms forever. During a one-second stream the trailing debounce must
      // not post at all; once the stream settles, Layers receives one latest
      // snapshot (the 1.5s max-wait still bounds truly endless streams).
      await page.locator("#animated").evaluate(async (element) => {
        for (let index = 0; index < 20; index += 1) {
          element.textContent = `Streaming card ${index}`;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      });
      expect(
        await page.evaluate(
          () =>
            ((window as any).__bridgeMessages ?? []).filter(
              (message: any) =>
                message.type === "agent-native:runtime-layer-snapshot",
            ).length,
        ),
      ).toBe(1);
      await page.waitForFunction(
        () =>
          ((window as any).__bridgeMessages ?? []).filter(
            (message: any) =>
              message.type === "agent-native:runtime-layer-snapshot",
          ).length === 2,
      );

      // A flex utility changes the Layers icon/layout contract and must still
      // refresh exactly once after the observer's coalescing window.
      await page.locator("#animated").evaluate((element) => {
        element.setAttribute("class", "motion-frame flex");
      });
      await page.waitForFunction(
        () =>
          ((window as any).__bridgeMessages ?? []).filter(
            (message: any) =>
              message.type === "agent-native:runtime-layer-snapshot",
          ).length === 3,
      );
      const semanticHtml = await page.evaluate(() => {
        const snapshots = ((window as any).__bridgeMessages ?? []).filter(
          (message: any) =>
            message.type === "agent-native:runtime-layer-snapshot",
        );
        return snapshots.at(-1)?.payload?.html ?? "";
      });
      expect(semanticHtml).toContain('class="motion-frame flex"');

      // Dynamic text and child hierarchy remain live in Layers.
      await page.locator("#animated").evaluate((element) => {
        element.textContent = "Updated card";
        element.appendChild(document.createElement("button")).textContent =
          "Open";
      });
      await page.waitForFunction(
        () =>
          ((window as any).__bridgeMessages ?? []).filter(
            (message: any) =>
              message.type === "agent-native:runtime-layer-snapshot",
          ).length === 4,
      );
      const treeHtml = await page.evaluate(() => {
        const snapshots = ((window as any).__bridgeMessages ?? []).filter(
          (message: any) =>
            message.type === "agent-native:runtime-layer-snapshot",
        );
        return snapshots.at(-1)?.payload?.html ?? "";
      });
      expect(treeHtml).toContain("Updated card");
      expect(treeHtml).toContain("<button");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge mints a pendingNodeId for id-less nodes without changing selector resolution (B5-5 bridge side)",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));
      // AI-generated-design shape: NO data-agent-native-node-id anywhere.
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      .target-box { position: absolute; left: 100px; top: 100px; width: 160px; height: 100px; background: #6366f1; }
    </style>
  </head>
  <body>
    <div class="target-box">Content</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      await page.mouse.click(180, 150);
      await page.waitForTimeout(60);
      await page.mouse.click(500, 500); // deselect (empty area)
      await page.waitForTimeout(30);
      await page.mouse.click(180, 150); // reselect — mint must be stable
      await page.waitForTimeout(60);

      const result = await page.evaluate(() => {
        const selects = ((window as any).__bridgeMessages ?? []).filter(
          (m: any) =>
            m.type === "element-select" && m.payload?.tagName === "div",
        );
        const box = document.querySelector<HTMLElement>(".target-box")!;
        return {
          payloads: selects.map((m: any) => ({
            pendingNodeId: m.payload.pendingNodeId,
            selector: m.payload.selector,
            sourceId: m.payload.sourceId,
          })),
          // The mint must NOT be written as a real node id (that would break
          // the host's structural-selector fallback against source HTML).
          realNodeIdAttr: box.getAttribute("data-agent-native-node-id"),
          pendingAttr: box.getAttribute("data-an-pending-node-id"),
        };
      });

      expect(result.payloads.length).toBeGreaterThanOrEqual(2);
      const first = result.payloads[0];
      const last = result.payloads[result.payloads.length - 1];
      expect(first.pendingNodeId).toMatch(/^an-pending-/);
      // Stable across re-selection (one mint per element).
      expect(last.pendingNodeId).toBe(first.pendingNodeId);
      // sourceId stays empty and the selector stays a structural fallback —
      // resolution semantics are unchanged until the host persists the id.
      expect(first.sourceId).toBe("");
      expect(first.selector).toContain("target-box");
      expect(result.realNodeIdAttr).toBeNull();
      expect(result.pendingAttr).toBe(first.pendingNodeId);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Template-clone reorder rejection + drop-on-leaf fix (DnD hardening) ────
//
// Two related fixes for the flow-reorder drag path:
//
// 1. An Alpine `<template x-for>` runtime clone has no counterpart in the
//    static source HTML (only the single template child exists there), so a
//    structural move targeting one can never resolve on the host — it used
//    to optimistically reorder the live DOM then silently revert it with
//    zero feedback. Reject up front instead (isTemplateCloneElement).
// 2. isContainerDropTarget's flex/grid computed-display check alone can't
//    tell a genuine layout container apart from an interactive leaf control
//    (e.g. `<button style="display:flex">` used purely to align its own
//    icon + label) — both LITERALLY have display:flex. hasOnlyLeafContent
//    closes that gap by inspecting the element's own children.

it(
  "editor chrome bridge rejects reordering an Alpine x-for template clone with visible feedback and no DOM mutation",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // Alpine's runtime shape for `<template x-for>`: the <template> stays
      // in the live DOM as a hidden marker, and every rendered instance is
      // inserted as a DIRECT SIBLING of it, all still children of the same
      // parent — `ul > template, li, li` — exactly mirroring what Alpine
      // itself produces (no Alpine runtime needed to test the bridge's own
      // detection, which only inspects DOM shape).
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      ul { position: absolute; left: 40px; top: 40px; width: 240px; display: flex; flex-direction: column; gap: 8px; list-style: none; padding: 0; margin: 0; }
      li { display: flex; align-items: center; padding: 12px; border: 1px solid #ccc; background: #f5f5f5; height: 48px; box-sizing: border-box; }
    </style>
  </head>
  <body>
    <ul>
      <template x-for="t in items"></template>
      <li>Alpha</li>
      <li>Beta</li>
    </ul>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const items = await page.locator("li").all();
      const itemABox = (await items[0].boundingBox())!;
      const itemBBox = (await items[1].boundingBox())!;
      const startX = itemABox.x + itemABox.width / 2;
      const startY = itemABox.y + itemABox.height / 2;

      await page.mouse.click(startX, startY);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 5, startY - 5, { steps: 3 });
      const targetY = itemBBox.y + itemBBox.height - 5;
      await page.mouse.move(startX, targetY, { steps: 10 });
      await page.waitForTimeout(80);

      // Rejection feedback must be visible for the whole gesture: no-drop
      // cursor + text badge — never the normal insertion guide.
      const midDragState = await page.evaluate(() => {
        const guide = document.querySelector<HTMLElement>(
          "[data-agent-native-insertion-guide]",
        );
        const badge = document.querySelector<HTMLElement>(
          "[data-agent-native-transform-badge]",
        );
        const shield = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="shield"]',
        );
        return {
          guideVisible: guide
            ? window.getComputedStyle(guide).display === "block"
            : false,
          badgeText:
            badge && window.getComputedStyle(badge).display !== "none"
              ? badge.textContent
              : null,
          shieldCursor: shield ? window.getComputedStyle(shield).cursor : null,
        };
      });
      expect(midDragState.guideVisible).toBe(false);
      expect(midDragState.badgeText).toMatch(/can.t reorder/i);
      expect(midDragState.shieldCursor).toBe("not-allowed");

      await page.mouse.up();
      await page.waitForTimeout(80);

      // No DOM mutation at all — order unchanged.
      const order = await page.evaluate(() =>
        Array.from(document.querySelectorAll("li")).map((el) =>
          el.textContent?.trim(),
        ),
      );
      expect(order).toEqual(["Alpha", "Beta"]);

      // Badge and cursor fully reset after release.
      const afterState = await page.evaluate(() => {
        const badge = document.querySelector<HTMLElement>(
          "[data-agent-native-transform-badge]",
        );
        const shield = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="shield"]',
        );
        return {
          badgeDisplay: badge ? window.getComputedStyle(badge).display : null,
          shieldCursor: shield ? window.getComputedStyle(shield).cursor : null,
        };
      });
      expect(afterState.badgeDisplay).toBe("none");
      expect(afterState.shieldCursor).toBe("default");

      // Never posts a doomed structural move.
      const messages = await readBridgeMessages(page);
      expect(messages.some((m) => m.type === "visual-structure-change")).toBe(
        false,
      );
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge rejects text-editing an Alpine x-for template clone with visible feedback and no contenteditable mutation",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // Same clone shape as the reorder-rejection test above, but the clone
      // items here are plain-text `<li>`s — exactly the shape that used to
      // pass findTextEditTarget's "only inline-editable descendants" check
      // and enter contenteditable mode on the raw clone, an edit that could
      // never resolve on commit (no per-instance source node exists for a
      // clone — only the single `<template>` does). The `<ul>` carries its
      // own stable id so the rejection fallback (select nearest source-
      // backed ancestor) has something real to land on.
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      ul { position: absolute; left: 40px; top: 40px; width: 240px; display: flex; flex-direction: column; gap: 8px; list-style: none; padding: 0; margin: 0; }
      li { display: flex; align-items: center; padding: 12px; border: 1px solid #ccc; background: #f5f5f5; height: 48px; box-sizing: border-box; }
    </style>
  </head>
  <body>
    <ul data-agent-native-node-id="list">
      <template x-for="t in items"></template>
      <li>Alpha</li>
      <li>Beta</li>
    </ul>
  </body>
</html>`);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithTextEditing(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const itemABox = (await page.locator("li").first().boundingBox())!;
      const dblclickX = itemABox.x + itemABox.width / 2;
      const dblclickY = itemABox.y + itemABox.height / 2;

      await page.mouse.dblclick(dblclickX, dblclickY);
      await page.waitForTimeout(80);

      const state = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll("li"));
        const badge = document.querySelector<HTMLElement>(
          "[data-agent-native-transform-badge]",
        );
        const selection = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        const list = document.querySelector<HTMLElement>("ul")!;
        return {
          anyContentEditable: items.some(
            (el) => el.getAttribute("contenteditable") === "true",
          ),
          anyTextEditingActive: !!document.querySelector(
            "[data-agent-native-text-editing]",
          ),
          badgeText:
            badge && window.getComputedStyle(badge).display !== "none"
              ? badge.textContent
              : null,
          selectionMatchesList:
            !!selection &&
            window.getComputedStyle(selection).display === "block" &&
            Math.abs(
              selection.getBoundingClientRect().left -
                list.getBoundingClientRect().left,
            ) < 1,
        };
      });

      // No clone was put into edit mode, and no orphaned in-progress session.
      expect(state.anyContentEditable).toBe(false);
      expect(state.anyTextEditingActive).toBe(false);
      // Clear rejection feedback, same contract as the reorder rejection.
      expect(state.badgeText).toMatch(/can.t edit/i);
      // Falls back to selecting the nearest source-backed ancestor (the
      // list container) instead of leaving a stale/no selection.
      expect(state.selectionMatchesList).toBe(true);

      // Never posts a doomed text-content-change for the clone.
      const messages = await readBridgeMessages(page);
      expect(messages.some((m) => m.type === "text-content-change")).toBe(
        false,
      );
      // Source text is completely untouched.
      const order = await page.evaluate(() =>
        Array.from(document.querySelectorAll("li")).map((el) =>
          el.textContent?.trim(),
        ),
      );
      expect(order).toEqual(["Alpha", "Beta"]);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge still reorders a normal (non-template) flow child normally, unaffected by the template-clone rejection",
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
      ul { position: absolute; left: 40px; top: 40px; width: 240px; display: flex; flex-direction: column; gap: 8px; list-style: none; padding: 0; margin: 0; }
      li { display: flex; align-items: center; padding: 12px; border: 1px solid #ccc; background: #f5f5f5; height: 48px; box-sizing: border-box; }
    </style>
  </head>
  <body>
    <ul>
      <li data-agent-native-node-id="itemA">Alpha</li>
      <li data-agent-native-node-id="itemB">Beta</li>
    </ul>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const itemABox = (await page
        .locator('[data-agent-native-node-id="itemA"]')
        .boundingBox())!;
      const itemBBox = (await page
        .locator('[data-agent-native-node-id="itemB"]')
        .boundingBox())!;
      const startX = itemABox.x + itemABox.width / 2;
      const startY = itemABox.y + itemABox.height / 2;

      await page.mouse.click(startX, startY);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 5, startY - 5, { steps: 3 });
      const targetY = itemBBox.y + itemBBox.height - 5;
      await page.mouse.move(startX, targetY, { steps: 10 });
      await page.waitForTimeout(80);

      const guideVisible = await page.evaluate(() => {
        const guide = document.querySelector<HTMLElement>(
          "[data-agent-native-insertion-guide]",
        );
        return guide
          ? window.getComputedStyle(guide).display === "block"
          : false;
      });
      expect(guideVisible).toBe(true);

      await page.mouse.up();
      await page.waitForTimeout(80);

      const messages = await readBridgeMessages(page);
      expect(
        messages.some(
          (m) =>
            m.type === "visual-structure-change" &&
            (m as { dropMode?: string }).dropMode === "flow-insert",
        ),
      ).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge does not nest a dragged element onto a leaf-content flex button (drop-on-leaf), and still nests onto a real flex container",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // itemA/itemB are `<button display:flex>` chips whose only children are
      // leaf/text content (icon-free label span) — the drop-on-leaf repro
      // case. #realContainer is also display:flex but hosts a genuine <div>
      // sub-layout child, so it must still accept nested drops.
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      nav { position: absolute; left: 40px; top: 40px; width: 240px; display: flex; flex-direction: column; gap: 8px; }
      button.chip { display: flex; align-items: center; gap: 8px; padding: 12px; border: 1px solid #ccc; background: #f5f5f5; height: 48px; box-sizing: border-box; width: 100%; text-align: left; }
      #realContainer { position: absolute; left: 320px; top: 40px; width: 200px; height: 150px; display: flex; flex-direction: column; background: #eee; border: 1px solid #ccc; }
      #realContainer .inner { height: 40px; background: #ccd; }
      #dragme { position: absolute; left: 40px; top: 260px; width: 80px; height: 40px; background: #6366f1; color: white; }
    </style>
  </head>
  <body>
    <nav data-agent-native-node-id="list">
      <button class="chip" data-agent-native-node-id="itemA"><span>Alpha</span></button>
      <button class="chip" data-agent-native-node-id="itemB"><span>Beta</span></button>
    </nav>
    <div id="realContainer" data-agent-native-node-id="realContainer">
      <div class="inner" data-agent-native-node-id="inner">inner</div>
    </div>
    <div id="dragme" data-agent-native-node-id="dragme">Drag me</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      // Part 1: dragging itemA onto itemB's middle must reorder as a
      // sibling, never nest inside itemB.
      const itemABox = (await page
        .locator('[data-agent-native-node-id="itemA"]')
        .boundingBox())!;
      const itemBBox = (await page
        .locator('[data-agent-native-node-id="itemB"]')
        .boundingBox())!;
      const aX = itemABox.x + itemABox.width / 2;
      const aY = itemABox.y + itemABox.height / 2;
      const bX = itemBBox.x + itemBBox.width / 2;
      const bY = itemBBox.y + itemBBox.height / 2;

      await page.mouse.click(aX, aY);
      await page.waitForTimeout(60);
      await page.mouse.move(aX, aY);
      await page.mouse.down();
      await page.mouse.move(aX - 5, aY - 5, { steps: 3 });
      await page.mouse.move(bX, bY, { steps: 10 });
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.waitForTimeout(80);

      const chipResult = await page.evaluate(() => {
        const list = document.querySelector(
          '[data-agent-native-node-id="list"]',
        )!;
        return {
          childIds: Array.from(list.children).map((c) =>
            c.getAttribute("data-agent-native-node-id"),
          ),
          itemBText: document
            .querySelector('[data-agent-native-node-id="itemB"]')!
            .textContent?.trim(),
        };
      });
      // itemA reordered as list's sibling — never nested inside itemB.
      expect(chipResult.childIds).toContain("itemA");
      expect(chipResult.childIds).toContain("itemB");
      expect(chipResult.itemBText).toBe("Beta");

      // Part 2: dragging #dragme onto the real flex container's middle must
      // still nest it as a child (container-with-real-children case is
      // unaffected by the leaf-content exclusion).
      const dragBox = (await page.locator("#dragme").boundingBox())!;
      const containerBox = (await page
        .locator("#realContainer")
        .boundingBox())!;
      const dStartX = dragBox.x + dragBox.width / 2;
      const dStartY = dragBox.y + dragBox.height / 2;
      const dTargetX = containerBox.x + containerBox.width / 2;
      const dTargetY = containerBox.y + containerBox.height - 10;

      await page.mouse.click(dStartX, dStartY);
      await page.waitForTimeout(60);
      await page.mouse.move(dStartX, dStartY);
      await page.mouse.down();
      await page.mouse.move(dStartX - 5, dStartY - 5, { steps: 3 });
      await page.mouse.move(dTargetX, dTargetY, { steps: 10 });
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.waitForTimeout(80);

      const nestResult = await page.evaluate(
        () => document.getElementById("dragme")?.parentElement?.id,
      );
      expect(nestResult).toBe("realContainer");

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge strips leftover position/left/top when an absolute-positioned element flow-inserts into an auto-layout container (absolute-into-flow teleport fix)",
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
      #col { position: absolute; left: 300px; top: 300px; width: 200px; display: flex; flex-direction: column; gap: 8px; }
      .item { height: 40px; background: #ccd; }
    </style>
  </head>
  <body>
    <div id="col" data-agent-native-node-id="col">
      <div class="item" data-agent-native-node-id="item1">Item 1</div>
      <div class="item" data-agent-native-node-id="item2">Item 2</div>
    </div>
    <div id="dragme" style="position:absolute;left:40px;top:40px;width:80px;height:40px;background:#6366f1;color:white" data-agent-native-node-id="dragme">Drag me</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(80, 60);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      // Wander far away first (like a real messy drag path) before landing
      // inside the column — this is what produces the large leftover
      // left/top offsets the original bug reported ("left:472px;
      // top:-350px").
      await page.mouse.move(80, 60);
      await page.mouse.down();
      await page.mouse.move(85, 65, { steps: 3 });
      await page.mouse.move(600, 20, { steps: 8 });
      await page.mouse.move(400, 320, { steps: 10 });
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.waitForTimeout(80);

      const result = await page.evaluate(() => {
        const el = document.getElementById("dragme")!;
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const colRect = document.getElementById("col")!.getBoundingClientRect();
        return {
          parentId: el.parentElement?.id,
          inlineStyle: el.getAttribute("style"),
          computedPosition: cs.position,
          withinColumnBounds:
            rect.x >= colRect.x - 5 &&
            rect.x <= colRect.x + colRect.width + 5 &&
            rect.y >= colRect.y - 5 &&
            rect.y <= colRect.y + colRect.height + 5,
        };
      });

      expect(result.parentId).toBe("col");
      expect(result.computedPosition).toBe("static");
      expect(result.inlineStyle ?? "").not.toMatch(
        /position|left|top|right|bottom/,
      );
      expect(result.withinColumnBounds).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge keeps position:absolute for an absolute-container drop (does not over-strip a genuinely absolute target)",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // #rect is an absolute-positioned primitive rectangle container (the
      // dedicated absolute-container drop target, distinct from flow-insert)
      // — dropping into it must keep the moved element absolutely
      // positioned, only flow-insert targets get the strip.
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
    </style>
  </head>
  <body>
    <div id="rect" style="position:absolute;left:300px;top:100px;width:200px;height:150px;background:#eee" data-agent-native-node-id="rect" data-an-primitive="rectangle"></div>
    <div id="dragme" style="position:absolute;left:40px;top:40px;width:80px;height:40px;background:#6366f1;color:white" data-agent-native-node-id="dragme">Drag me</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(80, 60);
      await page.waitForTimeout(60);
      await page.mouse.move(80, 60);
      await page.mouse.down();
      await page.mouse.move(85, 65, { steps: 3 });
      await page.mouse.move(400, 175, { steps: 10 }); // center of #rect
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.waitForTimeout(80);

      const result = await page.evaluate(() => {
        const el = document.getElementById("dragme")!;
        const cs = getComputedStyle(el);
        return {
          parentId: el.parentElement?.id,
          computedPosition: cs.position,
        };
      });
      expect(result.parentId).toBe("rect");
      // absolute-container drop mode: position is intentionally preserved.
      expect(result.computedPosition).toBe("absolute");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── hit-test bridge — pendingNodeId minting (cross-screen/canvas anchor) ───
//
// Companion to the editor-chrome bridge's B5-5 fix above, for the SEPARATE
// hit-test bridge injected into non-edit overview iframes for cross-screen
// and canvas-to-screen drop-anchor resolution. Screens with no node ids
// anywhere (the common case for default AI-generated content) used to
// resolve every candidate anchor to anchorNodeId:"", which forced the host
// to silently fall back to absolute placement even when a valid flow-insert
// slot was found. getNodeId now mints and stamps the same
// data-an-pending-node-id marker editor-chrome.bridge.ts's getElementInfo
// uses, exposed as `pendingNodeId` on the hit-test-result reply.

function hydratedHitTestBridgeScript(): string {
  return hitTestBridgeScript;
}

it(
  "hit-test bridge mints a stable pendingNodeId for an anchor with no stable id, without spamming re-mints across repeated hovers",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // No data-agent-native-node-id anywhere — default AI-generated shape.
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      main { display: flex; flex-direction: column; gap: 8px; padding: 20px; }
      .row { padding: 12px; background: #eee; height: 20px; }
    </style>
  </head>
  <body>
    <main>
      <div class="row">Row A</div>
      <div class="row">Row B</div>
    </main>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedHitTestBridgeScript() });

      const runHitTest = (x: number, y: number, correlationId: string) =>
        page.evaluate(
          ({ x, y, correlationId }) =>
            new Promise((resolve) => {
              const onMsg = (e: MessageEvent) => {
                if (
                  e.data?.type === "agent-native:hit-test-result" &&
                  e.data.correlationId === correlationId
                ) {
                  window.removeEventListener("message", onMsg);
                  resolve(e.data);
                }
              };
              window.addEventListener("message", onMsg);
              window.postMessage(
                {
                  type: "agent-native:hit-test",
                  correlationId,
                  x,
                  y,
                  preview: false,
                },
                "*",
              );
            }),
          { x, y, correlationId },
        );

      const reply1 = (await runHitTest(200, 45, "c1")) as {
        anchorNodeId: string;
        pendingNodeId?: string;
      };
      expect(reply1.anchorNodeId).toBe("");
      expect(reply1.pendingNodeId).toMatch(/^an-pending-/);

      const stamped = await page.evaluate(
        (pid) => !!document.querySelector(`[data-an-pending-node-id="${pid}"]`),
        reply1.pendingNodeId,
      );
      expect(stamped).toBe(true);

      // Repeated hit-test at the same point (simulating hover-phase polling
      // during a drag) must reuse the same id, not mint a new one each time.
      const reply2 = (await runHitTest(200, 45, "c2")) as {
        pendingNodeId?: string;
      };
      expect(reply2.pendingNodeId).toBe(reply1.pendingNodeId);

      const stampedCount = await page.evaluate(
        () => document.querySelectorAll("[data-an-pending-node-id]").length,
      );
      expect(stampedCount).toBe(1);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "hit-test bridge does not mint a pendingNodeId when the anchor already has a stable node id",
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
      main { display: flex; flex-direction: column; gap: 8px; padding: 20px; width: 300px; height: 200px; }
    </style>
  </head>
  <body>
    <main data-agent-native-node-id="main-anchor"></main>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedHitTestBridgeScript() });

      // Empty container — any point inside its bounds resolves the anchor
      // to <main> itself (no children to route to instead).
      const reply = (await page.evaluate(
        () =>
          new Promise((resolve) => {
            const onMsg = (e: MessageEvent) => {
              if (e.data?.type === "agent-native:hit-test-result") {
                window.removeEventListener("message", onMsg);
                resolve(e.data);
              }
            };
            window.addEventListener("message", onMsg);
            window.postMessage(
              {
                type: "agent-native:hit-test",
                correlationId: "c1",
                x: 100,
                y: 60,
                preview: false,
              },
              "*",
            );
          }),
      )) as { anchorNodeId: string; pendingNodeId?: string };

      expect(reply.anchorNodeId).toBe("main-anchor");
      expect(reply.pendingNodeId).toBeUndefined();
      const stampedCount = await page.evaluate(
        () => document.querySelectorAll("[data-an-pending-node-id]").length,
      );
      expect(stampedCount).toBe(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── hit-test bridge — gap-between-children resolution (finding 6) ─────────
//
// Companion to editor-chrome.bridge.ts's B5-4 fix (nearestChildInsertionTarget
// there): a cross-screen/canvas-to-screen drop hovering a flex/auto-layout
// container's own background — its padding, or the gap BETWEEN two children,
// which is exactly where the pointer naturally sits when dropping "between
// two cards" — used to resolve to placement:"inside" (append-after-last)
// instead of a before/after slot next to the nearest child. hit-test.bridge.ts
// now routes that same case through its own nearestChildInsertionTarget so
// cross-screen drops show the same Figma-style insertion line the in-screen
// drag path already gets.

it(
  "hit-test bridge resolves a hover over the gap BETWEEN children to a before/after slot instead of inside-append",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // A column flex container with a visible gap between two children —
      // data-agent-native-node-id on every node so the reply's anchorNodeId
      // is deterministic (no pendingNodeId minting to account for).
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      main {
        display: flex; flex-direction: column; gap: 40px; padding: 20px;
        width: 300px;
      }
      .row { padding: 12px; background: #eee; height: 40px; }
    </style>
  </head>
  <body>
    <main data-agent-native-node-id="main-anchor">
      <div class="row" data-agent-native-node-id="row-a">Row A</div>
      <div class="row" data-agent-native-node-id="row-b">Row B</div>
    </main>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedHitTestBridgeScript() });

      const runHitTest = (x: number, y: number) =>
        page.evaluate(
          ({ x, y }) =>
            new Promise((resolve) => {
              const onMsg = (e: MessageEvent) => {
                if (e.data?.type === "agent-native:hit-test-result") {
                  window.removeEventListener("message", onMsg);
                  resolve(e.data);
                }
              };
              window.addEventListener("message", onMsg);
              window.postMessage(
                {
                  type: "agent-native:hit-test",
                  correlationId: "gap-test",
                  x,
                  y,
                  preview: false,
                },
                "*",
              );
            }),
          { x, y },
        );

      // Row A occupies roughly y=20..72 (padding 20 + 40px height + border
      // box), then a 40px gap, then Row B starts around y=112. y=90 sits
      // squarely in that gap — a direct child hit-test would have missed
      // both rows and landed on <main> itself, the exact case that used to
      // resolve to placement:"inside".
      const reply = (await runHitTest(150, 90)) as {
        anchorNodeId: string;
        placement: string;
        axis: string;
        dropMode: string;
      };

      expect(reply.placement).not.toBe("inside");
      expect(["before", "after"]).toContain(reply.placement);
      expect(["row-a", "row-b"]).toContain(reply.anchorNodeId);
      expect(reply.axis).toBe("y");
      expect(reply.dropMode).toBe("flow-insert");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "hit-test bridge still resolves an empty auto-layout container to placement inside (no children to route to)",
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
      main {
        display: flex; flex-direction: column; gap: 8px; padding: 20px;
        width: 300px; height: 200px;
      }
    </style>
  </head>
  <body>
    <main data-agent-native-node-id="empty-main"></main>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedHitTestBridgeScript() });

      const reply = (await page.evaluate(
        () =>
          new Promise((resolve) => {
            const onMsg = (e: MessageEvent) => {
              if (e.data?.type === "agent-native:hit-test-result") {
                window.removeEventListener("message", onMsg);
                resolve(e.data);
              }
            };
            window.addEventListener("message", onMsg);
            window.postMessage(
              {
                type: "agent-native:hit-test",
                correlationId: "empty-test",
                x: 100,
                y: 60,
                preview: false,
              },
              "*",
            );
          }),
      )) as { anchorNodeId: string; placement: string };

      expect(reply.anchorNodeId).toBe("empty-main");
      expect(reply.placement).toBe("inside");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Absolute-into-pristine-flow reparent target + failed-move rollback ──────
//
// Regression: dragging a source-backed absolute-positioned element into a
// pristine (childless) flex/auto-layout container that is itself nested
// under another container (e.g. <main>) used to resolve the reparent TARGET
// one level too high — autoLayoutInsertionTargetForPoint checked "is
// cursor's PARENT a container" (sibling-insert, inside cursor's own parent)
// BEFORE checking "is CURSOR ITSELF a container" (nest inside cursor). Since
// an ancestor like <main> almost always satisfies the parent check, hovering
// directly over an empty flex row matched the sibling-insert branch first
// and the drop anchored to the OUTER container instead of nesting inside the
// hovered row. Fixed by promoting the cursor-is-container checks ahead of
// the parent-is-container fallback (matching reorderTargetForPoint's
// working precedence for the flow-reorder gesture).
//
// Second regression: once a host-side move-node round-trip fails (e.g. the
// resolved anchor can't be matched in the persisted HTML), the bridge's
// optimistic DOM mutation — reparent AND the absolute-into-flow position
// strip — was not fully undone: the visual-structure-ack failure branch
// restored the prior parent/sibling but left position/left/top stripped,
// leaving the element stuck in a half-reverted, visually broken state. Fixed
// by snapshotting the inline position/left/top/right/bottom values before
// the optimistic strip and restoring them alongside the DOM revert.

it(
  "resolves the reparent target to the hovered pristine flex row, not its outer ancestor",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // #row is a PRISTINE (childless) flex container nested inside <main>,
      // which is itself a valid BRIDGE_CONTAINER_TAGS nesting target — the
      // exact shape that triggered the wrong-ancestor bug (main satisfies
      // the old "is cursor's parent a container" check before #row's own
      // "is cursor a container" check ever ran).
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      main {
        position: absolute; left: 0; top: 0; width: 900px; height: 700px;
      }
      #row {
        position: absolute; left: 250px; top: 100px;
        width: 320px; height: 200px; background: #eef2ff;
        display: flex; flex-direction: column; gap: 8px;
      }
      #dragme {
        position: absolute; left: 40px; top: 40px;
        width: 80px; height: 60px; background: #6366f1;
      }
    </style>
  </head>
  <body>
    <main data-agent-native-node-id="main">
      <div id="row" data-agent-native-node-id="row"></div>
    </main>
    <div id="dragme" data-agent-native-node-id="dragme">Drag me</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      // Select #dragme (center at 80, 70) and drag it into #row's center
      // (410, 200) — the row has no children, so the pointer's hit target
      // IS the row itself, the exact scenario that used to resolve one
      // level too high.
      await page.mouse.click(80, 70);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.mouse.move(80, 70);
      await page.mouse.down();
      await page.mouse.move(90, 80, { steps: 4 });
      await page.mouse.move(410, 200, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const dragged = document.querySelector<HTMLElement>("#dragme")!;
        return {
          draggedParentId: dragged.parentElement?.id,
          position: dragged.style.position,
          positionPriority: dragged.style.getPropertyPriority("position"),
        };
      });

      // Correct target: reparented INTO #row, not as a sibling inside <main>.
      expect(result.draggedParentId).toBe("row");
      // Absolute-into-flow cleanup still applies on the correct target. This
      // fixture supplies position:absolute from an authored stylesheet rather
      // than inline style, so the bridge adds a temporary static override to
      // prevent a one-frame absolute flash before the host's source round-trip.
      expect(result.position).toBe("static");
      expect(result.positionPriority).toBe("important");

      const messages = await readBridgeMessages(page);
      const structureMessage = messages.find(
        (m) => m.type === "visual-structure-change",
      ) as any;
      expect(structureMessage).toBeTruthy();
      expect(structureMessage.dropMode).toBe("flow-insert");
      expect(structureMessage.forceFlowPositionOverride).toBe(true);
      // The anchor must identify #row (via its stable node id), never <main>.
      expect(structureMessage.anchorSourceId).toBe("row");
      expect(structureMessage.anchorSelector).toContain("row");
      expect(structureMessage.anchorSourceId).not.toBe("main");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "rolls back parent, DOM position, and stripped inline styles when the host rejects the move",
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
      #origin {
        position: absolute; left: 0; top: 350px; width: 300px; height: 200px;
      }
      #row {
        position: absolute; left: 250px; top: 100px;
        width: 320px; height: 200px; background: #eef2ff;
        display: flex; flex-direction: column; gap: 8px;
      }
      #sibling {
        width: 60px; height: 40px;
      }
    </style>
  </head>
  <body>
    <div id="origin" data-agent-native-node-id="origin">
      <div id="dragme" style="position:absolute;left:40px;top:40px;width:80px;height:60px;background:#6366f1" data-agent-native-node-id="dragme">Drag me</div>
      <span id="sibling" data-agent-native-node-id="sibling">Anchor</span>
    </div>
    <div id="row" data-agent-native-node-id="row"></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const before = await page.evaluate(() => {
        const dragged = document.querySelector<HTMLElement>("#dragme")!;
        return {
          parentId: dragged.parentElement?.id,
          nextSiblingId: (dragged.nextElementSibling as HTMLElement | null)?.id,
          position: dragged.style.position,
          left: dragged.style.left,
          top: dragged.style.top,
        };
      });
      expect(before.parentId).toBe("origin");
      expect(before.nextSiblingId).toBe("sibling");
      expect(before.position).toBe("absolute");

      // Drag #dragme (center ~80, 420) into the pristine #row (center 410, 200).
      await page.mouse.click(80, 420);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.mouse.move(80, 420);
      await page.mouse.down();
      await page.mouse.move(90, 410, { steps: 4 });
      await page.mouse.move(410, 200, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      // Confirm the optimistic move + strip happened (pre-rollback state).
      const optimistic = await page.evaluate(() => {
        const dragged = document.querySelector<HTMLElement>("#dragme")!;
        return {
          parentId: dragged.parentElement?.id,
          position: dragged.style.position,
        };
      });
      expect(optimistic.parentId).toBe("row");
      expect(optimistic.position).toBe("");

      const messages = await readBridgeMessages(page);
      const structureMessage = messages.find(
        (m) => m.type === "visual-structure-change",
      ) as any;
      expect(structureMessage).toBeTruthy();
      const requestId = structureMessage.requestId as string;
      expect(requestId).toBeTruthy();

      // Simulate the host rejecting the move (e.g. the resolved anchor
      // couldn't be matched against the persisted HTML) — exactly what
      // DesignEditor.tsx's onVisualStructureChange handler does when
      // handleVisualStructureChange returns false.
      await page.evaluate((id: string) => {
        window.postMessage(
          { type: "visual-structure-ack", requestId: id, applied: false },
          "*",
        );
      }, requestId);
      await page.waitForTimeout(30);

      const after = await page.evaluate(() => {
        const dragged = document.querySelector<HTMLElement>("#dragme")!;
        return {
          parentId: dragged.parentElement?.id,
          nextSiblingId: (dragged.nextElementSibling as HTMLElement | null)?.id,
          position: dragged.style.position,
          left: dragged.style.left,
          top: dragged.style.top,
        };
      });

      // Full rollback: original parent, original DOM position (still before
      // #sibling), AND the stripped position/left/top inline styles restored
      // — not left stuck reparented-and-stripped.
      expect(after.parentId).toBe(before.parentId);
      expect(after.nextSiblingId).toBe(before.nextSiblingId);
      expect(after.position).toBe(before.position);
      expect(after.left).toBe(before.left);
      expect(after.top).toBe(before.top);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "applies host-driven runtime layer moves by unique source ids and rolls rejected moves back",
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
      #origin { position: absolute; left: 20px; top: 300px; }
      #anchor { display: flex; flex-direction: column; gap: 8px; }
    </style>
  </head>
  <body>
    <div id="origin">
      <div class="repeated" data-agent-native-node-id="runtime-subject" style="position:absolute;left:40px;top:30px">Subject</div>
      <span id="sibling">Sibling</span>
    </div>
    <section id="anchor" class="repeated" data-agent-native-node-id="runtime-anchor"></section>
  </body>
</html>`);
      await page.locator("#origin .repeated").evaluate((element) => {
        Object.defineProperty(element, "__reactFiber$runtimemovesubject", {
          configurable: true,
          enumerable: true,
          value: {
            _debugStack: {
              stack:
                "Error\n    at ComposerButton (http://127.0.0.1:7331/app/components/ComposerButton.tsx:18:5)",
            },
            return: null,
          },
        });
      });
      await page.locator("#anchor").evaluate((element) => {
        Object.defineProperty(element, "__reactFiber$runtimemoveanchor", {
          configurable: true,
          enumerable: true,
          value: {
            _debugStack: {
              stack:
                "Error\n    at ComposerActions (http://127.0.0.1:7331/app/components/ComposerActions.tsx:31:3)",
            },
            return: null,
          },
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const before = await page.evaluate(() => {
        const subject = document.querySelector<HTMLElement>(
          '[data-agent-native-node-id="runtime-subject"]',
        )!;
        return {
          parentId: subject.parentElement?.id,
          nextSiblingId: subject.nextElementSibling?.id,
          position: subject.style.position,
          left: subject.style.left,
          top: subject.style.top,
        };
      });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "runtime-structure-move",
            subjectSelector: ".repeated",
            subjectSourceId: "runtime-subject",
            anchorSelector: ".repeated",
            anchorSourceId: "runtime-anchor",
            placement: "inside",
          },
          "*",
        );
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) => message.type === "visual-structure-change",
        ),
      );

      const optimistic = await page.evaluate(() => {
        const subject = document.querySelector<HTMLElement>(
          '[data-agent-native-node-id="runtime-subject"]',
        )!;
        return {
          parentId: subject.parentElement?.id,
          position: subject.style.position,
        };
      });
      expect(optimistic).toEqual({ parentId: "anchor", position: "" });

      const messages = await readBridgeMessages(page);
      const structureMessage = messages.find(
        (message) => message.type === "visual-structure-change",
      ) as any;
      expect(structureMessage).toMatchObject({
        sourceId: "runtime-subject",
        anchorSourceId: "runtime-anchor",
        placement: "inside",
        dropMode: "flow-insert",
        payload: {
          provenance: {
            sourceFile: "app/components/ComposerButton.tsx",
            line: 18,
            column: 5,
            component: "ComposerButton",
          },
        },
        anchorPayload: {
          provenance: {
            sourceFile: "app/components/ComposerActions.tsx",
            line: 31,
            column: 3,
            component: "ComposerActions",
          },
        },
      });

      await page.evaluate((requestId: string) => {
        window.postMessage(
          {
            type: "visual-structure-ack",
            requestId,
            applied: false,
          },
          "*",
        );
      }, structureMessage.requestId);
      await page.waitForTimeout(30);

      const after = await page.evaluate(() => {
        const subject = document.querySelector<HTMLElement>(
          '[data-agent-native-node-id="runtime-subject"]',
        )!;
        return {
          parentId: subject.parentElement?.id,
          nextSiblingId: subject.nextElementSibling?.id,
          position: subject.style.position,
          left: subject.style.left,
          top: subject.style.top,
        };
      });
      expect(after).toEqual(before);

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "runtime-structure-move",
            subjectSelector: ".repeated",
            anchorSelector: ".repeated",
            placement: "inside",
          },
          "*",
        );
      });
      await page.waitForTimeout(30);
      expect(
        (await readBridgeMessages(page)).filter(
          (message) => message.type === "visual-structure-change",
        ),
      ).toHaveLength(1);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Template-clone ANCHOR resolution (drop INTO a clones-only container) ───
//
// Companion to the "template-clone reorder rejection" fix above, which only
// gated the DRAGGED element (isTemplateCloneElement(gestureEl)). That left a
// gap: a drag ORIGINATING elsewhere that lands on a container whose ONLY
// children are Alpine x-for clones (e.g. a filter card with three rendered
// "All/Active/Done" tab clones and no static siblings) could still resolve
// its ANCHOR to one of those clones — a clone has no counterpart in the
// static source HTML, so the resulting moveNode always fails on the host
// (layerMoveFailed toast) even though the drop gesture itself targeted a
// perfectly valid container. Fixed by filtering clones out of every anchor
// candidate list (draggableElementChildren) and adding an explicit
// isTemplateCloneElement check at every remaining "use the raw hit element
// as anchor" site, falling back to the nearest non-clone sibling, else the
// container itself with "inside" placement.

it(
  "editor chrome bridge resolves a drop into a container whose ONLY children are x-for clones to a container-inside anchor, never a clone",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // #filterCard's only children are the <template x-for> marker plus its
      // three rendered clone instances — exactly the Daylist "All/Active/
      // Done" filter card shape. #dragme is a separate, real, source-backed
      // element being dragged INTO the card.
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #filterCard { position: absolute; left: 260px; top: 40px; width: 240px; height: 120px; display: flex; flex-direction: column; gap: 4px; background: #fafafa; border: 1px solid #ddd; padding: 8px; box-sizing: border-box; }
      .tab { display: flex; align-items: center; padding: 8px; background: #eee; height: 28px; box-sizing: border-box; }
      #dragme { position: absolute; left: 40px; top: 40px; width: 80px; height: 40px; background: #6366f1; color: white; }
    </style>
  </head>
  <body>
    <div id="filterCard" data-agent-native-node-id="filterCard">
      <template x-for="f in filters"></template>
      <div class="tab">All</div>
      <div class="tab">Active</div>
      <div class="tab">Done</div>
    </div>
    <div id="dragme" data-agent-native-node-id="dragme">Drag me</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const dragBox = (await page.locator("#dragme").boundingBox())!;
      const cardBox = (await page.locator("#filterCard").boundingBox())!;
      const startX = dragBox.x + dragBox.width / 2;
      const startY = dragBox.y + dragBox.height / 2;
      // Aim at the middle clone ("Active") so the raw hit-test element is
      // itself a template clone, not the container's padding/background.
      const targetX = cardBox.x + cardBox.width / 2;
      const targetY = cardBox.y + cardBox.height / 2;

      await page.mouse.click(startX, startY);
      await page.waitForTimeout(60);
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 5, startY - 5, { steps: 3 });
      await page.mouse.move(targetX, targetY, { steps: 10 });
      await page.waitForTimeout(80);

      // The insertion guide must be showing a real anchor (not hidden as a
      // rejected/no-target drag) while hovering directly over a clone.
      const guideVisible = await page.evaluate(() => {
        const guide = document.querySelector<HTMLElement>(
          "[data-agent-native-insertion-guide]",
        );
        return guide
          ? window.getComputedStyle(guide).display === "block"
          : false;
      });
      expect(guideVisible).toBe(true);

      await page.mouse.up();
      await page.waitForTimeout(80);

      // Drop must succeed (no rejection cursor/badge — this is a valid
      // container-drop, not the reject-the-dragged-clone case above).
      const messages = await readBridgeMessages(page);
      const structureMessage = messages.find(
        (m) => m.type === "visual-structure-change",
      ) as
        | {
            anchorSelector?: string;
            anchorSourceId?: string;
            placement?: string;
          }
        | undefined;
      expect(structureMessage).toBeTruthy();

      // The anchor must resolve to the container itself (filterCard) — never
      // to any of the clone <div class="tab"> instances, which carry no
      // data-agent-native-node-id/selector of their own that could survive
      // in source HTML.
      expect(structureMessage!.anchorSourceId).toBe("filterCard");
      expect(structureMessage!.placement).toBe("inside");

      // The live DOM actually reflects the optimistic move: #dragme landed
      // inside #filterCard (after the rendered clones, which is correct —
      // in source HTML the clones don't exist, so "after the clones" IS
      // "inside the container").
      const domResult = await page.evaluate(() => {
        const card = document.getElementById("filterCard")!;
        const dragged = document.getElementById("dragme")!;
        return { insideCard: card.contains(dragged) };
      });
      expect(domResult.insideCard).toBe(true);

      // Never mints a pending id on any clone.
      const cloneHasPendingId = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".tab")).some((el) =>
          el.hasAttribute("data-an-pending-node-id"),
        ),
      );
      expect(cloneHasPendingId).toBe(false);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge prefers the nearest NON-clone static sibling as anchor when a container mixes clone and static children",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // #list mixes two x-for clones with one real, static, source-backed
      // sibling (#staticItem). Dropping near a clone must resolve the
      // anchor to #staticItem, never to either clone.
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #list { position: absolute; left: 260px; top: 40px; width: 240px; display: flex; flex-direction: column; gap: 4px; background: #fafafa; border: 1px solid #ddd; padding: 8px; box-sizing: border-box; }
      .row { display: flex; align-items: center; padding: 8px; background: #eee; height: 28px; box-sizing: border-box; }
      #dragme { position: absolute; left: 40px; top: 40px; width: 80px; height: 40px; background: #6366f1; color: white; }
    </style>
  </head>
  <body>
    <div id="list" data-agent-native-node-id="list">
      <template x-for="r in rows"></template>
      <div class="row">Clone One</div>
      <div class="row">Clone Two</div>
      <div class="row" id="staticItem" data-agent-native-node-id="staticItem">Static</div>
    </div>
    <div id="dragme" data-agent-native-node-id="dragme">Drag me</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const dragBox = (await page.locator("#dragme").boundingBox())!;
      // Target the FIRST clone row directly — the raw hit-test element is a
      // clone, so the anchor resolution must fall through to the nearest
      // non-clone sibling (#staticItem), not use the clone itself.
      const cloneRowBox = (await page
        .locator("#list .row")
        .first()
        .boundingBox())!;
      const startX = dragBox.x + dragBox.width / 2;
      const startY = dragBox.y + dragBox.height / 2;
      const targetX = cloneRowBox.x + cloneRowBox.width / 2;
      const targetY = cloneRowBox.y + cloneRowBox.height / 2;

      await page.mouse.click(startX, startY);
      await page.waitForTimeout(60);
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 5, startY - 5, { steps: 3 });
      await page.mouse.move(targetX, targetY, { steps: 10 });
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.waitForTimeout(80);

      const messages = await readBridgeMessages(page);
      const structureMessage = messages.find(
        (m) => m.type === "visual-structure-change",
      ) as { anchorSourceId?: string; placement?: string } | undefined;
      expect(structureMessage).toBeTruthy();
      expect(structureMessage!.anchorSourceId).toBe("staticItem");
      expect(["before", "after"]).toContain(structureMessage!.placement);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "hit-test bridge resolves a hover over a container whose ONLY children are x-for clones to a container-inside anchor, never a clone",
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
      #filterCard { display: flex; flex-direction: column; gap: 4px; padding: 8px; width: 240px; box-sizing: border-box; }
      .tab { display: flex; align-items: center; padding: 8px; height: 28px; box-sizing: border-box; }
    </style>
  </head>
  <body>
    <div id="filterCard" data-agent-native-node-id="filterCard">
      <template x-for="f in filters"></template>
      <div class="tab">All</div>
      <div class="tab">Active</div>
      <div class="tab">Done</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedHitTestBridgeScript() });

      const cardBox = (await page.locator("#filterCard").boundingBox())!;
      // Hit-test directly over the middle clone ("Active").
      const x = cardBox.x + cardBox.width / 2;
      const y = cardBox.y + cardBox.height / 2;

      const reply = (await page.evaluate(
        ({ x, y }) =>
          new Promise((resolve) => {
            const onMsg = (e: MessageEvent) => {
              if (e.data?.type === "agent-native:hit-test-result") {
                window.removeEventListener("message", onMsg);
                resolve(e.data);
              }
            };
            window.addEventListener("message", onMsg);
            window.postMessage(
              {
                type: "agent-native:hit-test",
                correlationId: "c1",
                x,
                y,
                preview: false,
              },
              "*",
            );
          }),
        { x, y },
      )) as {
        anchorNodeId: string;
        pendingNodeId?: string;
        placement: string;
      };

      // Anchor resolves to the container itself, never a clone.
      expect(reply.anchorNodeId).toBe("filterCard");
      expect(reply.placement).toBe("inside");
      expect(reply.pendingNodeId).toBeUndefined();

      const cloneHasPendingId = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".tab")).some((el) =>
          el.hasAttribute("data-an-pending-node-id"),
        ),
      );
      expect(cloneHasPendingId).toBe(false);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "hit-test bridge recognizes a plain absolute frame as a container",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="frame" data-agent-native-node-id="frame" data-an-primitive="frame" style="position:absolute;left:300px;top:180px;width:220px;height:160px"></div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedHitTestBridgeScript() });

      const reply = (await page.evaluate(
        () =>
          new Promise((resolve) => {
            const onMessage = (event: MessageEvent) => {
              if (event.data?.type !== "agent-native:hit-test-result") return;
              window.removeEventListener("message", onMessage);
              resolve(event.data);
            };
            window.addEventListener("message", onMessage);
            window.postMessage(
              {
                type: "agent-native:hit-test",
                correlationId: "frame-container",
                x: 410,
                y: 260,
                preview: false,
              },
              "*",
            );
          }),
      )) as {
        anchorNodeId: string;
        placement: string;
        dropMode: string;
      };

      expect(reply.anchorNodeId).toBe("frame");
      expect(reply.placement).toBe("inside");
      expect(reply.dropMode).toBe("absolute-container");
    } finally {
      await browser.close();
    }
  },
);

it(
  "hit-test bridge prefers the nearest NON-clone static sibling as anchor when a container mixes clone and static children",
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
      #list { display: flex; flex-direction: column; gap: 4px; padding: 8px; width: 240px; box-sizing: border-box; }
      .row { display: flex; align-items: center; padding: 8px; height: 28px; box-sizing: border-box; }
    </style>
  </head>
  <body>
    <div id="list" data-agent-native-node-id="list">
      <template x-for="r in rows"></template>
      <div class="row">Clone One</div>
      <div class="row">Clone Two</div>
      <div class="row" data-agent-native-node-id="staticItem">Static</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedHitTestBridgeScript() });

      const cloneRowBox = (await page
        .locator("#list .row")
        .first()
        .boundingBox())!;
      const x = cloneRowBox.x + cloneRowBox.width / 2;
      const y = cloneRowBox.y + cloneRowBox.height / 2;

      const reply = (await page.evaluate(
        ({ x, y }) =>
          new Promise((resolve) => {
            const onMsg = (e: MessageEvent) => {
              if (e.data?.type === "agent-native:hit-test-result") {
                window.removeEventListener("message", onMsg);
                resolve(e.data);
              }
            };
            window.addEventListener("message", onMsg);
            window.postMessage(
              {
                type: "agent-native:hit-test",
                correlationId: "c1",
                x,
                y,
                preview: false,
              },
              "*",
            );
          }),
        { x, y },
      )) as { anchorNodeId: string; placement: string };

      expect(reply.anchorNodeId).toBe("staticItem");
      expect(["before", "after"]).toContain(reply.placement);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Hover-info postMessage de-duplication (perf) ────────────────────────────
//
it(
  "editor chrome bridge flow-inserts grid children and CSS grid tracks reflow when the parent resizes",
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
<html><head><style>
  html, body { margin: 0; width: 100%; height: 100%; }
  #grid { position:absolute; left:100px; top:80px; width:400px; display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:repeat(2,80px);
    column-gap:20px; row-gap:16px; padding:12px; }
  .cell { background:#a5b4fc; }
</style></head><body>
  <div id="grid" data-agent-native-node-id="grid">
    <div class="cell" id="cellA" data-agent-native-node-id="a">A</div>
    <div class="cell" id="cellB" data-agent-native-node-id="b">B</div>
    <div class="cell" id="cellC" data-agent-native-node-id="c">C</div>
    <div class="cell" id="cellD" data-agent-native-node-id="d">D</div>
  </div>
</body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const widthsBefore = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("#grid > .cell")).map(
          (element) => element.getBoundingClientRect().width,
        ),
      );
      await page.evaluate(() => {
        document.querySelector<HTMLElement>("#grid")!.style.width = "600px";
      });
      const widthsAfter = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("#grid > .cell")).map(
          (element) => element.getBoundingClientRect().width,
        ),
      );
      expect(widthsAfter[0]).toBeGreaterThan(widthsBefore[0]);
      expect(widthsAfter[0]).toBeCloseTo(widthsAfter[1], 5);

      // Move D into the first-row column gap. The bridge must use a flow
      // insertion slot, then native CSS Grid performs the child reflow.
      await page.mouse.click(570, 236);
      await page.mouse.move(570, 236);
      await page.mouse.down();
      await page.mouse.move(562, 228, { steps: 2 });
      await page.mouse.move(400, 120, { steps: 6 });
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.waitForTimeout(50);

      const order = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("#grid > .cell")).map(
          (element) => element.id,
        ),
      );
      expect(order).not.toEqual(["cellA", "cellB", "cellC", "cellD"]);
      const structureMessages = (await readBridgeMessages(page)).filter(
        (message) => message.type === "visual-structure-change",
      ) as Array<{ dropMode?: string }>;
      expect(structureMessages[structureMessages.length - 1]?.dropMode).toBe(
        "flow-insert",
      );
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// The shield's pointermove handler used to call getLightElementInfo (two
// getComputedStyle reads) and post a fresh "element-hover" message on EVERY
// raw pointermove tick, even when the hit-tested element hadn't changed since
// the previous tick — dozens to hundreds of wasted calls for a pointer that
// simply rests inside one element for a second or two. Fixed by gating the
// info-compute + post on hoveredEl actually changing since the last post.

it(
  "editor chrome bridge posts element-hover only when the hovered element actually changes, not on every raw pointermove",
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
      #box { position: absolute; left: 100px; top: 100px; width: 200px; height: 150px; background: #6366f1; }
    </style>
  </head>
  <body>
    <div id="box" data-agent-native-node-id="box"></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      // Several raw pointermove ticks that all stay inside #box — simulates
      // a slow, jittery real-mouse hover over one unchanged element.
      await page.mouse.move(150, 150);
      await page.mouse.move(152, 151);
      await page.mouse.move(154, 153);
      await page.mouse.move(151, 155);
      await page.mouse.move(153, 152);
      await page.waitForTimeout(50);

      const hoverMessages = (await readBridgeMessages(page)).filter(
        (m) => m.type === "element-hover",
      );
      expect(hoverMessages.length).toBe(1);

      // Moving onto <body> background (a genuinely different hoveredEl —
      // there's no "off the iframe" in this single-document harness) posts
      // one more; moving back onto #box posts one more again. Three distinct
      // hoveredEl values across the whole gesture, three posts total — never
      // one post per raw pointermove tick (5 ticks landed on #box above, 1
      // message; if the old unthrottled behavior were still in place this
      // would be 5 + 1 + 1 = 7, not 3).
      await page.mouse.move(500, 500);
      await page.waitForTimeout(30);
      await page.mouse.move(150, 150);
      await page.mouse.move(152, 151);
      await page.waitForTimeout(30);

      const hoverMessagesAfter = (await readBridgeMessages(page)).filter(
        (m) => m.type === "element-hover",
      );
      expect(hoverMessagesAfter.length).toBe(3);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge re-posts element-hover for the SAME element after a real pointerleave off the shield (regression: gate must re-arm on pointer-leaves-iframe, not just on hovering a different element)",
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
      #box { position: absolute; left: 100px; top: 100px; width: 200px; height: 150px; background: #6366f1; }
    </style>
  </head>
  <body>
    <div id="box" data-agent-native-node-id="box"></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      // 1) Hover the box — one "element-hover" post.
      await page.mouse.move(150, 150);
      await page.waitForTimeout(30);
      const afterHover = (await readBridgeMessages(page)).filter(
        (m) => m.type === "element-hover",
      );
      expect(afterHover.length).toBe(1);

      // 2) The cursor leaves the iframe content entirely (to a host panel,
      // or outside the browser window) without landing on any other
      // in-document element first. There's no "off the iframe" to move the
      // mouse to in this single-document harness, so — exactly like the
      // live repro — dispatch a real `pointerleave` on the shield element
      // directly. This must post "element-hover: null" AND re-arm the gate.
      await page.evaluate(() => {
        const shield = document.querySelector(
          '[data-agent-native-edit-overlay="shield"]',
        );
        shield?.dispatchEvent(
          new PointerEvent("pointerleave", {
            bubbles: false,
            cancelable: true,
            clientX: 150,
            clientY: 150,
          }),
        );
      });
      await page.waitForTimeout(30);
      const afterLeave = (await readBridgeMessages(page)).filter(
        (m) => m.type === "element-hover",
      );
      expect(afterLeave.length).toBe(2);
      expect(afterLeave[1].payload).toBeNull();

      // 3) The pointer comes back to the SAME element (#box). Before the
      // fix, lastHoverInfoPostedEl still held #box from step 1, so this
      // pointermove's `hoveredEl !== lastHoverInfoPostedEl` gate check was
      // false and the bridge silently skipped posting — the host's hover
      // highlight stayed stuck at "nothing" forever, since only a hover onto
      // a genuinely different element would ever unstick it.
      await page.mouse.move(152, 151);
      await page.waitForTimeout(30);
      const afterReturn = (await readBridgeMessages(page)).filter(
        (m) => m.type === "element-hover",
      );
      expect(afterReturn.length).toBe(3);
      expect(afterReturn[2].payload).not.toBeNull();
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Cross-screen-drag "move" phase rAF coalescing (perf) ────────────────────
//
// postCrossScreenDrag("move", ...) used to post once per raw mousemove tick
// during a free-position drag — a getBoundingClientRect plus a structured-
// clone postMessage on every event, unthrottled, for the whole gesture. A
// synchronous burst of raw events within one frame (a fast mouse/trackpad, or
// a script driving many DOM mousemove dispatches back to back) must now
// collapse to a single postMessage per animation frame, carrying the LATEST
// position — not the first tick's stale one — and no coalesced tick may ever
// fire after the gesture's own "cancel"/"end" phase already posted.

it(
  "editor chrome bridge coalesces cross-screen-drag move-phase posts to one per frame, with the latest position",
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
      #target { position: absolute; left: 100px; top: 100px; width: 120px; height: 80px; background: #6366f1; }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target"></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      // Capture the iframe-to-host calls synchronously. Listening for the
      // same-window `message` event introduces a second, unrelated scheduler:
      // postMessage delivery is a queued task and is not guaranteed to run
      // before the next animation frame (especially under loaded CI). This
      // test is about how often the bridge CALLS postMessage per frame.
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.postMessage = ((message: unknown) => {
          (window as any).__bridgeMessages.push(message);
        }) as typeof window.postMessage;
      });

      await page.mouse.click(160, 140);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await page.mouse.move(160, 140);
      await page.mouse.down();
      // Cross the drag threshold with a real move first. The shield arms the
      // gesture from a "pointerdown" listener (shieldOverlay.addEventListener
      // ("pointerdown", beginPotentialShieldDrag, ...)), so dragEventNames(e)
      // resolves to {move:"pointermove", up:"pointerup"} for the whole
      // gesture — the burst below must dispatch that same event type, not
      // "mousemove"/"mouseup", or the document-level listener never sees it.
      await page.mouse.move(170, 150);

      const moveMessageCount = await page.evaluate(async () => {
        // Synchronous burst: 20 raw pointermove events with the position
        // advancing between each, none of which yield to a frame in between —
        // exactly what a fast mouse/trackpad's event queue looks like within
        // one frame budget.
        for (let i = 0; i < 20; i++) {
          document.dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              cancelable: true,
              clientX: 170 + i,
              clientY: 150 + i,
            }),
          );
        }
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const messages = (window as any).__bridgeMessages as Array<
          Record<string, unknown>
        >;
        return messages.filter(
          (m) =>
            m.type === "agent-native:cross-screen-drag" && m.phase === "move",
        ).length;
      });
      // 20 raw events synchronously dispatched within one frame → coalesced
      // to exactly one "move" post, not 20.
      expect(moveMessageCount).toBe(1);

      const lastMoveMessage = await page.evaluate(() => {
        const messages = (window as any).__bridgeMessages as Array<
          Record<string, unknown>
        >;
        const moves = messages.filter(
          (m) =>
            m.type === "agent-native:cross-screen-drag" && m.phase === "move",
        );
        return moves[moves.length - 1] as { iframeX: number; iframeY: number };
      });
      // Carries the LAST dispatched position (170+19, 150+19), not the first.
      expect(lastMoveMessage.iframeX).toBe(189);
      expect(lastMoveMessage.iframeY).toBe(169);

      // Schedule one more tick, then release in the SAME synchronous task
      // (both dispatched in-page, back to back, with no `await` between them
      // so no animation frame can possibly run in between) — cleanupMoveDrag
      // must cancel the still-pending tick so no stale "move" can post after
      // "end". Using page.mouse.up() here instead would reintroduce exactly
      // the real-IPC-timing race this synchronous dispatch avoids.
      await page.evaluate(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            clientX: 400,
            clientY: 400,
          }),
        );
        document.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            cancelable: true,
            clientX: 400,
            clientY: 400,
          }),
        );
      });
      await new Promise((r) => setTimeout(r, 60));

      const postReleaseCounts = await page.evaluate(() => {
        const messages = (window as any).__bridgeMessages as Array<
          Record<string, unknown>
        >;
        const crossScreen = messages.filter(
          (m) => m.type === "agent-native:cross-screen-drag",
        );
        return {
          move: crossScreen.filter((m) => m.phase === "move").length,
          end: crossScreen.filter((m) => m.phase === "end").length,
          lastPhase: crossScreen[crossScreen.length - 1]?.phase,
        };
      });
      // Still exactly one "move" (the pending tick from right before mouseup
      // was cancelled, never posted after release).
      expect(postReleaseCounts.move).toBe(1);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Selection overlay tracks CSS transitions/animations ─────────────────────
//
// ResizeObserver (the existing overlay-sync mechanism) only fires on
// border-box SIZE changes, so a purely transform-driven transition/animation
// on the selected element — extremely common for hover/toggle states in
// generated prototypes — never triggered a re-sync. The one-shot
// MutationObserver callback that fires when the triggering class/style
// changes reads the element's rect at essentially the START of the
// transition, so the overlay used to freeze there for the whole transition
// duration instead of following the element to its final position.

it(
  "editor chrome bridge keeps the selection overlay tracking an element through a transform transition, not just its start/end rect",
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
      #target {
        position: absolute; left: 40px; top: 40px; width: 100px; height: 60px;
        background: #6366f1;
        transition: transform 400ms linear;
      }
      #target.moved { transform: translateX(300px); }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target"></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(90, 70);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      // Start the transition, then sample the overlay vs. the element's live
      // rect partway through — both read in the SAME evaluate call so the
      // comparison isn't skewed by round-trip timing.
      await page.evaluate(() => {
        document.getElementById("target")!.classList.add("moved");
      });
      await page.waitForTimeout(200); // ~midpoint of the 400ms transition

      const midTransition = await page.evaluate(() => {
        const target = document.getElementById("target")!;
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        )!;
        return {
          targetLeft: target.getBoundingClientRect().left,
          overlayLeft: overlay.getBoundingClientRect().left,
        };
      });
      // Element should be roughly mid-flight (well past its start position,
      // not yet at its end position) — sanity-checks the transition is
      // actually running under this browser/headless timing before we
      // assert anything about overlay tracking.
      expect(midTransition.targetLeft).toBeGreaterThan(60);
      expect(midTransition.targetLeft).toBeLessThan(320);
      // The overlay must be within a small tolerance of the element's
      // CURRENT (mid-transition) position — not still sitting at the
      // pre-transition rect (left≈40, which the old frozen-overlay bug would
      // show here) and not already jumped to the final rect (left≈340).
      expect(
        Math.abs(midTransition.overlayLeft - midTransition.targetLeft),
      ).toBeLessThan(20);

      await page.waitForTimeout(300); // settle past transitionend
      const settled = await page.evaluate(() => {
        const target = document.getElementById("target")!;
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        )!;
        return {
          targetLeft: target.getBoundingClientRect().left,
          overlayLeft: overlay.getBoundingClientRect().left,
        };
      });
      expect(Math.abs(settled.overlayLeft - settled.targetLeft)).toBeLessThan(
        2,
      );
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── shouldForwardDesignHotkey primary-modifier whitelist audit ──────────────
//
// Data-driven ground truth: every one of these chords has a real handler in
// useDesignHotkeys.ts (see that file's handleDesignHotkey for the exact
// binding cited in each row's comment). If shouldForwardDesignHotkey doesn't
// forward the chord while focus is inside the design iframe, the shortcut is
// silently dead for canvas users (Cmd+U underline was exactly this bug).
// Keeping this list in one place means future drift between the two files
// fails loudly here instead of waiting for the next live-QA pass.
const PRIMARY_HOTKEY_FORWARDING_CASES: Array<{
  name: string;
  key: string;
  shift?: boolean;
  alt?: boolean;
  ctrlOnly?: boolean;
}> = [
  { name: "Cmd/Ctrl+Z undo", key: "z" },
  { name: "Cmd/Ctrl+Shift+Z redo", key: "z", shift: true },
  { name: "Cmd/Ctrl+Y redo", key: "y" },
  { name: "Cmd/Ctrl+F find", key: "f" },
  { name: "Cmd/Ctrl+A select all", key: "a" },
  { name: "Cmd/Ctrl+X cut", key: "x" },
  { name: "Cmd/Ctrl+Shift+X strikethrough", key: "x", shift: true },
  { name: "Cmd/Ctrl+U underline", key: "u" },
  { name: "Cmd/Ctrl+C copy", key: "c" },
  // NOTE: bare Cmd/Ctrl+V (plain paste) is deliberately excluded here. It's
  // the one chord shouldForwardDesignHotkey defers instead of forwarding
  // immediately (see plainPasteHotkey in editor-chrome.bridge.ts): the
  // keydown handler leaves the browser's native paste alone and schedules a
  // design-hotkey post on a 0ms timer, but the document-level "paste"
  // listener unconditionally cancels that timer the instant a real paste
  // DOMEvent arrives (Figma-clipboard-flavored or not) so paste is never
  // double-handled. Chromium's synthetic CDP keyboard input dispatches that
  // real paste event even against a non-editable, unfocused document body,
  // so this chord can't be exercised as a simple "did a design-hotkey
  // message arrive" assertion the way every other chord here can. The
  // Cmd+Alt+V / Cmd+Shift+V variants below aren't `plainPasteHotkey` (that
  // flag requires !altKey && !shiftKey) and forward immediately and
  // synchronously like every other chord, so they cover the same "v" array
  // entry without the paste-event race.
  { name: "Cmd/Ctrl+Alt+V paste properties", key: "v", alt: true },
  { name: "Cmd/Ctrl+Shift+V paste over", key: "v", shift: true },
  { name: "Cmd/Ctrl+D duplicate", key: "d" },
  { name: "Cmd/Ctrl+R rename", key: "r" },
  { name: "Cmd/Ctrl+Shift+R paste to replace", key: "r", shift: true },
  { name: "Cmd/Ctrl+Shift+H toggle hidden", key: "h", shift: true },
  { name: "Cmd/Ctrl+Shift+L toggle locked", key: "l", shift: true },
  { name: "Cmd/Ctrl+G group", key: "g" },
  // BUG-UNGROUP-HOTKEY: Shift+Cmd+G ungroups (see useDesignHotkeys.ts's Cmd+G
  // family) — was dead because handleDesignHotkey itself swallowed it, not
  // because the bridge failed to forward it (this row pins that the bridge
  // side was never the problem: "g" is already unconditionally in the
  // primary-modifier whitelist above, regardless of shiftKey).
  { name: "Cmd/Ctrl+Shift+G ungroup", key: "g", shift: true },
  { name: "Cmd/Ctrl+Alt+G frame selection", key: "g", alt: true },
  { name: "Cmd/Ctrl+= zoom in", key: "=" },
  { name: "Cmd/Ctrl+- zoom out", key: "-" },
  { name: "Cmd/Ctrl+0 zoom reset", key: "0" },
  { name: "Cmd/Ctrl+Alt+K create component", key: "k", alt: true },
  { name: "Cmd/Ctrl+Alt+B detach instance", key: "b", alt: true },
  { name: "Cmd/Ctrl+] bring forward", key: "]" },
  { name: "Cmd/Ctrl+[ send backward", key: "[" },
  { name: "Cmd/Ctrl+\\ toggle UI", key: "\\" },
  { name: "Cmd/Ctrl+Backspace ungroup", key: "Backspace" },
  {
    name: "Ctrl+Alt+H distribute horizontal (literal Control)",
    key: "h",
    alt: true,
    ctrlOnly: true,
  },
  {
    name: "Ctrl+Alt+T tidy up (literal Control)",
    key: "t",
    alt: true,
    ctrlOnly: true,
  },
];

it(
  "editor chrome bridge forwards every host-handled primary-modifier hotkey (data-driven audit against useDesignHotkeys.ts)",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));
      await page.setContent(`<!doctype html><html><body>
        <div id="el" data-agent-native-node-id="el" style="position:absolute;left:40px;top:40px;width:80px;height:60px;background:#6366f1">El</div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.mouse.click(80, 70);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await collectBridgeMessages(page);

      const failures: string[] = [];
      for (const testCase of PRIMARY_HOTKEY_FORWARDING_CASES) {
        await page.evaluate(() => {
          (window as any).__bridgeMessages = [];
        });
        const modifier = testCase.ctrlOnly ? "Control" : "Meta";
        await page.keyboard.down(modifier);
        if (testCase.alt) await page.keyboard.down("Alt");
        if (testCase.shift) await page.keyboard.down("Shift");
        await page.keyboard.press(testCase.key);
        if (testCase.shift) await page.keyboard.up("Shift");
        if (testCase.alt) await page.keyboard.up("Alt");
        await page.keyboard.up(modifier);
        // postMessage always dispatches asynchronously even for same-window
        // self-messages (per spec), and the plain-paste chord additionally
        // defers its post behind a setTimeout(0) (see plainPasteHotkey in
        // editor-chrome.bridge.ts) — 60ms matches this file's other
        // message-polling waits (see the runtime-layer-snapshot test above).
        await page.waitForTimeout(60);
        const messages = await readBridgeMessages(page);
        const forwarded = messages.some(
          (message) => message.type === "design-hotkey",
        );
        if (!forwarded) failures.push(testCase.name);
      }

      expect(failures).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge leaves bare Cmd/Ctrl+T and Cmd/Ctrl+L alone (no host binding without the alt/shift gate)",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));
      await page.setContent(`<!doctype html><html><body>
        <div id="el" data-agent-native-node-id="el" style="position:absolute;left:40px;top:40px;width:80px;height:60px;background:#6366f1">El</div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.mouse.click(80, 70);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await collectBridgeMessages(page);

      // Bare Cmd+T has no host binding — only the literal Ctrl+Alt+T "tidy
      // up" combo does (see useDesignHotkeys.ts). Forwarding bare Cmd+T
      // anyway would preventDefault() the browser's own "new tab" shortcut
      // for nothing every time focus sits inside the design iframe.
      await page.keyboard.down("Meta");
      await page.keyboard.press("t");
      await page.keyboard.up("Meta");
      // Bare Cmd+L has no host binding either — only Cmd+Shift+L (toggle
      // locked) does. Bare Cmd/Ctrl+L is the browser's "focus address bar"
      // shortcut.
      await page.keyboard.down("Meta");
      await page.keyboard.press("l");
      await page.keyboard.up("Meta");
      await page.waitForTimeout(60);

      const messages = await readBridgeMessages(page);
      expect(messages.some((message) => message.type === "design-hotkey")).toBe(
        false,
      );
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── getElementInfo() computed-style payload completeness ───────────────────
//
// The properties panel's decoration toggles and auto-layout Gap field read
// `element.computedStyles.textDecorationLine` / `.gap` / `.rowGap` /
// `.columnGap` directly (see typography-helpers.ts's PERSISTENCE GOTCHA
// comment and layout-properties.tsx's FlexContainerControls). A field the
// bridge never puts in the payload reads as permanently blank/zero in the
// panel no matter what the element's actual style is.
it(
  "editor chrome bridge's element-select payload includes textDecorationLine and rowGap/columnGap alongside gap",
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
      /* Tailwind-style utility class — the ONLY source of the gap, no
         inline style at all, matching the live-QA "gap-3" repro. */
      .gap-3 { gap: 12px; }
      #row {
        position: absolute; left: 20px; top: 20px; width: 300px; height: 80px;
        display: flex;
      }
      /* Asymmetric row/column gap so rowGap and columnGap are provably
         distinct fields, not just aliases of the shorthand. */
      #split {
        position: absolute; left: 20px; top: 120px; width: 300px; height: 80px;
        display: flex; flex-wrap: wrap; row-gap: 6px; column-gap: 18px;
      }
      #underlined {
        position: absolute; left: 20px; top: 220px; width: 200px; height: 30px;
        text-decoration: underline;
      }
    </style>
  </head>
  <body>
    <div id="row" class="gap-3" data-agent-native-node-id="row"></div>
    <div id="split" data-agent-native-node-id="split"></div>
    <div id="underlined" data-agent-native-node-id="underlined">Hi</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      // Class-driven gap container (Tailwind-style `gap-3` utility class,
      // no inline style at all) — the live-QA "shows 0" repro case. Wait for
      // the actual "element-select" message rather than the overlay's
      // display style: postMessage always dispatches asynchronously (even
      // same-window self-messages), so racing straight from the overlay's
      // (synchronously-set) display style to reading __bridgeMessages can
      // read the array before the message has actually arrived.
      await page.mouse.click(170, 60);
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) => message.type === "element-select",
        ),
      );
      const rowMessages = await readBridgeMessages(page);
      const rowSelect = rowMessages.find(
        (message) => message.type === "element-select",
      ) as
        | { payload?: { computedStyles?: Record<string, string> } }
        | undefined;
      expect(rowSelect?.payload?.computedStyles?.gap).toBe("12px");
      expect(rowSelect?.payload?.computedStyles?.rowGap).toBe("12px");
      expect(rowSelect?.payload?.computedStyles?.columnGap).toBe("12px");

      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
      });
      await page.mouse.click(170, 160);
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) => message.type === "element-select",
        ),
      );
      const splitMessages = await readBridgeMessages(page);
      const splitSelect = splitMessages.find(
        (message) => message.type === "element-select",
      ) as
        | { payload?: { computedStyles?: Record<string, string> } }
        | undefined;
      expect(splitSelect?.payload?.computedStyles?.rowGap).toBe("6px");
      expect(splitSelect?.payload?.computedStyles?.columnGap).toBe("18px");

      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
      });
      await page.mouse.click(60, 235);
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) => message.type === "element-select",
        ),
      );
      const underlinedMessages = await readBridgeMessages(page);
      const underlinedSelect = underlinedMessages.find(
        (message) => message.type === "element-select",
      ) as
        | { payload?: { computedStyles?: Record<string, string> } }
        | undefined;
      expect(
        underlinedSelect?.payload?.computedStyles?.textDecorationLine,
      ).toBe("underline");

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

// ── Layers-panel-driven selection must post the same rich payload ──────────
//
// The host tells the iframe which element is selected via a "select-element"
// postMessage (this is how Layers-panel clicks, not just canvas pointer
// clicks, drive selection). Before this fix, that handler only repositioned
// the selection overlay and never called postElementSelect(), so the
// properties panel kept whatever payload (or lack of one) it already had —
// live-QA symptom: canvas-click selection showed Fill correctly, the same
// element selected via the Layers panel showed an empty Fill section.
it(
  "editor chrome bridge posts the full element-select payload when the host drives selection via select-element (Layers panel parity with pointer selection)",
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
      #target {
        position: absolute; left: 40px; top: 40px; width: 120px; height: 60px;
        background: linear-gradient(90deg, red 0%, green 50%, blue 100%);
      }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target"></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      // Host-driven selection — exactly what DesignCanvas.tsx sends when the
      // Layers panel (or replayIframeEditorState) selects a node by selector,
      // with no prior pointer interaction inside the iframe at all.
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: "#target",
            selectorCandidates: ["#target"],
          },
          "*",
        );
      });
      // Wait for the actual "element-select" message (postMessage always
      // dispatches asynchronously, even for same-window self-messages) —
      // racing straight from the overlay's synchronously-set display style
      // would read __bridgeMessages before the message has actually arrived.
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) => message.type === "element-select",
        ),
      );

      const messages = await readBridgeMessages(page);
      const select = messages.find(
        (message) => message.type === "element-select",
      ) as
        | {
            payload?: {
              computedStyles?: Record<string, string>;
              selector?: string;
            };
          }
        | undefined;
      expect(select).toBeTruthy();
      expect(select?.payload?.selector).toBe(
        '[data-agent-native-node-id="target"]',
      );
      // The full payload — not the empty-computedStyles light descriptor —
      // must be what's posted, with the gradient's backgroundImage intact
      // (all 3 stops, not truncated/parsed down to fewer). Computed style
      // normalizes named colors to rgb()/rgba(), so assert on stop COUNT
      // (one "%" per authored stop) rather than the literal color names.
      const backgroundImage = select?.payload?.computedStyles?.backgroundImage;
      expect(backgroundImage).toBeTruthy();
      expect(backgroundImage).toContain("gradient");
      expect((backgroundImage ?? "").match(/%/g)?.length).toBe(3);

      // Re-sending the identical select-element (the ~1-2s poll-tick replay)
      // must NOT re-post — this is the guard that keeps the fix from
      // becoming a message-spam loop.
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
      });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: "#target",
            selectorCandidates: ["#target"],
          },
          "*",
        );
      });
      await page.waitForTimeout(60);
      const replayMessages = await readBridgeMessages(page);
      expect(
        replayMessages.some((message) => message.type === "element-select"),
      ).toBe(false);

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge posts an ordered selectable layer stack for contextmenu points",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 500 },
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div data-agent-native-node-id="stage" data-agent-native-layer-name="Stage frame" style="position:relative;width:400px;height:350px">
          <div data-agent-native-node-id="back" data-agent-native-layer-name="Back sibling" style="position:absolute;left:40px;top:40px;width:260px;height:250px;background:#acf">Back</div>
          <div data-agent-native-node-id="parent" data-agent-native-layer-name="Nested parent" style="position:absolute;z-index:1;left:80px;top:80px;width:200px;height:200px;background:#afa">
            <div data-agent-native-node-id="child" data-agent-native-layer-name="Nested child" style="position:absolute;left:20px;top:20px;width:140px;height:140px;background:#ffa">Child</div>
          </div>
          <div data-agent-native-node-id="front" data-agent-native-layer-name="Front sibling" style="position:absolute;z-index:2;left:120px;top:120px;width:110px;height:110px;background:#faa">Front</div>
          <div data-agent-native-node-id="hidden" data-agent-native-layer-name="Hidden cover" data-agent-native-hidden="true" style="position:absolute;z-index:3;left:130px;top:130px;width:90px;height:90px">Hidden</div>
          <div data-agent-native-node-id="locked" data-agent-native-layer-name="Locked cover" data-agent-native-locked="true" style="position:absolute;z-index:4;left:140px;top:140px;width:70px;height:70px">Locked</div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      await page.evaluate(() => {
        const shield = document.querySelector(
          '[data-agent-native-edit-overlay="shield"]',
        );
        shield?.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: 165,
            clientY: 165,
          }),
        );
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) => message.type === "element-contextmenu",
        ),
      );
      const messages = await readBridgeMessages(page);
      expect(
        messages.some((message) => message.type === "element-select"),
      ).toBe(false);
      const contextMenu = messages.find(
        (message) => message.type === "element-contextmenu",
      ) as
        | {
            screenId?: string;
            layerCandidates?: Array<{
              label?: string;
              info?: { sourceId?: string; selector?: string };
            }>;
          }
        | undefined;
      expect(contextMenu?.screenId).toBe("bridge-guard");
      expect(
        contextMenu?.layerCandidates?.map((candidate) => candidate.label),
      ).toEqual([
        "Front sibling",
        "Nested child",
        "Nested parent",
        "Back sibling",
        "Stage frame",
      ]);
      expect(
        contextMenu?.layerCandidates?.map(
          (candidate) => candidate.info?.sourceId,
        ),
      ).toEqual(["front", "child", "parent", "back", "stage"]);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);
