import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath } from "./helpers";

const BASE_URL =
  process.env.E2E_BASE_URL ??
  `http://127.0.0.1:${process.env.E2E_PORT ?? "9333"}`;
const FRAME_LEFT = 40;
const FRAME_TOP = 120;
const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body style="margin:0;min-height:600px">
<main data-agent-native-node-id="main" style="position:relative;min-height:600px">
  <div data-agent-native-node-id="frame" data-an-primitive="frame" data-agent-native-layer-name="Frame" style="position:absolute;left:${FRAME_LEFT}px;top:${FRAME_TOP}px;width:600px;height:400px;border:1px solid #ccc"></div>
</main></body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${BASE_URL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Pen in frame QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  if (!fileId) throw new Error("create-file returned no id");
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 800, height: 600 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
      },
    ],
  });
  return designId;
}

/** Each vector's authored geometry next to where it paints, in screen px. */
async function vectors(page: Page) {
  return page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(
      "iframe[data-screen-iframe-id]",
    )?.contentDocument;
    if (!doc) return [];
    return [...doc.querySelectorAll<SVGElement>("svg[data-an-primitive]")].map(
      (svg) => {
        const rect = svg.getBoundingClientRect();
        const numbers = (svg.querySelector("path")?.getAttribute("d") ?? "")
          .split(/[^-\d.]+/)
          .filter(Boolean)
          .map(Number);
        const xs = numbers.filter((_, index) => index % 2 === 0);
        const ys = numbers.filter((_, index) => index % 2 === 1);
        return {
          parent:
            svg.parentElement?.getAttribute("data-agent-native-node-id") ??
            null,
          styleLeft: (svg as unknown as HTMLElement).style.left,
          drawnLeft: Math.min(...xs),
          drawnTop: Math.min(...ys),
          paintedLeft: Math.round(rect.left),
          paintedTop: Math.round(rect.top),
        };
      },
    );
  });
}

async function penClick(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
}

test("a pen path drawn inside a frame paints where it was drawn and stays draggable", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(0);
    await page.waitForTimeout(3000);
    const card = (await page
      .locator("[data-screen-card]")
      .first()
      .boundingBox())!;

    await page.keyboard.press("p");
    await page.waitForTimeout(400);
    await penClick(page, card.x + 60, card.y + 200);
    await penClick(page, card.x + 120, card.y + 140);
    await penClick(page, card.x + 180, card.y + 220);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);

    const drawn = await vectors(page);
    expect(drawn).toHaveLength(1);
    const vector = drawn[0]!;
    expect(vector.parent).toBe("frame");
    // Painted where the path was drawn, not offset by the frame's origin.
    expect(Math.abs(vector.paintedLeft - vector.drawnLeft)).toBeLessThan(6);
    expect(Math.abs(vector.paintedTop - vector.drawnTop)).toBeLessThan(6);

    const box = (await page
      .frameLocator("iframe[data-screen-iframe-id]")
      .locator("svg[data-an-primitive='path']")
      .first()
      .boundingBox())!;
    await page.keyboard.press("v");
    await page.waitForTimeout(400);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.click(centerX, centerY);
    await page.waitForTimeout(800);
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 10, centerY + 8, { steps: 3 });
    await page.mouse.move(centerX + 70, centerY + 50, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(2000);

    const moved = (await vectors(page))[0]!;
    expect(moved.styleLeft).not.toBe(vector.styleLeft);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
