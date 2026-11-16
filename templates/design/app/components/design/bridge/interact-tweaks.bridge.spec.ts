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
async function openSandboxedInteractFrame(
  page: Page,
  options: { content?: string; tweakValues?: Record<string, string> } = {
    tweakValues: { "--sail-twist": "0.25" },
  },
): Promise<Frame> {
  const srcdoc = buildInteractPreviewDocument({
    ...options,
    content: options.content ?? DESIGN,
    fitBodyToFrame: true,
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

  it("posts a tweak-set message to the editor from window.__anInteract.setTweak", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const frame = await openSandboxedInteractFrame(page);
      await page.evaluate(() => {
        (window as { received?: unknown[] }).received = [];
        window.addEventListener("message", (event) => {
          if (event.source !== document.querySelector("iframe")!.contentWindow)
            return;
          (window as { received?: unknown[] }).received!.push(event.data);
        });
      });

      await frame.evaluate(() => {
        const api = (
          window as {
            __anInteract?: { setTweak(id: string, value: unknown): void };
          }
        ).__anInteract!;
        api.setTweak("twist", 1.5);
        api.setTweak("--sail-twist", "0.4");
      });

      await expect
        .poll(() =>
          page.evaluate(() => (window as { received?: unknown[] }).received),
        )
        .toEqual([
          { type: "tweak-set", id: "twist", value: 1.5 },
          { type: "tweak-set", cssVar: "--sail-twist", value: "0.4" },
        ]);
    } finally {
      await browser.close();
    }
  });

  it("applies the first message when the document has no baked tweak sheet", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const frame = await openSandboxedInteractFrame(page, {});
      expect(
        await frame.evaluate(
          () =>
            document.querySelectorAll(
              "style[data-agent-native-interact-tweaks]",
            ).length,
        ),
      ).toBe(0);

      await postFromParent(page, { "--sail-twist": "0.75" });
      await expect.poll(() => readVar(frame, "--sail-twist")).toBe("0.75");
    } finally {
      await browser.close();
    }
  });

  it("applies the first message when the tweak sheet holds an unexpected rule", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const frame = await openSandboxedInteractFrame(page, {
        content: DESIGN.replace(
          "</head>",
          "<style data-agent-native-interact-tweaks>:root{--sail-twist:0.1} body{margin:0}</style></head>",
        ),
      });
      expect(await readVar(frame, "--sail-twist")).toBe("0.1");

      await postFromParent(page, { "--sail-twist": "0.75" });
      await expect.poll(() => readVar(frame, "--sail-twist")).toBe("0.75");
    } finally {
      await browser.close();
    }
  });
});
