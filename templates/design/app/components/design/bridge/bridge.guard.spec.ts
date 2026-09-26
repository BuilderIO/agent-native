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
import { build } from "esbuild";
import { describe, expect, it, vi } from "vitest";

import { handleDesignHotkey } from "@/hooks/useDesignHotkeys";
import { runRecordPendingLiveStructureEdit } from "@/pages/design-editor/commands/record-pending-live-structure-edit";
import { runUndo } from "@/pages/design-editor/commands/undo";
import { shouldAcceptEditorDragStateEvent } from "@/pages/design-editor/editor-drag-state";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";
import { embeddedWheelBridgeScript } from "../../../../.generated/bridge/embedded-wheel.generated";
import { hitTestBridgeScript } from "../../../../.generated/bridge/hit-test.generated";
import { buildCodeLayerProjection } from "../../../../shared/code-layer";
import {
  inferElementSizing,
  isTextElement,
} from "../edit-panel/element-classification";

const PLATFORM_PRIMARY_KEY = process.platform === "darwin" ? "Meta" : "Control";
const IGNORE_AUTO_LAYOUT_KEY = process.platform === "darwin" ? "Control" : "s";

declare global {
  interface Window {
    __bridgeMessages?: Array<{ type?: string; phase?: string }>;
  }
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const designRoot = resolve(__dirname, "../../../..");
import { AUTHORED_INLINE_STYLE_PROPERTIES } from "../edit-panel/interaction-state-helpers";

const bridgeDir = __dirname;
const generatedDir = join(designRoot, ".generated", "bridge");

const BRIDGE_SAFE_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  "editor-chrome.bridge.ts": [
    "@agent-native/toolkit/canvas-interactions",
    "@jridgewell/trace-mapping",
  ],
};

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
  boardSurface = true,
  script = editorChromeBridgeScript,
): string {
  return script
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify(screenId))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", String(boardSurface))
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace(
      "__RUNTIME_LAYER_SNAPSHOT_ENABLED__",
      runtimeLayerSnapshotEnabled ? "true" : "false",
    )
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

function hydratedReadOnlyEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "true")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("read-only"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "true")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false");
}

function hydratedEditorChromeBridgeScriptWithLiveReflow(
  screenId = "bridge-guard",
): string {
  return hydratedEditorChromeBridgeScript(false, screenId).replace(
    "__LIVE_REFLOW_ENABLED__",
    "true",
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

function hydratedEditorChromeBridgeScriptWithScale(scale: number): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", String(scale))
    .replace("__EDITOR_CHROME_SCALE_Y__", String(scale))
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("bridge-guard"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "true")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false");
}

function hydratedEditorChromeBridgeScriptWithTextEditing(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "true")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("bridge-guard"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "true")
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

describe("bridge source files", () => {
  const bridgeFiles = getBridgeFiles();

  it("has at least one *.bridge.ts file", () => {
    expect(bridgeFiles.length).toBeGreaterThan(0);
  });

  for (const filename of bridgeFiles) {
    it(`${filename} — only bridge-safe inlined imports`, () => {
      const src = readFileSync(join(bridgeDir, filename), "utf-8");

      const stripped = src.replace(/\/\/[^\n]*/g, "");

      const noComments = stripped.replace(/\/\*[\s\S]*?\*\//g, "");

      const importSources = [
        ...noComments.matchAll(
          /\bimport\s+(?:type\s+)?(?:\*\s+as\s+)?(?:{|[a-zA-Z_$])[^;]*?\s+from\s+["']([^"']+)["']/g,
        ),
      ].map((match) => match[1]);
      const allowedImports = new Set(BRIDGE_SAFE_IMPORTS[filename] ?? []);
      const hasUnsafeImport = importSources.some(
        (source) => !allowedImports.has(source),
      );
      const hasRequire = /\brequire\s*\(/.test(noComments);

      expect(
        hasUnsafeImport || hasRequire,
        `${filename} contains an import or require outside the narrow bridge-safe allow-list. Generated bridge files must remain self-contained iframe IIFEs.`,
      ).toBe(false);
    });
  }
});

describe("editor chrome shared gesture controller", () => {
  it("inlines the controller into the iframe runtime for both move and resize", () => {
    const source = readFileSync(
      join(bridgeDir, "editor-chrome.bridge.ts"),
      "utf-8",
    );

    expect(source).toContain(
      'from "@agent-native/toolkit/canvas-interactions"',
    );
    expect(source).toContain("bridgeMoveController.pointerMove");
    expect(source).toContain("bridgeMoveController.pointerUp");
    expect(source).toContain("bridgeResizeController.pointerMove");
    expect(source).toContain("bridgeResizeController.pointerUp");

    expect(editorChromeBridgeScript).toContain(
      "function createCanvasGestureController",
    );
    expect(editorChromeBridgeScript).toContain("bridgeMoveController");
    expect(editorChromeBridgeScript).toContain("bridgeResizeController");
    expect(editorChromeBridgeScript).not.toContain(
      "@agent-native/toolkit/canvas-interactions",
    );
  });

  it(
    "does not preview or commit a selected-box click, then commits one real drag",
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
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      #target { position: absolute; left: 280px; top: 240px; width: 160px; height: 90px; background: #e9eef8; }
      #shield-target { position: absolute; left: 520px; top: 240px; width: 160px; height: 90px; background: #f3d9a4; }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target">Target</div>
    <div id="shield-target" data-agent-native-node-id="shield-target">Shield target</div>
    <script>
      window.__bridgeMessages = [];
      window.addEventListener("message", (event) => window.__bridgeMessages.push(event.data));
    </script>
  </body>
</html>`);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

        await page.mouse.click(360, 285);
        await page.waitForFunction(() => {
          const selection = document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="selection"]',
          );
          return (
            selection && window.getComputedStyle(selection).display === "block"
          );
        });
        await page.evaluate(() => {
          window.__bridgeMessages = [];
        });

        await page.evaluate(() => {
          const selection = document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="selection"]',
          )!;
          selection.dispatchEvent(
            new MouseEvent("mousedown", {
              bubbles: true,
              cancelable: true,
              clientX: 360,
              clientY: 285,
            }),
          );
          document.dispatchEvent(
            new MouseEvent("mouseup", {
              bubbles: true,
              cancelable: true,
              clientX: 360,
              clientY: 285,
            }),
          );
        });
        await page.waitForTimeout(20);
        const afterClick = await page.evaluate(() => {
          const target = document.getElementById("target") as HTMLElement;
          const messages = window.__bridgeMessages ?? [];
          const rect = target.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            styleChanges: messages.filter(
              (message) => message.type === "visual-style-change",
            ).length,
          };
        });
        expect(afterClick).toEqual({
          left: 280,
          top: 240,
          styleChanges: 0,
        });

        await page.evaluate(() => {
          const selection = document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="selection"]',
          )!;
          selection.dispatchEvent(
            new MouseEvent("mousedown", {
              bubbles: true,
              cancelable: true,
              clientX: 360,
              clientY: 285,
            }),
          );
          document.dispatchEvent(
            new MouseEvent("mousemove", {
              bubbles: true,
              cancelable: true,
              clientX: 380,
              clientY: 297,
            }),
          );
          document.dispatchEvent(
            new MouseEvent("mouseup", {
              bubbles: true,
              cancelable: true,
              clientX: 380,
              clientY: 297,
            }),
          );
        });
        await page.waitForTimeout(20);
        const afterDrag = await page.evaluate(() => {
          const target = document.getElementById("target") as HTMLElement;
          const messages = window.__bridgeMessages ?? [];
          const rect = target.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            styleChanges: messages.filter(
              (message) => message.type === "visual-style-change",
            ).length,
          };
        });
        expect(afterDrag.left).not.toBe(280);
        expect(afterDrag.top).not.toBe(240);
        expect(afterDrag.styleChanges).toBe(1);

        await page.evaluate(() => {
          window.__bridgeMessages = [];
        });
        await page.mouse.move(600, 285);
        await page.mouse.down();
        await page.mouse.move(610, 285);
        await page.mouse.move(612, 287);
        await page.mouse.up();
        await page.waitForTimeout(20);
        const afterShieldDrag = await page.evaluate(() => {
          const target = document.getElementById(
            "shield-target",
          ) as HTMLElement;
          const rect = target.getBoundingClientRect();
          const messages = window.__bridgeMessages ?? [];
          return {
            left: rect.left,
            top: rect.top,
            styleChanges: messages.filter(
              (message) => message.type === "visual-style-change",
            ).length,
          };
        });
        expect(afterShieldDrag).toEqual({
          left: 522,
          top: 242,
          styleChanges: 1,
        });

        const beforeAltDuplicate = await page.evaluate(() => {
          const target = document.getElementById(
            "shield-target",
          ) as HTMLElement;
          const rect = target.getBoundingClientRect();
          return { left: rect.left, top: rect.top };
        });
        const altStartX = beforeAltDuplicate.left + 80;
        const altStartY = beforeAltDuplicate.top + 45;
        await page.evaluate(
          async ({ startX, startY }) => {
            const shield = document.querySelector<HTMLElement>(
              '[data-agent-native-edit-overlay="shield"]',
            )!;
            const event = (
              type: string,
              clientX: number,
              clientY: number,
              buttons: number,
            ) =>
              new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                altKey: true,
                button: 0,
                buttons,
                clientX,
                clientY,
                isPrimary: true,
                pointerId: 17,
                pointerType: "mouse",
              });
            shield.dispatchEvent(event("pointerdown", startX, startY, 1));
            document.dispatchEvent(
              event("pointermove", startX + 10, startY, 1),
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
            document.dispatchEvent(
              event("pointermove", startX + 12, startY + 2, 1),
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
            document.dispatchEvent(
              event("pointerup", startX + 12, startY + 2, 0),
            );
          },
          { startX: altStartX, startY: altStartY },
        );
        await page.waitForTimeout(20);
        const afterAltDuplicate = await page.evaluate(() => {
          const nodes = Array.from(
            document.querySelectorAll<HTMLElement>(
              "[data-agent-native-node-id]",
            ),
          );
          return nodes.map((node) => {
            const rect = node.getBoundingClientRect();
            return {
              id: node.dataset.agentNativeNodeId,
              left: rect.left,
              top: rect.top,
            };
          });
        });
        const duplicate = afterAltDuplicate.find(
          (node) => node.id !== "target" && node.id !== "shield-target",
        );
        expect(duplicate).toBeDefined();
        expect(Math.round(duplicate!.left)).toBe(
          Math.round(beforeAltDuplicate.left + 12),
        );
        expect(Math.round(duplicate!.top)).toBe(
          Math.round(beforeAltDuplicate.top + 2),
        );
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );
});

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

it("keeps cancel cleanup compatible with held modifiers", () => {
  const bridge = readFileSync(
    join(bridgeDir, "editor-chrome.bridge.ts"),
    "utf-8",
  );
  const resetStart = bridge.indexOf(
    "function resetBridgeDragModifierStateOnCancel",
  );
  const resetEnd = bridge.indexOf(
    "var activeCrossScreenStyleSnapshot",
    resetStart,
  );
  const cancel = bridge.slice(resetStart, resetEnd);
  expect(cancel).toContain("bridgeSpaceKeyPressed = false");
  expect(cancel).not.toContain("bridgeIgnoreAutoLayoutKeyPressed = false");
});

describe("generated bridge modules", () => {
  const bridgeFiles = getBridgeFiles();

  for (const filename of bridgeFiles) {
    it(`${filename} → .generated/bridge/${filename.replace(".bridge.ts", ".generated.ts")} is up to date`, async () => {
      const outPath = generatedPath(filename);

      expect(
        existsSync(outPath),
        `Missing generated file for ${filename}. Run: pnpm exec tsx app/components/design/bridge/codegen.ts`,
      ).toBe(true);

      const committed = readFileSync(outPath, "utf-8");

      const tempPath = outPath + ".tmp";
      try {
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

      await surface.click();
      expect(
        await page.evaluate(() =>
          Number(
            (window as Window & { __appPointerDowns?: number })
              .__appPointerDowns,
          ),
        ),
      ).toBe(1);

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
      expect(panMessages[1]).toMatchObject({ movementX: 32, movementY: 18 });
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
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]', {
        timeout: 5_000,
      });

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

        const scroller = document.scrollingElement || document.documentElement;
        for (let i = 0; i < 30; i++) {
          scroller.scrollTop = i * 7;
          window.dispatchEvent(new Event("scroll"));
        }

        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        observer.disconnect();

        const target = document.getElementById("target")!;
        const targetTop = target.getBoundingClientRect().top;
        const overlayTop = parseFloat(sel.style.top || "NaN");
        return { styleWrites, targetTop, overlayTop };
      });

      expect(result.styleWrites).toBeLessThan(15);
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
  "editor chrome bridge keeps a free element free when dragged into a plain container (no strip, no auto-layout conversion)",
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
      html, body { margin: 0; width: 100%; height: 100%; background: white; }
      #frame { position: relative; margin-left: 280px; margin-top: 180px; width: 420px; height: 340px; background: #f3f4f6; }
      #rect { position: absolute; left: 40px; top: 40px; width: 120px; height: 80px; background: #dadada; }
    </style>
  </head>
  <body>
    <main id="frame" data-agent-native-node-id="frame"></main>
    <div id="rect" data-an-primitive="rectangle" data-agent-native-node-id="rect"></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(100, 80);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.mouse.move(100, 80);
      await page.mouse.down();
      await page.mouse.move(490, 350, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(60);

      const result = await page.evaluate(() => {
        const rect = document.querySelector<HTMLElement>("#rect");
        const frame = document.querySelector<HTMLElement>("#frame");
        return {
          rectPosition: rect ? window.getComputedStyle(rect).position : null,
          frameDisplay: frame ? window.getComputedStyle(frame).display : null,
          rectMoved: rect?.style.left !== "40px" || rect?.style.top !== "40px",
        };
      });

      expect(result.rectPosition).toBe("absolute");
      expect(result.frameDisplay).toBe("block");
      expect(result.rectMoved).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge (live reflow) lifts and follows a dragged flow element, then restores it on drop",
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
      html, body { margin: 0; width: 100%; height: 100%; background: white; }
      #row { display: flex; flex-direction: row; gap: 12px; padding: 20px; align-items: flex-start; }
      #row > div { width: 100px; height: 60px; color: white; }
    </style>
  </head>
  <body>
    <div id="row" data-agent-native-node-id="row">
      <div id="a" data-agent-native-node-id="a" style="background:#ef4444;">A</div>
      <div id="b" data-agent-native-node-id="b" style="background:#22c55e;">B</div>
      <div id="c" data-agent-native-node-id="c" style="background:#3b82f6;">C</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithLiveReflow(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await selectElementDirect(page, '[data-agent-native-node-id="a"]');
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.addEventListener("message", (event: MessageEvent) => {
          (window as any).__bridgeMessages.push(event.data);
        });
      });

      await page.mouse.move(70, 50);
      await page.mouse.down();
      await page.mouse.move(330, 50, { steps: 10 });

      await page.waitForFunction(() => {
        const a = document.querySelector<HTMLElement>("#a");
        return !!a && a.style.transform.includes("translate");
      });
      const during = await page.evaluate(() => {
        const a = document.querySelector<HTMLElement>("#a")!;
        return {
          transform: a.style.transform,
          boxShadow: a.style.boxShadow,
          pointerEvents: a.style.pointerEvents,
        };
      });

      await page.mouse.up();
      await page.waitForTimeout(30);

      const after = await page.evaluate(() => {
        const a = document.querySelector<HTMLElement>("#a")!;
        return {
          transform: a.style.transform,
          boxShadow: a.style.boxShadow,
          pointerEvents: a.style.pointerEvents,
          order: Array.from(
            document.querySelectorAll<HTMLElement>("#row > div"),
          ).map((el) => el.id),
          messageTypes: ((window as any).__bridgeMessages ?? []).map(
            (m: { type?: string }) => m.type,
          ),
        };
      });

      expect(during.transform).toContain("translate");
      expect(during.boxShadow).not.toBe("");
      expect(during.pointerEvents).toBe("none");
      expect(after.transform).toBe("");
      expect(after.boxShadow).toBe("");
      expect(after.pointerEvents).toBe("");
      expect(after.messageTypes).toContain("visual-structure-change");
      expect(after.order).not.toEqual(["a", "b", "c"]);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge (live reflow OFF) leaves a dragged flow element untransformed",
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
      html, body { margin: 0; width: 100%; height: 100%; background: white; }
      #row { display: flex; flex-direction: row; gap: 12px; padding: 20px; align-items: flex-start; }
      #row > div { width: 100px; height: 60px; color: white; }
    </style>
  </head>
  <body>
    <div id="row" data-agent-native-node-id="row">
      <div id="a" data-agent-native-node-id="a" style="background:#ef4444;">A</div>
      <div id="b" data-agent-native-node-id="b" style="background:#22c55e;">B</div>
      <div id="c" data-agent-native-node-id="c" style="background:#3b82f6;">C</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(70, 50);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      await page.mouse.move(70, 50);
      await page.mouse.down();
      await page.mouse.move(330, 50, { steps: 10 });
      const duringTransform = await page.evaluate(
        () => document.querySelector<HTMLElement>("#a")!.style.transform,
      );
      await page.mouse.up();
      await page.waitForTimeout(20);

      expect(duringTransform).not.toContain("translate");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge (live reflow) Ctrl-drag free-places a flow element at the exact release point",
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
      html, body { margin: 0; width: 100%; height: 100%; background: white; }
      #row { display: flex; flex-direction: row; gap: 12px; padding: 20px; align-items: flex-start; }
      #row > div { width: 100px; height: 60px; color: white; }
    </style>
  </head>
  <body>
    <div id="row" data-agent-native-node-id="row">
      <div id="a" data-agent-native-node-id="a" style="background:#ef4444;">A</div>
      <div id="b" data-agent-native-node-id="b" style="background:#22c55e;">B</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithLiveReflow(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await selectElementDirect(page, '[data-agent-native-node-id="a"]');

      await page.keyboard.down("Control");
      await page.mouse.move(70, 50);
      await page.mouse.down();
      await page.mouse.move(400, 300, { steps: 10 });
      await page.mouse.up();
      await page.keyboard.up("Control");
      await page.waitForTimeout(40);

      const result = await page.evaluate(() => {
        const a = document.querySelector<HTMLElement>("#a")!;
        const rect = a.getBoundingClientRect();
        return {
          position: window.getComputedStyle(a).position,
          rectLeft: rect.left,
          rectTop: rect.top,
          inlineTransform: a.style.transform,
        };
      });

      expect(result.position).toBe("absolute");
      expect(result.rectLeft).toBeGreaterThan(335);
      expect(result.rectLeft).toBeLessThan(365);
      expect(result.rectTop).toBeGreaterThan(255);
      expect(result.rectTop).toBeLessThan(285);
      expect(result.inlineTransform).toBe("");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge (live reflow) honors Ctrl pressed only at release (free-place)",
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
      html, body { margin: 0; width: 100%; height: 100%; background: white; }
      #row { display: flex; flex-direction: row; gap: 12px; padding: 20px; align-items: flex-start; }
      #row > div { width: 100px; height: 60px; color: white; }
    </style>
  </head>
  <body>
    <div id="row" data-agent-native-node-id="row">
      <div id="a" data-agent-native-node-id="a" style="background:#ef4444;">A</div>
      <div id="b" data-agent-native-node-id="b" style="background:#22c55e;">B</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithLiveReflow(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await selectElementDirect(page, '[data-agent-native-node-id="a"]');

      await page.mouse.move(70, 50);
      await page.mouse.down();
      await page.mouse.move(400, 300, { steps: 10 });
      await page.keyboard.down("Control");
      await page.mouse.up();
      await page.keyboard.up("Control");
      await page.waitForTimeout(40);

      const position = await page.evaluate(
        () => window.getComputedStyle(document.querySelector("#a")!).position,
      );
      expect(position).toBe("absolute");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge (live reflow) clears drag transforms on pointercancel without committing",
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
      html, body { margin: 0; width: 100%; height: 100%; background: white; }
      #row { display: flex; flex-direction: row; gap: 12px; padding: 20px; align-items: flex-start; }
      #row > div { width: 100px; height: 60px; color: white; }
    </style>
  </head>
  <body>
    <div id="row" data-agent-native-node-id="row">
      <div id="a" data-agent-native-node-id="a" style="background:#ef4444;">A</div>
      <div id="b" data-agent-native-node-id="b" style="background:#22c55e;">B</div>
      <div id="c" data-agent-native-node-id="c" style="background:#3b82f6;">C</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithLiveReflow(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await selectElementDirect(page, '[data-agent-native-node-id="a"]');
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.addEventListener("message", (event: MessageEvent) => {
          (window as any).__bridgeMessages.push(event.data);
        });
      });

      await page.mouse.move(70, 50);
      await page.mouse.down();
      await page.mouse.move(250, 50, { steps: 10 });
      await page.waitForFunction(() =>
        (document.getElementById("a")?.style.transform ?? "").includes(
          "translate",
        ),
      );
      await page.evaluate(() =>
        document.dispatchEvent(new PointerEvent("pointercancel")),
      );
      await page.waitForTimeout(30);

      const after = await page.evaluate(() => ({
        transforms: ["a", "b", "c"].map(
          (id) => document.getElementById(id)!.style.transform,
        ),
        order: Array.from(
          document.querySelectorAll<HTMLElement>("#row > div"),
        ).map((el) => el.id),
        messageTypes: ((window as any).__bridgeMessages ?? []).map(
          (m: { type?: string }) => m.type,
        ),
      }));

      expect(after.transforms.every((t) => t === "")).toBe(true);
      expect(after.order).toEqual(["a", "b", "c"]);
      expect(after.messageTypes).not.toContain("visual-structure-change");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge (live reflow) parts siblings during a packed reorder, then restores them on drop",
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
      html, body { margin: 0; width: 100%; height: 100%; background: white; }
      #row { display: flex; flex-direction: row; gap: 12px; padding: 20px; align-items: flex-start; }
      #row > div { width: 100px; height: 60px; color: white; }
    </style>
  </head>
  <body>
    <div id="row" data-agent-native-node-id="row">
      <div id="a" data-agent-native-node-id="a" style="background:#ef4444;">A</div>
      <div id="b" data-agent-native-node-id="b" style="background:#22c55e;">B</div>
      <div id="c" data-agent-native-node-id="c" style="background:#3b82f6;">C</div>
      <div id="d" data-agent-native-node-id="d" style="background:#a855f7;">D</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithLiveReflow(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await selectElementDirect(page, '[data-agent-native-node-id="a"]');

      await page.mouse.move(70, 50);
      await page.mouse.down();
      await page.mouse.move(250, 50, { steps: 12 });

      await page.waitForFunction(() =>
        ["b", "c", "d"].some((id) =>
          (document.getElementById(id)?.style.transform ?? "").includes(
            "translate",
          ),
        ),
      );
      const during = await page.evaluate(() =>
        ["b", "c", "d"].map((id) => ({
          transform: document.getElementById(id)!.style.transform,
          transition: document.getElementById(id)!.style.transition,
        })),
      );

      await page.mouse.up();
      await page.waitForTimeout(40);

      const after = await page.evaluate(() => ({
        transforms: ["b", "c", "d"].map(
          (id) => document.getElementById(id)!.style.transform,
        ),
        order: Array.from(
          document.querySelectorAll<HTMLElement>("#row > div"),
        ).map((el) => el.id),
      }));

      expect(during.some((s) => s.transform.includes("translate"))).toBe(true);
      expect(during.some((s) => s.transition.includes("transform"))).toBe(true);
      expect(after.transforms.every((t) => t === "")).toBe(true);
      expect(after.order).not.toEqual(["a", "b", "c", "d"]);
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

it(
  "editor chrome bridge omits a move position badge and locks to the dominant axis while Shift is held during a move drag",
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

      await page.mouse.move(240, 230);
      await page.mouse.down();
      await page.mouse.move(250, 240);
      await page.mouse.move(280, 270);

      const draggedPosition = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        return { left: target.style.left, top: target.style.top };
      });
      expect(draggedPosition).toEqual({ left: "230px", top: "230px" });

      const badgeDisplay = await page.evaluate(() => {
        const badge = document.querySelector<HTMLElement>(
          "[data-agent-native-transform-badge]",
        );
        return badge ? window.getComputedStyle(badge).display : null;
      });
      expect(badgeDisplay).toBe("none");

      await page.keyboard.down("Shift");
      await page.mouse.move(400, 400);
      const lockedPosition = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        return { left: target.style.left, top: target.style.top };
      });
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

      await page.mouse.move(170, 240);
      await page.mouse.down();
      await page.mouse.move(174, 244);
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
      await page.keyboard.down(PLATFORM_PRIMARY_KEY);
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
      await page.keyboard.up(PLATFORM_PRIMARY_KEY);

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
  "editor chrome bridge renders hover and selection outlines with the same weight",
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

      await page.mouse.click(170, 180);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });
      await page.mouse.move(370, 180);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="highlight"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

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

      expect(widths.highlight).toBe(widths.selection);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "keeps chrome theme tokens on its host and hands pointer ownership back in Interact",
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
<html><head><style>html,body{margin:0;width:100%;height:100%}#spaces,#target{position:absolute;width:160px;height:60px}#spaces{left:120px;top:140px}#target{left:360px;top:140px}</style></head>
<body><a id="spaces" href="#spaces-destination">Spaces</a><div id="target">Target</div><script>window.__bridgeMessages=[];window.addEventListener('message',event=>window.__bridgeMessages.push(event.data));</script></body></html>`);
      await page.evaluate(() => {
        (
          window as Window & {
            __anEditorBridgeThemeVars?: Record<string, string>;
          }
        ).__anEditorBridgeThemeVars = {
          "--design-editor-accent-color": "hsl(205 100% 53%)",
          "--design-editor-selection-color": "hsl(205 100% 53% / 0.14)",
        };
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        (
          window as Window & { __retainedDocument?: Document }
        ).__retainedDocument = document;
      });
      await page.mouse.move(150, 160);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="highlight"]',
        );
        return overlay && getComputedStyle(overlay).display === "block";
      });
      await page.mouse.click(400, 160);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && getComputedStyle(overlay).display === "block";
      });

      const outlineColorBeforeHydration = await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>(
          "[data-agent-native-editor-chrome-host]",
        )!;
        const selection = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        )!;
        document.documentElement.removeAttribute("style");
        return {
          hostAccent: host.style.getPropertyValue(
            "--design-editor-accent-color",
          ),
          outline: getComputedStyle(selection).borderTopColor,
        };
      });
      expect(outlineColorBeforeHydration.hostAccent).toBe("hsl(205 100% 53%)");
      expect(outlineColorBeforeHydration.outline).toBe("rgb(15, 155, 255)");

      await page.keyboard.down("Space");
      await page.waitForFunction(() =>
        (window as any).__bridgeMessages.some(
          (message: any) =>
            message.type === "design-hotkey" && message.code === "Space",
        ),
      );
      await page.evaluate(() => {
        window.postMessage(
          { type: "set-interaction-mode", interact: true },
          "*",
        );
        window.postMessage({ type: "set-read-only", readOnly: false }, "*");
      });
      await page.waitForFunction(() => {
        const shield = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="shield"]',
        );
        const selection = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        const highlight = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="highlight"]',
        );
        return (
          shield?.style.pointerEvents === "none" &&
          selection?.style.display === "none" &&
          highlight?.style.display === "none"
        );
      });
      expect(
        await page.evaluate(() =>
          (window as any).__bridgeMessages
            .filter(
              (message: any) =>
                message.code === "Space" &&
                ["design-hotkey", "design-hotkey-up"].includes(message.type),
            )
            .map((message: any) => message.type),
        ),
      ).toEqual(["design-hotkey", "design-hotkey-up"]);
      await page.evaluate(() => {
        const bridge = (window as any).__anEditorChromeBridgeInstance;
        bridge.updateConfig({ readOnly: true, textEditingEnabled: true });
        bridge.repair();
      });
      await page.waitForFunction(() => {
        const shield = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="shield"]',
        );
        return shield?.style.pointerEvents === "none";
      });
      await page.mouse.click(150, 160);
      await page.waitForFunction(
        () => window.location.hash === "#spaces-destination",
      );
      expect(
        await page.evaluate(
          () =>
            (window as Window & { __retainedDocument?: Document })
              .__retainedDocument === document,
        ),
      ).toBe(true);

      await page.evaluate(() => {
        window.postMessage(
          { type: "set-interaction-mode", interact: false },
          "*",
        );
        window.postMessage({ type: "set-read-only", readOnly: false }, "*");
      });
      await page.waitForFunction(() => {
        const shield = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="shield"]',
        );
        const selection = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return (
          shield?.style.pointerEvents === "auto" &&
          selection?.style.display === "block"
        );
      });
      await page.mouse.click(400, 160);
      await page.waitForFunction(() => {
        const selection = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return selection && getComputedStyle(selection).display === "block";
      });
      await page.keyboard.up("Space");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge keeps viewer selection inspectable without transform handles",
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
      #target { position: absolute; left: 120px; top: 140px; width: 160px; height: 80px; background: #e9eef8; }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target">Target</div>
  </body>
</html>`);
      await page.addScriptTag({
        content: hydratedReadOnlyEditorChromeBridgeScript(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(180, 180);
      await page.waitForFunction(() => {
        const selection = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return selection?.style.display === "block";
      });

      const chrome = await page.evaluate(() => ({
        handles: Array.from(
          document.querySelectorAll<HTMLElement>(
            "[data-agent-native-edge-handle], [data-agent-native-edit-handle], [data-agent-native-rotate-handle]",
          ),
        ).map((node) => node.style.display),
        left: document.getElementById("target")!.getBoundingClientRect().left,
      }));
      expect(chrome.handles.every((display) => display === "none")).toBe(true);

      await page.mouse.move(180, 180);
      await page.mouse.down();
      await page.mouse.move(260, 240);
      await page.mouse.up();
      const leftAfterDrag = await page
        .locator("#target")
        .evaluate((element) => element.getBoundingClientRect().left);
      expect(leftAfterDrag).toBe(chrome.left);
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
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithTextEditing(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

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

it(
  "uses direct single-click selection inside screens while the board keeps Figma container-first selection",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];

    try {
      const openSurface = async (boardSurface: boolean) => {
        const page = await browser.newPage({
          viewport: { width: 900, height: 700 },
        });
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      #screen { position: absolute; left: 100px; top: 100px; width: 320px; height: 220px; background: #f5f5f5; }
      #frame { position: absolute; left: 20px; top: 20px; width: 280px; height: 180px; background: #e5e7eb; }
      #heading { position: absolute; left: 20px; top: 20px; width: 180px; height: 48px; background: #6366f1; }
    </style>
  </head>
  <body>
    <div id="screen" data-agent-native-node-id="screen">
      <div id="frame" data-agent-native-node-id="frame">
        <div id="heading" data-agent-native-node-id="heading"></div>
      </div>
    </div>
  </body>
</html>`);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(
            false,
            boardSurface ? "board" : "screen",
            boardSurface,
          ),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
        await page.evaluate(() => {
          (window as any).__selectedIds = [];
          window.addEventListener("message", (event: MessageEvent) => {
            if (event.data?.type === "element-select") {
              (window as any).__selectedIds.push(event.data.payload?.sourceId);
            }
          });
        });

        // HUMAN-DIRECTED UX EXCEPTION: the screen path is intentionally a
        // direct single-click selection, unlike the board's Figma behavior.
        await page.mouse.click(160, 160);
        await page.waitForFunction(
          () => ((window as any).__selectedIds as string[]).length > 0,
        );
        const selectedId = await page.evaluate(() => {
          const selectedIds = (window as any).__selectedIds as string[];
          return selectedIds[selectedIds.length - 1];
        });
        return { page, selectedId };
      };

      const screen = await openSurface(false);
      const board = await openSurface(true);
      expect(screen.selectedId).toBe("heading");
      expect(board.selectedId).toBe("screen");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "click-through descends from a generated wrapper into its text child on the second click, then edits it on double-click",
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
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      #headline { position: absolute; left: 100px; top: 100px; width: 300px; height: 120px; background: #f5f5f5; }
      #headline > span { position: absolute; left: 20px; display: block; font-size: 24px; }
      #headline > span:first-child { top: 20px; }
      #production-ui { top: 60px; }
    </style>
  </head>
  <body>
    <div id="headline" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline" data-agent-native-group-wrapper="true">
      <span data-an-primitive="text">Your prompt</span>
      <span id="production-ui" data-agent-native-node-id="production-ui" data-an-primitive="text">Production UI</span>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        window.postMessage(
          { type: "set-text-editing-enabled", enabled: true },
          "*",
        );
        (window as any).__elementSelectPayloads = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "element-select") {
            (window as any).__elementSelectPayloads.push(event.data.payload);
          }
        });
      });

      const prompt = page.locator("#headline > span").first();
      const box = await prompt.boundingBox();
      if (!box) throw new Error("Prompt text was not rendered");
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(
        () => (window as any).__elementSelectPayloads.length > 0,
      );
      const firstSelection = await page.evaluate(() =>
        (window as any).__elementSelectPayloads.at(-1),
      );
      expect(firstSelection.sourceId).toBe("headline");

      await page.waitForTimeout(500);
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(
        () => (window as any).__elementSelectPayloads.length > 1,
      );
      const repeatedSelection = await page.evaluate(() =>
        (window as any).__elementSelectPayloads.at(-1),
      );

      expect(repeatedSelection.sourceId).not.toBe("headline");

      await page.mouse.dblclick(point.x, point.y);
      await page.waitForFunction(() =>
        Boolean(
          document.querySelector<HTMLElement>(
            '[data-agent-native-text-editing="true"]',
          ),
        ),
      );
      const textSelection = await page.evaluate(() =>
        (window as any).__elementSelectPayloads.at(-1),
      );

      expect(textSelection.tagName).toBe("span");
      expect(textSelection.primitiveKind).toBe("text");
      expect(textSelection.hasOwnText).toBe(true);
      expect(textSelection.pendingNodeId).toBeTruthy();
      expect(isTextElement(textSelection)).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "reports a paragraph with an inline span as a whole text style root",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(`<!doctype html>
<html><body style="margin:0">
  <main><article>
    <p id="note" data-agent-native-node-id="note" style="margin:0"><span>Shared note</span></p>
    <div id="generic" data-agent-native-node-id="generic"><span>Generic note</span></div>
  </article></main>
</body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        window.postMessage(
          { type: "set-text-editing-enabled", enabled: true },
          "*",
        );
        (window as any).__elementSelectPayloads = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "element-select") {
            (window as any).__elementSelectPayloads.push(event.data.payload);
          }
        });
      });

      await selectElementDirect(page, "#note");
      await page.waitForFunction(
        () =>
          (window as any).__elementSelectPayloads.at(-1)?.sourceId === "note",
      );
      const selection = await page.evaluate(() =>
        (window as any).__elementSelectPayloads.at(-1),
      );

      expect(selection.sourceId).toBe("note");
      expect(selection.tagName).toBe("p");
      expect(selection.hasOwnText).toBe(false);
      expect(selection.wholeTextStyleRoot).toBe(true);
      expect(isTextElement(selection)).toBe(true);

      await selectElementDirect(page, "#generic");
      await page.waitForFunction(
        () =>
          (window as any).__elementSelectPayloads.at(-1)?.sourceId ===
          "generic",
      );
      const genericSelection = await page.evaluate(() =>
        (window as any).__elementSelectPayloads.at(-1),
      );
      expect(genericSelection.tagName).toBe("div");
      expect(genericSelection.wholeTextStyleRoot).toBe(false);
      expect(isTextElement(genericSelection)).toBe(false);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge promotes generated groups, but not authored or copied Group layers",
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
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      .group { position: absolute; width: 180px; height: 120px; background: #f5f5f5; }
      .child { position: absolute; left: 20px; top: 20px; width: 60px; height: 60px; background: #6366f1; }
      #authored-group { left: 100px; top: 100px; }
      #generated-group { left: 400px; top: 100px; }
      #legacy-group { left: 700px; top: 100px; }
      #cloned-group { left: 100px; top: 300px; }
    </style>
  </head>
  <body>
    <div id="authored-group" class="group" data-agent-native-node-id="authored-group" data-agent-native-layer-name="Group">
      <div id="authored-child" class="child" data-agent-native-node-id="authored-child"></div>
    </div>
    <div id="generated-group" class="group" data-agent-native-node-id="generated-group" data-agent-native-layer-name="Renamed section" data-agent-native-group-wrapper="true">
      <div id="generated-child" class="child" data-agent-native-node-id="generated-child"></div>
    </div>
    <div id="legacy-group" class="group" data-agent-native-node-id="an-legacygroup" data-agent-native-layer-name="Group 2" data-agent-native-preserve-styles="true">
      <div id="legacy-child" class="child" data-agent-native-node-id="legacy-child"></div>
    </div>
    <div id="cloned-group" class="group" data-agent-native-node-id="copy-cloned-group" data-agent-native-layer-name="Group" data-agent-native-group-wrapper="true" data-agent-native-clone-root="true" data-agent-native-preserve-styles="true">
      <div id="cloned-child" class="child" data-agent-native-node-id="cloned-child"></div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page
        .waitForSelector('[data-agent-native-edit-overlay="shield"]', {
          timeout: 2_000,
        })
        .catch((error) => {
          throw new Error(
            `Editor overlay did not initialize: ${pageErrors.join("; ") || error.message}`,
          );
        });
      await page.evaluate(() => {
        (window as any).__selectedIds = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "element-select") {
            (window as any).__selectedIds.push(event.data.payload?.sourceId);
          }
        });
      });

      await page.keyboard.down("Meta");

      await page.mouse.click(140, 140);
      await page.waitForFunction(
        () => ((window as any).__selectedIds as string[]).length >= 1,
        undefined,
        { timeout: 2_000 },
      );
      const authoredSelection = await page.evaluate(() =>
        (window as any).__selectedIds.at(-1),
      );
      expect(authoredSelection).toBe("authored-child");

      await page.mouse.click(440, 140);
      await page.waitForFunction(
        () => ((window as any).__selectedIds as string[]).length >= 2,
        undefined,
        { timeout: 2_000 },
      );
      const generatedSelection = await page.evaluate(() =>
        (window as any).__selectedIds.at(-1),
      );
      expect(generatedSelection).toBe("generated-group");

      await page.mouse.click(740, 140);
      await page.waitForFunction(
        () => ((window as any).__selectedIds as string[]).length >= 3,
        undefined,
        { timeout: 2_000 },
      );
      const legacySelection = await page.evaluate(() =>
        (window as any).__selectedIds.at(-1),
      );
      expect(legacySelection).toBe("an-legacygroup");

      await page.mouse.click(140, 340);
      await page.waitForFunction(
        () => ((window as any).__selectedIds as string[]).length >= 4,
        undefined,
        { timeout: 2_000 },
      );
      const clonedSelection = await page.evaluate(() =>
        (window as any).__selectedIds.at(-1),
      );
      expect(clonedSelection).toBe("cloned-child");

      await page.keyboard.up("Meta");
    } finally {
      await browser.close();
    }
  },
);

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
      expect(afterNormalResize.borderWidth).toBe("");
      expect(afterNormalResize.fontSize).toBe("");

      await page.evaluate(() => {
        window.postMessage({ type: "scale-tool-mode", enabled: true }, "*");
      });
      await page.waitForTimeout(10);

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
  "editor chrome bridge K-scale tool scales the type inside the resized element and returns each scaled node in one batch",
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
      #card {
        position: absolute; left: 150px; top: 150px; width: 200px; height: 200px;
        background: #e9eef8; border: 2px solid #333;
      }
      #heading { font-size: 24px; margin: 0; }
      #inherited { margin: 0; }
    </style>
  </head>
  <body>
    <div id="card" data-agent-native-node-id="card">
      <p id="heading" data-agent-native-node-id="heading">hello there</p>
      <p id="inherited" data-agent-native-node-id="inherited">inherits</p>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.evaluate(() => {
        (window as unknown as { __styleChanges: unknown[] }).__styleChanges =
          [];
        window.addEventListener("message", (event) => {
          const data = event.data as {
            type?: string;
            changes?: Array<Record<string, unknown>>;
          };
          if (data?.type === "visual-style-batch-change") {
            (
              window as unknown as { __styleChanges: unknown[] }
            ).__styleChanges.push(...(data.changes ?? []));
          }
        });
        window.postMessage({ type: "scale-tool-mode", enabled: true }, "*");
      });

      await page.mouse.click(340, 340);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      const seHandle = page.locator('[data-agent-native-edit-handle="se"]');
      const seBox = await seHandle.boundingBox();
      if (!seBox) throw new Error("resize handle not found");
      const handleX = seBox.x + seBox.width / 2;
      const handleY = seBox.y + seBox.height / 2;
      await page.mouse.move(handleX, handleY);
      await page.mouse.down();
      await page.mouse.move(handleX - 100, handleY - 100);
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const changes = (
          window as unknown as {
            __styleChanges: Array<{
              selector: string;
              styles: Record<string, string>;
              originalStyles?: Record<string, string>;
              preserveSelection?: boolean;
            }>;
          }
        ).__styleChanges;
        const heading = changes.find((change) =>
          change.selector.includes("heading"),
        );
        return {
          cardWidth: document.querySelector<HTMLElement>("#card")!.style.width,
          headingFontSize:
            document.querySelector<HTMLElement>("#heading")!.style.fontSize,
          inheritedFontSize:
            document.querySelector<HTMLElement>("#inherited")!.style.fontSize,
          committedHeadingFontSize: heading?.styles["font-size"],
          headingRevertBaseline: heading?.originalStyles?.["font-size"],
          headingPreservesSelection: heading?.preserveSelection,
        };
      });

      expect(result.cardWidth).toBe("100px");
      expect(result.headingFontSize).toBe("12px");
      expect(result.inheritedFontSize).toBe("8px");
      expect(result.committedHeadingFontSize).toBe("12px");
      expect(result.headingRevertBaseline).toBe("");
      expect(result.headingPreservesSelection).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "external K-scale only collects visual nodes, including hidden authored layers and SVG",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html>
<html><head>
  <style data-agent-native-node-id="authored-style">
    #hidden-layer { width: 64px; height: 32px; font-size: 12px; display: none; }
  </style>
</head><body>
  <script data-agent-native-node-id="authored-script">window.runtimeOnly = true;</script>
  <div id="hidden-layer" data-agent-native-node-id="hidden-layer"></div>
  <div data-agent-native-edit-overlay="shield">
    <div id="overlay-child" data-agent-native-node-id="overlay-child" style="width:48px;height:24px;font-size:14px"></div>
  </div>
  <svg id="authored-svg" data-agent-native-node-id="authored-svg" style="width:40px;height:20px">
    <rect id="authored-rect" data-agent-native-node-id="authored-rect" width="12" height="8" style="stroke-width:2px" />
  </svg>
  <iframe data-agent-native-node-id="authored-iframe" aria-hidden="true" style="width:40px;height:20px;font-size:12px"></iframe>
</body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        const iframe = document.createElement("iframe");
        iframe.setAttribute("aria-hidden", "true");
        iframe.tabIndex = -1;
        iframe.style.cssText =
          "position:fixed!important;width:0!important;height:0!important;border:0!important;visibility:hidden!important;pointer-events:none!important;font-size:16px;outline-width:3px";
        document.body.appendChild(iframe);
      });

      const changes = await page.evaluate(() => {
        const scale = (
          window as Window & {
            __designCanvasScaleContents?: (
              factor: number,
              phase: "begin" | "preview" | "commit" | "cancel" | "accept",
            ) => Array<{
              selector: string;
              sourceId?: string;
              styles: Record<string, string>;
            }>;
          }
        ).__designCanvasScaleContents;
        if (!scale) return null;
        scale(1, "begin");
        const result = scale(1.5, "commit");
        scale(1, "cancel");
        return result.map((change) => ({
          ...change,
          tagName: document.querySelector(change.selector)?.tagName,
        }));
      });

      expect(changes).not.toBeNull();
      const targets = changes ?? [];
      expect(targets.map((change) => change.sourceId)).toContain(
        "hidden-layer",
      );
      expect(targets.map((change) => change.sourceId)).toContain(
        "authored-svg",
      );
      expect(targets.map((change) => change.sourceId)).toContain(
        "authored-rect",
      );
      expect(targets.map((change) => change.sourceId)).toContain(
        "authored-iframe",
      );
      expect(targets.map((change) => change.sourceId)).not.toContain(
        "authored-script",
      );
      expect(targets.map((change) => change.sourceId)).not.toContain(
        "authored-style",
      );
      expect(targets.map((change) => change.sourceId)).not.toContain(
        "overlay-child",
      );
      expect(targets.map((change) => change.tagName)).not.toContain("SCRIPT");
      expect(targets.map((change) => change.tagName)).not.toContain("STYLE");
      expect(
        targets
          .filter((change) => change.tagName === "IFRAME")
          .map((change) => change.sourceId),
      ).toEqual(["authored-iframe"]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "cancels external K-scale preview before restoring its unchanged source",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      const html = `<!doctype html>
<html><head><style>html,body{margin:0;width:400px;height:400px}</style></head>
<body><div id="child" data-agent-native-node-id="child" style="position:absolute;left:24px;top:20px;width:60px;height:40px;background:#ef4444"></div></body></html>`;
      await page.setContent('<iframe id="preview"></iframe>');
      const frame = page
        .frames()
        .find((candidate) => candidate.parentFrame() === page.mainFrame());
      if (!frame) throw new Error("Preview iframe unavailable");
      await frame.setContent(html);
      await frame.addScriptTag({
        content: hydratedEditorChromeBridgeScript(),
      });
      await frame.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const child = frame.locator("#child");
      await expect
        .poll(() =>
          child.evaluate((element) => getComputedStyle(element).width),
        )
        .toBe("60px");
      await child.evaluate((element) => {
        const scale = (
          element.ownerDocument.defaultView as Window & {
            __designCanvasScaleContents?: (
              factor: number,
              phase: "begin" | "preview" | "cancel",
            ) => unknown;
          }
        ).__designCanvasScaleContents;
        if (!scale) throw new Error("K-scale bridge unavailable");
        scale(1, "begin");
        scale(1.5, "preview");
      });
      await expect
        .poll(() =>
          child.evaluate((element) => getComputedStyle(element).width),
        )
        .toBe("90px");

      await page.locator("#preview").evaluate((element) => {
        const frameWindow = (element as HTMLIFrameElement)
          .contentWindow as Window & {
          __designCanvasScaleContents?: (
            factor: number,
            phase: "cancel",
          ) => unknown;
        };
        frameWindow.__designCanvasScaleContents?.(1, "cancel");
      });
      await page.evaluate(
        ({ html }) => {
          const frameWindow = (
            document.querySelector("#preview") as HTMLIFrameElement | null
          )?.contentWindow;
          if (!frameWindow) throw new Error("Preview iframe unavailable");
          frameWindow.postMessage(
            {
              type: "replace-document-content",
              content: html,
              selectedSelector: '[data-agent-native-node-id="child"]',
              selectorCandidates: ['[data-agent-native-node-id="child"]'],
              forceFullDocument: true,
            },
            "*",
          );
        },
        { html },
      );
      await expect
        .poll(() =>
          child.evaluate((element) => getComputedStyle(element).width),
        )
        .toBe("60px");
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge K scaling preserves computed fixed and em geometry, responsive percentages, and non-length values",
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
  #card { position: absolute; left: 150px; top: 150px; width: 200px; height: 200px; font-size: 20px; }
  .fixed { position: absolute; left: 20px; top: 20px; width: 4em; height: 2em; padding: 1em; font-size: 20px; }
  .responsive { position: absolute; left: 50%; top: 10%; width: 50%; height: 50%; }
  #vector { position: absolute; left: 110px; top: 110px; width: 40px; height: 40px; }
</style></head><body>
  <div id="card" data-agent-native-node-id="card">
    <div class="fixed" data-agent-native-node-id="fixed" style="background-image:url('/assets/icon20px.png');content:'label 20px';--copy:'value 20px'"></div>
    <div class="responsive" data-agent-native-node-id="responsive"></div>
    <svg id="vector" data-agent-native-node-id="vector" viewBox="0 0 40 40">
      <rect id="vector-shape" data-agent-native-node-id="vector-shape" x="5" y="5" width="10" height="10" style="stroke-width:2px" />
      <text id="vector-text" x="0" y="30">abc</text>
    </svg>
  </div>
  <svg id="vector-native-oracle" aria-hidden="true" viewBox="0 0 40 40" style="position:absolute;left:700px;top:0;width:48px;height:48px;font-size:20px">
    <text id="vector-native-oracle-text" x="0" y="30">abc</text>
  </svg>
</body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        (window as unknown as { __scaleChanges: unknown[] }).__scaleChanges =
          [];
        window.addEventListener("message", (event) => {
          if (
            (event.data as { type?: string })?.type ===
            "visual-style-batch-change"
          ) {
            (
              window as unknown as { __scaleChanges: unknown[] }
            ).__scaleChanges.push(event.data);
          }
        });
        window.postMessage({ type: "scale-tool-mode", enabled: true }, "*");
      });
      await page.mouse.click(340, 340);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return overlay && window.getComputedStyle(overlay).display === "block";
      });

      const handle = page.locator('[data-agent-native-edit-handle="se"]');
      const bounds = await handle.boundingBox();
      if (!bounds) throw new Error("resize handle not found");
      const startX = bounds.x + bounds.width / 2;
      const startY = bounds.y + bounds.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 40, startY + 40, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const fixed = document.querySelector<HTMLElement>(".fixed")!;
        const responsive = document.querySelector<HTMLElement>(".responsive")!;
        return {
          fixed: {
            width: fixed.style.width,
            height: fixed.style.height,
            left: fixed.style.left,
            top: fixed.style.top,
            paddingTop: fixed.style.paddingTop,
            paddingRight: fixed.style.paddingRight,
            paddingBottom: fixed.style.paddingBottom,
            paddingLeft: fixed.style.paddingLeft,
            fontSize: fixed.style.fontSize,
            backgroundImage: fixed.style.backgroundImage,
            content: fixed.style.content,
            copy: fixed.style.getPropertyValue("--copy"),
          },
          responsive: {
            width: responsive.style.width,
            height: responsive.style.height,
            computedWidth: getComputedStyle(responsive).width,
          },
          vector: {
            width:
              document.querySelector<SVGSVGElement>("#vector")!.style.width,
            height:
              document.querySelector<SVGSVGElement>("#vector")!.style.height,
            left: document.querySelector<SVGSVGElement>("#vector")!.style.left,
            shapeWidth: document
              .querySelector<SVGRectElement>("#vector-shape")!
              .getAttribute("width"),
            shapeHeight: document
              .querySelector<SVGRectElement>("#vector-shape")!
              .getAttribute("height"),
            strokeWidth:
              document.querySelector<SVGRectElement>("#vector-shape")!.style
                .strokeWidth,
            renderedShapeWidth: document
              .querySelector<SVGRectElement>("#vector-shape")!
              .getBoundingClientRect().width,
            fontSize: getComputedStyle(
              document.querySelector<SVGSVGElement>("#vector")!,
            ).fontSize,
            textWidth: document
              .querySelector<SVGTextElement>("#vector-text")!
              .getBoundingClientRect().width,
            cardFontSize: getComputedStyle(
              document.querySelector<HTMLElement>("#card")!,
            ).fontSize,
          },
          nativeVector: {
            width: document
              .querySelector<SVGSVGElement>("#vector-native-oracle")!
              .getBoundingClientRect().width,
            height: document
              .querySelector<SVGSVGElement>("#vector-native-oracle")!
              .getBoundingClientRect().height,
            fontSize: getComputedStyle(
              document.querySelector<SVGSVGElement>("#vector-native-oracle")!,
            ).fontSize,
            textWidth: document
              .querySelector<SVGTextElement>("#vector-native-oracle-text")!
              .getBoundingClientRect().width,
          },
          vectorCommitted: (
            window as unknown as {
              __scaleChanges: Array<{ changes?: Array<{ selector: string }> }>;
            }
          ).__scaleChanges
            .flatMap((batch) => batch.changes ?? [])
            .some((change) => change.selector.includes("vector-shape")),
          batchCount: (window as unknown as { __scaleChanges: unknown[] })
            .__scaleChanges.length,
        };
      });
      expect(result.fixed).toEqual({
        width: "96px",
        height: "48px",
        left: "24px",
        top: "24px",
        paddingTop: "24px",
        paddingRight: "24px",
        paddingBottom: "24px",
        paddingLeft: "24px",
        fontSize: "24px",
        backgroundImage: 'url("/assets/icon20px.png")',
        content: '"label 20px"',
        copy: "'value 20px'",
      });
      expect(result.responsive).toEqual({
        width: "",
        height: "",
        computedWidth: "120px",
      });
      expect(result.vector).toMatchObject({
        width: "48px",
        height: "48px",
        left: "132px",
        shapeWidth: "10",
        shapeHeight: "10",
        strokeWidth: "2px",
        renderedShapeWidth: 12,
        fontSize: "20px",
        cardFontSize: "24px",
      });
      expect(result.nativeVector).toMatchObject({
        width: 48,
        height: 48,
        fontSize: "20px",
      });
      expect(result.vector.textWidth).toBe(result.nativeVector.textWidth);
      expect(result.vectorCommitted).toBe(false);
      expect(result.batchCount).toBe(1);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge scales a multi-selection from the group bounds handle, with the K tool scaling stroke and type too",
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
      .box {
        position: absolute; box-sizing: border-box;
        width: 100px; height: 100px;
        border: 2px solid #333; font-size: 16px;
      }
      #boxA { left: 100px; top: 100px; background: #6366f1; }
      #boxB { left: 300px; top: 100px; background: #22c55e; }
    </style>
  </head>
  <body>
    <div id="boxA" class="box" data-agent-native-node-id="boxA">A</div>
    <div id="boxB" class="box" data-agent-native-node-id="boxB">B</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.evaluate(() => {
        (window as unknown as { __styleChanges: unknown[] }).__styleChanges =
          [];
        (window as unknown as { __styleBatchCount: number }).__styleBatchCount =
          0;
        window.addEventListener("message", (event) => {
          const data = event.data as {
            type?: string;
            changes?: Array<{
              selector: string;
              sourceId?: string;
              styles: Record<string, string>;
            }>;
          };
          if (data?.type === "visual-style-change") {
            (
              window as unknown as { __styleChanges: unknown[] }
            ).__styleChanges.push(event.data);
          } else if (data?.type === "visual-style-batch-change") {
            const host = window as unknown as {
              __styleBatchCount: number;
              __styleChanges: unknown[];
            };
            host.__styleBatchCount += 1;
            (
              window as unknown as { __styleChanges: unknown[] }
            ).__styleChanges.push(...(data.changes ?? []));
          }
        });
        window.postMessage({ type: "scale-tool-mode", enabled: true }, "*");
      });

      await page.mouse.click(150, 150);
      await page.keyboard.down("Shift");
      await page.mouse.click(350, 150);
      await page.keyboard.up("Shift");
      await page.waitForFunction(() => {
        const bounds = document.querySelector<HTMLElement>(
          "[data-agent-native-multi-selection-bounds]",
        );
        return bounds && window.getComputedStyle(bounds).display === "block";
      });

      const seHandle = page.locator(
        "[data-agent-native-multi-selection-bounds] [data-corner='se']",
      );
      const seBox = await seHandle.boundingBox();
      if (!seBox) throw new Error("group handle not found");
      const handleX = seBox.x + seBox.width / 2;
      const handleY = seBox.y + seBox.height / 2;
      await page.mouse.move(handleX, handleY);
      await page.mouse.down();
      await page.mouse.move(handleX - 150, handleY, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const a = document.querySelector<HTMLElement>("#boxA")!;
        const b = document.querySelector<HTMLElement>("#boxB")!;
        const changes = (
          window as unknown as {
            __styleChanges: Array<{
              selector: string;
              sourceId?: string;
              styles: Record<string, string>;
            }>;
          }
        ).__styleChanges;
        const batchCount = (window as unknown as { __styleBatchCount: number })
          .__styleBatchCount;
        return {
          a: {
            left: a.style.left,
            top: a.style.top,
            width: a.style.width,
            height: a.style.height,
            borderWidth: a.style.borderWidth,
            fontSize: a.style.fontSize,
          },
          b: { left: b.style.left, width: b.style.width },
          committedChanges: changes,
          batchCount,
        };
      });

      expect(result.a.left).toBe("100px");
      expect(result.a.top).toBe("100px");
      expect(result.a.width).toBe("50px");
      expect(result.a.height).toBe("50px");
      expect(result.a.borderWidth).toBe("1px");
      expect(result.a.fontSize).toBe("8px");
      expect(result.b.left).toBe("200px");
      expect(result.b.width).toBe("50px");
      expect(result.batchCount).toBe(1);
      expect(result.committedChanges).toHaveLength(2);
      expect(result.committedChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceId: "boxA",
            styles: expect.objectContaining({
              "border-width": "1px 1px 1px 1px",
              "font-size": "8px",
            }),
          }),
          expect.objectContaining({
            sourceId: "boxB",
            styles: expect.objectContaining({
              "border-width": "1px 1px 1px 1px",
              "font-size": "8px",
            }),
          }),
        ]),
      );
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge group scale keeps a rotated member centred and restores an in-flow member on Escape",
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
      #anchorBox {
        position: absolute; box-sizing: border-box;
        left: 100px; top: 100px; width: 100px; height: 100px;
        background: #6366f1;
      }
      #spun {
        position: absolute; box-sizing: border-box;
        left: 300px; top: 100px; width: 100px; height: 100px;
        background: #22c55e; transform: rotate(45deg);
      }
      #flow { margin: 400px 0 0 20px; width: 60px; height: 20px; background: #f59e0b; }
    </style>
  </head>
  <body>
    <div id="anchorBox" data-agent-native-node-id="anchorBox">A</div>
    <div id="spun" data-agent-native-node-id="spun">B</div>
    <div id="flow" data-agent-native-node-id="flow">C</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        window.postMessage({ type: "scale-tool-mode", enabled: true }, "*");
      });

      const groupHandle = page.locator(
        "[data-agent-native-multi-selection-bounds] [data-corner='se']",
      );

      await page.mouse.click(150, 150);
      await page.keyboard.down("Shift");
      await page.mouse.click(50, 410);
      await page.keyboard.up("Shift");
      await page.waitForFunction(() => {
        const bounds = document.querySelector<HTMLElement>(
          "[data-agent-native-multi-selection-bounds]",
        );
        return bounds && window.getComputedStyle(bounds).display === "block";
      });
      const flowHandleBox = (await groupHandle.boundingBox())!;
      await page.mouse.move(
        flowHandleBox.x + flowHandleBox.width / 2,
        flowHandleBox.y + flowHandleBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        flowHandleBox.x + flowHandleBox.width / 2 - 40,
        flowHandleBox.y + flowHandleBox.height / 2 - 40,
        { steps: 6 },
      );
      await page.keyboard.press("Escape");
      await page.mouse.up();

      const flowAfterEscape = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>("#flow")!;
        return {
          position: el.style.position,
          left: el.style.left,
          width: el.style.width,
        };
      });
      expect(flowAfterEscape).toEqual({ position: "", left: "", width: "" });

      await page.mouse.click(600, 600);
      await page.mouse.click(150, 150);
      await page.keyboard.down("Shift");
      await page.mouse.click(350, 150);
      await page.keyboard.up("Shift");
      await page.waitForFunction(() => {
        const bounds = document.querySelector<HTMLElement>(
          "[data-agent-native-multi-selection-bounds]",
        );
        return bounds && window.getComputedStyle(bounds).display === "block";
      });

      const before = await page.evaluate(() => {
        const rect = document
          .querySelector<HTMLElement>("#spun")!
          .getBoundingClientRect();
        return { centerX: rect.left + rect.width / 2 };
      });
      const spunHandleBox = (await groupHandle.boundingBox())!;
      const startX = spunHandleBox.x + spunHandleBox.width / 2;
      const startY = spunHandleBox.y + spunHandleBox.height / 2;
      const groupBounds = (await page
        .locator("[data-agent-native-multi-selection-bounds]")
        .boundingBox())!;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 100, startY, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const after = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>("#spun")!;
        const rect = el.getBoundingClientRect();
        return {
          centerX: rect.left + rect.width / 2,
          width: el.style.width,
          transform: window.getComputedStyle(el).transform,
        };
      });
      const factor = (groupBounds.width - 100) / groupBounds.width;
      const expectedCenterX =
        groupBounds.x + (before.centerX - groupBounds.x) * factor;
      expect(Math.abs(after.centerX - expectedCenterX)).toBeLessThan(3);
      expect(Number.parseFloat(after.width)).toBeCloseTo(100 * factor, 2);
      expect(after.transform).not.toBe("none");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge resize seeds the origin from rendered pixels for every non-px CSS width/height unit (%, vw/vh, rem, em, calc)",
  { timeout: 60_000 },
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
        await selectElementDirect(page, "#target");

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
        await selectElementDirect(page, "#target");

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

it(
  "editor chrome bridge SE-corner resize of a width:100% element grows width from its rendered size, not from a shrunk parsed-percentage value",
  { timeout: 60_000 },
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
      expect(renderedBefore.width).toBeCloseTo(500, 0);
      expect(renderedBefore.height).toBeCloseTo(160, 0);

      await selectElementDirect(page, "#target");

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
      expect(after.height).toBe("190px");
      expect(after.width).not.toBe("150px");
      expect(after.renderedWidth).toBeGreaterThan(500);
      expect(after.renderedWidth).toBeCloseTo(550, 0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge resize commits only the axis the user actually dragged, leaving a percentage width untouched on a pure vertical drag",
  { timeout: 60_000 },
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

      await selectElementDirect(page, "#target");

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
      expect(after.height).toBe("190px");
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

      await page.mouse.click(220, 170);
      await page.waitForFunction(() => {
        const sel = document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        ) as HTMLElement | null;
        return !!sel && sel.style.display === "block";
      });

      const beforeMoveRect = await page.evaluate(() => {
        const r = document.getElementById("card")!.getBoundingClientRect();
        return { left: r.left, top: r.top };
      });
      await page.mouse.move(210, 170);
      await page.mouse.down();
      await page.mouse.move(250, 175, { steps: 5 });
      await page.mouse.up();

      const afterMoveStyle = await page.locator("#card").getAttribute("style");
      expect(afterMoveStyle).not.toMatch(/padding/);
      const afterMoveRect = await page.evaluate(() => {
        const r = document.getElementById("card")!.getBoundingClientRect();
        return { left: r.left, top: r.top };
      });
      expect(afterMoveRect.left).not.toBe(beforeMoveRect.left);
      expect(afterMoveRect.top).not.toBe(beforeMoveRect.top);

      const cardRect = await page.evaluate(() => {
        const r = document.getElementById("card")!.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      const midX = cardRect.left + cardRect.width / 2;
      const lineY = cardRect.top + 24;

      await page.mouse.move(midX, lineY);
      await page.waitForTimeout(80);
      await page.mouse.down();
      await page.mouse.move(midX, lineY + 20, { steps: 5 });
      await page.mouse.up();

      const afterPaddingDragStyle = await page
        .locator("#card")
        .getAttribute("style");
      expect(afterPaddingDragStyle).toMatch(/padding-top:\s*68px/);
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
      await selectElementDirect(page, '[data-agent-native-node-id="item1"]');

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
      await selectElementDirect(page, '[data-agent-native-node-id="chip"]');
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
      expect(chipZoneState.covering).toEqual([]);
      expect(chipZoneState.topmostIsHandle).toBe(false);

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
        const s = 1 / Math.max(0.05, 0.19);
        const probe = document.createElement("span");
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
    "clears the native selection when a text edit blurs",
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
          target.focus();
          const range = document.createRange();
          range.selectNodeContents(target);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
        });
        await page.evaluate(() => {
          (
            document.querySelector(
              "[data-agent-native-text-editing]",
            ) as HTMLElement
          ).blur();
        });
        await page.waitForTimeout(30);

        const state = await page.evaluate(() => ({
          editing: Boolean(
            document.querySelector("[data-agent-native-text-editing]"),
          ),
          rangeCount: window.getSelection()?.rangeCount ?? 0,
        }));
        expect(state.editing).toBe(false);
        expect(state.rangeCount).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "blurs an active text edit when bridge reconfiguration disables text editing",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        await beginTextEditOnTarget(page);

        await page.evaluate(() => {
          const bridge = (window as any).__anEditorChromeBridgeInstance;
          if (!bridge || typeof bridge.updateConfig !== "function") {
            throw new Error("missing editor chrome config updater");
          }
          bridge.updateConfig({
            readOnly: false,
            textEditingEnabled: false,
          });
        });
        await page.waitForSelector("[data-agent-native-text-editing]", {
          state: "detached",
        });
        const restoredChrome = await page.evaluate(() => ({
          shieldPointerEvents: (
            document.querySelector(
              '[data-agent-native-edit-overlay="shield"]',
            ) as HTMLElement
          ).style.pointerEvents,
          visibleHandles: Array.from(
            document.querySelectorAll(
              "[data-agent-native-edge-handle],[data-agent-native-edit-handle],[data-agent-native-rotate-handle],[data-agent-native-radius-handle]",
            ),
          ).filter((handle) => getComputedStyle(handle).display !== "none")
            .length,
        }));
        expect(restoredChrome.shieldPointerEvents).toBe("auto");
        expect(restoredChrome.visibleHandles).toBeGreaterThan(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "keeps native text selection available when the host replays editable state",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        await beginTextEditOnTarget(page);
        await page.evaluate(() => {
          const bridge = (window as any).__anEditorChromeBridgeInstance;
          bridge.updateConfig({ readOnly: false, textEditingEnabled: true });
        });
        const reconfiguredState = await page.evaluate(() => ({
          shieldPointerEvents: (
            document.querySelector(
              '[data-agent-native-edit-overlay="shield"]',
            ) as HTMLElement
          ).style.pointerEvents,
          visibleHandles: Array.from(
            document.querySelectorAll(
              "[data-agent-native-edge-handle],[data-agent-native-edit-handle],[data-agent-native-rotate-handle],[data-agent-native-radius-handle]",
            ),
          ).filter((handle) => getComputedStyle(handle).display !== "none")
            .length,
        }));
        expect(reconfiguredState).toEqual({
          shieldPointerEvents: "none",
          visibleHandles: 0,
        });
        await page.evaluate(() => {
          window.postMessage({ type: "set-read-only", readOnly: false }, "*");
        });

        const points = await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>("#target")!;
          const text = target.firstChild!;
          const range = document.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 5);
          const bounds = range.getBoundingClientRect();
          return {
            startX: bounds.left + 0.5,
            endX: bounds.right - 0.5,
            y: bounds.top + bounds.height / 2,
            hit: document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
            )?.id,
            shieldPointerEvents: (
              document.querySelector(
                '[data-agent-native-edit-overlay="shield"]',
              ) as HTMLElement
            ).style.pointerEvents,
          };
        });
        expect(points.hit).toBe("target");
        expect(points.shieldPointerEvents).toBe("none");
        const visibleHandles = await page.evaluate(
          () =>
            Array.from(
              document.querySelectorAll(
                "[data-agent-native-edge-handle],[data-agent-native-edit-handle],[data-agent-native-rotate-handle],[data-agent-native-radius-handle]",
              ),
            ).filter((handle) => getComputedStyle(handle).display !== "none")
              .length,
        );
        expect(visibleHandles).toBe(0);
        await page.mouse.move(points.startX, points.y);
        await page.mouse.down();
        await page.mouse.move(points.endX, points.y, { steps: 4 });
        await page.mouse.up();

        await expect
          .poll(() =>
            page.evaluate(() => window.getSelection()?.toString() ?? ""),
          )
          .toBe("Hello");
        const state = await page.evaluate(() => ({
          editing: Boolean(
            document.querySelector("[data-agent-native-text-editing]"),
          ),
          focused:
            document.activeElement ===
            document.querySelector("[data-agent-native-text-editing]"),
          shieldPointerEvents: (
            document.querySelector(
              '[data-agent-native-edit-overlay="shield"]',
            ) as HTMLElement
          ).style.pointerEvents,
        }));
        expect(state).toEqual({
          editing: true,
          focused: true,
          shieldPointerEvents: "none",
        });
        await page.locator("#target").evaluate((target) => {
          (target as HTMLElement).blur();
        });
        await expect
          .poll(() =>
            page.evaluate(() =>
              Boolean(
                document.querySelector("[data-agent-native-text-editing]"),
              ),
            ),
          )
          .toBe(false);
        const restoredChrome = await page.evaluate(() => ({
          shieldPointerEvents: (
            document.querySelector(
              '[data-agent-native-edit-overlay="shield"]',
            ) as HTMLElement
          ).style.pointerEvents,
          visibleHandles: Array.from(
            document.querySelectorAll(
              "[data-agent-native-edge-handle],[data-agent-native-edit-handle],[data-agent-native-rotate-handle],[data-agent-native-radius-handle]",
            ),
          ).filter((handle) => getComputedStyle(handle).display !== "none")
            .length,
        }));
        expect(restoredChrome.shieldPointerEvents).toBe("auto");
        expect(restoredChrome.visibleHandles).toBeGreaterThan(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "clears the native selection when the host deselects the text element",
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
        await page.evaluate(() => {
          window.postMessage({ type: "clear-selection" }, "*");
        });
        await page.waitForFunction(
          () => window.getSelection()?.rangeCount === 0,
        );

        const state = await page.evaluate(() => ({
          editing: Boolean(
            document.querySelector("[data-agent-native-text-editing]"),
          ),
          rangeCount: window.getSelection()?.rangeCount ?? 0,
        }));
        expect(state.editing).toBe(true);
        expect(state.rangeCount).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T26: truncated text expands only for the edit session and restores its layout",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        const before = await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>("#target")!;
          target.textContent =
            "A title with enough words to continue onto several lines while editing";
          target.style.width = "182px";
          target.style.height = "21px";
          target.style.minWidth = "0px";
          target.style.minHeight = "0px";
          target.style.fontSize = "16px";
          target.style.whiteSpace = "normal";
          target.style.display = "-webkit-box";
          target.style.overflow = "hidden";
          target.style.setProperty("-webkit-box-orient", "vertical");
          target.style.setProperty("-webkit-line-clamp", "1");
          target.style.transform = "scale(1.25)";
          target.style.transformOrigin = "top left";
          const bounds = target.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        });
        await beginTextEditOnTarget(page);

        const editing = await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>("#target")!;
          const bounds = target.getBoundingClientRect();
          const computed = window.getComputedStyle(target);
          return {
            width: bounds.width,
            height: bounds.height,
            lineClamp: computed.getPropertyValue("-webkit-line-clamp"),
            overflow: computed.overflow,
            scrollHeight: target.scrollHeight,
            clientHeight: target.clientHeight,
            contenteditable: target.getAttribute("contenteditable"),
          };
        });
        expect(editing.contenteditable).toBe("true");
        expect(editing.lineClamp).toBe("none");
        expect(editing.overflow).toBe("visible");
        expect(editing.width).toBe(before.width);
        expect(editing.height).toBe(before.height);
        expect(editing.scrollHeight).toBeGreaterThan(editing.clientHeight);

        await page.keyboard.press("Escape");
        await page.waitForTimeout(30);
        const after = await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>("#target")!;
          const bounds = target.getBoundingClientRect();
          const computed = window.getComputedStyle(target);
          return {
            width: bounds.width,
            height: bounds.height,
            lineClamp: computed.getPropertyValue("-webkit-line-clamp"),
            overflow: computed.overflow,
            contenteditable: target.getAttribute("contenteditable"),
          };
        });
        expect(after.contenteditable).toBeNull();
        expect(after.lineClamp).toBe("1");
        expect(after.overflow).toBe("hidden");
        expect(after.width).toBe(before.width);
        expect(after.height).toBe(before.height);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "T27: inspector Enter resumes the same selected text range",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const { page, pageErrors } = await launchTextEditPage(browser);
        await collectBridgeMessages(page);
        await beginTextEditOnTarget(page);
        await page.evaluate(async () => {
          const target = document.querySelector<HTMLElement>("#target")!;
          const text = target.firstChild!;
          const range = document.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 5);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
          window.postMessage(
            { type: "text-edit-inspector-focus", focused: true },
            "*",
          );
          await new Promise((resolve) => window.setTimeout(resolve, 0));
          target.blur();
        });
        await page.waitForSelector("[data-agent-native-text-editing]", {
          state: "detached",
          timeout: 5_000,
        });
        await page.waitForFunction(() =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: any) =>
              message.type === "text-editing-state" &&
              message.active === false &&
              message.hasRange === true,
          ),
        );
        const suspendedStates = (await readBridgeMessages(page)).filter(
          (message) =>
            message.type === "text-editing-state" &&
            (message as any).active === false &&
            (message as any).hasRange === true,
        );
        const suspendedState = suspendedStates[suspendedStates.length - 1] as
          | { selector?: string; sourceId?: string }
          | undefined;
        expect(suspendedState?.selector).toBeTruthy();
        expect(suspendedState?.sourceId).toBe("target");

        await page.evaluate((selector) => {
          (window as any).__bridgeMessages = [];
          window.postMessage(
            {
              type: "style-change",
              selector,
              selectorCandidates: [selector],
              property: "lineHeight",
              value: "20%",
            },
            "*",
          );
        }, suspendedState!.selector!);
        await page.waitForFunction(() =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: any) => message.type === "text-content-change",
          ),
        );
        const styledRange = await page.locator("#target").evaluate((target) => {
          const span = target.querySelector("span");
          return {
            text: span?.textContent,
            lineHeight: span?.style.lineHeight,
            editing: target.getAttribute("contenteditable"),
          };
        });
        expect(styledRange).toEqual({
          text: "Hello",
          lineHeight: "20%",
          editing: null,
        });

        await page.evaluate(
          ({ selector, sourceId }) => {
            window.postMessage(
              {
                type: "resume-text-edit",
                screenId: "another-screen",
                selector,
                sourceId,
              },
              "*",
            );
          },
          {
            selector: suspendedState!.selector!,
            sourceId: suspendedState!.sourceId,
          },
        );
        await page.waitForTimeout(10);
        expect(
          await page.locator("#target").getAttribute("contenteditable"),
        ).toBeNull();

        await page.evaluate(
          async ({ selector, sourceId }) => {
            window.postMessage(
              { type: "set-text-editing-enabled", enabled: false },
              "*",
            );
            await new Promise((resolve) => window.setTimeout(resolve, 0));
            window.postMessage(
              {
                type: "resume-text-edit",
                screenId: "bridge-guard",
                selector,
                sourceId,
              },
              "*",
            );
          },
          {
            selector: suspendedState!.selector!,
            sourceId: suspendedState!.sourceId,
          },
        );
        await page.waitForTimeout(10);
        expect(
          await page.locator("#target").getAttribute("contenteditable"),
        ).toBeNull();

        await page.evaluate(async () => {
          window.postMessage(
            { type: "set-text-editing-enabled", enabled: true },
            "*",
          );
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        });
        await page.evaluate(
          ({ selector, sourceId }) => {
            window.postMessage(
              {
                type: "resume-text-edit",
                screenId: "bridge-guard",
                selector,
                sourceId,
              },
              "*",
            );
          },
          {
            selector: suspendedState!.selector!,
            sourceId: suspendedState!.sourceId,
          },
        );
        await page.waitForFunction(
          () =>
            document
              .querySelector("#target")
              ?.getAttribute("contenteditable") === "true",
          undefined,
          { timeout: 5_000 },
        );
        const resumedRange = await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>("#target")!;
          const selection = window.getSelection()!;
          return {
            active: document.activeElement === target,
            selectedText: selection.toString(),
            hasRange: selection.rangeCount > 0,
          };
        });
        expect(resumedRange).toEqual({
          active: true,
          selectedText: "Hello",
          hasRange: true,
        });

        await page.keyboard.press("ArrowRight");
        const afterArrow = await page.evaluate(() => {
          const selection = window.getSelection()!;
          return {
            collapsed: selection.isCollapsed,
            selectedText: selection.toString(),
          };
        });
        expect(afterArrow).toEqual({ collapsed: true, selectedText: "" });
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
    "hands range-only live formatting to the host with its relative source operation",
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
          const text = target.firstChild!;
          const range = document.createRange();
          range.setStart(text, 6);
          range.setEnd(text, 11);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          (window as any).__rangeHandoffs = [];
          window.addEventListener("message", (event) => {
            if (event.data?.type === "text-content-change") {
              (window as any).__rangeHandoffs.push(event.data);
            }
          });
          window.postMessage(
            {
              type: "style-change",
              selector: '[data-agent-native-node-id="target"]',
              selectorCandidates: ['[data-agent-native-node-id="target"]'],
              property: "fontSize",
              value: "22px",
              relativeOperation: {
                kind: "expression",
                expression: "+2",
                unit: "px",
              },
            },
            "*",
          );
          window.postMessage(
            {
              type: "style-change",
              selector: '[data-agent-native-node-id="target"]',
              selectorCandidates: ['[data-agent-native-node-id="target"]'],
              property: "letterSpacing",
              value: "1px",
              relativeOperation: {
                kind: "delta",
                delta: 1,
              },
            },
            "*",
          );
        });
        await page.waitForFunction(
          () => (window as any).__rangeHandoffs?.length === 2,
        );
        const result = await page.evaluate(() => {
          const target = document.querySelector("#target")!;
          const spans = Array.from(target.querySelectorAll("span"));
          return {
            html: target.innerHTML,
            spanCount: spans.length,
            text: target.textContent,
            targetFontSize: getComputedStyle(target).fontSize,
            selectedFontSize: spans[0]
              ? getComputedStyle(spans[0]).fontSize
              : null,
            handoffs: (window as any).__rangeHandoffs,
          };
        });
        expect(result.spanCount).toBe(1);
        expect(result.text).toBe("Hello world");
        expect(result.targetFontSize).not.toBe("22px");
        expect(result.selectedFontSize).toBe("22px");
        expect(result.html).toContain("font-size: 22px");
        expect(result.html).toContain("letter-spacing: 1px");
        expect(result.handoffs).toHaveLength(2);
        expect(result.handoffs[0].relativeOperations).toEqual({
          fontSize: {
            kind: "expression",
            expression: "+2",
            unit: "px",
          },
        });
        expect(result.handoffs[0].html).toContain("Hello ");
        expect(result.handoffs[0].html).toContain("world");
        expect(result.handoffs[1].relativeOperations).toEqual({
          letterSpacing: { kind: "delta", delta: 1 },
        });
        expect(result.handoffs[1].html).toContain("Hello ");
        expect(result.handoffs[1].html).toContain("world");
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

        await page.keyboard.type(" typed");
        await page.waitForTimeout(20);

        const listenerCountBefore = await page.evaluate(() => {
          const w = window as any;
          w.__selectionChangeCount = w.__selectionChangeCount || 0;
          return w.__selectionChangeCount;
        });

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

        expect(wrapperColor).not.toBe("rgb(255, 0, 0)");
        expect(leafHasRangeStyle).toBe("rgb(255, 0, 0)");

        await page.evaluate(() => {
          (window as any).__rangeStyleStates = [];
          window.addEventListener("message", (event: MessageEvent) => {
            if (
              event.data?.type === "text-editing-state" &&
              event.data.hasRange
            ) {
              (window as any).__rangeStyleStates.push(event.data);
            }
          });
        });
        const expectRangeSnapshot = async (property: string, value: string) => {
          const count = await page.evaluate(
            () => (window as any).__rangeStyleStates.length,
          );
          await page.evaluate(
            ({ styleProperty, styleValue }) => {
              window.postMessage(
                {
                  type: "style-change",
                  selector: '[data-agent-native-node-id="wrapper"]',
                  selectorCandidates: ['[data-agent-native-node-id="wrapper"]'],
                  property: styleProperty,
                  value: styleValue,
                },
                "*",
              );
            },
            { styleProperty: property, styleValue: value },
          );
          await page.waitForFunction(
            ({ previousCount, styleProperty, styleValue }) => {
              const states = (window as any).__rangeStyleStates ?? [];
              const latest = states[states.length - 1];
              return (
                states.length > previousCount &&
                latest?.computedStyles?.[styleProperty] === styleValue
              );
            },
            {
              previousCount: count,
              styleProperty: property,
              styleValue: value,
            },
          );
          const state = await page.evaluate(() => {
            const states = (window as any).__rangeStyleStates ?? [];
            return states[states.length - 1];
          });
          expect(state.active).toBe(true);
          expect(state.hasRange).toBe(true);
          expect(state.computedStyles?.[property]).toBe(value);
        };

        await expectRangeSnapshot("fontSize", "24px");
        await expectRangeSnapshot("fontWeight", "600");
        await expectRangeSnapshot("fontFamily", "monospace");
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

        const keystrokeCount = 12;
        await page.evaluate((count) => {
          const target = document.querySelector<HTMLElement>(
            "[data-agent-native-text-editing]",
          )!;
          for (let i = 0; i < count; i += 1) {
            target.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }, keystrokeCount);

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

        await page.mouse.click(50, 50);
        await page.waitForTimeout(30);
        const shieldRestored = await page.evaluate(
          () =>
            document.querySelector<HTMLElement>(
              '[data-agent-native-edit-overlay="shield"]',
            )!.style.pointerEvents,
        );
        expect(shieldRestored).not.toBe("none");

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

it(
  "editor chrome bridge rotation drag preserves computed transform from a class rule",
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
      /* Transform lives ONLY in a class rule — no inline style on the element. */
      .rotated-box {
        position: absolute;
        left: 200px; top: 200px;
        width: 100px; height: 100px;
        background: #e0e;
        transform: rotate(30deg);
        transform-origin: center center;
      }
    </style>
  </head>
  <body>
    <div class="rotated-box" data-agent-native-node-id="rotated">Rotated</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.mouse.click(250, 250);
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        return !!overlay && overlay.style.display === "block";
      });

      const rotationChrome = await page.evaluate(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        )!;
        const button = overlay.querySelector<HTMLElement>(
          '[data-agent-native-rotate-handle="top-center"]',
        )!;
        return {
          hasVisibleRotateButton: Boolean(button),
          left: parseFloat(overlay.style.left),
          top: parseFloat(overlay.style.top),
          width: parseFloat(overlay.style.width),
          height: parseFloat(overlay.style.height),
        };
      });
      expect(rotationChrome).toEqual({
        hasVisibleRotateButton: false,
        left: 200,
        top: 200,
        width: 100,
        height: 100,
      });

      await collectBridgeMessages(page);

      const nwHandle = page
        .locator('[data-agent-native-rotate-handle="nw"]')
        .first();
      const handleBox = await nwHandle.boundingBox();
      if (!handleBox) throw new Error("nw rotate handle not visible");

      const overlayCenter = await page.evaluate(() => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        )!;
        const r = overlay.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      });

      const hx = handleBox.x + handleBox.width / 2;
      const hy = handleBox.y + handleBox.height / 2;
      const { cx, cy } = overlayCenter;
      const startAngle = Math.atan2(hy - cy, hx - cx);
      const endAngle = startAngle + (15 * Math.PI) / 180;
      const r = Math.hypot(hx - cx, hy - cy) || 60;
      const endX = cx + r * Math.cos(endAngle);
      const endY = cy + r * Math.sin(endAngle);

      await page.mouse.move(hx, hy);
      await page.mouse.down();
      await page.mouse.move(endX, endY, { steps: 4 });
      await page.mouse.up();

      await page.waitForTimeout(100);

      const messages = await readBridgeMessages(page);
      const styleChange = messages.find(
        (m) => m.type === "visual-style-change",
      ) as { styles?: { transform?: string } } | undefined;

      expect(styleChange).toBeTruthy();
      expect(styleChange!.styles?.transform).toBeTruthy();

      const transform = styleChange!.styles!.transform!;
      expect(transform).toMatch(/rotate\(/i);

      const match = transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/i);
      expect(match).toBeTruthy();
      const deg = parseFloat(match![1]);
      expect(deg).toBeGreaterThanOrEqual(40);
      expect(deg).toBeLessThanOrEqual(50);

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge maps radius drags through rotated and independently scaled ancestors",
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
      .rotated-parent {
        position: absolute;
        left: 440px;
        top: 100px;
        width: 360px;
        height: 360px;
        transform-origin: 0 0;
        transform: rotate(90deg);
        scale: 2 3;
      }
      #target {
        position: absolute;
        left: 20px;
        top: 20px;
        width: 100px;
        height: 60px;
        border-top-left-radius: 20px;
        background: #6366f1;
      }
    </style>
  </head>
  <body>
    <div class="rotated-parent" data-agent-native-node-id="parent">
      <div id="target" data-agent-native-node-id="target"></div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);
      await selectElementDirect(page, "#target");

      const handle = page.locator('[data-agent-native-radius-handle="nw"]');
      await page.waitForFunction(() => {
        const handle = document.querySelector<HTMLElement>(
          '[data-agent-native-radius-handle="nw"]',
        );
        return handle && window.getComputedStyle(handle).display === "block";
      });
      const handleBox = await handle.boundingBox();
      if (!handleBox) throw new Error("nw radius handle not visible");

      await page.mouse.move(
        handleBox.x + handleBox.width / 2,
        handleBox.y + handleBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        handleBox.x + handleBox.width / 2 + 12,
        handleBox.y + handleBox.height / 2,
        { steps: 4 },
      );
      await page.mouse.up();
      const radius = await page.evaluate(
        () =>
          document.querySelector<HTMLElement>("#target")!.style
            .borderTopLeftRadius,
      );
      const messages = await readBridgeMessages(page);
      const styleChange = messages.find(
        (message) => message.type === "visual-style-change",
      );
      expect(radius).toBe("20px 14px");
      expect(styleChange).toMatchObject({
        styles: { borderTopLeftRadius: "20px 14px" },
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

function collectBridgeMessages(
  page: import("@playwright/test").Page,
  options: { grantSnapshotReservations?: boolean } = {},
) {
  return page.evaluate(({ grantSnapshotReservations }) => {
    (window as any).__bridgeMessages = [];
    window.addEventListener("message", (event: MessageEvent) => {
      (window as any).__bridgeMessages.push(event.data);
      if (
        grantSnapshotReservations !== false &&
        event.source === window &&
        event.data?.type ===
          "agent-native:runtime-layer-snapshot-reservation-request"
      ) {
        window.postMessage(
          {
            type: "grant-runtime-layer-snapshot-reservation",
            requestId: event.data.requestId,
            documentId: event.data.documentId,
            reservationToken: `test-reservation-${event.data.requestId}`,
          },
          "*",
        );
      }
    });
  }, options);
}

async function readBridgeMessages(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      new Promise<Array<Record<string, unknown>>>((resolve) => {
        const sentinel = `__bridge-read-${Math.random()}`;
        const onMessage = (event: MessageEvent) => {
          if (event.data?.type !== sentinel) return;
          window.removeEventListener("message", onMessage);
          const messages = (window as any).__bridgeMessages as Array<
            Record<string, unknown>
          >;
          for (let index = messages.length - 1; index >= 0; index -= 1) {
            if (messages[index]?.type === sentinel) messages.splice(index, 1);
          }
          resolve([...messages]);
        };
        window.addEventListener("message", onMessage);
        window.postMessage({ type: sentinel }, "*");
      }),
  );
}

// Selects `selector` directly via the bridge's `select-element` postMessage
// instead of a plain click. Plain clicks now resolve container-first (Figma
// parity — containerFirstSelectionTarget): clicking a descendant nested more
// than one level below the current container scope (the screen root, i.e.
// document.body, by default) selects that scope's direct child on the path
// to the pointer, not the descendant itself. A setup that needs a specific
// nested element selected — to drag/resize/etc. THAT element rather than its
// wrapping container — must select it explicitly.
//
// Waits for the overlay to actually match the target's CURRENT rect, not
// just for display:block — a re-select of the element that is ALREADY the
// selection (e.g. re-selecting after changing its size) never flips display,
// so that alone resolves immediately against the stale, pre-change geometry
// and races the postMessage's async delivery.
async function selectElementDirect(
  page: import("@playwright/test").Page,
  selector: string,
) {
  await page.evaluate((sel) => {
    window.postMessage({ type: "select-element", selector: sel }, "*");
  }, selector);
  await page.waitForFunction((sel) => {
    const overlay = document.querySelector<HTMLElement>(
      '[data-agent-native-edit-overlay="selection"]',
    );
    const target = document.querySelector(sel);
    if (!overlay || !target) return false;
    if (window.getComputedStyle(overlay).display !== "block") return false;
    const targetRect = target.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    return (
      Math.abs(overlayRect.width - targetRect.width) < 2 &&
      Math.abs(overlayRect.height - targetRect.height) < 2
    );
  }, selector);
}

it(
  "editor chrome bridge nests a dragged rectangle into a plain rectangle target as a free child (no auto-layout conversion)",
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
      await page.mouse.move(460, 220, { steps: 8 });

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
          draggedPosition: window.getComputedStyle(dragged).position,
        };
      });

      expect(result.draggedParentId).toBe("frame");
      expect(result.frameDisplay).toBe("block");
      expect(result.draggedPosition).toBe("absolute");

      const messages = await readBridgeMessages(page);
      const frameFlexMessage = messages.find(
        (m) =>
          m.type === "visual-style-change" &&
          (m as any).selector?.includes("frame") &&
          (m as any).styles?.display === "flex",
      );
      const structureMessage = messages.find(
        (m) => m.type === "visual-structure-change",
      ) as any;
      expect(frameFlexMessage).toBeFalsy();
      expect(structureMessage).toBeTruthy();
      expect(structureMessage.dropMode).toBe("absolute-container");
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
        "block",
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
          labelPosition: window.getComputedStyle(label).position,
        };
      });

      expect(result.labelParentId).toBe("frame");
      expect(result.frameDisplay).toBe("block");
      expect(result.labelPosition).toBe("absolute");

      const messages = await readBridgeMessages(page);
      const structureMessage = messages.find(
        (m) => m.type === "visual-structure-change",
      ) as any;
      expect(structureMessage).toBeTruthy();
      expect(structureMessage.dropMode).toBe("absolute-container");
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
    <div id="container" data-an-primitive="frame" data-agent-native-node-id="container"></div>
    <div id="note" data-agent-native-node-id="note">Note</div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
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
          containerPaddingLeft: containerRect.left + 2,
          containerPaddingTop: containerRect.top + 2,
        };
      });

      expect(result.parentId).toBe("container");
      expect(result.position).toBe("absolute");
      expect(Math.abs(result.rectLeft - preDropRect.left)).toBeLessThan(1);
      expect(Math.abs(result.rectTop - preDropRect.top)).toBeLessThan(1);
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

      await selectElementDirect(page, '[data-agent-native-node-id="note"]');
      await page.mouse.move(382, 302);
      await page.mouse.down();
      await page.mouse.move(392, 312);
      await page.mouse.move(420, 190);

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
          innerPaddingLeft: innerRect.left + 2,
          innerPaddingTop: innerRect.top + 2,
        };
      });

      expect(result.parentId).toBe("inner");
      expect(result.position).toBe("absolute");
      expect(Math.abs(result.rectLeft - preDropRect.left)).toBeLessThan(1);
      expect(Math.abs(result.rectTop - preDropRect.top)).toBeLessThan(1);
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

      await page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>("#frame")!;
        frame.style.display = "flex";
        frame.style.flexDirection = "column";
        frame.style.gap = "8px";
      });

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
      await page.mouse.move(400, 175, { steps: 8 });

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
          position: window.getComputedStyle(dragged).position,
          left: dragged.style.left,
          top: dragged.style.top,
        };
      });

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

it(
  "editor chrome bridge un-nests an absolute child dropped outside its clipped frame onto the screen",
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
        position: absolute; left: 40px; top: 40px;
        width: 200px; height: 160px; background: #f4f4f8;
        overflow: hidden;
      }
      #child {
        position: absolute; left: 20px; top: 20px;
        width: 60px; height: 40px; background: #6366f1;
      }
    </style>
  </head>
  <body>
    <div id="frame" data-an-primitive="frame" data-agent-native-node-id="frame">
      <div id="child" data-agent-native-node-id="child">Child</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      await selectElementDirect(page, '[data-agent-native-node-id="child"]');

      await page.mouse.move(90, 80);
      await page.mouse.down();
      await page.mouse.move(100, 90, { steps: 4 });
      const midDragVisible = await page.evaluate(() => {
        const child = document.querySelector<HTMLElement>("#child")!;
        const rect = child.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      await page.mouse.move(320, 80, { steps: 8 });
      const pastEdgeVisible = await page.evaluate(() => {
        const child = document.querySelector<HTMLElement>("#child")!;
        const frame = document.querySelector<HTMLElement>("#frame")!;
        const childRect = child.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        return {
          width: childRect.width,
          height: childRect.height,
          pastFrame: childRect.left >= frameRect.right - 1,
        };
      });
      await page.mouse.up();
      await page.waitForTimeout(30);

      const result = await page.evaluate(() => {
        const child = document.querySelector<HTMLElement>("#child")!;
        return {
          parentTag: child.parentElement?.tagName.toLowerCase() ?? null,
          parentId: child.parentElement?.id ?? null,
          position: window.getComputedStyle(child).position,
        };
      });

      expect(midDragVisible).toBe(true);
      expect(pastEdgeVisible.width).toBeGreaterThan(0);
      expect(pastEdgeVisible.height).toBeGreaterThan(0);
      expect(pastEdgeVisible.pastFrame).toBe(true);
      expect(result.parentTag).toBe("body");
      expect(result.parentId).not.toBe("frame");
      expect(result.position).toBe("absolute");

      const sibling = await page.evaluate(() => {
        const frame = document.querySelector("#frame");
        const child = document.querySelector("#child");
        return frame?.nextElementSibling === child;
      });
      expect(sibling).toBe(true);

      const messages = await readBridgeMessages(page);
      const structureMessage = messages.find(
        (m) => m.type === "visual-structure-change",
      ) as { dropMode?: string; placement?: string } | undefined;
      expect(structureMessage).toBeTruthy();
      expect(structureMessage?.dropMode).toBe("absolute-container");
      expect(structureMessage?.placement).toBe("after");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

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

      await page.mouse.move(320, 100);
      await page.mouse.down();
      await page.mouse.move(324, 104, { steps: 2 });
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

      expect(result.aLeft).toBe("160px");
      expect(result.aTop).toBe("110px");
      expect(result.bLeft).toBe("360px");
      expect(result.bTop).toBe("110px");
      expect(result.multiSelectionStillVisible).toBe(true);

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
  "editor chrome bridge drops a multi-selected group consecutively into a container as free children (no auto-layout conversion)",
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
          childPositions: Array.from(target.children).map(
            (c) => window.getComputedStyle(c).position,
          ),
        };
      });

      expect(result.childIds).toEqual(["boxA", "boxB"]);
      expect(result.targetDisplay).toBe("block");
      expect(result.childPositions).toEqual(["absolute", "absolute"]);

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
      expect(conversionMessages.length).toBe(0);
      expect(structureMessages.length).toBe(2);
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
  "editor chrome bridge lifts SCROLLABLE clipping ancestors during a drag",
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
      #screen { position: absolute; left: 0; top: 0; width: 900px; height: 700px; }
      #scroller {
        position: absolute; left: 100px; top: 100px;
        width: 300px; height: 200px; background: #f0f0f4;
        overflow: auto;
      }
      #item {
        position: absolute; left: 20px; top: 20px;
        width: 60px; height: 40px; background: #6366f1;
      }
    </style>
  </head>
  <body>
    <div id="screen" data-agent-native-node-id="screen">
      <div id="scroller" data-an-primitive="frame" data-agent-native-node-id="scroller">
        <div id="item" data-agent-native-node-id="item"></div>
      </div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const box = (await page.locator("#item").boundingBox())!;
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await selectElementDirect(page, '[data-agent-native-node-id="item"]');
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 5, startY + 5, { steps: 2 });
      await page.mouse.move(600, 500, { steps: 8 });
      const midDrag = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>("#scroller")!;
        const cs = window.getComputedStyle(scroller);
        return { overflow: cs.overflow, overflowX: cs.overflowX };
      });
      await page.mouse.up();
      await page.waitForTimeout(50);

      expect(midDrag).toEqual({
        overflow: "visible",
        overflowX: "visible",
      });
      const afterDrop = await page.evaluate(
        () =>
          window.getComputedStyle(
            document.querySelector<HTMLElement>("#scroller")!,
          ).overflow,
      );
      expect(afterDrop).toBe("auto");
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
        await selectElementDirect(page, '[data-agent-native-node-id="item"]');
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX + 5, startY + 5, { steps: 2 });
        await page.mouse.move(x, y, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(50);
      };

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
      expect(structureMessages.map((message) => message.placement)).toEqual([
        "after",
        "inside",
        "inside",
        "inside",
      ]);
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
      await selectElementDirect(
        page,
        '[data-agent-native-node-id="spaceItem"]',
      );
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
      await selectElementDirect(
        page,
        '[data-agent-native-node-id="controlItem"]',
      );
      await page.mouse.move(controlStartX, controlStartY);
      await page.mouse.down();
      await page.keyboard.down(IGNORE_AUTO_LAYOUT_KEY);
      await page.mouse.move(450, 115, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.up(IGNORE_AUTO_LAYOUT_KEY);
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
      await page.mouse.move(480, 330, { steps: 8 });
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
      expect(result.autoColor).toBe("inherit");
      expect(result.userParent).toBe("frame");
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

      await selectElementDirect(page, "#rowC");
      await page.mouse.move(300, 270);
      await page.mouse.down();
      await page.mouse.move(306, 264, { steps: 2 });
      await page.mouse.move(300, 156, { steps: 6 });
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

      expect(guide).toBeTruthy();
      expect(guide!.display).toBe("block");
      expect(guide!.height).toBeLessThan(10);
      expect(guide!.width).toBeGreaterThan(100);

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
      expect(runtimeSnapshot.html).toContain(
        'data-source-method="debug-stack"',
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
        framework: "react",
        sourceFile: "app/routes/_index.tsx",
        line: 78,
        column: 35,
        component: "ChatRoute",
        method: "debug-stack",
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "publishes local layers immediately and captures shared HTML after the latest reservation",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        "<!doctype html><html><body><h1>Canvas</h1></body></html>",
      );
      const sourceBuild = await build({
        entryPoints: [join(bridgeDir, "editor-chrome.bridge.ts")],
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2020",
        write: false,
        external: [],
      });
      const sourceScript = sourceBuild.outputFiles[0]?.text;
      if (!sourceScript) throw new Error("Bridge source compilation failed");
      await collectBridgeMessages(page, {
        grantSnapshotReservations: false,
      });
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(
          true,
          "bridge-guard",
          true,
          sourceScript,
        ),
      });
      await page.waitForFunction(
        () =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: any) =>
              message.type ===
              "agent-native:runtime-layer-snapshot-reservation-request",
          ),
        undefined,
        { timeout: 15_000 },
      );

      const firstRequest = await page.evaluate(() =>
        ((window as any).__bridgeMessages ?? []).find(
          (message: any) =>
            message.type ===
            "agent-native:runtime-layer-snapshot-reservation-request",
        ),
      );
      expect(firstRequest.documentId).toEqual(expect.any(String));
      await page.evaluate((request) => {
        window.postMessage(
          {
            type: "grant-runtime-layer-snapshot-reservation",
            requestId: request.requestId,
            documentId: "retired-document",
            reservationToken: "stale-document-reservation",
          },
          "*",
        );
      }, firstRequest);
      await page.waitForTimeout(50);
      const staleReservationSnapshots = await page.evaluate(() =>
        ((window as any).__bridgeMessages ?? []).filter(
          (message: any) =>
            message.type === "agent-native:runtime-layer-snapshot" &&
            message.payload?.reservationToken === "stale-document-reservation",
        ),
      );
      expect(staleReservationSnapshots).toHaveLength(0);

      await page.evaluate((request) => {
        window.postMessage(
          {
            type: "grant-runtime-layer-snapshot-reservation",
            requestId: request.requestId,
            documentId: request.documentId,
          },
          "*",
        );
      }, firstRequest);
      await page.waitForFunction(
        (requestId) =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: any) =>
              message.type === "agent-native:runtime-layer-snapshot" &&
              message.payload?.requestId === requestId &&
              !message.payload?.reservationToken,
          ),
        firstRequest.requestId,
        { timeout: 5_000 },
      );
      await page.locator("h1").evaluate((element) => {
        element.textContent = "Latest canvas";
      });
      await page.waitForTimeout(350);
      await page.waitForFunction(
        () =>
          ((window as any).__bridgeMessages ?? []).filter(
            (message: any) =>
              message.type ===
              "agent-native:runtime-layer-snapshot-reservation-request",
          ).length === 2,
        undefined,
        { timeout: 5_000 },
      );
      const requestIds = await page.evaluate(() =>
        ((window as any).__bridgeMessages ?? [])
          .filter(
            (message: any) =>
              message.type ===
              "agent-native:runtime-layer-snapshot-reservation-request",
          )
          .map((message: any) => message.requestId),
      );
      expect(requestIds).toEqual([
        firstRequest.requestId,
        firstRequest.requestId + 1,
      ]);

      await page.evaluate(
        ({ requestId, documentId }) => {
          window.postMessage(
            {
              type: "grant-runtime-layer-snapshot-reservation",
              requestId,
              documentId,
            },
            "*",
          );
        },
        { requestId: requestIds[1], documentId: firstRequest.documentId },
      );
      await page.waitForFunction(
        (requestId) =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: any) =>
              message.type === "agent-native:runtime-layer-snapshot" &&
              message.payload?.requestId === requestId &&
              !message.payload?.reservationToken &&
              message.payload?.html?.includes("Latest canvas"),
          ),
        requestIds[1],
        { timeout: 5_000 },
      );

      await page.evaluate(
        ({ requestId, documentId }) => {
          window.postMessage(
            {
              type: "grant-runtime-layer-snapshot-reservation",
              requestId,
              documentId,
              reservationToken: "late-capture-one",
            },
            "*",
          );
        },
        { requestId: requestIds[0], documentId: firstRequest.documentId },
      );
      await page.waitForTimeout(50);
      const lateReservationSnapshots = await page.evaluate(() =>
        ((window as any).__bridgeMessages ?? []).filter(
          (message: any) =>
            message.type === "agent-native:runtime-layer-snapshot" &&
            message.payload?.reservationToken === "late-capture-one",
        ),
      );
      expect(lateReservationSnapshots).toHaveLength(0);

      await page.evaluate(
        ({ requestId, documentId }) => {
          window.postMessage(
            {
              type: "grant-runtime-layer-snapshot-reservation",
              requestId,
              documentId,
              reservationToken: "capture-two",
            },
            "*",
          );
        },
        { requestId: requestIds[1], documentId: firstRequest.documentId },
      );
      await page.waitForFunction(
        (requestId) =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: any) =>
              message.type === "agent-native:runtime-layer-snapshot" &&
              message.payload?.requestId === requestId &&
              message.payload?.reservationToken === "capture-two",
          ),
        requestIds[1],
        { timeout: 5_000 },
      );
      const reservedSnapshots = await page.evaluate(() =>
        ((window as any).__bridgeMessages ?? [])
          .filter(
            (message: any) =>
              message.type === "agent-native:runtime-layer-snapshot" &&
              message.payload?.reservationToken,
          )
          .map((message: any) => ({
            requestId: message.payload.requestId,
            reservationToken: message.payload.reservationToken,
            html: message.payload.html,
          })),
      );
      expect(reservedSnapshots).toEqual([
        {
          requestId: requestIds[1],
          reservationToken: "capture-two",
          html: expect.stringContaining("Latest canvas"),
        },
      ]);
      const snapshots = await page.evaluate(() =>
        ((window as any).__bridgeMessages ?? []).filter(
          (message: any) =>
            message.type === "agent-native:runtime-layer-snapshot",
        ),
      );
      expect(snapshots).toHaveLength(3);
      expect(snapshots.at(-1)?.payload).toMatchObject({
        requestId: requestIds[1],
        reservationToken: "capture-two",
        html: expect.stringContaining("Latest canvas"),
      });
    } finally {
      await browser.close();
    }
  },
);

async function expectSnapshotReservationRequests(
  page: import("@playwright/test").Page,
  requestIds: number[],
) {
  const actual = await page.evaluate(() =>
    ((window as any).__bridgeMessages ?? [])
      .filter(
        (message: any) =>
          message.type ===
          "agent-native:runtime-layer-snapshot-reservation-request",
      )
      .map((message: any) => message.requestId),
  );
  expect(actual).toEqual(requestIds);
}

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
      await page.mouse.click(500, 500);
      await page.waitForTimeout(30);
      await page.mouse.click(180, 150);
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
          realNodeIdAttr: box.getAttribute("data-agent-native-node-id"),
          pendingAttr: box.getAttribute("data-an-pending-node-id"),
        };
      });

      expect(result.payloads.length).toBeGreaterThanOrEqual(2);
      const first = result.payloads[0];
      const last = result.payloads[result.payloads.length - 1];
      expect(first.pendingNodeId).toMatch(/^an-pending-/);
      expect(last.pendingNodeId).toBe(first.pendingNodeId);
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
      <template x-for="t in items"><li></li></template>
      <li>Alpha</li>
      <li>Beta</li>
    </ul>
  </body>
</html>`);
      await page.evaluate(() => {
        const template = document.querySelector("ul > template[x-for]")!;
        const rows = Array.from(template.parentElement!.children).filter(
          (child) => child !== template,
        );
        (template as any)._x_lookup = new Map(
          rows.map((row, index) => [`item-${index}`, row]),
        );
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const items = await page.locator("li").all();
      const itemABox = (await items[0].boundingBox())!;
      const itemBBox = (await items[1].boundingBox())!;
      const startX = itemABox.x + itemABox.width / 2;
      const startY = itemABox.y + itemABox.height / 2;

      await selectElementDirect(page, "ul > li:nth-child(2)");

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 5, startY - 5, { steps: 3 });
      const targetY = itemBBox.y + itemBBox.height - 5;
      await page.mouse.move(startX, targetY, { steps: 10 });
      await page.waitForTimeout(80);

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

      const order = await page.evaluate(() =>
        Array.from(document.querySelectorAll("li")).map((el) =>
          el.textContent?.trim(),
        ),
      );
      expect(order).toEqual(["Alpha", "Beta"]);

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
      <template x-for="t in items"><li></li></template>
      <li>Alpha</li>
      <li>Beta</li>
    </ul>
  </body>
</html>`);
      await page.evaluate(() => {
        const template = document.querySelector("ul > template[x-for]")!;
        const rows = Array.from(template.parentElement!.children).filter(
          (child) => child !== template,
        );
        (template as any)._x_lookup = new Map(
          rows.map((row, index) => [`item-${index}`, row]),
        );
      });
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

      expect(state.anyContentEditable).toBe(false);
      expect(state.anyTextEditingActive).toBe(false);
      expect(state.badgeText).toMatch(/can.t edit/i);
      expect(state.selectionMatchesList).toBe(true);

      const messages = await readBridgeMessages(page);
      expect(messages.some((m) => m.type === "text-content-change")).toBe(
        false,
      );
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

      await selectElementDirect(page, '[data-agent-native-node-id="itemA"]');

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
  "editor chrome bridge uses the exited frame for empty-area drops and preserves explicit sibling slots",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));
      const sourceBuild = await build({
        entryPoints: [join(bridgeDir, "editor-chrome.bridge.ts")],
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2020",
        write: false,
        external: [],
      });
      const sourceScript = sourceBuild.outputFiles[0]?.text;
      if (!sourceScript) throw new Error("Bridge source compilation failed");
      const fixtureHtml = `<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      #outer { position: absolute; left: 100px; top: 100px; width: 600px; height: 500px; background: #eee; }
      #nested { position: absolute; left: 220px; top: 200px; width: 200px; height: 120px; display: flex; background: #ccc; }
      #dragme { width: 80px; height: 60px; background: #6366f1; }
      #candidate { position: absolute; left: 20px; top: 350px; width: 100px; height: 60px; background: #9ca3af; }
      #overlap { position: absolute; left: 0; top: 0; width: 160px; height: 120px; background: #ef4444; }
    </style>
  </head>
  <body>
    <main id="outer" data-agent-native-node-id="outer">
      <section id="nested" data-an-primitive="frame" data-agent-native-node-id="nested">
        <div id="dragme" data-agent-native-node-id="dragme">Drag me</div>
      </section>
      <div id="candidate" data-agent-native-node-id="candidate">Drop area</div>
      <div id="overlap" data-agent-native-node-id="overlap">Later layer</div>
    </main>
  </body>
</html>`;
      const dropResults: Array<{
        crossesExitedFrame: boolean;
        dropArea: "empty" | "sibling";
        parentId: string | undefined;
        childOrder: string[];
        structureChange: Record<string, unknown> | undefined;
      }> = [];

      for (const testCase of [
        { crossesExitedFrame: false, dropArea: "empty" },
        { crossesExitedFrame: true, dropArea: "empty" },
        { crossesExitedFrame: false, dropArea: "sibling" },
      ] as const) {
        await page.setContent(`<!doctype html><html><body style="margin:0">
<iframe id="design" style="display:block;width:900px;height:700px;border:0"></iframe>
<script>
  window.__bridgeMessages = [];
  window.addEventListener("message", event => {
    const message = event.data;
    if (!message || typeof message.type !== "string") return;
    window.__bridgeMessages.push(message);
    if (message.type === "visual-structure-change") {
      event.source.postMessage({
        type: "visual-structure-ack",
        requestId: message.requestId,
        applied: true,
      }, "*");
    }
  });
</script>
</body></html>`);
        await page.locator("#design").evaluate((iframe, html) => {
          (iframe as HTMLIFrameElement).srcdoc = html as string;
        }, fixtureHtml);
        const iframe = await page.locator("#design").elementHandle();
        const frame = await iframe?.contentFrame();
        if (!frame) throw new Error("Design fixture iframe failed to load");
        await frame.waitForSelector("#dragme");
        await frame.evaluate(() => {
          (window as any).__receivedStructureAcks = [];
          window.addEventListener("message", (event) => {
            if (event.data?.type === "visual-structure-ack") {
              (window as any).__receivedStructureAcks.push(event.data);
            }
          });
        });
        await frame.addScriptTag({
          content: hydratedEditorChromeBridgeScript(
            false,
            "g4",
            true,
            sourceScript,
          ),
        });
        await frame.waitForSelector(
          '[data-agent-native-edit-overlay="shield"]',
        );
        await page.evaluate(() => {
          document
            .querySelector<HTMLIFrameElement>("#design")!
            .contentWindow!.postMessage(
              { type: "select-element", selector: "#dragme" },
              "*",
            );
        });
        await frame.waitForFunction(() => {
          const overlay = document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="selection"]',
          );
          const target = document.querySelector<HTMLElement>("#dragme");
          if (!overlay || !target) return false;
          const overlayRect = overlay.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          return (
            window.getComputedStyle(overlay).display === "block" &&
            Math.abs(overlayRect.width - targetRect.width) < 2 &&
            Math.abs(overlayRect.height - targetRect.height) < 2
          );
        });

        const dragmeBox = await frame.locator("#dragme").boundingBox();
        if (!dragmeBox) throw new Error("Dragged layer has no rendered box");
        const startX = dragmeBox.x + dragmeBox.width / 2;
        const startY = dragmeBox.y + dragmeBox.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        if (testCase.crossesExitedFrame) {
          await page.mouse.move(570, 350, { steps: 4 });
          await page.mouse.move(startX, startY, { steps: 4 });
        }
        await page.mouse.move(
          testCase.dropArea === "empty" ? 650 : 130,
          testCase.dropArea === "empty" ? 550 : 460,
          { steps: 12 },
        );
        await page.mouse.up();

        const messages = await readBridgeMessages(page);
        const structureMessage = messages.find(
          (message) => message.type === "visual-structure-change",
        );
        if (!structureMessage) {
          throw new Error("The host did not receive the structure change");
        }
        await frame.waitForFunction((requestId) => {
          const acknowledgements = (window as any)
            .__receivedStructureAcks as Array<Record<string, unknown>>;
          return acknowledgements.some(
            (acknowledgement) =>
              acknowledgement.requestId === requestId &&
              acknowledgement.applied === true,
          );
        }, structureMessage.requestId);
        const structureChange = structureMessage
          ? {
              anchorSourceId: structureMessage.anchorSourceId,
              persistenceAnchorSourceId:
                structureMessage.persistenceAnchorSourceId,
              placement: structureMessage.placement,
              persistencePlacement: structureMessage.persistencePlacement,
            }
          : undefined;
        const result = await frame.evaluate(() => {
          const outer = document.querySelector<HTMLElement>("#outer")!;
          const child = document.querySelector<HTMLElement>("#dragme")!;
          return {
            parentId: child.parentElement?.id,
            childOrder: Array.from(outer.children).map((element) => element.id),
          };
        });

        dropResults.push({ ...testCase, ...result, structureChange });
      }

      for (const dropResult of dropResults) {
        const label = `${dropResult.crossesExitedFrame ? "nested-frame crossing" : "direct exit"} ${dropResult.dropArea} drop`;
        const observed = JSON.stringify(dropResults);
        expect(dropResult.parentId, `${label}: ${observed}`).toBe("outer");
        expect(dropResult.childOrder, `${label}: ${observed}`).toEqual([
          "nested",
          "dragme",
          "candidate",
          "overlap",
        ]);
        if (dropResult.dropArea === "empty") {
          expect(dropResult.structureChange).toMatchObject({
            anchorSourceId: "nested",
            persistenceAnchorSourceId: "nested",
            placement: "after",
            persistencePlacement: "after",
          });
        } else {
          expect(dropResult.structureChange).toMatchObject({
            anchorSourceId: "candidate",
            persistenceAnchorSourceId: "candidate",
            placement: "before",
            persistencePlacement: "before",
          });
        }
      }
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

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
      nav { position: absolute; left: 40px; top: 40px; width: 240px; display: flex; flex-direction: column; gap: 8px; }
      button.chip { display: flex; align-items: center; gap: 8px; padding: 12px; border: 1px solid #ccc; background: #f5f5f5; height: 48px; box-sizing: border-box; width: 100%; text-align: left; }
      button.chip span { flex: 1; }
      #realContainer { position: absolute; left: 320px; top: 40px; width: 200px; height: 150px; display: flex; flex-direction: column; background: #eee; border: 1px solid #ccc; }
      #realContainer .inner { height: 40px; background: #ccd; }
      #dragme { position: absolute; left: 40px; top: 260px; width: 80px; height: 40px; background: #6366f1; color: white; }
    </style>
  </head>
  <body>
    <nav data-agent-native-node-id="list">
      <button class="chip" data-agent-native-node-id="itemA"><span>Alpha</span></button>
      <button class="chip" data-agent-native-node-id="itemB"><span data-agent-native-node-id="itemB-label">Beta</span></button>
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

      const itemABox = (await page
        .locator('[data-agent-native-node-id="itemA"]')
        .boundingBox())!;
      const itemBBox = (await page
        .locator('[data-agent-native-node-id="itemB"]')
        .boundingBox())!;
      const aX = itemABox.x + itemABox.width / 2;
      const aY = itemABox.y + itemABox.height / 2;
      const bX = itemBBox.x + itemBBox.width * 0.82;
      const bY = itemBBox.y + itemBBox.height / 2;

      await selectElementDirect(page, '[data-agent-native-node-id="itemA"]');
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
      expect(chipResult.childIds).toEqual(["itemB", "itemA"]);
      expect(chipResult.itemBText).toBe("Beta");
      const chipMove = (await readBridgeMessages(page)).find(
        (message) =>
          message.type === "visual-structure-change" &&
          (message as { sourceId?: string }).sourceId === "itemA",
      ) as { anchorSourceId?: string; placement?: string } | undefined;
      expect(chipMove?.anchorSourceId).toBe("itemB");
      expect(chipMove?.placement).toBe("after");

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

      await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      body { background: white; }
    </style>
  </head>
  <body>
    <div id="rect" style="position:absolute;left:300px;top:100px;width:200px;height:150px;background:#eee" data-agent-native-node-id="rect" data-an-primitive="frame"></div>
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
      await page.mouse.move(400, 175, { steps: 10 });
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
      expect(result.computedPosition).toBe("absolute");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

const FRAME_DRAG_MARKUP = `<!doctype html>
<html>
  <head><style>html, body { margin: 0; width: 100%; height: 100%; background: white; }</style></head>
  <body>
    <div id="frame" data-an-primitive="frame" data-agent-native-node-id="frame" style="position:absolute;left:100px;top:100px;width:400px;height:400px;background:#f5f5f5">
      <div id="child" data-agent-native-node-id="child" style="position:absolute;left:40px;top:40px;width:120px;height:60px;background:#6366f1;color:white">Child</div>
      <div id="sibling" data-agent-native-node-id="sibling" style="position:absolute;left:40px;top:220px;width:120px;height:60px;background:#10b981;color:white">Sib</div>
    </div>
    <div id="other" data-an-primitive="frame" data-agent-native-node-id="other" style="position:absolute;left:560px;top:100px;width:300px;height:400px;background:#e5e7eb"></div>
  </body>
</html>`;

it(
  "editor chrome bridge drags a framed element without restyling it: no fade, no drop-target highlight, and no z-order change inside its own frame",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 950, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));
      await page.setContent(FRAME_DRAG_MARKUP);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await selectElementDirect(page, '[data-agent-native-node-id="child"]');
      await page.mouse.move(200, 170);
      await page.mouse.down();
      await page.mouse.move(210, 180, { steps: 3 });
      await page.mouse.move(280, 190, { steps: 8 });
      await page.waitForTimeout(80);

      const mid = await page.evaluate(() => {
        const child = document.getElementById("child")!;
        const guide = document.querySelector(
          '[data-agent-native-edit-overlay="insertion-guide"]',
        ) as HTMLElement;
        return {
          left: child.style.left,
          inlineOpacity: child.style.opacity,
          computedOpacity: getComputedStyle(child).opacity,
          guideDisplay: guide.style.display,
        };
      });
      await page.mouse.up();
      await page.waitForTimeout(80);

      const after = await page.evaluate(() => {
        const child = document.getElementById("child")!;
        return {
          left: child.style.left,
          inlineOpacity: child.style.opacity,
          parentId: child.parentElement?.id,
          order: Array.from(document.getElementById("frame")!.children).map(
            (el) => el.id,
          ),
        };
      });

      expect(mid.left).not.toBe("40px");
      expect(after.left).not.toBe("40px");
      expect(mid.inlineOpacity).toBe("");
      expect(mid.computedOpacity).toBe("1");
      expect(mid.guideDisplay).toBe("none");
      expect(after.inlineOpacity).toBe("");
      expect(after.parentId).toBe("frame");
      expect(after.order).toEqual(["child", "sibling"]);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge keeps the dragged element at full opacity while it hovers a different frame as a drop target",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 950, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));
      await page.setContent(FRAME_DRAG_MARKUP);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await selectElementDirect(page, '[data-agent-native-node-id="child"]');
      await page.mouse.move(200, 170);
      await page.mouse.down();
      await page.mouse.move(210, 180, { steps: 3 });
      await page.mouse.move(700, 300, { steps: 10 });
      await page.waitForTimeout(80);

      const mid = await page.evaluate(() => {
        const child = document.getElementById("child")!;
        const guide = document.querySelector(
          '[data-agent-native-edit-overlay="insertion-guide"]',
        ) as HTMLElement;
        return {
          inlineOpacity: child.style.opacity,
          computedOpacity: getComputedStyle(child).opacity,
          guideDisplay: guide.style.display,
        };
      });
      await page.mouse.up();
      await page.waitForTimeout(120);

      const after = await page.evaluate(() => {
        const child = document.getElementById("child")!;
        return {
          inlineOpacity: child.style.opacity,
          parentId: child.parentElement?.id,
        };
      });

      expect(mid.guideDisplay).toBe("block");
      expect(after.parentId).toBe("other");
      expect(mid.inlineOpacity).toBe("");
      expect(mid.computedOpacity).toBe("1");
      expect(after.inlineOpacity).toBe("");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

function hydratedHitTestBridgeScript(): string {
  return hitTestBridgeScript;
}

it(
  "hit-test bridge exposes review anchor, rect, and focus messages for opaque preview frames",
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
  <body style="margin:0">
    <h1 data-agent-native-node-id="hero-title" data-agent-native-layer-name="Hero title" style="margin:40px;width:320px;height:80px">Hello</h1>
    <div style="position:absolute;left:500px;top:100px;width:200px;height:100px"><span style="display:block;width:160px;height:60px">Nested layer</span></div>
    <div data-agent-native-node-id="nested-parent" style="position:absolute;left:700px;top:100px;width:160px;height:100px"><span data-agent-native-node-id="nested-child" style="display:block;width:120px;height:60px">Nested identity</span></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedHitTestBridgeScript() });

      const result = await page.evaluate(async () => {
        const request = (data: Record<string, unknown>, responseType: string) =>
          new Promise<Record<string, unknown>>((resolve) => {
            const onMessage = (event: MessageEvent) => {
              if (
                event.data?.type !== responseType ||
                event.data?.correlationId !== data.correlationId
              ) {
                return;
              }
              window.removeEventListener("message", onMessage);
              resolve(event.data);
            };
            window.addEventListener("message", onMessage);
            window.postMessage(data, "*");
          });
        const anchor = await request(
          {
            type: "agent-native:review-anchor-at-point",
            correlationId: "review-point",
            x: 100,
            y: 70,
          },
          "agent-native:review-anchor-at-point-result",
        );
        const selectorAnchor = await request(
          {
            type: "agent-native:review-anchor-at-point",
            correlationId: "review-selector-point",
            x: 550,
            y: 130,
          },
          "agent-native:review-anchor-at-point-result",
        );
        const nestedAnchor = await request(
          {
            type: "agent-native:review-anchor-at-point",
            correlationId: "review-nested-point",
            x: 720,
            y: 120,
          },
          "agent-native:review-anchor-at-point-result",
        );
        const rects = await request(
          {
            type: "agent-native:review-node-rects",
            correlationId: "review-rects",
            nodeIds: ["hero-title"],
          },
          "agent-native:review-node-rects-result",
        );
        const focus = await request(
          {
            type: "agent-native:review-focus",
            correlationId: "review-focus",
            nodeId: "hero-title",
          },
          "agent-native:review-focus-result",
        );
        return { anchor, selectorAnchor, nestedAnchor, rects, focus };
      });

      expect(result.anchor).toMatchObject({
        nodeId: "hero-title",
        layerName: "Hero title",
        tagName: "h1",
      });
      expect(result.selectorAnchor).toMatchObject({
        targetSelector: "body > div:nth-of-type(1) > span:nth-of-type(1)",
        tagName: "span",
      });
      expect(result.selectorAnchor.nodeId).toBeUndefined();
      expect(result.nestedAnchor).toMatchObject({ nodeId: "nested-child" });
      expect(result.rects).toMatchObject({
        rects: {
          "hero-title": { left: 40, top: 40, width: 320, height: 80 },
        },
        viewportWidth: 900,
        viewportHeight: 700,
      });
      expect(result.focus).toMatchObject({ focused: true });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

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

it(
  "hit-test bridge keeps the document body as the root fallback without minting an anchor id",
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
<html><head><meta charset="utf-8"></head>
<body style="margin:0;min-height:600px;background:#fff"></body></html>`);
      await page.addScriptTag({ content: hydratedHitTestBridgeScript() });

      const reply = (await page.evaluate(
        () =>
          new Promise((resolve) => {
            const onMsg = (event: MessageEvent) => {
              if (event.data?.type !== "agent-native:hit-test-result") return;
              window.removeEventListener("message", onMsg);
              resolve(event.data);
            };
            window.addEventListener("message", onMsg);
            window.postMessage(
              {
                type: "agent-native:hit-test",
                correlationId: "empty-root",
                x: 180,
                y: 240,
                preview: false,
              },
              "*",
            );
          }),
      )) as {
        anchorNodeId: string;
        pendingNodeId?: string;
        placement: string;
        dropMode: string;
      };

      expect(reply).toMatchObject({
        anchorNodeId: "",
        placement: "inside",
        dropMode: "flow-insert",
      });
      expect(reply.pendingNodeId).toBeUndefined();
      expect(
        await page.evaluate(
          () => document.querySelectorAll("[data-an-pending-node-id]").length,
        ),
      ).toBe(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

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

      expect(result.draggedParentId).toBe("row");
      expect(result.position).toBe("static");
      expect(result.positionPriority).toBe("important");

      const messages = await readBridgeMessages(page);
      const structureMessage = messages.find(
        (m) => m.type === "visual-structure-change",
      ) as any;
      expect(structureMessage).toBeTruthy();
      expect(structureMessage.dropMode).toBe("flow-insert");
      expect(structureMessage.forceFlowPositionOverride).toBe(true);
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

      await selectElementDirect(page, '[data-agent-native-node-id="dragme"]');

      await page.mouse.move(80, 420);
      await page.mouse.down();
      await page.mouse.move(90, 410, { steps: 4 });
      await page.mouse.move(410, 200, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(30);

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
      <template x-for="f in filters"><div class="tab"></div></template>
      <div class="tab">All</div>
      <div class="tab">Active</div>
      <div class="tab">Done</div>
    </div>
    <div id="dragme" data-agent-native-node-id="dragme">Drag me</div>
  </body>
</html>`);
      await page.evaluate(() => {
        const template = document.querySelector(
          "#filterCard > template[x-for]",
        )!;
        const rows = Array.from(template.parentElement!.children).filter(
          (child) => child !== template,
        );
        (template as any)._x_lookup = new Map(
          rows.map((row, index) => [`filter-${index}`, row]),
        );
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const dragBox = (await page.locator("#dragme").boundingBox())!;
      const cardBox = (await page.locator("#filterCard").boundingBox())!;
      const startX = dragBox.x + dragBox.width / 2;
      const startY = dragBox.y + dragBox.height / 2;
      const targetX = cardBox.x + cardBox.width / 2;
      const targetY = cardBox.y + cardBox.height / 2;

      await page.mouse.click(startX, startY);
      await page.waitForTimeout(60);
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 5, startY - 5, { steps: 3 });
      await page.mouse.move(targetX, targetY, { steps: 10 });
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

      expect(structureMessage!.anchorSourceId).toBe("filterCard");
      expect(structureMessage!.placement).toBe("inside");

      const domResult = await page.evaluate(() => {
        const card = document.getElementById("filterCard")!;
        const dragged = document.getElementById("dragme")!;
        return { insideCard: card.contains(dragged) };
      });
      expect(domResult.insideCard).toBe(true);

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
      <template x-for="r in rows"><div class="row"></div></template>
      <div class="row">Clone One</div>
      <div class="row">Clone Two</div>
      <div class="row" id="staticItem" data-agent-native-node-id="staticItem">Static</div>
    </div>
    <div id="dragme" data-agent-native-node-id="dragme">Drag me</div>
  </body>
</html>`);
      await page.evaluate(() => {
        const template = document.querySelector("#list > template[x-for]")!;
        const rows = document.querySelectorAll("#list > .row");
        (template as any)._x_lookup = new Map([
          ["one", rows[0]],
          ["two", rows[1]],
        ]);
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const dragBox = (await page.locator("#dragme").boundingBox())!;
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
      <template x-for="f in filters"><div class="tab"></div></template>
      <div class="tab">All</div>
      <div class="tab">Active</div>
      <div class="tab">Done</div>
    </div>
  </body>
</html>`);
      await page.evaluate(() => {
        const template = document.querySelector(
          "#filterCard > template[x-for]",
        )!;
        const rows = Array.from(template.parentElement!.children).filter(
          (child) => child !== template,
        );
        (template as any)._x_lookup = new Map(
          rows.map((row, index) => [`filter-${index}`, row]),
        );
      });
      await page.addScriptTag({ content: hydratedHitTestBridgeScript() });

      const cardBox = (await page.locator("#filterCard").boundingBox())!;
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
      <template x-for="r in rows"><div class="row"></div></template>
      <div class="row">Clone One</div>
      <div class="row">Clone Two</div>
      <div class="row" data-agent-native-node-id="staticItem">Static</div>
    </div>
  </body>
</html>`);
      await page.evaluate(() => {
        const template = document.querySelector("#list > template[x-for]")!;
        const rows = document.querySelectorAll("#list > .row");
        (template as any)._x_lookup = new Map([
          ["one", rows[0]],
          ["two", rows[1]],
        ]);
      });
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

it.each(["row", "column"] as const)(
  "editor chrome bridge flow-inserts %s-flow grid children without freezing auto placement",
  { timeout: 30_000 },
  async (flow) => {
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
  #grid { position:absolute; left:100px; top:80px; width:400px; display:grid; grid-auto-flow:${flow};
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

      await selectElementDirect(page, '[data-agent-native-node-id="d"]');
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
      if (flow === "column") {
        const styles = await page.evaluate(() =>
          Array.from(
            document.querySelectorAll<HTMLElement>("#grid > .cell"),
          ).map((element) => ({
            gridColumn: element.style.gridColumn,
            gridRow: element.style.gridRow,
          })),
        );
        expect(styles).toEqual(
          styles.map(() => ({ gridColumn: "", gridRow: "" })),
        );
        expect(
          (
            structureMessages[structureMessages.length - 1] as {
              gridPlacement?: unknown;
            }
          )?.gridPlacement,
        ).toBeUndefined();
      }
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge shows an insertion line over an occupied explicit grid cell",
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
        <div id="source" data-agent-native-node-id="source"
          style="position:absolute;left:40px;top:400px;width:80px;height:44px;background:#6366f1">Source</div>
        <div id="grid" data-agent-native-node-id="grid"
          style="position:absolute;left:300px;top:80px;width:320px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(3,80px);grid-auto-rows:56px;gap:16px;box-sizing:border-box">
          <div id="span" data-agent-native-node-id="span" style="grid-column:1 / span 2;background:#a855f7">Span</div>
          <div id="target" data-agent-native-node-id="target" style="grid-column:3;background:#ec4899">Target</div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);
      await selectElementDirect(page, "#source");

      const source = await page.locator("#source").boundingBox();
      const target = await page.locator("#target").boundingBox();
      expect(source).toBeTruthy();
      expect(target).toBeTruthy();
      await page.mouse.move(
        source!.x + source!.width / 2,
        source!.y + source!.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        source!.x + source!.width / 2 + 10,
        source!.y + source!.height / 2 + 6,
        { steps: 4 },
      );
      await page.mouse.move(target!.x + 4, target!.y + target!.height / 2, {
        steps: 12,
      });
      await page.mouse.move(target!.x + 10, target!.y + target!.height / 2, {
        steps: 4,
      });
      await page.waitForFunction(() => {
        const guide = document.querySelector<HTMLElement>(
          "[data-agent-native-insertion-guide]",
        );
        return guide && getComputedStyle(guide).display === "block";
      });

      const guide = await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>(
          "[data-agent-native-insertion-guide]",
        );
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      await page.mouse.up();
      expect(guide).toBeTruthy();
      expect(Math.min(guide!.width, guide!.height)).toBeLessThan(10);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

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

      await page.mouse.move(150, 150);
      await page.waitForTimeout(30);
      const afterHover = (await readBridgeMessages(page)).filter(
        (m) => m.type === "element-hover",
      );
      expect(afterHover.length).toBe(1);

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
      await page.mouse.move(170, 150);

      const moveMessageCount = await page.evaluate(async () => {
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
      expect(postReleaseCounts.move).toBe(1);

      const overlayAlignment = await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target");
        const overlay = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        );
        if (!target || !overlay) return null;
        const targetRect = target.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        return {
          targetLeft: targetRect.left,
          targetTop: targetRect.top,
          overlayLeft: overlayRect.left,
          overlayTop: overlayRect.top,
        };
      });
      expect(overlayAlignment).not.toBeNull();
      expect(
        Math.abs(overlayAlignment!.overlayLeft - overlayAlignment!.targetLeft),
      ).toBeLessThan(1);
      expect(
        Math.abs(overlayAlignment!.overlayTop - overlayAlignment!.targetTop),
      ).toBeLessThan(1);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge posts the pre-lift source outerHTML on the cross-screen-drag start phase",
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
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.postMessage = ((message: unknown) => {
          (window as any).__bridgeMessages.push(message);
        }) as typeof window.postMessage;
      });

      await page.mouse.click(160, 140);
      const preLiftHtml = await page.evaluate(
        () => document.querySelector("#target")!.outerHTML,
      );
      await page.mouse.move(160, 140);
      await page.mouse.down();
      await page.mouse.move(200, 180, { steps: 4 });

      const start = await page.evaluate(() => {
        const starts = (
          (window as any).__bridgeMessages as Array<Record<string, unknown>>
        ).filter(
          (m) =>
            m.type === "agent-native:cross-screen-drag" && m.phase === "start",
        );
        return starts[starts.length - 1];
      });
      expect(start?.sourceCloneHtml).toBe(preLiftHtml);
      await page.mouse.up();
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "keeps a live drag source visible until the host acknowledges the destination insert",
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
      #target { position: absolute; left: 100px; top: 100px; width: 120px; height: 80px; background: #6366f1; opacity: .6; }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target"></div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.mouse.click(120, 120);
      await page.mouse.move(120, 120);
      await page.mouse.down();
      await page.mouse.move(150, 150, { steps: 3 });
      await page.evaluate(() => {
        window.postMessage(
          { type: "agent-native:cross-screen-claim", claimed: true },
          "*",
        );
      });
      await page.waitForTimeout(0);
      await page.mouse.up();

      const source = await page.locator("#target").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          parent: element.parentElement?.tagName,
          left: rect.left,
          top: rect.top,
          opacity: getComputedStyle(element).opacity,
          pointerEvents: getComputedStyle(element).pointerEvents,
          pendingDelete: element.hasAttribute(
            "data-agent-native-pending-delete-style",
          ),
        };
      });
      expect(source).toEqual({
        parent: "BODY",
        left: 100,
        top: 100,
        opacity: "0.6",
        pointerEvents: "auto",
        pendingDelete: false,
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

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

      await page.evaluate(() => {
        document.getElementById("target")!.classList.add("moved");
      });
      await page.waitForTimeout(200);

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
      expect(midTransition.targetLeft).toBeGreaterThan(60);
      expect(midTransition.targetLeft).toBeLessThan(320);
      expect(
        Math.abs(midTransition.overlayLeft - midTransition.targetLeft),
      ).toBeLessThan(20);

      await page.waitForTimeout(300);
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

const PRIMARY_HOTKEY_FORWARDING_CASES: Array<{
  name: string;
  key: string;
  code?: string;
  shift?: boolean;
  alt?: boolean;
  ctrlOnly?: boolean;
  platformPrimary?: boolean;
}> = [
  { name: "Cmd/Ctrl+Z undo", key: "z" },
  { name: "Cmd/Ctrl+Shift+Z redo", key: "z", shift: true },
  { name: "Cmd/Ctrl+Y redo", key: "y" },
  { name: "Cmd/Ctrl+F find", key: "f", platformPrimary: true },
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
  { name: "Cmd/Ctrl+Shift+R paste to replace", key: "r", shift: true },
  { name: "Cmd/Ctrl+Shift+H toggle hidden", key: "h", shift: true },
  { name: "Cmd/Ctrl+Shift+L toggle locked", key: "l", shift: true },
  { name: "Cmd/Ctrl+Backslash toggle sidebars", key: "\\" },
  { name: "Cmd/Ctrl+Shift+Backslash minimal UI", key: "|", shift: true },
  { name: "Cmd/Ctrl+G group", key: "g" },
  { name: "Cmd/Ctrl+Shift+G ungroup", key: "g", shift: true },
  { name: "Cmd/Ctrl+Alt+G frame selection", key: "g", alt: true },
  { name: "Cmd/Ctrl+= zoom in", key: "=" },
  { name: "Cmd/Ctrl+- zoom out", key: "-" },
  { name: "Cmd/Ctrl+0 zoom reset", key: "0" },
  { name: "Cmd/Ctrl+Alt+K create component", key: "k", alt: true },
  { name: "Cmd/Ctrl+Alt+B detach instance", key: "b", alt: true },
  { name: "Cmd/Ctrl+] bring forward", key: "]" },
  { name: "Cmd/Ctrl+[ send backward", key: "[" },
  {
    name: "Cmd/Ctrl+physical BracketRight bring forward",
    key: "BracketRight",
    code: "BracketRight",
  },
  {
    name: "Cmd/Ctrl+physical BracketLeft send backward",
    key: "BracketLeft",
    code: "BracketLeft",
  },
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
        const modifier =
          testCase.ctrlOnly ||
          (testCase.platformPrimary && process.platform !== "darwin")
            ? "Control"
            : "Meta";
        await page.keyboard.down(modifier);
        if (testCase.alt) await page.keyboard.down("Alt");
        if (testCase.shift) await page.keyboard.down("Shift");
        if (testCase.code) {
          await page.evaluate(
            (chord) => {
              document.body.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: chord.key,
                  code: chord.code,
                  metaKey: chord.modifier === "Meta",
                  ctrlKey: chord.modifier === "Control",
                  altKey: Boolean(chord.alt),
                  shiftKey: Boolean(chord.shift),
                  bubbles: true,
                  cancelable: true,
                }),
              );
            },
            {
              ...testCase,
              modifier,
            },
          );
        } else {
          await page.keyboard.press(testCase.key);
        }
        if (testCase.shift) await page.keyboard.up("Shift");
        if (testCase.alt) await page.keyboard.up("Alt");
        await page.keyboard.up(modifier);
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
  "editor chrome bridge forwards undo to the host immediately after a live iframe drag",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
    });
    try {
      await page.setContent(
        '<body style="margin:0"><iframe id="preview" tabindex="0" style="display:block;width:900px;height:700px;border:0"></iframe></body>',
      );
      const frame = page
        .frames()
        .find((candidate) => candidate !== page.mainFrame());
      if (!frame) throw new Error("preview iframe did not load");
      await page.locator("#preview").focus();
      await frame.setContent(`<!doctype html>
        <html><head><style>
          html, body { margin: 0; width: 100%; height: 100%; }
          #row { display: flex; gap: 12px; padding: 20px; }
          #row > div { width: 100px; height: 60px; color: white; }
        </style></head><body>
          <div id="row" data-agent-native-node-id="row">
            <div id="a" data-agent-native-node-id="a" style="background:#ef4444">A</div>
            <div id="b" data-agent-native-node-id="b" style="background:#22c55e">B</div>
            <div id="c" data-agent-native-node-id="c" style="background:#3b82f6">C</div>
          </div>
        </body></html>`);
      await frame.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithLiveReflow("drag-undo"),
      });
      await frame.waitForSelector('[data-agent-native-edit-overlay="shield"]', {
        timeout: 2_000,
      });
      await page.evaluate(() => {
        document
          .querySelector("iframe")
          ?.contentWindow?.postMessage(
            { type: "select-element", selector: "#a" },
            "*",
          );
      });
      await frame.waitForFunction(
        () => {
          const overlay = document.querySelector<HTMLElement>(
            '[data-agent-native-edit-overlay="selection"]',
          );
          return (
            overlay && window.getComputedStyle(overlay).display === "block"
          );
        },
        undefined,
        { timeout: 2_000 },
      );
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (
            event.source === document.querySelector("iframe")?.contentWindow
          ) {
            (window as any).__bridgeMessages.push(event.data);
          }
        });
      });

      await page.mouse.move(70, 50);
      await page.mouse.down();
      await page.mouse.move(330, 50, { steps: 10 });
      await page.mouse.up();

      const primary = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.press(`${primary}+z`);
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: { type?: string; key?: string }) =>
            message.type === "design-hotkey" &&
            message.key?.toLowerCase() === "z",
        ),
      );
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
        "IFRAME",
      );
      expect(
        await frame.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>("#row > div")).map(
            (element) => element.id,
          ),
        ),
      ).toEqual(["b", "c", "a"]);
      expect(
        await page.evaluate(() => (window as any).__bridgeMessages),
      ).toContainEqual(
        expect.objectContaining({
          type: "design-hotkey",
          key: "z",
          ...(process.platform === "darwin"
            ? { metaKey: true }
            : { ctrlKey: true }),
        }),
      );
    } finally {
      await browser.close();
    }
  },
);

it(
  "host undo reverts a live iframe reorder while focus remains in the cross-origin frame",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
    });
    const activeEditorDragRef = { current: false };
    const pendingLiveNonStyleEditsRef = { current: [] as any[] };
    const pendingLiveNonStyleUndoStackRef = { current: [] as any[] };
    const pendingLiveNonStyleRedoStackRef = { current: [] as any[] };
    const historyOrderRef = { current: [] as string[] };
    const redoOrderRef = { current: [] as string[] };
    const requestedReverts: any[][] = [];
    const setPendingLiveNonStyleEdits = vi.fn();
    const requestPendingLiveNonStyleRevert = vi.fn((edits: any[]) => {
      requestedReverts.push([...edits]);
    });
    const undoArgs = {
      activeEditorDragRef,
      activeFile: { id: "preview", filename: "preview.html" },
      allowPendingLiveEdits: true,
      canEditDesign: false,
      fileHistoryMutationPendingRef: { current: false },
      historyOrderRef,
      redoOrderRef,
      pendingLiveNonStyleEditsRef,
      pendingLiveNonStyleUndoStackRef,
      pendingLiveNonStyleRedoStackRef,
      pendingVisualStyleEditsRef: { current: [] },
      pendingVisualStyleUndoStackRef: { current: [] },
      pendingVisualStyleRedoStackRef: { current: [] },
      requestPendingLiveNonStyleRevert,
      resetGeometryCommitCoalescing: vi.fn(),
      setPendingLiveNonStyleEdits,
      setSelectedElement: vi.fn(),
      syncUndoRedoState: vi.fn(),
    } as unknown as Parameters<typeof runUndo>[0];
    const recordArgs = {
      canEditDesign: false,
      canEditLiveScreens: new Set(["preview"]),
      cancelPendingStructureVerification: vi.fn(),
      files: [{ id: "preview", filename: "preview.html" }],
      localhostConnectionRootPathByIdRef: { current: new Map() },
      overviewScreens: [
        { id: "preview", filename: "preview.html", sourceType: "localhost" },
      ],
      pendingLiveNonStyleEditsRef,
      pendingLiveNonStyleRedoStackRef,
      pendingLiveNonStyleUndoStackRef,
      pendingStructureRedoReplayRef: { current: undefined },
      pendingStructureRedoReplayTimerRef: { current: undefined },
      pendingVisualStyleRedoStackRef: { current: [] },
      recordPendingHistoryEntry: (kind: string) =>
        historyOrderRef.current.push(kind),
      runtimeLayerSnapshotsById: {},
      setPendingLiveNonStyleEdits,
    } as unknown as Parameters<typeof runRecordPendingLiveStructureEdit>[0];
    const bridgeMessages: Array<Record<string, any>> = [];
    let activeAtUndo: boolean | undefined;
    let historyAtUndo: string[] = [];
    let activeDragId: string | null = null;
    let latestDragEventAt: number | undefined;
    const acceptedDragStates: boolean[] = [];
    let stage = "start";

    try {
      stage = "register local test documents";
      await page.route("http://localhost:4173/host", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html><body style="margin:0"><iframe id="preview" tabindex="0" src="http://127.0.0.1:4173/app" style="display:block;width:900px;height:700px;border:0"></iframe></body></html>`,
        }),
      );
      await page.route("http://127.0.0.1:4173/app", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html><head><style>
            html, body { margin: 0; width: 100%; height: 100%; }
            #row { display: flex; gap: 12px; padding: 20px; }
            #row > div { width: 100px; height: 60px; color: white; }
          </style></head><body>
            <div id="row" data-agent-native-node-id="row">
              <div id="a" data-agent-native-node-id="a" style="background:#ef4444">A</div>
              <div id="b" data-agent-native-node-id="b" style="background:#22c55e">B</div>
              <div id="c" data-agent-native-node-id="c" style="background:#3b82f6">C</div>
            </div>
          </body></html>`,
        }),
      );
      await page.exposeFunction("__hostUndoBridgeMessage", (raw: unknown) => {
        if (!raw || typeof raw !== "object") return;
        const message = raw as Record<string, any>;
        bridgeMessages.push(message);
        if (message.type === "agent-native:editor-drag-state") {
          const state = {
            active: message.active === true,
            dragId:
              typeof message.dragId === "string" ? message.dragId : undefined,
            screenId:
              typeof message.screenId === "string"
                ? message.screenId
                : undefined,
            eventAt:
              typeof message.eventAt === "number" ? message.eventAt : undefined,
          };
          if (
            !shouldAcceptEditorDragStateEvent(state, {
              dragId: activeDragId,
              retiredDragIds: new Set(),
              retiredScreenIds: new Set(),
              latestEventAt:
                state.dragId === activeDragId ? latestDragEventAt : undefined,
            })
          ) {
            return;
          }
          if (state.dragId && typeof state.eventAt === "number") {
            latestDragEventAt = state.eventAt;
          }
          if (state.active && state.dragId) activeDragId = state.dragId;
          if (!state.active) activeDragId = null;
          activeEditorDragRef.current = state.active;
          acceptedDragStates.push(state.active);
          return;
        }
        if (message.type === "visual-structure-change") {
          runRecordPendingLiveStructureEdit(
            recordArgs,
            "preview",
            String(message.selector ?? ""),
            String(
              message.persistenceAnchorSelector ?? message.anchorSelector ?? "",
            ),
            message.persistencePlacement ?? message.placement,
            message.payload,
            {
              sourceId: message.sourceId,
              anchorSourceId:
                message.persistenceAnchorSourceId ?? message.anchorSourceId,
              anchorElementInfo: message.anchorPayload,
              requestId: message.requestId,
              transactionId: message.transactionId,
              dropMode: message.dropMode,
            },
          );
          return;
        }
        if (
          message.type === "design-hotkey" &&
          message.key?.toLowerCase() === "z"
        ) {
          activeAtUndo = activeEditorDragRef.current;
          historyAtUndo = [...historyOrderRef.current];
          const event = {
            key: message.key,
            code: message.code,
            metaKey: message.metaKey,
            ctrlKey: message.ctrlKey,
            shiftKey: message.shiftKey,
            altKey: message.altKey,
            repeat: message.repeat,
            preventDefault: vi.fn(),
          } as unknown as KeyboardEvent;
          handleDesignHotkey(event, {
            canClaimBoundChords: true,
            onUndo: () => runUndo(undoArgs),
          });
        }
      });
      await page.goto("http://localhost:4173/host");
      stage = "install host message handler";
      await page.evaluate(() => {
        const host = window as unknown as Window & {
          __hostUndoBridgeMessage: (message: unknown) => Promise<void>;
          __hostUndoBridgeMessages: Array<Record<string, unknown>>;
          __hostUndoProcessed: Array<string>;
          __hostUndoQueue: Promise<void>;
        };
        const iframe = document.querySelector<HTMLIFrameElement>("#preview");
        host.__hostUndoBridgeMessages = [];
        host.__hostUndoProcessed = [];
        host.__hostUndoQueue = Promise.resolve();
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.source !== iframe?.contentWindow) return;
          host.__hostUndoBridgeMessages.push(event.data);
          const messageType = String(event.data?.type ?? "");
          host.__hostUndoQueue = host.__hostUndoQueue.then(() =>
            host.__hostUndoBridgeMessage(event.data).then(() => {
              host.__hostUndoProcessed.push(messageType);
            }),
          );
        });
      });
      const frame = page
        .frames()
        .find((candidate) => candidate !== page.mainFrame());
      if (!frame) throw new Error("preview iframe did not load");
      stage = "install bridge";
      await frame.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithLiveReflow("preview"),
      });
      await frame.waitForSelector('[data-agent-native-edit-overlay="shield"]', {
        timeout: 2_000,
      });
      await page.locator("#preview").focus();
      await page.evaluate(() => {
        document
          .querySelector<HTMLIFrameElement>("#preview")
          ?.contentWindow?.postMessage(
            { type: "select-element", selector: "#a" },
            "*",
          );
      });

      stage = "drag element";
      await page.mouse.move(70, 50);
      await page.mouse.down();
      await page.mouse.move(330, 50, { steps: 10 });
      await page.mouse.up();
      const primary = process.platform === "darwin" ? "Meta" : "Control";
      stage = "forward host undo";
      await page.keyboard.press(`${primary}+z`);
      await page.waitForFunction(
        () => {
          const host = window as unknown as Window & {
            __hostUndoProcessed?: string[];
          };
          return (
            host.__hostUndoProcessed?.includes("visual-structure-change") &&
            host.__hostUndoProcessed?.includes("design-hotkey")
          );
        },
        undefined,
        { timeout: 3_000 },
      );
      expect(
        bridgeMessages
          .filter(
            (message) =>
              message.type === "visual-structure-change" ||
              message.type === "design-hotkey",
          )
          .map((message) => message.type),
      ).toEqual(["visual-structure-change", "design-hotkey"]);
      expect(acceptedDragStates[0]).toBe(true);
      expect(acceptedDragStates[acceptedDragStates.length - 1]).toBe(false);
      expect(historyAtUndo).toEqual(["pending-live"]);
      expect(historyOrderRef.current).toEqual([]);
      expect(redoOrderRef.current).toEqual(["pending-live"]);
      expect(pendingLiveNonStyleUndoStackRef.current).toHaveLength(0);
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
        "IFRAME",
      );
      expect(activeAtUndo).toBe(false);
      expect(requestPendingLiveNonStyleRevert).toHaveBeenCalledTimes(1);
      expect(requestedReverts[0]).toEqual([
        expect.objectContaining({
          kind: "structure",
          requestId: expect.any(String),
        }),
      ]);
      expect(
        await frame.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>("#row > div")).map(
            (element) => element.id,
          ),
        ),
      ).toEqual(["b", "c", "a"]);

      const [revert] = requestedReverts[0]!;
      const structureChange = bridgeMessages.find(
        (message) => message.type === "visual-structure-change",
      );
      expect(revert?.requestId).toBe(structureChange?.requestId);
      stage = "acknowledge iframe undo";
      await page.evaluate((requestId) => {
        document
          .querySelector<HTMLIFrameElement>("#preview")
          ?.contentWindow?.postMessage(
            { type: "visual-structure-ack", requestId, applied: false },
            "*",
          );
      }, revert.requestId);
      await expect
        .poll(async () =>
          frame.evaluate(() =>
            Array.from(
              document.querySelectorAll<HTMLElement>("#row > div"),
            ).map((element) => element.id),
          ),
        )
        .toEqual(["a", "b", "c"]);
      expect(pendingLiveNonStyleRedoStackRef.current).toHaveLength(1);
    } catch (error) {
      throw new Error(`${stage}: ${String(error)}`);
    } finally {
      await browser.close();
    }
  },
);

const NON_PRIMARY_HOTKEY_FORWARDING_CASES: Array<{
  name: string;
  key: string;
  code: string;
  shift?: boolean;
  alt?: boolean;
}> = [
  { name: "Alt+A align left", key: "a", code: "KeyA", alt: true },
  { name: "Alt+D align right", key: "d", code: "KeyD", alt: true },
  { name: "Alt+W align top", key: "w", code: "KeyW", alt: true },
  { name: "Alt+S align bottom", key: "s", code: "KeyS", alt: true },
  {
    name: "Option+Shift+S Boolean Subtract",
    key: "Í",
    code: "KeyS",
    alt: true,
    shift: true,
  },
  { name: "Alt+H align center-h", key: "h", code: "KeyH", alt: true },
  { name: "Alt+V align center-v", key: "v", code: "KeyV", alt: true },
  { name: "Alt+1 layers panel", key: "1", code: "Digit1", alt: true },
  { name: "Alt+2 assets panel", key: "2", code: "Digit2", alt: true },
  {
    name: "Option+A align left (composed key)",
    key: "å",
    code: "KeyA",
    alt: true,
  },
  {
    name: "Option+H align center-h (composed key)",
    key: "˙",
    code: "KeyH",
    alt: true,
  },
  { name: "Shift+A add auto layout", key: "A", code: "KeyA", shift: true },
  { name: "Shift+H flip horizontal", key: "H", code: "KeyH", shift: true },
  { name: "Shift+V flip vertical", key: "V", code: "KeyV", shift: true },
  { name: "Shift+X swap fill/stroke", key: "X", code: "KeyX", shift: true },
  { name: "Shift+C toggle comments", key: "C", code: "KeyC", shift: true },
  { name: "Shift+L arrow tool", key: "L", code: "KeyL", shift: true },
  { name: "Shift+N previous frame", key: "N", code: "KeyN", shift: true },
  { name: "Shift+Y draw tool", key: "Y", code: "KeyY", shift: true },
  { name: "O ellipse tool", key: "o", code: "KeyO" },
  { name: "L line tool", key: "l", code: "KeyL" },
  { name: "I eyedropper", key: "i", code: "KeyI" },
  { name: "N next frame", key: "n", code: "KeyN" },
  { name: "\\ select parent", key: "\\", code: "Backslash" },
  { name: "] bring to front", key: "]", code: "BracketRight" },
  { name: "[ send to back", key: "[", code: "BracketLeft" },
  {
    name: "physical BracketRight bring to front",
    key: "BracketRight",
    code: "BracketRight",
  },
  {
    name: "physical BracketLeft send to back",
    key: "BracketLeft",
    code: "BracketLeft",
  },
  { name: "= zoom in", key: "=", code: "Equal" },
  { name: "- zoom out", key: "-", code: "Minus" },
  { name: "5 opacity 50%", key: "5", code: "Digit5" },
  { name: "0 opacity 100%", key: "0", code: "Digit0" },
];

it(
  "editor chrome bridge forwards every host-handled non-primary hotkey (Alt-only, Shift-only, and unmodified families)",
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
      for (const testCase of NON_PRIMARY_HOTKEY_FORWARDING_CASES) {
        await page.evaluate(() => {
          (window as any).__bridgeMessages = [];
        });
        await page.evaluate((chord) => {
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: chord.key,
              code: chord.code,
              altKey: Boolean(chord.alt),
              shiftKey: Boolean(chord.shift),
              bubbles: true,
              cancelable: true,
            }),
          );
        }, testCase);
        await page.waitForTimeout(20);
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
  "editor chrome bridge forwards Cmd+K so the host command menu opens from an iframe",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await collectBridgeMessages(page);

      await page.evaluate(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "k",
            code: "KeyK",
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await page.waitForTimeout(60);

      expect(await readBridgeMessages(page)).toContainEqual(
        expect.objectContaining({
          type: "design-hotkey",
          key: "k",
          metaKey: true,
        }),
      );
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge forwards Cmd+\\ and Cmd+Shift+\\, but leaves Shift+\\ and other host chords alone",
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

      await page.evaluate(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "\\",
            code: "Backslash",
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await page.waitForTimeout(60);
      expect(await readBridgeMessages(page)).toContainEqual(
        expect.objectContaining({
          type: "design-hotkey",
          code: "Backslash",
          shiftKey: false,
          metaKey: true,
          ctrlKey: false,
        }),
      );
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
      });

      await page.evaluate(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "|",
            code: "Backslash",
            metaKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await page.waitForTimeout(60);
      expect(await readBridgeMessages(page)).toContainEqual(
        expect.objectContaining({
          type: "design-hotkey",
          code: "Backslash",
          shiftKey: true,
          metaKey: true,
          ctrlKey: false,
        }),
      );
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
      });

      await page.evaluate(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "|",
            code: "Backslash",
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await page.waitForTimeout(60);
      expect(
        (await readBridgeMessages(page)).some(
          (message) => message.type === "design-hotkey",
        ),
      ).toBe(false);
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
      });

      await page.evaluate(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "r",
            code: "KeyR",
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await page.waitForTimeout(60);
      expect(
        (await readBridgeMessages(page)).some(
          (message) => message.type === "design-hotkey",
        ),
      ).toBe(false);

      await page.keyboard.down("Meta");
      await page.keyboard.press("t");
      await page.keyboard.up("Meta");
      await page.keyboard.down("Meta");
      await page.keyboard.press("l");
      await page.keyboard.up("Meta");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge reports and refreshes computed root Screen styles",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 300, height: 200 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));
      await page.setContent(`<!doctype html>
<html>
  <head>
    <style data-agent-native-style-id="root-screen-style">
      html { --color-bg: #f97316; }
      body {
        margin: 0;
        background: var(--color-bg, #ffffff);
        opacity: .5;
        border-radius: 18px;
        min-width: 180px;
        max-width: 420px;
        min-height: 190px;
        max-height: 440px;
      }
    </style>
  </head>
  <body><div>Screen</div></body>
</html>`);
      await collectBridgeMessages(page);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "agent-native:screen-root-computed-styles",
        ),
      );
      const initialMessages = await readBridgeMessages(page);
      const initial = initialMessages.find(
        (message) =>
          message.type === "agent-native:screen-root-computed-styles",
      ) as { computedStyles?: Record<string, string> } | undefined;
      expect(initial?.computedStyles?.backgroundColor).toBe(
        "rgb(249, 115, 22)",
      );
      expect(initial?.computedStyles?.opacity).toBe("0.5");
      expect(initial?.computedStyles?.borderRadius).toBe("18px");
      expect(initial?.computedStyles?.minWidth).toBe("180px");
      expect(initial?.computedStyles?.maxWidth).toBe("420px");
      expect(initial?.computedStyles?.minHeight).toBe("190px");
      expect(initial?.computedStyles?.maxHeight).toBe("440px");

      const replaceSourceHead = async (
        sourceColor: string,
        maxWidth: string,
        expectedColor: string,
      ) => {
        const content = `<!doctype html><html><head>
<style data-agent-native-style-id="root-screen-style">
html { --color-bg: ${sourceColor}; }
body {
  margin: 0;
  background: var(--color-bg, #ffffff);
  opacity: .5;
  border-radius: 18px;
  min-width: 180px;
  max-width: ${maxWidth};
  min-height: 190px;
  max-height: 440px;
}
</style>
</head><body><div>Screen</div></body></html>`;
        await page.evaluate((nextContent) => {
          window.postMessage(
            {
              type: "replace-document-content",
              content: nextContent,
              forceFullDocument: true,
            },
            "*",
          );
        }, content);
        await page.waitForFunction(
          ({ backgroundColor, nextMaxWidth }) =>
            ((window as any).__bridgeMessages ?? []).some(
              (message: any) =>
                message.type === "agent-native:screen-root-computed-styles" &&
                message.computedStyles?.backgroundColor === backgroundColor &&
                message.computedStyles?.maxWidth === nextMaxWidth,
            ),
          { backgroundColor: expectedColor, nextMaxWidth: maxWidth },
        );
        expect(
          await page.locator("body").evaluate((body) => body.textContent),
        ).toBe("Screen");
      };

      await replaceSourceHead("#22c55e", "420px", "rgb(34, 197, 94)");
      await replaceSourceHead("#a855f7", "440px", "rgb(168, 85, 247)");

      await page.evaluate(() => {
        document.body.style.backgroundColor = "#3b82f6";
        document.body.style.maxWidth = "460px";
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "agent-native:screen-root-computed-styles" &&
            message.computedStyles?.backgroundColor === "rgb(59, 130, 246)" &&
            message.computedStyles?.maxWidth === "460px",
        ),
      );
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge reports a measured normal line-height only for selected text",
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
  #text { position: absolute; left: 30px; top: 30px; font: 700 16px Arial; line-height: normal; }
  #shape { position: absolute; left: 30px; top: 80px; width: 60px; height: 30px; }
</style></head><body>
  <div id="text" data-agent-native-node-id="text">Measured title</div>
  <div id="shape" data-agent-native-node-id="shape"></div>
</body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const selectNode = async (selector: string) => {
        await page.evaluate((targetSelector) => {
          (window as any).__bridgeMessages = [];
          window.postMessage(
            {
              type: "select-element",
              selector: targetSelector,
              selectorCandidates: [targetSelector],
            },
            "*",
          );
        }, selector);
        await page.waitForFunction(() =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: any) => message.type === "element-select",
          ),
        );
        return (await readBridgeMessages(page)).find(
          (message) => message.type === "element-select",
        ) as
          | { payload?: { computedStyles?: Record<string, string> } }
          | undefined;
      };

      const textSelect = await selectNode("#text");
      expect(textSelect?.payload?.computedStyles?.lineHeight).toBe("normal");
      expect(
        Number.parseFloat(
          textSelect?.payload?.computedStyles?.resolvedLineHeightPx ?? "",
        ),
      ).toBeGreaterThan(0);
      expect(textSelect?.payload?.computedStyles?.resolvedLineHeightPx).toMatch(
        /^\d+(?:\.\d+)?px$/,
      );

      const shapeSelect = await selectNode("#shape");
      expect(
        shapeSelect?.payload?.computedStyles?.resolvedLineHeightPx,
      ).toBeUndefined();
      expect(await page.locator('span[aria-hidden="true"]').count()).toBe(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge refreshes selected text metadata when a local font finishes loading",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    let releaseFontResponse: (() => void) | undefined;
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const fontBytes = readFileSync(
        resolve(
          designRoot,
          "../../packages/core/src/assets/fonts/NotoNaskhArabic-Variable.ttf",
        ),
      );
      let markFontRequestStarted!: () => void;
      const fontRequestStarted = new Promise<void>((resolveRequest) => {
        markFontRequestStarted = resolveRequest;
      });
      await page.route(
        "https://bridge-font.invalid/noto-naskh-arabic.ttf",
        async (route) => {
          markFontRequestStarted();
          await new Promise<void>((resolveResponse) => {
            releaseFontResponse = resolveResponse;
          });
          await route.fulfill({
            status: 200,
            contentType: "font/ttf",
            body: fontBytes,
          });
        },
      );
      await page.setContent(
        `<!doctype html>
<html><head><style>
  @font-face {
    font-family: "Bridge Fixture";
    src: url("https://bridge-font.invalid/noto-naskh-arabic.ttf") format("truetype");
    font-style: normal;
    font-weight: 100 900;
    font-display: swap;
  }
  html, body { margin: 0; width: 100%; height: 100%; }
  #text { position: absolute; left: 30px; top: 30px; font-family: "Bridge Fixture", serif; font-size: 48px; font-style: normal; font-weight: 700; line-height: normal; }
  #other { position: absolute; left: 30px; top: 120px; }
</style></head><body>
  <div id="text" data-agent-native-node-id="text">قياس ارتفاع النص</div>
  <div id="other" data-agent-native-node-id="other">Other selected text</div>
</body></html>`,
        { waitUntil: "domcontentloaded" },
      );
      await fontRequestStarted;
      await collectBridgeMessages(page);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithTextEditing(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="text"]',
            selectorCandidates: ['[data-agent-native-node-id="text"]'],
          },
          "*",
        );
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) => message.type === "element-select",
        ),
      );
      const initialSelection = (await readBridgeMessages(page)).find(
        (message) => message.type === "element-select",
      ) as
        | { payload?: { computedStyles?: Record<string, string> } }
        | undefined;
      const initialLineHeight = Number.parseFloat(
        initialSelection?.payload?.computedStyles?.resolvedLineHeightPx ?? "",
      );
      expect(initialLineHeight).toBeGreaterThan(0);

      await page.evaluate(() => {
        window.postMessage(
          { type: "begin-text-edit", nodeId: "text", force: true },
          "*",
        );
      });
      await page.waitForSelector("[data-agent-native-text-editing]");
      await page.evaluate(() => {
        const text = document.querySelector("#text")!.firstChild!;
        const range = document.createRange();
        range.selectNodeContents(text);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "text-editing-state" &&
            message.active === true &&
            message.hasRange === true,
        ),
      );
      const initialRenderedHeight = await page
        .locator("#text")
        .evaluate((element) => element.getBoundingClientRect().height);
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
      });

      releaseFontResponse?.();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolveFrame) =>
          requestAnimationFrame(() => resolveFrame()),
        );
      });
      await page.waitForFunction(() => {
        return document.fonts.check(
          '700 48px "Bridge Fixture"',
          "قياس ارتفاع النص",
        );
      });
      let loadedMessages = await readBridgeMessages(page);
      await page.waitForFunction(() => {
        const messages = (window as any).__bridgeMessages ?? [];
        return (
          messages.some((message: any) => message.type === "element-select") &&
          messages.some(
            (message: any) =>
              message.type === "text-editing-state" &&
              message.active === true &&
              message.hasRange === true,
          )
        );
      });
      loadedMessages = await readBridgeMessages(page);
      const activeRangeUpdate = loadedMessages.find(
        (message) =>
          message.type === "text-editing-state" &&
          (message as { active?: boolean }).active === true &&
          (message as { hasRange?: boolean }).hasRange === true,
      ) as
        | {
            computedStyles?: Record<string, string>;
          }
        | undefined;
      expect(activeRangeUpdate?.computedStyles?.fontFamily).toContain(
        "Bridge Fixture",
      );
      expect(activeRangeUpdate?.computedStyles?.resolvedLineHeightPx).toMatch(
        /^\d+(?:\.\d+)?px$/,
      );
      const loadedLineHeight = Number.parseFloat(
        activeRangeUpdate?.computedStyles?.resolvedLineHeightPx ?? "",
      );
      const loadedRenderedHeight = await page
        .locator("#text")
        .evaluate((element) => element.getBoundingClientRect().height);
      expect(loadedLineHeight).not.toBe(initialLineHeight);
      expect(loadedRenderedHeight).not.toBe(initialRenderedHeight);
      expect(loadedRenderedHeight).toBeCloseTo(loadedLineHeight, 1);
      expect(
        loadedMessages.some(
          (message) =>
            message.type === "text-content-change" ||
            message.type === "style-change",
        ),
      ).toBe(false);
      const wholeLayerUpdate = loadedMessages.find(
        (message) => message.type === "element-select",
      ) as
        | {
            intent?: unknown;
            payload?: { computedStyles?: Record<string, string> };
          }
        | undefined;
      expect(wholeLayerUpdate?.intent).toBeUndefined();
      expect(wholeLayerUpdate?.payload?.computedStyles?.fontFamily).toContain(
        "Bridge Fixture",
      );
      expect(
        wholeLayerUpdate?.payload?.computedStyles?.resolvedLineHeightPx,
      ).toMatch(/^\d+(?:\.\d+)?px$/);
      const wholeLayerLineHeight = Number.parseFloat(
        wholeLayerUpdate?.payload?.computedStyles?.resolvedLineHeightPx ?? "",
      );
      expect(wholeLayerLineHeight).not.toBe(initialLineHeight);
      expect(wholeLayerLineHeight).toBeCloseTo(loadedRenderedHeight, 1);

      await page.evaluate(() => {
        window.postMessage(
          { type: "select-elements", selectorGroups: [["#other"]] },
          "*",
        );
      });
      await page.waitForFunction(() =>
        Array.from(
          document.querySelectorAll(
            '[data-agent-native-edit-overlay="multi-selection"]:not([data-agent-native-multi-selection-bounds])',
          ),
        ).some((overlay) => getComputedStyle(overlay).display !== "none"),
      );
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        document.fonts.dispatchEvent(new Event("loadingdone"));
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolveFrame) =>
            requestAnimationFrame(() => resolveFrame()),
          ),
      );
      loadedMessages = await readBridgeMessages(page);
      expect(
        loadedMessages.some(
          (message) =>
            message.type === "element-select" ||
            message.type === "text-editing-state",
        ),
      ).toBe(false);
      expect(
        await page
          .locator(
            '[data-agent-native-edit-overlay="multi-selection"]:not([data-agent-native-multi-selection-bounds])',
          )
          .count(),
      ).toBeGreaterThan(0);

      await page.evaluate(() => {
        window.postMessage(
          { type: "select-elements", selectorGroups: [] },
          "*",
        );
      });
      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            '[data-agent-native-edit-overlay="multi-selection"]:not([data-agent-native-multi-selection-bounds])',
          ).length === 0,
      );
      await page.evaluate(() => {
        document
          .querySelector("#text")!
          .removeAttribute("data-agent-native-text-editing");
        (window as any).__bridgeMessages = [];
        document.fonts.dispatchEvent(new Event("loadingdone"));
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolveFrame) =>
            requestAnimationFrame(() => resolveFrame()),
          ),
      );
      expect(
        (await readBridgeMessages(page)).some(
          (message) => message.type === "text-editing-state",
        ),
      ).toBe(false);

      await page
        .locator("#text")
        .evaluate((target: HTMLElement) => target.blur());
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "text-editing-state" &&
            message.active === false &&
            message.hasRange === true,
        ),
      );
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        document.fonts.dispatchEvent(new Event("loadingdone"));
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "text-editing-state" &&
            message.active === false &&
            message.hasRange === true,
        ),
      );
      const suspendedRangeUpdate = (await readBridgeMessages(page)).find(
        (message) =>
          message.type === "text-editing-state" &&
          (message as { active?: boolean }).active === false &&
          (message as { hasRange?: boolean }).hasRange === true,
      ) as { computedStyles?: Record<string, string> } | undefined;
      expect(suspendedRangeUpdate?.computedStyles?.fontFamily).toContain(
        "Bridge Fixture",
      );

      await page.evaluate(() => {
        window.postMessage({ type: "clear-selection" }, "*");
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "text-editing-state" &&
            message.active === false &&
            message.hasRange === false,
        ),
      );
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        document.fonts.dispatchEvent(new Event("loadingdone"));
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolveFrame) =>
            requestAnimationFrame(() => resolveFrame()),
          ),
      );
      expect(
        (await readBridgeMessages(page)).some(
          (message) =>
            message.type === "element-select" ||
            message.type === "text-editing-state",
        ),
      ).toBe(false);

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="text"]',
            selectorCandidates: ['[data-agent-native-node-id="text"]'],
          },
          "*",
        );
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) => message.type === "element-select",
        ),
      );
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        document.querySelector("#text")!.remove();
        document.fonts.dispatchEvent(new Event("loadingdone"));
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolveFrame) =>
            requestAnimationFrame(() => resolveFrame()),
          ),
      );
      expect(
        (await readBridgeMessages(page)).some(
          (message) =>
            message.type === "element-select" ||
            message.type === "text-editing-state",
        ),
      ).toBe(false);
      expect(pageErrors).toEqual([]);
    } finally {
      releaseFontResponse?.();
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge measures normal line-height from a selected nested text range",
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
  #target { position: absolute; left: 30px; top: 30px; width: 500px; font: 400 24px Arial; line-height: normal; }
  #nested { font: 700 16px Arial; line-height: normal; }
  #other { font: 700 18px Arial; line-height: normal; }
</style></head><body>
  <div id="target" data-agent-native-node-id="target">Parent text <span id="nested">Nested title</span> <span id="other">Other title</span></div>
</body></html>`);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithTextEditing(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="target"]',
            selectorCandidates: ['[data-agent-native-node-id="target"]'],
          },
          "*",
        );
        window.postMessage(
          { type: "begin-text-edit", nodeId: "target", force: true },
          "*",
        );
      });
      await page.waitForSelector("[data-agent-native-text-editing]", {
        timeout: 5_000,
      });
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        const nested = document.querySelector("#nested")!;
        const range = document.createRange();
        range.selectNodeContents(nested);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "text-editing-state" && message.hasRange === true,
        ),
      );
      const nestedRangeState = (await readBridgeMessages(page)).find(
        (message) =>
          message.type === "text-editing-state" && message.hasRange === true,
      ) as
        | {
            sourceId?: string;
            computedStyles?: Record<string, string>;
            inlineStyles?: Record<string, string>;
          }
        | undefined;
      expect(nestedRangeState?.sourceId).toBe("target");
      expect(nestedRangeState?.computedStyles?.fontSize).toBe("16px");
      expect(nestedRangeState?.computedStyles?.fontWeight).toBe("700");
      expect(nestedRangeState?.computedStyles?.lineHeight).toBe("normal");
      expect(nestedRangeState?.computedStyles?.resolvedLineHeightPx).toMatch(
        /^\d+(?:\.\d+)?px$/,
      );
      expect(nestedRangeState?.inlineStyles?.lineHeight).toBe("");

      await page.evaluate(() => {
        window.postMessage(
          { type: "text-edit-inspector-focus", focused: true },
          "*",
        );
      });
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-agent-native-text-editing]", {
        state: "detached",
        timeout: 5_000,
      });

      await page.evaluate(() => {
        const shield = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="shield"]',
        )!;
        const rect = document.querySelector("#target")!.getBoundingClientRect();
        (window as any).__bridgeMessages = [];
        shield.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 450,
            clientY: rect.top + rect.height / 2,
          }),
        );
      });
      await page.waitForFunction(
        () =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: any) => message.type === "element-select",
          ),
        undefined,
        { timeout: 5_000 },
      );
      const selected = (await readBridgeMessages(page)).find(
        (message) => message.type === "element-select",
      ) as
        | { payload?: { computedStyles?: Record<string, string> } }
        | undefined;

      expect(selected?.payload?.computedStyles?.fontSize).toBe("Mixed");
      expect(selected?.payload?.computedStyles?.fontWeight).toBe("Mixed");
      expect(selected?.payload?.computedStyles?.lineHeight).toBe("normal");
      expect(
        selected?.payload?.computedStyles?.resolvedLineHeightPx,
      ).toBeUndefined();
      expect(
        await page
          .locator("#target")
          .evaluate((el) => getComputedStyle(el).lineHeight),
      ).toBe("normal");
      expect(
        await page
          .locator("#target")
          .evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe("24px");
      expect(
        await page
          .locator("#nested")
          .evaluate((el) => getComputedStyle(el).lineHeight),
      ).toBe("normal");

      await page.evaluate(() => {
        window.postMessage(
          { type: "begin-text-edit", nodeId: "target", force: true },
          "*",
        );
      });
      await page.waitForSelector("[data-agent-native-text-editing]", {
        timeout: 5_000,
      });
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        const start = document.querySelector("#nested")!.firstChild!;
        const end = document.querySelector("#other")!.firstChild!;
        const range = document.createRange();
        range.setStart(start, 0);
        range.setEnd(end, end.textContent!.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "text-editing-state" && message.hasRange === true,
        ),
      );
      const mixedRangeState = (await readBridgeMessages(page)).find(
        (message) =>
          message.type === "text-editing-state" && message.hasRange === true,
      ) as { computedStyles?: Record<string, string> } | undefined;
      expect(mixedRangeState?.computedStyles?.fontSize).toBe("Mixed");
      expect(
        mixedRangeState?.computedStyles?.resolvedLineHeightPx,
      ).toBeUndefined();

      await page.evaluate(() => {
        window.postMessage(
          { type: "text-edit-inspector-focus", focused: true },
          "*",
        );
      });
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-agent-native-text-editing]", {
        state: "detached",
        timeout: 5_000,
      });
      await page.evaluate(() => {
        const shield = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="shield"]',
        )!;
        const rect = document.querySelector("#target")!.getBoundingClientRect();
        (window as any).__bridgeMessages = [];
        shield.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 450,
            clientY: rect.top + rect.height / 2,
          }),
        );
      });
      await page.waitForFunction(
        () =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: any) => message.type === "element-select",
          ),
        undefined,
        { timeout: 5_000 },
      );
      const mixedRange = (await readBridgeMessages(page)).find(
        (message) => message.type === "element-select",
      ) as
        | { payload?: { computedStyles?: Record<string, string> } }
        | undefined;
      expect(mixedRange?.payload?.computedStyles?.fontSize).toBe("Mixed");
      expect(
        mixedRange?.payload?.computedStyles?.resolvedLineHeightPx,
      ).toBeUndefined();
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge follows the caret text leaf and aggregates whole-text styles",
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
  #target { position: absolute; left: 30px; top: 30px; width: 500px; font: 400 24px Arial; }
  #nested { font: 700 16px Arial; }
  #wrapped { font: 400 24px Arial; line-height: 30px; }
  #wrapped-a { font: 700 16px Arial; }
  #wrapped-b { font: 400 20px Arial; }
  #group { font: 400 24px Arial; line-height: 30px; }
  #group-child { font: 700 16px Arial; }
  #frame, #container { font: 400 24px Arial; line-height: 30px; }
  #frame-child, #container-child { display: block; font: 700 16px Arial; }
</style></head><body>
  <div id="target" data-agent-native-node-id="target" style="line-height:30px">Parent <span id="nested" style="line-height:150%">Nested title</span> suffix</div>
  <p id="wrapped" data-agent-native-node-id="wrapped"><span id="wrapped-a">First run</span><span id="wrapped-b">Second run</span></p>
  <div id="group" data-agent-native-node-id="group" data-agent-native-group="true">Group text <span id="group-child">Child text</span></div>
  <div id="frame" data-agent-native-node-id="frame" data-an-primitive="frame">Frame text <span id="frame-child">Frame child</span></div>
  <div id="container" data-agent-native-node-id="container">Container text <div id="container-child">Block child</div></div>
</body></html>`);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScriptWithTextEditing(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="target"]',
            selectorCandidates: ['[data-agent-native-node-id="target"]'],
          },
          "*",
        );
      });
      await page.waitForFunction(
        () =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: any) => message.type === "element-select",
          ),
        undefined,
        { timeout: 5_000 },
      );
      const wholeText = (await readBridgeMessages(page)).find(
        (message) => message.type === "element-select",
      ) as
        | { payload?: { computedStyles?: Record<string, string> } }
        | undefined;
      expect(wholeText?.payload?.computedStyles?.fontSize).toBe("Mixed");
      expect(wholeText?.payload?.computedStyles?.fontWeight).toBe("Mixed");
      expect(wholeText?.payload?.computedStyles?.lineHeight).toBe("Mixed");
      expect(
        wholeText?.payload?.computedStyles?.resolvedLineHeightPx,
      ).toBeUndefined();

      const selectPayload = async (nodeId: string) => {
        await page.evaluate((id) => {
          (window as any).__bridgeMessages = [];
          window.postMessage(
            {
              type: "select-element",
              selector: `[data-agent-native-node-id="${id}"]`,
              selectorCandidates: [`[data-agent-native-node-id="${id}"]`],
            },
            "*",
          );
        }, nodeId);
        await page.waitForFunction(
          () =>
            ((window as any).__bridgeMessages ?? []).some(
              (message: any) => message.type === "element-select",
            ),
          undefined,
          { timeout: 5_000 },
        );
        return (await readBridgeMessages(page)).find(
          (message) => message.type === "element-select",
        ) as
          | { payload?: { computedStyles?: Record<string, string> } }
          | undefined;
      };
      const wrappedRuns = await selectPayload("wrapped");
      expect(wrappedRuns?.payload?.computedStyles?.fontSize).toBe("Mixed");
      expect(wrappedRuns?.payload?.computedStyles?.fontWeight).toBe("Mixed");
      const group = await selectPayload("group");
      expect(group?.payload?.computedStyles?.fontSize).toBe("24px");
      const frame = await selectPayload("frame");
      expect(frame?.payload?.computedStyles?.fontSize).toBe("24px");
      const container = await selectPayload("container");
      expect(container?.payload?.computedStyles?.fontSize).toBe("24px");
      await selectPayload("target");

      await page.evaluate(() => {
        window.postMessage(
          { type: "begin-text-edit", nodeId: "target", force: true },
          "*",
        );
      });
      const target = page.locator("#target");
      await page.waitForFunction(
        () =>
          document.querySelector("#target")?.getAttribute("contenteditable") ===
          "true",
        undefined,
        { timeout: 5_000 },
      );

      const placeCaret = async (selector: string, offset: number) => {
        await page.evaluate(
          ({ targetSelector, caretOffset }) => {
            (window as any).__bridgeMessages = [];
            const leaf = document.querySelector(targetSelector)?.firstChild;
            if (!leaf || leaf.nodeType !== Node.TEXT_NODE) {
              throw new Error(`Missing text leaf for ${targetSelector}`);
            }
            const range = document.createRange();
            range.setStart(leaf, caretOffset);
            range.collapse(true);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            document.dispatchEvent(new Event("selectionchange"));
          },
          { targetSelector: selector, caretOffset: offset },
        );
      };
      const activeTextState = async (fontSize: string) => {
        await page.waitForFunction(
          (expectedSize) =>
            ((window as any).__bridgeMessages ?? []).some(
              (message: any) =>
                message.type === "text-editing-state" &&
                message.active === true &&
                message.hasRange === false &&
                message.computedStyles?.fontSize === expectedSize,
            ),
          fontSize,
          { timeout: 5_000 },
        );
        const states = (await readBridgeMessages(page)).filter(
          (message) => message.type === "text-editing-state",
        );
        return states[states.length - 1] as
          | {
              hasRange?: boolean;
              computedStyles?: Record<string, string>;
              inlineStyles?: Record<string, string>;
            }
          | undefined;
      };

      await placeCaret("#nested", 0);
      const nestedCaret = await activeTextState("16px");
      expect(nestedCaret?.computedStyles?.fontWeight).toBe("700");
      expect(nestedCaret?.computedStyles?.lineHeight).toBe("24px");
      expect(nestedCaret?.inlineStyles?.lineHeight).toBe("150%");

      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        const targetElement = document.querySelector("#target")!;
        const range = document.createRange();
        range.setStart(targetElement, 0);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      const parentCaret = await activeTextState("24px");
      expect(parentCaret?.computedStyles?.fontWeight).toBe("400");
      expect(parentCaret?.computedStyles?.lineHeight).toBe("30px");
      expect(parentCaret?.inlineStyles?.lineHeight).toBe("30px");

      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        const targetElement = document.querySelector("#target")!;
        const range = document.createRange();
        range.selectNodeContents(targetElement);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      await page.waitForFunction(
        () =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: any) =>
              message.type === "text-editing-state" &&
              message.hasRange === true &&
              message.computedStyles?.fontSize === "Mixed",
          ),
        undefined,
        { timeout: 5_000 },
      );
      const textStates = (await readBridgeMessages(page)).filter(
        (message) => message.type === "text-editing-state",
      );
      const mixedTextState = textStates[textStates.length - 1] as
        | { computedStyles?: Record<string, string> }
        | undefined;
      expect(
        mixedTextState?.computedStyles?.resolvedLineHeightPx,
      ).toBeUndefined();

      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () =>
          document.querySelector("#target")?.getAttribute("contenteditable") !==
          "true",
        undefined,
        { timeout: 5_000 },
      );
      await page.evaluate(() => {
        const shield = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="shield"]',
        )!;
        const rect = document.querySelector("#target")!.getBoundingClientRect();
        (window as any).__bridgeMessages = [];
        shield.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 450,
            clientY: rect.top + rect.height / 2,
          }),
        );
      });
      await page.waitForFunction(
        () =>
          ((window as any).__bridgeMessages ?? []).some(
            (message: any) => message.type === "element-select",
          ),
        undefined,
        { timeout: 5_000 },
      );
      const afterExit = (await readBridgeMessages(page)).find(
        (message) => message.type === "element-select",
      ) as
        | { payload?: { computedStyles?: Record<string, string> } }
        | undefined;
      expect(afterExit?.payload?.computedStyles?.fontSize).toBe("Mixed");
      expect(afterExit?.payload?.computedStyles?.lineHeight).toBe("Mixed");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

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

it(
  "reports only explicitly authored border sides in the selection inline-style payload",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(`<!doctype html>
<html><body>
  <div id="shorthand" data-agent-native-node-id="shorthand" style="border-width: 6px; border-style: solid; border-color: #111827"></div>
  <div id="sides" data-agent-native-node-id="sides" style="border-top-width: 6px; border-right-width: 6px; border-bottom-width: 6px; border-left-width: 6px; border-top-style: solid; border-right-style: solid; border-bottom-style: solid; border-left-style: solid; border-top-color: #111827; border-right-color: #111827; border-bottom-color: #111827; border-left-color: #111827"></div>
  <div id="top-border" data-agent-native-node-id="top-border" style="border-top: 6px solid #111827"></div>
</body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const select = async (selector: string) => {
        await page.evaluate((targetSelector) => {
          window.postMessage(
            {
              type: "select-element",
              selector: targetSelector,
              selectorCandidates: [targetSelector],
            },
            "*",
          );
        }, selector);
        await page.waitForFunction(
          (sourceId) =>
            ((window as any).__bridgeMessages ?? []).some(
              (message: any) =>
                message.type === "element-select" &&
                message.payload?.sourceId === sourceId,
            ),
          selector.slice(1),
        );
        return (await readBridgeMessages(page)).find(
          (message) =>
            message.type === "element-select" &&
            (message as any).payload?.sourceId === selector.slice(1),
        ) as
          | { payload?: { inlineStyles?: Record<string, string> } }
          | undefined;
      };

      const shorthand = await select("#shorthand");
      expect(shorthand?.payload?.inlineStyles?.borderWidth).toBe("6px");
      expect(shorthand?.payload?.inlineStyles).not.toHaveProperty(
        "borderTopWidth",
      );
      expect(shorthand?.payload?.inlineStyles).not.toHaveProperty(
        "borderTopStyle",
      );
      expect(shorthand?.payload?.inlineStyles).not.toHaveProperty(
        "borderTopColor",
      );

      const sides = await select("#sides");
      expect(sides?.payload?.inlineStyles?.borderTopWidth).toBe("6px");
      expect(sides?.payload?.inlineStyles?.borderTopStyle).toBe("solid");
      expect(sides?.payload?.inlineStyles?.borderTopColor).toBe(
        "rgb(17, 24, 39)",
      );

      const topBorder = await select("#top-border");
      expect(topBorder?.payload?.inlineStyles?.borderTop).toBe(
        "6px solid rgb(17, 24, 39)",
      );
      expect(topBorder?.payload?.inlineStyles).not.toHaveProperty(
        "borderRight",
      );
    } finally {
      await browser.close();
    }
  },
);

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
      #text-target {
        position: absolute; left: 220px; top: 40px;
        background-image: linear-gradient(90deg, red 0%, blue 100%);
        background-clip: text;
        -webkit-background-clip: text;
        color: transparent;
      }
    </style>
  </head>
  <body>
    <div id="target" data-agent-native-node-id="target"></div>
    <button id="text-target" data-agent-native-node-id="text-target">Listen now</button>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

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
      const backgroundImage = select?.payload?.computedStyles?.backgroundImage;
      expect(backgroundImage).toBeTruthy();
      expect(backgroundImage).toContain("gradient");
      expect((backgroundImage ?? "").match(/%/g)?.length).toBe(3);

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

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: "#text-target",
            selectorCandidates: ["#text-target"],
          },
          "*",
        );
      });
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "element-select" &&
            message.payload?.id === "text-target",
        ),
      );
      const textSelect = (await readBridgeMessages(page)).find(
        (message) =>
          message.type === "element-select" &&
          (message as any).payload?.id === "text-target",
      ) as
        | { payload?: { computedStyles?: Record<string, string> } }
        | undefined;
      expect(textSelect?.payload?.computedStyles?.backgroundClip).toBe("text");

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "snapshots authored paint from SVG geometry and Boolean result sources",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><body>
        <svg id="path-layer" data-agent-native-node-id="path-layer" data-an-primitive="path" viewBox="0 0 20 20">
          <path d="M0 0h20v20H0z" fill="#123456"></path>
        </svg>
        <svg id="boolean-layer" data-agent-native-node-id="boolean-layer" data-an-primitive="boolean" viewBox="0 0 20 20" style="--boolean-mask-fill:color-mix(in srgb, #654321 0%, transparent)">
          <defs><path id="boolean-base" d="M0 0h20v20H0z"></path></defs>
          <use data-an-boolean-result="true" href="#boolean-base" style="fill:var(--boolean-mask-fill)"></use>
        </svg>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const select = async (selector: string) => {
        await page.evaluate((targetSelector) => {
          (window as any).__bridgeMessages = [];
          window.postMessage(
            {
              type: "select-element",
              selector: targetSelector,
              selectorCandidates: [targetSelector],
            },
            "*",
          );
        }, selector);
        await page.waitForFunction(
          (targetSelector) =>
            ((window as any).__bridgeMessages ?? []).some(
              (message: any) =>
                message.type === "element-select" &&
                message.payload?.selector?.includes(targetSelector.slice(1)),
            ),
          selector,
        );
        const message = (await readBridgeMessages(page)).find(
          (entry) => entry.type === "element-select",
        ) as
          | {
              payload?: {
                inlineStyles?: Record<string, string>;
              };
            }
          | undefined;
        return message?.payload?.inlineStyles?.fill;
      };

      expect(await select("#path-layer")).toBe("#123456");
      expect(await select("#boolean-layer")).toContain(
        "color-mix(in srgb, #654321 0%, transparent)",
      );
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

it(
  "flow-reorder of a card past a sibling text card reorders in the column, never nesting into it or converting it to flex (Phase 0.3)",
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
      html, body { margin: 0; width: 100%; height: 100%; background: white; }
      #col { display: flex; flex-direction: column; gap: 16px; padding: 20px;
             align-items: stretch; width: 340px; }
      #col > div { height: 60px; background: #e5e7eb; }
    </style>
  </head>
  <body>
    <div id="col" data-agent-native-node-id="col">
      <div id="card-a" data-agent-native-node-id="card-a">Card A — first card</div>
      <div id="card-b" data-agent-native-node-id="card-b">Card B — second card</div>
      <div id="card-c" data-agent-native-node-id="card-c">Card C — third card</div>
    </div>
  </body>
</html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      await selectElementDirect(page, '[data-agent-native-node-id="card-b"]');
      await page.mouse.move(170, 126);
      await page.mouse.down();
      await page.mouse.move(170, 135, { steps: 4 });
      await page.mouse.move(170, 210, { steps: 10 });

      const guideMidDrag = await page.evaluate(() => {
        const guide = document.querySelector<HTMLElement>(
          "[data-agent-native-insertion-guide]",
        );
        return {
          connected: !!guide?.isConnected,
          display: guide ? window.getComputedStyle(guide).display : "missing",
        };
      });

      await page.mouse.up();
      await page.waitForTimeout(40);

      const result = await page.evaluate(() => {
        const b = document.querySelector<HTMLElement>("#card-b")!;
        const c = document.querySelector<HTMLElement>("#card-c")!;
        return {
          cardBParentId: b.parentElement?.id,
          cardCInlineDisplay: c.style.display,
          order: Array.from(document.querySelectorAll("#col > div")).map(
            (el) => el.id,
          ),
        };
      });

      expect(result.cardBParentId).toBe("col");
      expect(result.cardCInlineDisplay).not.toBe("flex");
      expect(result.order).toEqual(["card-a", "card-c", "card-b"]);
      expect(guideMidDrag.connected).toBe(true);
      expect(guideMidDrag.display).not.toBe("none");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge reads Fiber owner provenance even when a source plugin already stamped data-source-*",
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
  <head><style>html,body{margin:0;width:100%;height:100%}#target{position:absolute;left:40px;top:40px;width:120px;height:60px}</style></head>
  <body><button id="target" data-agent-native-node-id="target" data-source-file="src/components/Card.jsx" data-source-line="7" data-source-column="9">Buy</button></body>
</html>`);
      await page.locator("#target").evaluate((element) => {
        Object.defineProperty(element, "__reactFiber$bridgeguard", {
          configurable: true,
          enumerable: true,
          value: {
            type: "button",
            key: null,
            _debugStack: {
              stack:
                "Error\n    at Card (http://localhost:8220/src/components/Card.jsx:25:32)",
            },
            return: {
              type: function Card() {},
              key: "b",
              _debugStack: {
                stack: "Error\n    at http://localhost:8220/src/App.jsx:55:51",
              },
              return: null,
            },
          },
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);
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
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) => message.type === "element-select",
        ),
      );
      const messages = await readBridgeMessages(page);
      const provenance = (
        messages.find((message) => message.type === "element-select") as
          | { payload?: { provenance?: Record<string, unknown> } }
          | undefined
      )?.payload?.provenance;

      expect(provenance).toMatchObject({
        sourceFile: "src/components/Card.jsx",
        line: 7,
        column: 9,
        method: "data-attribute",
        ownerSourceFile: "src/App.jsx",
        ownerLine: 55,
        ownerColumn: 51,
        ownerKey: "b",
        ownerMethod: "debug-stack",
      });
      expect(provenance?.unavailableReason).toBeUndefined();
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

const STACKED_DROP_TARGET_PAGE = `<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: white; }
      #source {
        position: absolute; left: 20px; top: 20px; width: 180px;
        display: flex; flex-direction: column; gap: 8px;
      }
      #source > div { height: 40px; background: #6366f1; }
      #stack {
        position: absolute; left: 320px; top: 20px; width: 400px;
        padding: 12px; background: #eee;
      }
      #stack > div { height: 40px; background: #22c55e; }
      #stack > div + div { margin-top: 12px; }
      #empty {
        position: absolute; left: 320px; top: 320px;
        width: 400px; height: 200px; background: #ddd;
      }
    </style>
  </head>
  <body>
    <div id="source" data-agent-native-node-id="source">
      <div id="dragme" data-agent-native-node-id="dragme">A</div>
      <div id="stay" data-agent-native-node-id="stay">B</div>
    </div>
    <div id="stack" data-agent-native-node-id="stack">
      <div id="r1" data-agent-native-node-id="r1">Row 1</div>
      <div id="r2" data-agent-native-node-id="r2">Row 2</div>
      <div id="r3" data-agent-native-node-id="r3">Row 3</div>
    </div>
    <div id="empty" data-agent-native-node-id="empty"></div>
  </body>
</html>`;

async function dragFlowChildOnto(
  page: import("@playwright/test").Page,
  targetSelector: string,
) {
  const from = (await page.locator("#dragme").boundingBox())!;
  const to = (await page.locator(targetSelector).boundingBox())!;
  await selectElementDirect(page, "#dragme");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await page.waitForTimeout(30);
}

it(
  "editor chrome bridge leaves a plain drop target that already has children in normal flow",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));
      await page.setContent(STACKED_DROP_TARGET_PAGE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const spacingBefore = await page.evaluate(() => {
        const r1 = document.querySelector("#r1")!.getBoundingClientRect();
        const r2 = document.querySelector("#r2")!.getBoundingClientRect();
        return Math.round(r2.top - r1.bottom);
      });
      await dragFlowChildOnto(page, "#r2");

      const result = await page.evaluate(() => {
        const stack = document.querySelector<HTMLElement>("#stack")!;
        const r1 = document.querySelector("#r1")!.getBoundingClientRect();
        const r2 = document.querySelector("#r2")!.getBoundingClientRect();
        return {
          draggedParentId: document.querySelector("#dragme")?.parentElement?.id,
          display: window.getComputedStyle(stack).display,
          inlineStyle: stack.getAttribute("style"),
          spacing: Math.round(r2.top - r1.bottom),
        };
      });

      expect(result.draggedParentId).toBe("stack");
      expect(result.display).toBe("block");
      expect(result.inlineStyle).toBeNull();
      expect(result.spacing).toBe(spacingBefore);

      const messages = await readBridgeMessages(page);
      const conversion = messages.find(
        (message) =>
          message.type === "visual-style-change" &&
          (message as any).selector?.includes("stack"),
      );
      expect(conversion).toBeFalsy();
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge converts an empty plain drop target to column auto layout",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));
      await page.setContent(STACKED_DROP_TARGET_PAGE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);
      await dragFlowChildOnto(page, "#empty");

      const result = await page.evaluate(() => {
        const empty = document.querySelector<HTMLElement>("#empty")!;
        return {
          draggedParentId: document.querySelector("#dragme")?.parentElement?.id,
          display: window.getComputedStyle(empty).display,
          flexDirection: window.getComputedStyle(empty).flexDirection,
        };
      });

      expect(result.draggedParentId).toBe("empty");
      expect(result.display).toBe("flex");
      expect(result.flexDirection).toBe("column");

      const messages = await readBridgeMessages(page);
      const conversion = messages.find(
        (message) =>
          message.type === "visual-style-change" &&
          (message as any).selector?.includes("empty"),
      ) as any;
      expect(conversion?.styles).toMatchObject({
        display: "flex",
        "flex-direction": "column",
        gap: "10px",
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "hit-test bridge treats an unmarked absolute group with children as a free-form container",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="group" data-agent-native-node-id="group" data-agent-native-layer-name="Group 2" style="position:absolute;left:300px;top:180px;width:220px;height:160px">
          <div data-agent-native-node-id="c1" style="position:absolute;left:0;top:0;width:40px;height:40px"></div>
          <div data-agent-native-node-id="c2" style="position:absolute;left:0;top:80px;width:40px;height:40px"></div>
        </div>
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
                correlationId: "group-container",
                x: 460,
                y: 260,
                preview: false,
              },
              "*",
            );
          }),
      )) as { anchorNodeId: string; placement: string; dropMode: string };

      expect(reply.anchorNodeId).toBe("group");
      expect(reply.placement).toBe("inside");
      expect(reply.dropMode).toBe("absolute-container");
    } finally {
      await browser.close();
    }
  },
);

it(
  "hit-test bridge treats an unmarked absolute <section> with children as a free-form container",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <section id="sec" data-agent-native-node-id="sec" style="position:absolute;left:300px;top:180px;width:220px;height:160px">
          <div data-agent-native-node-id="c1" style="position:absolute;left:0;top:0;width:40px;height:40px"></div>
        </section>
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
                correlationId: "section-container",
                x: 460,
                y: 300,
                preview: false,
              },
              "*",
            );
          }),
      )) as { anchorNodeId: string; placement: string; dropMode: string };

      expect(reply.anchorNodeId).toBe("sec");
      expect(reply.dropMode).toBe("absolute-container");
    } finally {
      await browser.close();
    }
  },
);

it(
  "forced nested hit testing refuses a locked descendant subtree",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="outer" data-agent-native-node-id="outer" style="display:flex;width:500px;height:300px">
          <div id="locked" data-agent-native-locked="true" style="display:flex;width:300px;height:200px">
            <div id="child" data-agent-native-node-id="child" style="width:100px;height:100px"></div>
          </div>
        </div>
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
                correlationId: "locked-nested",
                x: 50,
                y: 50,
                preview: false,
                modifiers: { forceNestedAutoLayout: true },
              },
              "*",
            );
          }),
      )) as { anchorNodeId: string };

      expect(reply.anchorNodeId).toBe("");
    } finally {
      await browser.close();
    }
  },
);

it("keeps isAbsolutePrimitiveContainer identical in both bridges", () => {
  const extract = (filename: string) => {
    const source = readFileSync(join(bridgeDir, filename), "utf-8");
    const start = source.indexOf(
      "  function isAbsolutePrimitiveContainer(el: Element | null): boolean {",
    );
    expect(
      start,
      `${filename} defines isAbsolutePrimitiveContainer`,
    ).toBeGreaterThan(-1);
    const end = source.indexOf("\n  }\n", start);
    return source.slice(start, end);
  };

  expect(extract("hit-test.bridge.ts")).toBe(
    extract("editor-chrome.bridge.ts"),
  );
});

it("coalesces free-drag target and overlay work", () => {
  const bridge = readFileSync(
    join(bridgeDir, "editor-chrome.bridge.ts"),
    "utf-8",
  );
  const start = bridge.indexOf("var currentAutoLayoutTarget:");
  const end = bridge.indexOf(
    "function restoreSourceDragPosition(): void {",
    start,
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const freeDragLoop = bridge.slice(start, end);

  expect(freeDragLoop).toContain(
    "scheduleAutoLayoutTargetResolution(ev, snapResult)",
  );
  expect(freeDragLoop).toContain("scheduleRefreshOverlays()");
  expect(freeDragLoop).not.toContain(
    `currentAutoLayoutTarget = !bridgeSpaceKeyPressed
          ? autoLayoutInsertionTargetForPoint(`,
  );
  expect(freeDragLoop).not.toContain(`      refreshOverlays();
`);

  const pointerUp = bridge.slice(bridge.indexOf("function onUp(ev)"));
  expect(pointerUp).toContain("autoLayoutInsertionTargetForPoint(");
  expect(pointerUp).toContain(
    "currentAutoLayoutTarget = finalAutoLayoutTarget;",
  );
});

it("snapshots drag modifiers before queued target resolution", () => {
  const bridge = readFileSync(
    join(bridgeDir, "editor-chrome.bridge.ts"),
    "utf-8",
  );
  const start = bridge.indexOf("var pendingAutoLayoutTargetPoint:");
  const end = bridge.indexOf(
    "// Client px per CSS px for this element.",
    start,
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const dragScheduler = bridge.slice(start, end);

  expect(dragScheduler).toMatch(
    /spaceKeyPressed:\s*[\s\S]*bridgeSpaceKeyPressed/,
  );
  expect(dragScheduler).toMatch(
    /ignoreAutoLayoutKeyPressed:\s*[\s\S]*bridgeIgnoreAutoLayoutKeyPressed/,
  );
  expect(dragScheduler).toContain("if (point.spaceKeyPressed)");
  expect(dragScheduler).toContain("isIgnoreAutoLayoutChordForDragPoint(point)");
  expect(dragScheduler).toContain("dragChromeSuppressed = true");
  expect(dragScheduler).toContain("hideSnapGuides()");
  expect(dragScheduler).toContain("hideSizeBadge()");
  expect(dragScheduler).toContain("hideConstraintGuides()");
  expect(dragScheduler).toContain("showSnapGuides(");
  expect(dragScheduler).toContain("showConstraintGuides(dragEl)");
  expect(dragScheduler).not.toContain("isIgnoreAutoLayoutChord(point)");

  const moveStart = bridge.indexOf("        if (!bridgeSpaceKeyPressed) {");
  const moveEnd = bridge.indexOf("// Snap guides only make sense", moveStart);
  expect(moveStart).toBeGreaterThan(-1);
  expect(moveEnd).toBeGreaterThan(moveStart);
  expect(bridge.slice(moveStart, moveEnd)).toContain("hideInsertionGuide()");

  const pointerUp = bridge.slice(bridge.indexOf("function onUp(ev)"));
  expect(pointerUp).toContain("isIgnoreAutoLayoutChord(ev)");
  expect(bridge).toContain("cancelAutoLayoutTargetResolution();");
});

it("keeps the authored inline-style key list in sync with the bridge", () => {
  const bridge = readFileSync(
    join(bridgeDir, "editor-chrome.bridge.ts"),
    "utf-8",
  );
  const start = bridge.indexOf("var INLINE_STYLE_PROPERTIES = [");
  expect(start).toBeGreaterThan(-1);
  const bridgeKeys = [
    ...bridge
      .slice(start, bridge.indexOf("];", start))
      .matchAll(/"([-a-zA-Z][-a-zA-Z0-9]*)"/g),
  ].map((m) => m[1]);

  expect([...AUTHORED_INLINE_STYLE_PROPERTIES].sort()).toEqual(
    bridgeKeys.sort(),
  );
});

it("retains grid placement for authored grouped and cross-grid sources", () => {
  const bridge = readFileSync(
    join(bridgeDir, "editor-chrome.bridge.ts"),
    "utf-8",
  );
  const start = bridge.indexOf("var sourceHasAuthoredPlacement = Boolean(");
  const end = bridge.indexOf("var hasAuthoredSingleCellSourcePlacement", start);
  expect(start).toBeGreaterThan(-1);
  const classifier = bridge.slice(start, end);
  expect(classifier).toContain("excluded?.some");
  expect(classifier).toContain("hasAuthoredPlacement");
  expect(classifier).not.toContain("parentElement === container");
});

it(
  "carries an authored grid-auto-flow into the selection's inline-style payload",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><body>
        <div id="dense-grid" data-agent-native-node-id="dense-grid" style="display:grid;grid-auto-flow:dense;grid-template-columns:repeat(2, 1fr)"><div>Cell</div></div>
        <div id="column-grid" data-agent-native-node-id="column-grid" style="display:grid;grid-auto-flow:column"><div id="column-grid-child">Cell</div></div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const selectElementPayload = async (selector: string) => {
        await page.evaluate((targetSelector) => {
          (window as any).__bridgeMessages = [];
          window.postMessage(
            {
              type: "select-element",
              selector: targetSelector,
              selectorCandidates: [targetSelector],
            },
            "*",
          );
        }, selector);
        await page.waitForFunction(
          (targetSelector) =>
            ((window as any).__bridgeMessages ?? []).some(
              (message: any) =>
                message.type === "element-select" &&
                message.payload?.selector?.includes(targetSelector.slice(1)),
            ),
          selector,
        );
        const message = (await readBridgeMessages(page)).find(
          (entry) => entry.type === "element-select",
        ) as
          | {
              payload?: {
                inlineStyles?: Record<string, string>;
                parentLayout?: { gridAutoFlow?: string };
              };
            }
          | undefined;
        return message?.payload;
      };
      const selectInlineStyles = async (selector: string) =>
        (await selectElementPayload(selector))?.inlineStyles;

      const dense = await selectInlineStyles("#dense-grid");
      expect(dense?.gridAutoFlow).toContain("dense");
      expect(dense?.gridTemplateColumns).toBe("repeat(2, 1fr)");
      expect((await selectInlineStyles("#column-grid"))?.gridAutoFlow).toBe(
        "column",
      );
      const childPayload = await selectElementPayload("#column-grid-child");
      expect(childPayload?.parentLayout?.gridAutoFlow).toBe("column");
    } finally {
      await browser.close();
    }
  },
);

it(
  "keeps stylesheet-authored flex/grid sizing distinct from auto defaults",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 500 },
      });
      await page.setContent(`<!doctype html><style>
        html, body { margin: 0; }
        .flex-explicit { display: flex; width: 240px; height: 100px; }
        .flex-important { display: flex; width: 240px !important; height: 100px !important; }
        .flex-auto { display: flex; }
        .grid-explicit { display: grid; width: 240px; height: 100px; }
        .grid-auto { display: grid; }
      </style>
      <div id="flex-explicit" class="flex-explicit"><span>Explicit flex</span></div>
      <div id="flex-important" class="flex-important" style="width:auto;height:auto"><span>Important flex</span></div>
      <div id="flex-auto" class="flex-auto"><span>Auto flex</span></div>
      <div id="grid-explicit" class="grid-explicit"><span>Explicit grid</span></div>
      <div id="grid-auto" class="grid-auto"><span>Auto grid</span></div>`);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        (window as any).__lastElementSelection = undefined;
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "element-select") {
            (window as any).__lastElementSelection = event.data.payload;
          }
        });
      });

      const select = async (id: string) => {
        await page.evaluate((id) => {
          window.postMessage(
            {
              type: "select-element",
              selector: `#${id}`,
              selectorCandidates: [`#${id}`],
            },
            "*",
          );
        }, id);
        await page.waitForFunction(
          (id) => (window as any).__lastElementSelection?.sourceId === id,
          id,
        );
        return page.evaluate(() => (window as any).__lastElementSelection);
      };

      for (const id of ["flex-explicit", "grid-explicit"] as const) {
        const payload = await select(id);
        expect(payload.inlineStyles).toEqual({});
        expect(payload.authoredSizeStyles).toEqual({
          width: "240px",
          height: "100px",
        });
        expect(inferElementSizing(payload, "horizontal")).toBe("fixed");
        expect(inferElementSizing(payload, "vertical")).toBe("fixed");
      }

      const important = await select("flex-important");
      expect(important.inlineStyles).toMatchObject({
        width: "auto",
        height: "auto",
      });
      expect(important.authoredSizeStyles).toEqual({
        width: "240px",
        height: "100px",
      });
      expect(inferElementSizing(important, "horizontal")).toBe("fixed");
      expect(inferElementSizing(important, "vertical")).toBe("fixed");

      for (const id of ["flex-auto", "grid-auto"] as const) {
        const payload = await select(id);
        expect(payload.inlineStyles).toEqual({});
        expect(payload.authoredSizeStyles).toEqual({
          width: "auto",
          height: "auto",
        });
        expect(inferElementSizing(payload, "horizontal")).toBe("hug");
        expect(inferElementSizing(payload, "vertical")).toBe("hug");
      }
    } finally {
      await browser.close();
    }
  },
);

it(
  "hit-test bridge keeps an absolute card with in-flow children on the flow path",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="card" data-agent-native-node-id="card" style="position:absolute;left:300px;top:180px;width:260px;background:#fff;padding:16px">
          <h2 data-agent-native-node-id="t">Title</h2>
          <p data-agent-native-node-id="p">Body copy</p>
        </div>
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
            const rect = document
              .querySelector("#card p")!
              .getBoundingClientRect();
            window.postMessage(
              {
                type: "agent-native:hit-test",
                correlationId: "card-flow",
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
                preview: false,
              },
              "*",
            );
          }),
      )) as { dropMode: string };

      expect(reply.dropMode).toBe("flow-insert");
    } finally {
      await browser.close();
    }
  },
);

it(
  "editor chrome bridge relays video clipboard files to the host",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(["video"], "clipboard.mp4", { type: "video/mp4" }),
        );
        document.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
      });

      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) => message.type === "canvas-image-paste",
        ),
      );
      const messages = await readBridgeMessages(page);
      const paste = messages.find(
        (message) => message.type === "canvas-image-paste",
      ) as
        | {
            files?: Array<{ type?: string; dataUrl?: string; name?: string }>;
            screenId?: string;
          }
        | undefined;
      expect(paste).not.toHaveProperty("screenId");
      expect(paste?.files).toEqual([
        expect.objectContaining({
          type: "video/mp4",
          name: "clipboard.mp4",
          dataUrl: expect.stringMatching(/^data:video\/mp4;base64,/),
        }),
      ]);
    } finally {
      await browser.close();
    }
  },
);

it(
  "relays SVG clipboard files through the sanitized SVG paste path",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(
          false,
          "screen-target",
          false,
        ),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const defaultPrevented = await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(
            ['<svg width="17" height="9"><path d="M0 0h17"/></svg>'],
            "clipboard.svg",
            { type: "image/svg+xml" },
          ),
        );
        const event = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        });
        document.dispatchEvent(event);
        return event.defaultPrevented;
      });
      expect(defaultPrevented).toBe(true);
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "figma-clipboard-paste" &&
            message.svg?.includes('<path d="M0 0h17"'),
        ),
      );

      const paste = (await readBridgeMessages(page)).find(
        (message) => message.type === "figma-clipboard-paste",
      ) as { content?: string; screenId?: string; svg?: string } | undefined;
      expect(paste).toMatchObject({
        content: "",
        screenId: "screen-target",
        svg: '<svg width="17" height="9"><path d="M0 0h17"/></svg>',
      });
    } finally {
      await browser.close();
    }
  },
);

it(
  "omits screen binding when relaying SVG clipboard files from the board iframe",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(false, "board", true),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(['<svg><path d="M0 0h17"/></svg>'], "board.svg", {
            type: "image/svg+xml",
          }),
        );
        document.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
      });

      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "figma-clipboard-paste" &&
            message.svg?.includes('<path d="M0 0h17"'),
        ),
      );
      const paste = (await readBridgeMessages(page)).find(
        (message) => message.type === "figma-clipboard-paste",
      ) as { screenId?: string; svg?: string } | undefined;
      expect(paste?.svg).toBe('<svg><path d="M0 0h17"/></svg>');
      expect(paste).not.toHaveProperty("screenId");
    } finally {
      await browser.close();
    }
  },
);

it(
  "relays every SVG and mixed image/video file from one iframe clipboard paste",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(
          false,
          "screen-target",
          false,
        ),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(['<svg><path d="M0 0h1"/></svg>'], "first.svg", {
            type: "image/svg+xml",
          }),
        );
        transfer.items.add(
          new File(['<svg><circle r="2"/></svg>'], "second.svg", {
            type: "application/octet-stream",
          }),
        );
        transfer.items.add(
          new File(["image"], "photo.png", { type: "image/png" }),
        );
        transfer.items.add(
          new File(["video"], "clip.mp4", { type: "video/mp4" }),
        );
        document.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
      });

      await page.waitForFunction(
        () => {
          const messages = (window as any).__bridgeMessages ?? [];
          return (
            messages.filter(
              (message: any) =>
                message.type === "figma-clipboard-paste" && message.svg,
            ).length === 2 &&
            messages.some(
              (message: any) => message.type === "canvas-image-paste",
            )
          );
        },
        undefined,
        { timeout: 5_000 },
      );
      const messages = await readBridgeMessages(page);
      expect(
        messages
          .filter((message) => message.type === "figma-clipboard-paste")
          .map((message) => {
            const paste = message as { screenId?: string; svg?: string };
            return { screenId: paste.screenId, svg: paste.svg };
          }),
      ).toEqual([
        {
          screenId: "screen-target",
          svg: '<svg><path d="M0 0h1"/></svg>',
        },
        {
          screenId: "screen-target",
          svg: '<svg><circle r="2"/></svg>',
        },
      ]);
      expect(messages[messages.length - 1]).toMatchObject({
        type: "canvas-image-paste",
        screenId: "screen-target",
        files: [
          expect.objectContaining({ type: "image/png", name: "photo.png" }),
          expect.objectContaining({ type: "video/mp4", name: "clip.mp4" }),
        ],
      });
    } finally {
      await browser.close();
    }
  },
);

it(
  "consumes oversized SVG clipboard files and reports the rejection",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(
          false,
          "screen-target",
          false,
        ),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const defaultPrevented = await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(["x".repeat(1_000_001)], "large.svg", {
            type: "image/svg+xml",
          }),
        );
        const event = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        });
        document.dispatchEvent(event);
        return event.defaultPrevented;
      });
      expect(defaultPrevented).toBe(true);
      const messages = await readBridgeMessages(page);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: "figma-clipboard-paste",
          content: "",
          svgFileError: "too-large",
        }),
      );
    } finally {
      await browser.close();
    }
  },
);

it(
  "consumes unreadable SVG clipboard files and reports the read failure",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(
          false,
          "screen-target",
          false,
        ),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await collectBridgeMessages(page);

      const defaultPrevented = await page.evaluate(() => {
        const file = new File(["<svg/>"], "unreadable.svg", {
          type: "image/svg+xml",
        });
        Object.defineProperty(file, "text", {
          value: () => Promise.reject(new DOMException("Read failed")),
        });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const event = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        });
        document.dispatchEvent(event);
        return event.defaultPrevented;
      });
      expect(defaultPrevented).toBe(true);
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "figma-clipboard-paste" &&
            message.svgFileError === "unreadable",
        ),
      );
    } finally {
      await browser.close();
    }
  },
);
