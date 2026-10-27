import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "@playwright/test";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Host = typeof import("./in-place-text-session.browser-host");

declare global {
  interface Window {
    rteHost: Host;
  }
}

/** One scenario from in-place-text-session.browser-cases.json. */
interface TextCase {
  id: string;
  area: string;
  title: string;
  /** `|` is the caret, `[` `]` the selection. */
  html: string;
  backward?: boolean;
  /** Steps: `type:`, key chords (`Mod` = Cmd/Ctrl), `undo`, `redo`, `caret:b:o`,
   * `select:b1:o1:b2:o2`, `paste-html:`, `paste-text:`, `settle`. */
  steps: string[];
  /** Canonical HTML of the edited element after the steps. */
  expected: string;
  /** Needs macOS editing commands (Cmd/Option navigation and deletion). */
  macOnly?: boolean;
}

const EDITOR_DIR = path.dirname(fileURLToPath(import.meta.url));
const SLIDES_ROOT = path.resolve(EDITOR_DIR, "../../..");
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const CASES: TextCase[] = JSON.parse(
  fs.readFileSync(
    path.join(EDITOR_DIR, "in-place-text-session.browser-cases.json"),
    "utf8",
  ),
);

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (bundledError) {
    try {
      return await chromium.launch({ channel: "chrome", headless: true });
    } catch (channelError) {
      throw new Error(
        [
          "Could not launch Chromium for the in-place text session E2E.",
          `Bundled Chromium error: ${String(bundledError).split("\n")[0]}`,
          `Chrome channel error: ${String(channelError).split("\n")[0]}`,
        ].join("\n"),
      );
    }
  }
}

/** The session and canonicalizer as one browser script, bundled from source. */
async function bundleHost(): Promise<string> {
  const result = await build({
    configFile: false,
    root: SLIDES_ROOT,
    logLevel: "silent",
    // A library build leaves React's `process.env.NODE_ENV` reads in place.
    define: { "process.env.NODE_ENV": '"production"' },
    resolve: {
      alias: {
        "@": path.join(SLIDES_ROOT, "app"),
        "@shared": path.join(SLIDES_ROOT, "shared"),
      },
    },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.join(EDITOR_DIR, "in-place-text-session.browser-host.ts"),
        name: "rteHost",
        formats: ["iife"],
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const bundle = outputs.find((output) => "output" in output);
  const chunk = bundle && "output" in bundle ? bundle.output[0] : undefined;
  if (!chunk) throw new Error("The in-place text session host did not bundle.");
  return chunk.code;
}

const PAGE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { margin: 40px; font: 16px/1.4 Arial, sans-serif; }
      #stage { width: 600px; }
    </style>
  </head>
  <body><div id="stage"></div></body>
</html>`;

let browser: Browser;
let hostScript: string;

beforeAll(async () => {
  [browser, hostScript] = await Promise.all([launchBrowser(), bundleHost()]);
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

const settle = (page: Page) => page.evaluate(() => window.rteHost.settle());

async function runStep(page: Page, step: string) {
  if (step.startsWith("type:")) return page.keyboard.type(step.slice(5));
  if (step === "settle") return;
  if (step === "undo") return page.keyboard.press(`${MOD}+z`);
  if (step === "redo") return page.keyboard.press(`${MOD}+Shift+z`);
  let m = step.match(/^caret:(\d+):(\d+)$/);
  if (m) {
    const at = { b: Number(m[1]), o: Number(m[2]) };
    return page.evaluate((p) => window.rteHost.select(p, p), at);
  }
  m = step.match(/^select:(\d+):(\d+):(\d+):(\d+)$/);
  if (m) {
    const [b1, o1, b2, o2] = m.slice(1).map(Number);
    return page.evaluate(
      ([anchor, focus]) => window.rteHost.select(anchor, focus),
      [
        { b: b1, o: o1 },
        { b: b2, o: o2 },
      ],
    );
  }
  m = step.match(/^paste-(html|text):([\s\S]*)$/);
  if (m) {
    return page.evaluate(
      ([kind, payload]) =>
        window.rteHost.paste(kind as "html" | "text", payload),
      [m[1], m[2]],
    );
  }
  return page.keyboard.press(
    step
      .split("+")
      .map((key) => (key === "Mod" ? MOD : key))
      .join("+"),
  );
}

/** Boots a fresh slide text leaf, runs the steps, and reads the document back. */
async function run(c: TextCase): Promise<{ actual: string; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  try {
    await page.setContent(PAGE_HTML);
    await page.addScriptTag({ content: hostScript });
    await page.evaluate(
      ([html, backward]) => window.rteHost.boot(html as string, !!backward),
      [c.html, c.backward],
    );
    for (const step of c.steps) {
      await runStep(page, step);
      await settle(page);
    }
    const actual = await page.evaluate(() => window.rteHost.canonical());
    return { actual, errors };
  } finally {
    await page.close();
  }
}

const areas = new Map<string, TextCase[]>();
for (const c of CASES) areas.set(c.area, [...(areas.get(c.area) ?? []), c]);

describe.each([...areas])(
  "in-place text session in Chromium: %s",
  (_area, cases) => {
    for (const c of cases) {
      it.skipIf(c.macOnly && process.platform !== "darwin")(
        c.id,
        async () => {
          const { actual, errors } = await run(c);
          expect(errors, `${c.id} raised page errors`).toEqual([]);
          expect(actual, `${c.id}: ${c.title} [${c.steps.join(", ")}]`).toBe(
            c.expected,
          );
        },
        30_000,
      );
    }
  },
);
