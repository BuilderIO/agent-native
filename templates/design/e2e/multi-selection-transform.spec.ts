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
<body style="margin:0;min-height:900px">
<main data-agent-native-node-id="main" style="position:relative;min-height:900px">
  <p data-agent-native-node-id="text" style="position:absolute;left:96px;top:253px;margin:0;font-size:16px">hello bud</p>
  <div data-agent-native-node-id="rect" style="position:absolute;left:260px;top:240px;width:100px;height:34px;background:#dadada;border:1px solid #ababab"></div>
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
    title: `Multi-selection transform QA ${Date.now()}`,
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
        value: { sourceType: "inline", width: 600, height: 400 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 600, height: 400, z: 0 },
      },
    ],
  });
  return designId;
}

async function openOverview(page: Page, request: APIRequestContext) {
  const designId = await createDesign(request);
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(async () => page.locator("[data-screen-shell]").count(), {
      timeout: 40_000,
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(3000);
  return designId;
}

async function selectTextAndRect(page: Page) {
  const canvas = page.frameLocator("iframe[data-screen-iframe-id]");
  await canvas
    .locator('[data-agent-native-node-id="text"]')
    .click({ force: true });
  await page.waitForTimeout(800);
  await canvas
    .locator('[data-agent-native-node-id="rect"]')
    .click({ force: true, modifiers: ["Shift"] });
  await page.waitForTimeout(1200);
}

/** Geometry of both members plus whether the group bounds box is on screen. */
async function state(page: Page) {
  return page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(
      "iframe[data-screen-iframe-id]",
    )?.contentDocument;
    if (!doc) return null;
    const read = (id: string) => {
      const el = doc.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${id}"]`,
      )!;
      const cs = getComputedStyle(el);
      return {
        left: Math.round(parseFloat(el.style.left || cs.left)),
        top: Math.round(parseFloat(el.style.top || cs.top)),
        width: Math.round(parseFloat(cs.width)),
        fontSize: Math.round(parseFloat(cs.fontSize)),
      };
    };
    const bounds = doc.querySelector<HTMLElement>(
      "[data-agent-native-multi-selection-bounds]",
    );
    return {
      text: read("text"),
      rect: read("rect"),
      groupBoundsVisible: Boolean(
        bounds && getComputedStyle(bounds).display !== "none",
      ),
    };
  });
}

test("the scale tool scales a whole multi-selection and keeps it selected", async ({
  page,
  request,
}) => {
  const designId = await openOverview(page, request);
  try {
    await selectTextAndRect(page);
    await expect(page.getByText("2 selected")).toBeVisible();
    const before = (await state(page))!;
    expect(before.groupBoundsVisible).toBe(true);

    await page.keyboard.press("k");
    await page.waitForTimeout(600);

    const handle = page
      .frameLocator("iframe[data-screen-iframe-id]")
      .locator("[data-agent-native-multi-selection-bounds] [data-corner='se']");
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 - 60,
      box.y + box.height / 2 - 30,
      {
        steps: 10,
      },
    );
    await page.mouse.up();
    await page.waitForTimeout(2000);

    const after = (await state(page))!;
    // Both members shrink, the group's NW corner stays put, and the text
    // scales with the box rather than staying at its authored size.
    expect(after.rect.width).toBeLessThan(before.rect.width);
    expect(after.text.width).toBeLessThan(before.text.width);
    expect(after.text.fontSize).toBeLessThan(before.text.fontSize);
    expect(after.text.left).toBe(before.text.left);
    expect(after.rect.left).toBeLessThan(before.rect.left);
    // Still a multi-selection, so the next gesture can scale it again.
    await expect(page.getByText("2 selected")).toBeVisible();
    expect(after.groupBoundsVisible).toBe(true);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("moving a multi-selection leaves it selected", async ({
  page,
  request,
}) => {
  const designId = await openOverview(page, request);
  try {
    await selectTextAndRect(page);
    const before = (await state(page))!;

    const textBox = (await page
      .frameLocator("iframe[data-screen-iframe-id]")
      .locator('[data-agent-native-node-id="text"]')
      .boundingBox())!;
    const startX = textBox.x + textBox.width / 2;
    const startY = textBox.y + textBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 8, startY + 6, { steps: 3 });
    await page.mouse.move(startX + 60, startY + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(2000);

    const after = (await state(page))!;
    // Both members carry the same delta, so the gap between them is unchanged.
    expect(after.text.left).toBeGreaterThan(before.text.left);
    expect(after.rect.left - after.text.left).toBe(
      before.rect.left - before.text.left,
    );
    await expect(page.getByText("2 selected")).toBeVisible();
    expect(after.groupBoundsVisible).toBe(true);

    // A plain click still collapses the selection to the object clicked.
    await page
      .frameLocator("iframe[data-screen-iframe-id]")
      .locator('[data-agent-native-node-id="rect"]')
      .click({ force: true });
    await page.waitForTimeout(1000);
    await expect(page.getByText("2 selected")).toHaveCount(0);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
