import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath } from "./helpers";

async function boardHtml(
  request: APIRequestContext,
  designId: string,
): Promise<string> {
  const baseUrl = e2eBaseURL();
  const response = await request.get(
    `${baseUrl.replace(/\/$/, "")}/_agent-native/actions/get-design?id=${designId}`,
  );
  const design = await response.json();
  return (
    (design.files ?? []).find(
      (file: { filename: string }) => file.filename === "__board__.html",
    )?.content ?? ""
  );
}

/**
 * Computed styles are not paint. Every earlier board-colour assertion read
 * `background-color` off the layer and passed while the frame in front of it
 * painted an opaque white base, which is the bug users kept reporting — so
 * these read the rendered pixels instead.
 */

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const baseUrl = e2eBaseURL();
  const response = await request.post(
    `${baseUrl.replace(/\/$/, "")}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function pixelAt(page: Page, x: number, y: number): Promise<string> {
  const client = await page.context().newCDPSession(page);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  await client.detach();
  return page.evaluate(
    async ({ b64, px, py }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context for the screenshot");
      ctx.drawImage(img, 0, 0);
      const ratio = img.width / window.innerWidth;
      const d = ctx.getImageData(
        Math.round(px * ratio),
        Math.round(py * ratio),
        1,
        1,
      ).data;
      return `${d[0]},${d[1]},${d[2]}`;
    },
    { b64: data, px: x, py: y },
  );
}

test.use({ viewport: { width: 1440, height: 1000 } });

for (const { theme, canvasRgb, canvasHex, boardTextColor } of [
  {
    theme: "dark",
    canvasRgb: "26,26,26",
    canvasHex: "1A1A1A",
    boardTextColor: "rgb(255, 255, 255)",
  },
  {
    theme: "light",
    canvasRgb: "235,235,235",
    canvasHex: "EBEBEB",
    boardTextColor: "currentcolor",
  },
] as const) {
  test(`${theme} theme: the canvas keeps its colour when the board gains its first shape`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    let designId: string | undefined;

    try {
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );

      const created = await postAction(page.request, "create-design", {
        title: `E2E Canvas Background ${theme}`,
        projectType: "prototype",
      });
      designId = created?.id ?? created?.data?.id;
      expect(designId).toBeTruthy();

      await page.goto(appPath(`/design/${designId}`), {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));

      // Well clear of both the shape drawn below and the floating toolbar.
      const canvasBox = await page
        .locator("[data-design-canvas-container]")
        .boundingBox();
      if (!canvasBox) throw new Error("no canvas container box");
      const sampleX = Math.round(canvasBox.x + canvasBox.width * 0.15);
      const sampleY = Math.round(canvasBox.y + canvasBox.height * 0.6);

      await expect.poll(() => pixelAt(page, sampleX, sampleY)).toBe(canvasRgb);

      const canvasSection = page
        .locator("section.design-sidebar-section")
        .filter({
          has: page.locator(
            'h3.design-sidebar-section-title:text-is("Canvas")',
          ),
        });
      await expect(canvasSection).toContainText(canvasHex);
      await expect(canvasSection).not.toContainText("NONE");

      await page.locator('button[aria-label="Rectangle"]').first().click();
      await expect(
        page.locator('button[aria-label="Rectangle"]').first(),
      ).toHaveAttribute("aria-pressed", "true");
      await page.mouse.move(800, 380);
      await page.mouse.down();
      await page.mouse.move(1000, 520, { steps: 12 });
      await page.mouse.up();

      // The board layer only mounts once the board has content, so this is the
      // first moment a second colour can appear over the canvas.
      await expect(page.locator("[data-board-surface-layer]")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator('[role="treeitem"]')).toContainText(
        "Rectangle",
      );

      await expect.poll(() => pixelAt(page, sampleX, sampleY)).toBe(canvasRgb);

      // Board text keys off the same canvas colour: white on a dark canvas,
      // inherited on a light one, where white would be unreadable.
      await page.locator('button[aria-label="Text"]').first().click();
      await expect(
        page.locator('button[aria-label="Text"]').first(),
      ).toHaveAttribute("aria-pressed", "true");
      await page.mouse.move(640, 640);
      await page.mouse.down();
      await page.mouse.move(880, 700, { steps: 12 });
      await page.mouse.up();
      await page.keyboard.type("board text");
      await page.keyboard.press("Escape");

      await expect
        .poll(
          async () => {
            const html = await boardHtml(page.request, designId!);
            const style = html.match(
              /data-an-primitive="text"[^>]*style="([^"]*)"/,
            )?.[1];
            // Absent is not "no colour": without it there is nothing to judge.
            if (!style) return null;
            return style.match(/(?:^|;)\s*color:\s*([^;"]+)/i)?.[1].trim();
          },
          { timeout: 20_000 },
        )
        .toBe(boardTextColor);
    } finally {
      if (designId) {
        await postAction(page.request, "delete-design", { id: designId }).catch(
          () => {},
        );
      }
    }
  });
}
