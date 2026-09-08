import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body style="margin:0;min-height:900px">
<main data-agent-native-node-id="main" style="position:relative;min-height:900px">
  <h1 data-agent-native-node-id="hero" style="position:absolute;left:40px;top:48px">Hero</h1>
  <p data-agent-native-node-id="copy" style="position:absolute;left:40px;top:220px">Copy</p>
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
    title: `Tool persistence QA ${Date.now()}`,
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
        value: { sourceType: "inline", width: 1280, height: 900 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 1280, height: 900, z: 0 },
      },
    ],
  });
  return { designId, fileId };
}

async function openOverview(page: Page, designId: string) {
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(async () => page.locator("[data-screen-shell]").count(), {
      timeout: 40_000,
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(2500);
}

/** Drags a shape inside the first screen card, offset so repeat draws don't overlap. */
async function drawShape(page: Page, offset: number) {
  const box = (await page.locator("[data-screen-card]").first().boundingBox())!;
  const x = Math.max(box.x, 0) + 60 + offset;
  const y = Math.max(box.y, 0) + 320;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 70, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(2000);
}

/** Border radii of every drawn ellipse in the screen's live preview. */
async function drawnEllipseRadii(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      "iframe[data-screen-iframe-id]",
    );
    const doc = frame?.contentDocument;
    if (!doc) return [] as string[];
    return [
      ...doc.querySelectorAll<HTMLElement>(
        '[data-agent-native-layer-name="Ellipse"]',
      ),
    ].map((el) => el.style.borderRadius);
  });
}

test("the shape button keeps drawing the shape it was last set to", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);

    const toolbar = page.locator("[data-design-bottom-toolbar]");
    await toolbar.getByRole("button", { name: "Rectangle options" }).click();
    await page.getByRole("menuitem", { name: "Ellipse" }).click();
    await drawShape(page, 0);

    // Drawing drops back to Move by design; the group button must not.
    const shapeButton = toolbar.getByRole("button", {
      name: "Ellipse",
      exact: true,
    });
    await expect(shapeButton).toBeVisible();

    await shapeButton.click();
    await drawShape(page, 200);

    const radii = await drawnEllipseRadii(page);
    expect(radii).toHaveLength(2);
    expect(radii.every((radius) => radius === "50%")).toBe(true);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("the scale tool stays armed when the selection changes", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);

    const canvasFrame = page.frameLocator("iframe[data-screen-iframe-id]");
    await canvasFrame
      .locator('[data-agent-native-node-id="hero"]')
      .click({ force: true });
    await page.waitForTimeout(800);

    const toolbar = page.locator("[data-design-bottom-toolbar]");
    await toolbar.getByRole("button", { name: "Move", exact: true }).click();
    await page.keyboard.press("k");
    await expect(
      toolbar.getByRole("button", { name: "Scale", exact: true }),
    ).toBeVisible();

    await canvasFrame
      .locator('[data-agent-native-node-id="copy"]')
      .click({ force: true });
    await page.waitForTimeout(1200);

    await expect(
      toolbar.getByRole("button", { name: "Scale", exact: true }),
    ).toBeVisible();
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
