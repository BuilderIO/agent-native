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

async function sampleXY(page: Page): Promise<{ x: number; y: number }> {
  const canvasBox = await page
    .locator("[data-design-canvas-container]")
    .boundingBox();
  if (!canvasBox) throw new Error("no canvas container box");
  const leftShellBox = await page
    .locator('[data-design-chrome-region="left-shell"]')
    .boundingBox()
    .catch(() => null);
  const rightPanelBox = await page
    .locator('[data-design-chrome-region="right-panel"]')
    .boundingBox()
    .catch(() => null);
  const leftEdge = leftShellBox
    ? leftShellBox.x + leftShellBox.width
    : canvasBox.x;
  const rightEdge = rightPanelBox
    ? rightPanelBox.x
    : canvasBox.x + canvasBox.width;
  const x = Math.round(leftEdge + (rightEdge - leftEdge) * 0.5);
  const y = Math.round(canvasBox.y + canvasBox.height * 0.5);

  const hitInfo = await page.evaluate(
    ({ px, py }) => {
      const el = document.elementFromPoint(px, py) as HTMLElement | null;
      if (!el) return { ok: false, reason: "no element" };
      let cur: HTMLElement | null = el;
      for (let i = 0; i < 8 && cur; i++) {
        if (cur.dataset?.designChromeRegion) {
          return {
            ok: false,
            reason: `hit chrome:${cur.dataset.designChromeRegion}`,
          };
        }
        cur = cur.parentElement;
      }
      return { ok: true, reason: "clear" };
    },
    { px: x, py: y },
  );
  if (!hitInfo.ok) {
    throw new Error(
      `sampleXY point (${x},${y}) is not clear of chrome: ${hitInfo.reason}`,
    );
  }
  return { x, y };
}

test.use({ viewport: { width: 1440, height: 1000 } });

for (const { theme, canvasHex, expectedCanvasRgb, boardTextColor } of [
  {
    theme: "dark",
    canvasHex: "1A1A1A",
    expectedCanvasRgb: "26,26,26",
    boardTextColor: "rgb(255, 255, 255)",
  },
  {
    theme: "light",
    canvasHex: "EBEBEB",
    expectedCanvasRgb: "235,235,235",
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

      const { x: sampleX, y: sampleY } = await sampleXY(page);

      const initialCanvasRgb = await pixelAt(page, sampleX, sampleY);
      expect(initialCanvasRgb).toBe(expectedCanvasRgb);

      const canvasSection = page
        .locator("section.design-sidebar-section")
        .filter({
          has: page.locator(
            'h3.design-sidebar-section-title:text-is("Canvas")',
          ),
        });
      await expect(
        canvasSection.getByRole("textbox", { name: "Color" }),
      ).toHaveValue(canvasHex);
      await expect(canvasSection).not.toContainText("NONE");

      await page.locator('button[aria-label="Rectangle"]').first().click();
      await expect(
        page.locator('button[aria-label="Rectangle"]').first(),
      ).toHaveAttribute("aria-pressed", "true");
      await page.mouse.move(800, 380);
      await page.mouse.down();
      await page.mouse.move(1000, 520, { steps: 12 });
      await page.mouse.up();

      await expect(page.locator("[data-board-surface-layer]")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator('[role="treeitem"]')).toContainText(
        "Rectangle",
      );

      await expect
        .poll(() => pixelAt(page, sampleX, sampleY))
        .toBe(initialCanvasRgb);

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
