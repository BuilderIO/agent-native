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
const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body style="margin:0;min-height:600px">
<main data-agent-native-node-id="main" style="position:relative;min-height:600px">
  <h1 data-agent-native-node-id="hero" style="position:absolute;left:24px;top:16px;margin:0">Hero</h1>
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
    title: `Board pen ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  const second = await action(request, "create-file", {
    designId,
    filename: "second.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const secondId = second.id ?? second.data?.id;
  const board = await action(request, "create-file", {
    designId,
    filename: "__board__.html",
    content: `<!doctype html><html><head><meta charset="utf-8"><title>Board</title></head><body style="margin:0;position:relative;background:transparent;overflow:visible"></body></html>`,
    fileType: "html",
  });
  const boardFileId = board.id ?? board.data?.id;
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
      {
        op: "set",
        path: ["screenMetadata", secondId],
        value: { sourceType: "inline", width: 800, height: 600 },
      },
      {
        op: "set",
        path: ["canvasFrames", secondId],
        value: { x: 1200, y: 0, width: 800, height: 600, z: 0 },
      },
      { op: "set", path: ["boardFileId"], value: boardFileId },
    ],
  });
  return { designId, fileId, secondId, boardFileId };
}

/** Every vector in every canvas iframe, tagged with which document holds it. */
async function allVectors(page: Page) {
  return page.evaluate(() => {
    const out: Array<{
      frame: string;
      left: string;
      top: string;
      fill: string | null;
      d: string | null;
    }> = [];
    document.querySelectorAll("iframe").forEach((iframe) => {
      const doc = (iframe as HTMLIFrameElement).contentDocument;
      if (!doc) return;
      const label =
        iframe.getAttribute("data-screen-iframe-id") ??
        iframe.getAttribute("title") ??
        "(iframe)";
      doc
        .querySelectorAll<SVGElement>("svg[data-an-primitive]")
        .forEach((svg) => {
          out.push({
            frame: label,
            left: (svg as unknown as HTMLElement).style.left,
            top: (svg as unknown as HTMLElement).style.top,
            fill: svg.querySelector("path")?.getAttribute("fill") ?? null,
            d: svg.querySelector("path")?.getAttribute("d") ?? null,
          });
        });
    });
    return out;
  });
}

async function penClick(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function screenVectorCount(page: Page) {
  return page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(
      "iframe[data-screen-iframe-id]",
    )?.contentDocument;
    return doc ? doc.querySelectorAll("svg[data-an-primitive]").length : -1;
  });
}

test("a pen path drawn on the board commits once and keeps the pen armed", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(1);
    await page.waitForTimeout(3000);

    const boxes = await Promise.all(
      (await page.locator("[data-screen-card]").all()).map((card) =>
        card.boundingBox(),
      ),
    );
    const first = boxes[0]!;
    const second = boxes[1]!;
    // The empty board between the two screens.
    const gapX = (first.x + first.width + second.x) / 2;
    const gapY = first.y + 120;

    await page.keyboard.press("p");
    await page.waitForTimeout(400);
    await penClick(page, gapX - 40, gapY);
    await penClick(page, gapX + 20, gapY + 60);
    await penClick(page, gapX - 20, gapY + 120);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);

    expect(await allVectors(page)).toHaveLength(1);
    // The commit must not disarm the tool mid-drawing-session either.
    await expect(
      page
        .locator("[data-design-bottom-toolbar]")
        .getByRole("button", { name: "Pen", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
