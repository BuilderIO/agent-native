import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { designFrame, enterDirectMode, gotoEditor } from "./helpers";

const ALIGN_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Alignment fixture</title></head>
  <body style="margin:0;font-family:Arial,sans-serif">
    <div
      data-agent-native-node-id="align-canvas"
      data-agent-native-layer-name="Canvas"
      style="width:800px;height:600px"
    >
      <div
        data-agent-native-node-id="align-frame"
        data-agent-native-layer-name="Board"
        style="position:relative;box-sizing:border-box;width:100%;height:100%;border:10px solid #999999;padding:20px;background:#eeeeee"
      >
        <div
          data-agent-native-node-id="align-chip"
          data-agent-native-layer-name="Chip"
          style="position:absolute;left:300px;top:250px;width:120px;height:60px;background:#fca5a5"
        >Chip</div>
        <div
          data-agent-native-node-id="align-percent-chip"
          data-agent-native-layer-name="Percent"
          style="position:absolute;left:50%;top:100px;width:120px;height:60px;background:#93c5fd"
        >Percent</div>
      </div>
    </div>
  </body>
</html>`;

const AUTO_LAYOUT_ALIGNMENT_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Auto Layout alignment fixture</title></head>
  <body style="margin:0">
    <div data-agent-native-node-id="layout-frame" data-agent-native-layer-name="Layout frame"
         style="position:absolute;left:100px;top:100px;width:400px;height:300px;display:flex;flex-direction:row;justify-content:flex-start;align-items:flex-start;background:#eeeeee">
      <div data-agent-native-node-id="layout-child" data-agent-native-layer-name="Layout child"
           style="width:80px;height:40px;background:#fca5a5"></div>
    </div>
  </body>
</html>`;

const SCROLLED_POSITION_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Scrolled position fixture</title></head>
  <body style="margin:0;width:3000px;height:1600px">
    <main style="position:relative;width:3000px;height:1600px">
      <div data-agent-native-node-id="position-frame" data-agent-native-layer-name="Position frame" data-an-primitive="frame"
           style="position:absolute;left:2285px;top:528px;width:240px;height:220px;padding:24px;box-sizing:border-box;background:#eeeeee">
        <div data-agent-native-node-id="position-vector" data-agent-native-layer-name="Vector" data-an-primitive="rectangle"
             style="width:80px;height:40px;background:#fca5a5"></div>
      </div>
    </main>
  </body>
</html>`;

const GROUP_POSITION_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Group position fixture</title></head>
  <body style="margin:0;width:800px;height:1600px">
      <div data-agent-native-node-id="outer-frame" data-agent-native-layer-name="Outer frame" data-an-primitive="frame"
           style="position:absolute;left:200px;top:800px;width:400px;height:400px;background:#eeeeee">
      <div data-agent-native-node-id="position-group" data-agent-native-layer-name="Position group" data-agent-native-group="true"
           style="position:absolute;left:20px;top:20px;width:160px;height:160px;background:#d1d5db">
        <div data-agent-native-node-id="group-child" data-agent-native-layer-name="Group child" data-an-primitive="rectangle"
             style="position:absolute;left:80px;top:80px;width:80px;height:80px;background:#fca5a5"></div>
      </div>
      <div data-agent-native-node-id="nested-frame" data-agent-native-layer-name="Nested frame" data-an-primitive="frame"
           style="position:absolute;left:220px;top:60px;width:140px;height:140px;background:#c7d2fe">
        <div data-agent-native-node-id="nested-child" data-agent-native-layer-name="Nested child" data-an-primitive="rectangle"
             style="position:absolute;left:10px;top:10px;width:80px;height:80px;background:#93c5fd"></div>
      </div>
</div>
  </body>
</html>`;

const PLAIN_POSITION_WRAPPER_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Plain wrapper position fixture</title></head>
  <body style="margin:0;width:800px;height:600px">
    <div data-agent-native-node-id="position-frame" data-agent-native-layer-name="Position frame" data-an-primitive="frame"
         style="position:absolute;left:200px;top:100px;width:400px;height:300px;background:#eeeeee">
      <div data-agent-native-node-id="plain-wrapper" data-agent-native-layer-name="Plain wrapper"
           style="position:relative;left:20px;top:30px;width:240px;height:200px;background:#dddddd">
        <div data-agent-native-node-id="plain-wrapper-child" data-agent-native-layer-name="Plain wrapper child" data-an-primitive="rectangle"
             style="position:absolute;left:80px;top:90px;width:80px;height:40px;background:#fca5a5"></div>
      </div>
    </div>
  </body>
</html>`;

const CONTAINING_BLOCK_POSITION_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Containing block position fixture</title></head>
  <body style="margin:0;width:800px;height:600px">
    <div data-agent-native-node-id="position-frame" data-agent-native-layer-name="Position frame" data-an-primitive="frame"
         style="position:absolute;left:200px;top:100px;box-sizing:border-box;width:400px;height:300px;border:8px solid #999;padding:20px;background:#eeeeee">
      <div data-agent-native-node-id="static-wrapper" data-agent-native-layer-name="Static wrapper" style="margin:30px 0 0 40px">
        <div data-agent-native-node-id="position-child" data-agent-native-layer-name="Position child" data-an-primitive="rectangle"
             style="position:absolute;left:100px;top:80px;width:80px;height:40px;background:#fca5a5"></div>
      </div>
    </div>
  </body>
</html>`;

const UNFRAMED_POSITION_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Unframed position fixture</title></head>
  <body style="margin:30px 40px;width:800px;height:600px">
    <div data-agent-native-node-id="static-wrapper" data-agent-native-layer-name="Static wrapper" style="margin:30px 0 0 40px">
      <div data-agent-native-node-id="position-child" data-agent-native-layer-name="Position child" data-an-primitive="rectangle"
           style="position:absolute;left:100px;top:80px;width:80px;height:40px;background:#fca5a5"></div>
    </div>
  </body>
</html>`;

const FIXED_POSITION_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Fixed position fixture</title></head>
  <body style="margin:0;width:3000px;height:1600px">
    <main style="width:3000px;height:1600px">
      <div data-agent-native-node-id="fixed-child" data-agent-native-layer-name="Fixed child" data-an-primitive="rectangle"
           style="position:fixed;left:35px;top:24px;width:80px;height:40px;background:#fca5a5">Fixed child</div>
    </main>
  </body>
</html>`;

const TRANSFORMED_POSITION_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Transformed position fixture</title></head>
  <body style="margin:0;width:800px;height:600px">
    <div data-agent-native-node-id="position-frame" data-agent-native-layer-name="Position frame" data-an-primitive="frame"
         style="position:absolute;left:100px;top:100px;width:400px;height:300px;background:#eeeeee">
      <div data-agent-native-node-id="static-transformed-wrapper" data-agent-native-layer-name="Static transformed wrapper"
           style="width:200px;height:200px;margin:20px 0 0 30px;transform:scale(2,.5);transform-origin:top left;background:#dddddd">
        <div data-agent-native-node-id="transformed-child" data-agent-native-layer-name="Transformed child" data-an-primitive="rectangle"
             style="position:absolute;left:50px;top:40px;width:80px;height:40px;transform:translateX(10px);background:#fca5a5"></div>
      </div>
    </div>
  </body>
</html>`;

const BOUNDS_WIDTH = 780;
const BOUNDS_HEIGHT = 580;
const CHIP_WIDTH = 120;
const CHIP_HEIGHT = 60;

const ALIGN_LABELS = [
  "Align left",
  "Align horizontal centers",
  "Align right",
  "Align top",
  "Align vertical centers",
  "Align bottom",
] as const;

async function postAction(
  request: APIRequestContext,
  baseURL: string,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${baseURL.replace(/\/$/, "")}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function openEditPanel(page: Page, designId: string) {
  await gotoEditor(page, designId);
  await leaveResponsivePreview(page);
  await enterDirectMode(page);
  await leaveResponsivePreview(page);
}

async function leaveResponsivePreview(page: Page) {
  const previewControls = page.locator(
    "[data-design-top-bar] [data-design-interact-route]",
  );
  if ((await previewControls.count()) > 0) {
    await page
      .locator('[data-design-top-bar] [data-design-mode="edit"]')
      .click();
    await expect(previewControls).toHaveCount(0);
  }
}

function requireBaseURL(baseURL: string | undefined): string {
  if (!baseURL) throw new Error("playwright baseURL is not configured");
  return baseURL;
}

function alignButton(page: Page, label: string) {
  return page.getByRole("button", { name: label, exact: true }).first();
}

async function selectLayer(page: Page, layerName: string) {
  const tree = page.getByRole("tree", { name: "Layers" });
  const row = tree
    .getByRole("button", { name: layerName, exact: true })
    .first();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await row.isVisible().catch(() => false)) break;
    const expander = tree.getByRole("button", { name: "Expand layer" }).first();
    if (!(await expander.isVisible().catch(() => false))) break;
    await expander.click();
    await page.waitForTimeout(250);
  }
  await expect(row).toBeVisible();
  await row.click();
  await expect(
    tree.locator('[role="treeitem"][aria-selected="true"]'),
  ).toContainText(layerName);
}

async function layerOffset(page: Page, layerName: string) {
  return designFrame(page)
    .locator(`[data-agent-native-layer-name="${layerName}"]`)
    .evaluate((element) => {
      const parent = element.parentElement!;
      const child = element.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      return {
        left: Math.round(child.left - parentRect.left - parent.clientLeft),
        top: Math.round(child.top - parentRect.top - parent.clientTop),
      };
    });
}

async function positionReferenceOffset(page: Page, layerName: string) {
  return designFrame(page)
    .locator(`[data-agent-native-layer-name="${layerName}"]`)
    .evaluate((element) => {
      const reference =
        element.parentElement?.closest('[data-an-primitive="frame"]') ??
        element.ownerDocument.documentElement;
      const childRect = element.getBoundingClientRect();
      const referenceRect = reference.getBoundingClientRect();
      return {
        x: Math.round(childRect.x - referenceRect.x),
        y: Math.round(childRect.y - referenceRect.y),
      };
    });
}

async function expectOffset(
  page: Page,
  layerName: string,
  expected: { left: number; top: number },
) {
  await expect
    .poll(() => layerOffset(page, layerName), { timeout: 10_000 })
    .toEqual(expected);
}

async function seedDesign(
  request: APIRequestContext,
  baseURL: string,
  html: string = ALIGN_HTML,
) {
  const created = await postAction(request, baseURL, "create-design", {
    title: `Alignment ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  await postAction(request, baseURL, "create-file", {
    designId,
    filename: "index.html",
    content: html,
    fileType: "html",
  });
  return designId;
}

test("Left and Right alignment controls move to their named edges", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(request, requireBaseURL(baseURL));
  await openEditPanel(page, designId);
  await selectLayer(page, "Chip");
  await expectOffset(page, "Chip", { left: 300, top: 250 });

  await alignButton(page, "Align right").click();
  await expectOffset(page, "Chip", {
    left: BOUNDS_WIDTH - CHIP_WIDTH,
    top: 250,
  });

  await alignButton(page, "Align left").click();
  await expectOffset(page, "Chip", { left: 0, top: 250 });
});

test("Top and Bottom alignment controls move to their named edges", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(request, requireBaseURL(baseURL));
  await openEditPanel(page, designId);
  await selectLayer(page, "Chip");
  await expectOffset(page, "Chip", { left: 300, top: 250 });

  await alignButton(page, "Align bottom").click();
  await expectOffset(page, "Chip", {
    left: 300,
    top: BOUNDS_HEIGHT - CHIP_HEIGHT,
  });

  await alignButton(page, "Align top").click();
  await expectOffset(page, "Chip", { left: 300, top: 0 });
});

test("aligning one axis leaves a percentage offset on the other axis put", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(request, requireBaseURL(baseURL));
  await openEditPanel(page, designId);
  await selectLayer(page, "Percent");
  const half = BOUNDS_WIDTH / 2;
  await expectOffset(page, "Percent", { left: half, top: 100 });

  await alignButton(page, "Align top").click();
  await expectOffset(page, "Percent", { left: half, top: 0 });
});

test("a lone top-level frame has nothing to align against", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(request, requireBaseURL(baseURL));
  await openEditPanel(page, designId);
  await selectLayer(page, "Canvas");

  for (const label of ALIGN_LABELS) {
    await expect(alignButton(page, label)).toBeDisabled();
  }
});

test("Auto Layout matrix centers both axes and persists after reload", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(
    request,
    requireBaseURL(baseURL),
    AUTO_LAYOUT_ALIGNMENT_HTML,
  );
  await openEditPanel(page, designId);
  await selectLayer(page, "Layout frame");

  const center = page.getByRole("button", {
    name: "middle center",
    exact: true,
  });
  await expect(center).toBeVisible();
  await center.click();

  const centeredOnBothAxes = async () =>
    designFrame(page)
      .locator('[data-agent-native-node-id="layout-frame"]')
      .evaluate((frame) => {
        const child = frame.querySelector<HTMLElement>(
          '[data-agent-native-node-id="layout-child"]',
        );
        if (!child) return false;
        const frameRect = frame.getBoundingClientRect();
        const childRect = child.getBoundingClientRect();
        return (
          Math.abs(
            childRect.left +
              childRect.width / 2 -
              (frameRect.left + frameRect.width / 2),
          ) < 1 &&
          Math.abs(
            childRect.top +
              childRect.height / 2 -
              (frameRect.top + frameRect.height / 2),
          ) < 1
        );
      });
  await expect.poll(centeredOnBothAxes).toBe(true);

  const savedAlignment = async () => {
    const html = await page.request
      .get(
        `${requireBaseURL(baseURL).replace(/\/$/, "")}/_agent-native/actions/get-design?id=${designId}`,
      )
      .then((response) => response.json());
    const source = (html.files ?? []).find(
      (file: { filename: string }) => file.filename === "index.html",
    )?.content;
    return page.evaluate((content: string) => {
      const parsed = new DOMParser().parseFromString(content, "text/html");
      const frame = parsed.querySelector<HTMLElement>(
        '[data-agent-native-node-id="layout-frame"]',
      );
      return [frame?.style.justifyContent, frame?.style.alignItems];
    }, source ?? "");
  };
  await expect.poll(savedAlignment).toEqual(["center", "center"]);

  await openEditPanel(page, designId);
  await selectLayer(page, "Layout frame");
  await expect.poll(centeredOnBothAxes).toBe(true);
  await expect.poll(savedAlignment).toEqual(["center", "center"]);
});

test("canvas and Layers selection show parent-relative position after iframe scroll", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(
    request,
    requireBaseURL(baseURL),
    SCROLLED_POSITION_HTML,
  );
  await openEditPanel(page, designId);
  const frame = designFrame(page);
  await frame.locator("body").evaluate(() => window.scrollTo(2200, 400));
  const vector = frame.locator('[data-agent-native-node-id="position-vector"]');
  await expect(vector).toBeVisible();
  const geometry = await vector.evaluate((element) => {
    const child = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    return {
      childX: child.x + window.scrollX,
      childY: child.y + window.scrollY,
      parentX: parent.x + window.scrollX,
      parentY: parent.y + window.scrollY,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  });
  expect(geometry).toMatchObject({
    childX: 2309,
    childY: 552,
    parentX: 2285,
    parentY: 528,
  });
  expect(geometry.scrollX).toBeGreaterThan(0);

  const x = page.getByRole("textbox", { name: "X-position" });
  const y = page.getByRole("textbox", { name: "Y-position" });
  const vectorBox = (await vector.boundingBox())!;
  await page.mouse.click(
    vectorBox.x + vectorBox.width / 2,
    vectorBox.y + vectorBox.height / 2,
  );
  await expect(x).toHaveValue("24px");
  await expect(y).toHaveValue("24px");
  await test.info().attach("position-inspector-canvas-selection.png", {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
  const screenshotDir = process.env.DESIGN_REGRESSION_SCREENSHOT_DIR;
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
      path: path.join(screenshotDir, "position-inspector-canvas-selection.png"),
      animations: "disabled",
    });
  }

  await selectLayer(page, "Vector");
  await expect(x).toHaveValue("24px");
  await expect(y).toHaveValue("24px");

  await x.fill("25");
  await x.press("Enter");
  await expectOffset(page, "Vector", { left: 25, top: 24 });

  await page.reload();
  await openEditPanel(page, designId);
  await expectOffset(page, "Vector", { left: 25, top: 24 });
  await selectLayer(page, "Vector");
  await expect(page.getByRole("textbox", { name: "X-position" })).toHaveValue(
    "25px",
  );
  await expect(page.getByRole("textbox", { name: "Y-position" })).toHaveValue(
    "24px",
  );
});

test("fixed Position stays viewport-relative after iframe scroll and reload", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(
    request,
    requireBaseURL(baseURL),
    FIXED_POSITION_HTML,
  );
  await openEditPanel(page, designId);
  const frame = designFrame(page);
  await frame.locator("body").evaluate(() => window.scrollTo(50, 0));
  await expect
    .poll(() =>
      frame
        .locator("body")
        .evaluate(() => ({ x: window.scrollX, y: window.scrollY })),
    )
    .toEqual({ x: 50, y: 0 });

  const fixed = frame.locator('[data-agent-native-node-id="fixed-child"]');
  const box = (await fixed.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const x = page.getByRole("textbox", { name: "X-position" });
  const y = page.getByRole("textbox", { name: "Y-position" });
  await expect(x).toHaveValue("35px");
  await expect(y).toHaveValue("24px");

  await selectLayer(page, "Fixed child");
  await expect(x).toHaveValue("35px");
  await expect(y).toHaveValue("24px");
  await x.fill("40");
  await x.press("Enter");
  await expect
    .poll(() =>
      fixed.evaluate((element) => element.getBoundingClientRect().left),
    )
    .toBe(40);

  await page.reload();
  await openEditPanel(page, designId);
  await frame.locator("body").evaluate(() => window.scrollTo(50, 0));
  await expect
    .poll(() =>
      frame
        .locator("body")
        .evaluate(() => ({ x: window.scrollX, y: window.scrollY })),
    )
    .toEqual({ x: 50, y: 0 });
  await selectLayer(page, "Fixed child");
  await expect(page.getByRole("textbox", { name: "X-position" })).toHaveValue(
    "40px",
  );
  await expect(page.getByRole("textbox", { name: "Y-position" })).toHaveValue(
    "24px",
  );
});

// Position skips Groups and resets at the nearest Frame.
test("Position stays Frame-relative through Groups and resets at nested Frames", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(
    request,
    requireBaseURL(baseURL),
    GROUP_POSITION_HTML,
  );
  await openEditPanel(page, designId);

  const frame = designFrame(page);
  const groupChild = frame.locator('[data-agent-native-node-id="group-child"]');
  await expect(groupChild).toBeVisible();
  const childBox = (await groupChild.boundingBox())!;
  await page.mouse.click(
    childBox.x + childBox.width / 2,
    childBox.y + childBox.height / 2,
  );
  const x = page.getByRole("textbox", { name: "X-position" });
  const y = page.getByRole("textbox", { name: "Y-position" });
  await expect(x).toHaveValue("100px");
  await expect(y).toHaveValue("100px");

  await selectLayer(page, "Group child");
  await expect(x).toHaveValue("100px");
  await expect(y).toHaveValue("100px");
  await x.fill("110");
  await x.press("Enter");
  await expectOffset(page, "Group child", { left: 90, top: 80 });
  await expect(x).toHaveValue("110px");

  await page.reload();
  await openEditPanel(page, designId);
  await selectLayer(page, "Group child");
  await expect(x).toHaveValue("110px");
  await expect(y).toHaveValue("100px");
  await expectOffset(page, "Group child", { left: 90, top: 80 });

  await selectLayer(page, "Nested child");
  await expect(x).toHaveValue("10px");
  await expect(y).toHaveValue("10px");
});

test("Position edits use the CSS containing block through static wrappers and borders", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(
    request,
    requireBaseURL(baseURL),
    CONTAINING_BLOCK_POSITION_HTML,
  );
  await openEditPanel(page, designId);

  const frame = designFrame(page);
  const child = frame.locator('[data-agent-native-node-id="position-child"]');
  const childBox = (await child.boundingBox())!;
  await page.mouse.click(
    childBox.x + childBox.width / 2,
    childBox.y + childBox.height / 2,
  );
  const x = page.getByRole("textbox", { name: "X-position" });
  const y = page.getByRole("textbox", { name: "Y-position" });
  await expect(x).toHaveValue("108px");
  await expect(y).toHaveValue("88px");

  await selectLayer(page, "Position child");
  await expect(x).toHaveValue("108px");
  await expect(y).toHaveValue("88px");
  await x.fill("120");
  await x.press("Enter");
  await y.fill("140");
  await y.press("Enter");
  await expect
    .poll(() => positionReferenceOffset(page, "Position child"))
    .toEqual({ x: 120, y: 140 });

  await page.reload();
  await openEditPanel(page, designId);
  await selectLayer(page, "Position child");
  await expect(x).toHaveValue("120px");
  await expect(y).toHaveValue("140px");
  await expect
    .poll(() => positionReferenceOffset(page, "Position child"))
    .toEqual({ x: 120, y: 140 });
});

test("Position stays Frame-relative through a positioned plain wrapper", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(
    request,
    requireBaseURL(baseURL),
    PLAIN_POSITION_WRAPPER_HTML,
  );
  await openEditPanel(page, designId);

  const child = designFrame(page).locator(
    '[data-agent-native-node-id="plain-wrapper-child"]',
  );
  const childBox = (await child.boundingBox())!;
  await page.mouse.click(
    childBox.x + childBox.width / 2,
    childBox.y + childBox.height / 2,
  );
  const x = page.getByRole("textbox", { name: "X-position" });
  const y = page.getByRole("textbox", { name: "Y-position" });
  await expect(x).toHaveValue("100px");
  await expect(y).toHaveValue("120px");

  await selectLayer(page, "Plain wrapper child");
  await expect(x).toHaveValue("100px");
  await expect(y).toHaveValue("120px");
  await x.fill("110");
  await x.press("Enter");
  await expect
    .poll(() => authoredOffset(page, "Plain wrapper child"))
    .toMatchObject({ left: "90px" });
  await expect
    .poll(() => positionReferenceOffset(page, "Plain wrapper child"))
    .toEqual({ x: 110, y: 120 });

  await page.reload();
  await openEditPanel(page, designId);
  await selectLayer(page, "Plain wrapper child");
  await expect(x).toHaveValue("110px");
  await expect(y).toHaveValue("120px");
  await expect
    .poll(() => authoredOffset(page, "Plain wrapper child"))
    .toMatchObject({ left: "90px" });
});

test("unframed absolute positions use the initial containing block through static wrappers", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(
    request,
    requireBaseURL(baseURL),
    UNFRAMED_POSITION_HTML,
  );
  await openEditPanel(page, designId);
  await selectLayer(page, "Position child");

  const x = page.getByRole("textbox", { name: "X-position" });
  const y = page.getByRole("textbox", { name: "Y-position" });
  await expect(x).toHaveValue("100px");
  await expect(y).toHaveValue("80px");
  await x.fill("120");
  await x.press("Enter");
  await y.fill("140");
  await y.press("Enter");
  await expect
    .poll(() => positionReferenceOffset(page, "Position child"))
    .toEqual({ x: 120, y: 140 });

  await page.reload();
  await openEditPanel(page, designId);
  await selectLayer(page, "Position child");
  await expect(x).toHaveValue("120px");
  await expect(y).toHaveValue("140px");
});

test("Position edits invert own and static-containing-block transforms and persist", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(
    request,
    requireBaseURL(baseURL),
    TRANSFORMED_POSITION_HTML,
  );
  await openEditPanel(page, designId);
  await selectLayer(page, "Transformed child");

  const x = page.getByRole("textbox", { name: "X-position" });
  const y = page.getByRole("textbox", { name: "Y-position" });
  await expect(x).toHaveValue("150px");
  await expect(y).toHaveValue("40px");
  await x.fill("170");
  await x.press("Enter");
  await y.fill("50");
  await y.press("Enter");
  await expect
    .poll(() => authoredOffset(page, "Transformed child"))
    .toEqual({ left: "60px", top: "60px" });
  await expect
    .poll(() => positionReferenceOffset(page, "Transformed child"))
    .toEqual({ x: 170, y: 50 });

  await page.reload();
  await openEditPanel(page, designId);
  await selectLayer(page, "Transformed child");
  await expect(x).toHaveValue("170px");
  await expect(y).toHaveValue("50px");
  await expect
    .poll(() => positionReferenceOffset(page, "Transformed child"))
    .toEqual({ x: 170, y: 50 });
});

// Alignment uses Group bounds; Position remains Frame-relative.
test("Align uses a Group's bounds while Position stays Frame-relative", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(
    request,
    requireBaseURL(baseURL),
    GROUP_POSITION_HTML,
  );
  await openEditPanel(page, designId);
  await selectLayer(page, "Group child");

  const x = page.getByRole("textbox", { name: "X-position" });
  const y = page.getByRole("textbox", { name: "Y-position" });
  await expect(x).toHaveValue("100px");
  await expect(y).toHaveValue("100px");

  await alignButton(page, "Align left").click();
  await expectOffset(page, "Group child", { left: 0, top: 80 });
  await expect(x).toHaveValue("20px");
  await expect(y).toHaveValue("100px");

  await x.fill("100");
  await x.press("Enter");
  await expectOffset(page, "Group child", { left: 80, top: 80 });
  await alignButton(page, "Align horizontal centers").click();
  await expectOffset(page, "Group child", { left: 40, top: 80 });
  await expect(x).toHaveValue("60px");
  await expect(y).toHaveValue("100px");
});

const TRANSFORM_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Transform fixture</title></head>
  <body style="margin:0;font-family:Arial,sans-serif">
    <div
      data-agent-native-node-id="scaler"
      data-agent-native-layer-name="Scaler"
      style="width:800px;height:600px"
    >
      <div
        data-agent-native-node-id="scaled"
        data-agent-native-layer-name="Scaled"
        style="position:relative;box-sizing:border-box;width:100%;height:100%;transform:scale(2,0.5);transform-origin:top left;background:#eeeeee"
      >
        <div
          data-agent-native-node-id="inner"
          data-agent-native-layer-name="Inner"
          style="position:absolute;left:100px;top:100px;width:120px;height:60px;background:#fca5a5"
        >Inner</div>
        <div
          data-agent-native-node-id="shifted"
          data-agent-native-layer-name="Shifted"
          style="position:absolute;left:100px;top:300px;width:120px;height:60px;transform:translateX(20px);background:#93c5fd"
        >Shifted</div>
      </div>
    </div>
    <div
      data-agent-native-node-id="static-parent"
      data-agent-native-layer-name="StaticParent"
      style="width:400px;height:300px;background:#dddddd"
    >
      <div
        data-agent-native-node-id="flow-child"
        data-agent-native-layer-name="Flow"
        style="width:100px;height:50px;background:#bbf7d0"
      >Flow</div>
    </div>
  </body>
</html>`;

async function authoredOffset(page: Page, layerName: string) {
  return designFrame(page)
    .locator(`[data-agent-native-layer-name="${layerName}"]`)
    .evaluate((element) => ({
      left: (element as HTMLElement).style.left,
      top: (element as HTMLElement).style.top,
    }));
}

test("a scaled parent does not scale the offsets that get committed", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(
    request,
    requireBaseURL(baseURL),
    TRANSFORM_HTML,
  );
  await openEditPanel(page, designId);
  await selectLayer(page, "Inner");

  await alignButton(page, "Align right").click();
  await expect
    .poll(() => authoredOffset(page, "Inner"), { timeout: 10_000 })
    .toEqual({ left: "680px", top: "100px" });

  await alignButton(page, "Align bottom").click();
  await expect
    .poll(() => authoredOffset(page, "Inner"), { timeout: 10_000 })
    .toEqual({ left: "680px", top: "540px" });
});

test("a transformed node aligns by its layout box, not its painted box", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(
    request,
    requireBaseURL(baseURL),
    TRANSFORM_HTML,
  );
  await openEditPanel(page, designId);
  await selectLayer(page, "Shifted");

  await alignButton(page, "Align right").click();
  await expect
    .poll(() => authoredOffset(page, "Shifted"), { timeout: 10_000 })
    .toEqual({ left: "680px", top: "300px" });
});

test("a static parent is not the containing block, so alignment refuses", async ({
  page,
  request,
  baseURL,
}) => {
  const designId = await seedDesign(
    request,
    requireBaseURL(baseURL),
    TRANSFORM_HTML,
  );
  await openEditPanel(page, designId);
  await selectLayer(page, "Flow");

  for (const label of ALIGN_LABELS) {
    await expect(alignButton(page, label)).toBeDisabled();
  }
});
