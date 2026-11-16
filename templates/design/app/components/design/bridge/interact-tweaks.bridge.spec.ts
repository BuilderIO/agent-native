import { chromium, type Frame, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { buildInteractPreviewDocument } from "../design-canvas/interact-document";

const DESIGN = `<!doctype html><html><head><style>:root{--sail-twist:1;--sail-color:#000}</style></head>
<body><div data-agent-native-node-id="sail">Sail</div></body></html>`;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// A read-only canvas frame: scripts run, but the document is an opaque origin
// the editor cannot reach into.
async function openSandboxedInteractFrame(page: Page): Promise<Frame> {
  const srcdoc = buildInteractPreviewDocument({
    content: DESIGN,
    fitBodyToFrame: true,
    tweakValues: { "--sail-twist": "0.25" },
  });
  await page.setContent(
    `<!doctype html><html><body><iframe sandbox="allow-scripts" srcdoc="${escapeAttribute(srcdoc)}"></iframe></body></html>`,
  );
  const handle = await page.waitForSelector("iframe");
  const frame = await handle.contentFrame();
  if (!frame) throw new Error("no Interact frame");
  await frame.waitForLoadState("load");
  return frame;
}

function readVar(frame: Frame, name: string): Promise<string> {
  return frame.evaluate(
    (cssVar) =>
      getComputedStyle(document.documentElement)
        .getPropertyValue(cssVar)
        .trim(),
    name,
  );
}

async function postFromParent(page: Page, values: Record<string, string>) {
  await page.evaluate((tweakValues) => {
    document
      .querySelector("iframe")!
      .contentWindow!.postMessage(
        { type: "tweak-values", values: tweakValues },
        "*",
      );
  }, values);
}

describe("Interact tweaks bridge", () => {
  it("applies knob changes from the editor inside an opaque-origin sandbox", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const frame = await openSandboxedInteractFrame(page);
      expect(await frame.evaluate(() => document.domain)).toBe("");
      expect(await readVar(frame, "--sail-twist")).toBe("0.25");

      await postFromParent(page, {
        "--sail-twist": "0.75",
        "--sail-color": "#8b5cf6",
      });
      await expect.poll(() => readVar(frame, "--sail-twist")).toBe("0.75");
      expect(await readVar(frame, "--sail-color")).toBe("#8b5cf6");

      // A later message is the complete set: a dropped knob falls back to the
      // design's own default.
      await postFromParent(page, { "--sail-twist": "0.5" });
      await expect.poll(() => readVar(frame, "--sail-twist")).toBe("0.5");
      expect(await readVar(frame, "--sail-color")).toBe("#000");
    } finally {
      await browser.close();
    }
  });

  it("ignores messages that do not come from the editor, and values that would add rules", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const frame = await openSandboxedInteractFrame(page);

      await frame.evaluate(() =>
        window.postMessage(
          { type: "tweak-values", values: { "--sail-twist": "9" } },
          "*",
        ),
      );
      await postFromParent(page, {
        "--sail-twist": "0.6",
        "--sail-color": "red} body{display:none",
        "not-a-var": "1",
      });
      await expect.poll(() => readVar(frame, "--sail-twist")).toBe("0.6");
      expect(
        await frame.evaluate(() => getComputedStyle(document.body).display),
      ).toBe("block");
      expect(
        await frame.evaluate(
          () =>
            document.querySelectorAll(
              "style[data-agent-native-interact-tweaks]",
            ).length,
        ),
      ).toBe(1);
    } finally {
      await browser.close();
    }
  });
});
