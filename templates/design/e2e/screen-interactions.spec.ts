import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  designFrame,
  frameToolButton,
  gotoEditor,
  pickFrameMode,
} from "./helpers";

const PRESET_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen preset persistence</title></head>
  <body style="margin:0;min-height:900px"></body>
</html>`;

const FILL_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen fill target</title>
    <style>:root { --screen-fill: #0f1115; } body { margin: 0; background: var(--screen-fill); }</style>
  </head>
  <body>
    <div data-agent-native-node-id="child" data-agent-native-layer-name="Child"
      style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#dadada"></div>
  </body>
</html>`;

const RESIZE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Edge resize height</title></head>
  <body style="margin:0;min-height:900px;background:#f8fafc">
    <main style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#334155"></main>
  </body>
</html>`;

const APPEARANCE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      html { background: transparent; }
      body { margin: 0; background: #3b82f6; }
      #child { position: absolute; left: 24px; top: 20px; width: 60px; height: 40px; background: #ef4444; }
    </style>
  </head>
  <body><div id="child"></div></body>
</html>`;

const SCREEN_K_SCALE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      html { background: transparent; }
      body { margin: 0; background: #3b82f6; }
      #layout { position: absolute; left: 24px; top: 20px; box-sizing: border-box; display: flex; gap: 12px; padding: 8px; width: 220px; height: 120px; background: #f8fafc; font-size: 16px; line-height: 20px; }
      #fixed { box-sizing: border-box; flex: none; width: 60px; height: 40px; background: #ef4444; }
      #fill { box-sizing: border-box; flex: 1 1 0%; min-width: 0; height: 40px; background: #22c55e; }
      #copy { font-size: 12px; line-height: 18px; }
    </style>
  </head>
  <body>
    <main id="layout" data-agent-native-node-id="screen-layout" data-agent-native-layer-name="Screen layout">
      <div id="fixed" data-agent-native-node-id="screen-fixed" data-agent-native-layer-name="Fixed child"><span id="copy" data-agent-native-node-id="screen-copy" data-agent-native-layer-name="Screen text">Scale text</span></div>
      <div id="fill" data-agent-native-node-id="screen-fill" data-agent-native-layer-name="Fill child">Fill</div>
    </main>
  </body>
</html>`;

const HUG_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style data-agent-native-screen-default-height>body { min-height: 100vh; }</style>
    <style>
      html { background: transparent; }
      body { margin: 0; background: #3b82f6; }
      main { height: 84px; }
    </style>
  </head>
  <body><main>Natural flow</main></body>
</html>`;

const EXPLICIT_HUG_HTML = HUG_HTML.replace(
  "<style data-agent-native-screen-default-height>body { min-height: 100vh; }</style>",
  '<meta data-agent-native-screen-height-mode="hug" />',
);

type DesignRecord = {
  title?: string;
  data?: unknown;
  files?: Array<{ id: string; filename?: string; content?: string }>;
};

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext, title: string) {
  const created = await action(request, "create-design", {
    title: `${title} ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id;
  if (typeof designId !== "string") {
    throw new Error("create-design did not return an id");
  }
  return designId;
}

async function readDesign(request: APIRequestContext, designId: string) {
  const response = await request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

function designData(record: DesignRecord): Record<string, any> {
  return typeof record.data === "string"
    ? JSON.parse(record.data || "{}")
    : ((record.data ?? {}) as Record<string, any>);
}

async function createScreen(
  request: APIRequestContext,
  designId: string,
  options: {
    content: string;
    filename?: string;
    metadata: Record<string, unknown>;
    geometry: Record<string, unknown>;
  },
) {
  const file = await action(request, "create-file", {
    designId,
    filename: options.filename ?? "screen.html",
    content: options.content,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  if (typeof fileId !== "string") {
    throw new Error("create-file did not return an id");
  }
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: options.metadata,
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: options.geometry,
      },
    ],
  });
  return fileId;
}

async function enterEditor(page: Page, designId: string) {
  await gotoEditor(page, designId);
  await expect(page.locator("[data-screen-shell]")).toHaveCount(1);
}

test("Cmd+R renames a Screen selected on canvas or in Layers without renaming the design", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request, "Screen keyboard rename");
  try {
    const fileId = await createScreen(request, designId, {
      content: FILL_HTML,
      metadata: { sourceType: "inline", width: 390, height: 844 },
      geometry: { x: 0, y: 0, width: 390, height: 844, z: 0 },
    });
    const original = await readDesign(request, designId);
    expect(original.title).toBeTruthy();
    await enterEditor(page, designId);
    const screenTitle = page
      .locator(`[data-screen-shell][data-frame-id="${fileId}"]`)
      .locator("[data-frame-title]")
      .first();
    await screenTitle.click();
    const rename = page.getByRole("textbox", {
      name: "Rename layer",
      exact: true,
    });
    const shortcut = process.platform === "darwin" ? "Meta+r" : "Control+r";
    for (const name of ["Mobile", "Tablet"]) {
      if (name === "Tablet") {
        await page
          .getByRole("tree", { name: "Layers" })
          .getByRole("treeitem")
          .filter({
            has: page.locator('[data-layer-row-button] > span[title="Mobile"]'),
          })
          .locator("[data-layer-row-button]")
          .first()
          .click();
      }
      await page.keyboard.press(shortcut);
      await expect(rename).toBeVisible();
      await rename.fill(name);
      await rename.press("Enter");
      await expect
        .poll(
          async () =>
            (await readDesign(request, designId)).files?.find(
              (file) => file.id === fileId,
            )?.filename,
        )
        .toBe(`${name}.html`);
      expect((await readDesign(request, designId)).title).toBe(original.title);
      await page.reload();
      await expect(screenTitle).toHaveText(name);
      expect(
        (await readDesign(request, designId)).files?.filter(
          (file) => file.filename !== "__board__.html",
        ),
      ).toHaveLength(1);
    }
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("preset screen dimensions and direct size edits survive reload", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request, "Screen preset persistence");
  try {
    await action(request, "create-file", {
      designId,
      filename: "index.html",
      content: PRESET_HTML,
      fileType: "html",
    });
    await enterEditor(page, designId);
    const before = new Set(
      (await readDesign(request, designId)).files?.map((file) => file.id),
    );

    await pickFrameMode(page, "Screen");
    await frameToolButton(page).click();
    await expect
      .poll(() => page.getByRole("button", { name: /Desktop.*1440/ }).count())
      .toBe(1);
    const presetGroups = page.locator(".design-inspector-scroll > section");
    const desktopGroup = presetGroups.nth(0);
    const phoneGroup = presetGroups.nth(1);
    await expect(desktopGroup.locator(":scope > button").first()).toContainText(
      "Desktop",
    );
    await expect(desktopGroup.getByRole("button").nth(1)).toContainText(
      "Desktop",
    );
    await phoneGroup.locator(":scope > button").click();
    await phoneGroup
      .getByRole("button", { name: /iPhone 17/ })
      .first()
      .click();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    let presetScreenId = "";
    await expect
      .poll(async () => {
        const record = await readDesign(request, designId);
        const screen = record.files?.find((file) => !before?.has(file.id));
        if (!screen) return null;
        presetScreenId = screen.id;
        const data = designData(record);
        return {
          id: screen.id,
          frame: data.canvasFrames?.[screen.id],
          metadata: data.screenMetadata?.[screen.id],
        };
      })
      .toMatchObject({
        frame: { width: 402, height: 874 },
        metadata: {
          width: 402,
          height: 874,
          heightPinned: true,
          heightMode: "fixed",
        },
      });

    const screenShell = page.locator(
      `[data-screen-shell][data-frame-id="${presetScreenId}"]`,
    );
    const expectScreenSize = async (width: number, height: number) => {
      await expect
        .poll(async () => {
          const data = designData(await readDesign(request, designId));
          const geometry = data.canvasFrames?.[presetScreenId];
          const metadata = data.screenMetadata?.[presetScreenId];
          return [
            geometry?.width,
            geometry?.height,
            metadata?.width,
            metadata?.height,
            metadata?.heightPinned,
            metadata?.heightMode,
          ];
        })
        .toEqual([width, height, width, height, true, "fixed"]);
      await expect(screenShell).toHaveCSS("width", `${width}px`);
      await expect(screenShell.locator("[data-screen-card]")).toHaveCSS(
        "height",
        `${height}px`,
      );
    };
    await expectScreenSize(402, 874);

    await page.reload();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expect(screenShell).toHaveCSS("width", "402px");
    await expect(screenShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      "874px",
    );
    await page.keyboard.press("Escape");
    const screenLayer = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { name: /^Screen 2/ })
      .getByRole("button", { name: "Screen 2" });
    await screenLayer.click();
    const widthInput = page.getByRole("textbox", {
      name: /^W(?: size in pixels)?$/,
    });
    const heightInput = page.getByRole("textbox", {
      name: /^H(?: size in pixels)?$/,
    });
    await widthInput.fill("800");
    await widthInput.press("Enter");
    await heightInput.fill("800");
    await heightInput.press("Enter");
    await expectScreenSize(800, 800);

    await page.keyboard.press("ControlOrMeta+z");
    await expectScreenSize(800, 874);

    await page.keyboard.press("ControlOrMeta+z");
    await expectScreenSize(402, 874);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expectScreenSize(800, 874);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expectScreenSize(800, 800);

    await page.reload();
    const persistedShell = page.locator(
      `[data-screen-shell][data-frame-id="${presetScreenId}"]`,
    );
    await expect(persistedShell).toHaveCSS("width", "800px");
    await expect(persistedShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      "800px",
    );
    await page.keyboard.press("Escape");
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { name: /^Screen 2/ })
      .getByRole("button", { name: "Screen 2" })
      .click();
    await expect(widthInput).toHaveValue("800px");
    await expect(heightInput).toHaveValue("800px");
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("editing a screen fill changes its body without changing child fills", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request, "Screen fill target");
  try {
    const fileId = await createScreen(request, designId, {
      content: FILL_HTML,
      metadata: { sourceType: "inline", width: 1280, height: 900 },
      geometry: { x: 0, y: 0, width: 1280, height: 900, z: 0 },
    });
    await gotoEditor(page, designId);

    const screenRow = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem")
      .first();
    await expect(screenRow).toBeVisible();
    await screenRow.click();
    const fillSection = page
      .getByRole("heading", { name: "Fill", exact: true })
      .locator("xpath=ancestor::section");
    await expect(fillSection).toBeVisible();
    await fillSection
      .getByRole("button", { name: "Open color picker" })
      .click();
    const hexInput = page.getByRole("textbox", { name: "Hex", exact: true });
    await expect(hexInput).toHaveValue("0F1115");
    await hexInput.fill("3B82F6");
    await hexInput.press("Enter");

    await expect
      .poll(async () => {
        const record = await readDesign(request, designId);
        return record.files?.find((file) => file.id === fileId)?.content ?? "";
      })
      .toMatch(/<body[^>]*style="[^"]*background-color:\s*#3b82f6/i);

    const screenFrame = page.frameLocator(
      `[data-screen-shell][data-frame-id="${fileId}"] iframe[data-screen-iframe-id="${fileId}"]`,
    );
    await expect(screenFrame.locator("body")).toHaveCSS(
      "background-color",
      "rgb(59, 130, 246)",
    );
    await expect(
      screenFrame.locator('[data-agent-native-node-id="child"]'),
    ).toHaveCSS("background-color", "rgb(218, 218, 218)");
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("a screen's east-edge resize keeps its explicit height in the rendered card", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request, "Screen edge resize");
  try {
    const fileId = await createScreen(request, designId, {
      content: RESIZE_HTML,
      metadata: {
        sourceType: "inline",
        width: 1280,
        height: 900,
        heightPinned: true,
        heightMode: "fixed",
      },
      geometry: { x: 0, y: 0, width: 400, height: 900, z: 0 },
    });

    await gotoEditor(page, designId);
    const screenShell = page.locator(
      `[data-screen-shell][data-frame-id="${fileId}"]`,
    );
    await expect(screenShell).toBeVisible();
    const allScreensButton = page.getByRole("button", { name: "All screens" });
    await allScreensButton.click();
    await expect(allScreensButton).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Shift+1");
    await expect(screenShell.locator("[data-frame-label]")).toBeVisible();
    await screenShell.locator("[data-frame-label]").click();
    const screenCard = screenShell.locator("[data-screen-card]");
    await expect(screenCard).toHaveCSS("height", "900px");
    const selectionBox = page.locator("[data-frame-selection-box]");
    const eastHandle = selectionBox.locator('[data-resize-handle="e"]');
    await expect(eastHandle).toBeVisible();
    const start = await eastHandle.boundingBox();
    if (!start) throw new Error("missing east resize handle bounds");
    const screenBefore = await screenShell.boundingBox();
    if (!screenBefore) throw new Error("missing screen frame bounds");
    const zoomScale = screenBefore.width / 400;
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 25, { steps: 8 });
    await page.mouse.up();
    const expectedWidth = Math.round(400 + 60 / zoomScale);

    await expect
      .poll(async () => {
        const data = designData(await readDesign(request, designId));
        const frame = data.canvasFrames?.[fileId];
        const metadata = data.screenMetadata?.[fileId];
        return {
          frame: { width: frame?.width, height: frame?.height },
          metadata: {
            width: metadata?.width,
            height: metadata?.height,
            heightPinned: metadata?.heightPinned,
            heightMode: metadata?.heightMode,
          },
        };
      })
      .toMatchObject({
        frame: { width: expectedWidth, height: 900 },
        metadata: {
          width: expectedWidth,
          height: 900,
          heightPinned: true,
          heightMode: "fixed",
        },
      });

    await expect(screenCard).toHaveCSS("width", `${expectedWidth}px`);
    await expect(screenCard).toHaveCSS("height", "900px");
    await expect(screenShell.locator("[data-screen-content]")).toHaveJSProperty(
      "clientHeight",
      900,
    );
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("a Hug screen keeps Hug on width resize and becomes Fixed on height resize", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request, "Hug screen resize");
  try {
    const fileId = await createScreen(request, designId, {
      content: HUG_HTML,
      metadata: {
        sourceType: "inline",
        width: 300,
        height: 400,
        heightMode: "auto",
        heightPinned: false,
      },
      geometry: { x: 0, y: 0, width: 300, height: 400, z: 0 },
    });

    await gotoEditor(page, designId);
    const screenShell = page.locator(
      `[data-screen-shell][data-frame-id="${fileId}"]`,
    );
    const allScreensButton = page.getByRole("button", { name: "All screens" });
    await allScreensButton.click();
    await page.keyboard.press("Shift+1");
    await screenShell.locator("[data-frame-label]").click();
    await page.getByRole("button", { name: "H sizing mode — Auto" }).click();
    await page.getByRole("menuitem", { name: "Hug contents" }).click();
    await expect(screenShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      "84px",
    );
    const selectionBox = page.locator("[data-frame-selection-box]");
    const eastHandle = selectionBox.locator('[data-resize-handle="e"]');
    await expect(eastHandle).toBeVisible();
    const eastBounds = await eastHandle.boundingBox();
    const initialShell = await screenShell.boundingBox();
    if (!eastBounds || !initialShell) {
      throw new Error("missing Hug screen resize bounds");
    }
    const zoomScale = initialShell.width / 300;
    const eastX = eastBounds.x + eastBounds.width / 2;
    const eastY = eastBounds.y + eastBounds.height / 2;
    await page.mouse.move(eastX, eastY);
    await page.mouse.down();
    await page.mouse.move(eastX + 60, eastY + 25, { steps: 8 });
    await page.mouse.up();
    const expectedWidth = Math.round(300 + 60 / zoomScale);
    const readFrameState = async () => {
      const data = designData(await readDesign(request, designId));
      return {
        frame: data.canvasFrames?.[fileId],
        metadata: data.screenMetadata?.[fileId],
      };
    };
    await expect.poll(readFrameState).toMatchObject({
      frame: { width: expectedWidth, height: 84 },
      metadata: {
        width: expectedWidth,
        heightMode: "hug",
        heightPinned: false,
      },
    });
    await expect(screenShell.locator("[data-screen-card]")).toHaveCSS(
      "width",
      `${expectedWidth}px`,
    );
    await expect(screenShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      "84px",
    );

    const southHandle = selectionBox.locator('[data-resize-handle="s"]');
    await expect(southHandle).toBeVisible();
    const southBounds = await southHandle.boundingBox();
    if (!southBounds) throw new Error("missing south resize handle bounds");
    const southX = southBounds.x + southBounds.width / 2;
    const southY = southBounds.y + southBounds.height / 2;
    await page.mouse.move(southX, southY);
    await page.mouse.down();
    await page.mouse.move(southX, southY + 40, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(readFrameState)
      .toMatchObject({ metadata: { heightMode: "fixed", heightPinned: true } });
    const fixedAfterResize = await readFrameState();
    const fixedHeight = fixedAfterResize.frame?.height;
    expect(fixedHeight).toBeGreaterThan(84);
    await expect(screenShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      `${fixedHeight}px`,
    );
    const sourceModeState = async () => {
      const content =
        (await readDesign(request, designId)).files?.find(
          (file) => file.id === fileId,
        )?.content ?? "";
      return {
        hasHugMarker: content.includes(
          '<meta data-agent-native-screen-height-mode="hug">',
        ),
        hasViewportFloor: content.includes("body { min-height: 100vh; }"),
      };
    };
    await expect.poll(sourceModeState).toEqual({
      hasHugMarker: false,
      hasViewportFloor: true,
    });

    const undoShortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";
    const redoShortcut =
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";
    await page.keyboard.press(undoShortcut);
    await expect.poll(readFrameState).toMatchObject({
      frame: { width: expectedWidth, height: 84 },
      metadata: { heightMode: "hug", heightPinned: false },
    });
    await expect.poll(sourceModeState).toEqual({
      hasHugMarker: true,
      hasViewportFloor: false,
    });
    await expect(screenShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      "84px",
    );
    await page.keyboard.press(redoShortcut);
    await expect.poll(readFrameState).toMatchObject({
      frame: { width: expectedWidth, height: fixedHeight },
      metadata: { heightMode: "fixed", heightPinned: true },
    });
    await expect.poll(sourceModeState).toEqual({
      hasHugMarker: false,
      hasViewportFloor: true,
    });
    await expect(screenShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      `${fixedHeight}px`,
    );
    await page.reload();
    await expect.poll(readFrameState).toMatchObject({
      frame: { width: expectedWidth, height: fixedHeight },
      metadata: { heightMode: "fixed", heightPinned: true },
    });
    await expect(screenShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      `${fixedHeight}px`,
    );
    await expect.poll(sourceModeState).toEqual({
      hasHugMarker: false,
      hasViewportFloor: true,
    });
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("Screen Appearance styles reveal the board and keep pinned versus Hug height in exported source", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request, "Screen appearance styles");
  try {
    const fixedId = await createScreen(request, designId, {
      content: APPEARANCE_HTML,
      filename: "fixed-screen.html",
      metadata: {
        sourceType: "inline",
        width: 300,
        height: 200,
        heightPinned: true,
      },
      geometry: { x: 0, y: 0, width: 300, height: 200, z: 0 },
    });
    const hugId = await createScreen(request, designId, {
      content: HUG_HTML,
      filename: "hug-screen.html",
      metadata: { sourceType: "inline", width: 300, height: 400 },
      geometry: { x: 450, y: 0, width: 300, height: 400, z: 0 },
    });
    await action(request, "update-design", {
      id: designId,
      dataOperations: [
        { op: "set", path: ["canvasBackground"], value: "#20242a" },
      ],
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoEditor(page, designId);

    const fixedShell = page.locator(
      `[data-screen-shell][data-frame-id="${fixedId}"]`,
    );
    await page
      .getByRole("treeitem")
      .filter({ hasText: "Fixed screen" })
      .first()
      .click();
    const fixedHeightMode = page.getByRole("button", {
      name: "H sizing mode — Fixed",
    });
    await fixedHeightMode.click();
    await page.getByRole("menuitem", { name: "Hug contents" }).click();
    await expect
      .poll(() =>
        fixedShell
          .locator("[data-screen-card]")
          .evaluate((el) => el.clientHeight),
      )
      .toBe(60);
    const undoShortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";
    const redoShortcut =
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";
    const fixedModeState = async () => {
      const data = designData(await readDesign(request, designId));
      const metadata = data.screenMetadata?.[fixedId] ?? {};
      return {
        mode:
          metadata.heightMode ??
          (metadata.heightPinned === true ? "fixed" : "auto"),
        pinned: metadata.heightPinned,
        height: data.canvasFrames?.[fixedId]?.height,
      };
    };
    await expect.poll(fixedModeState).toEqual({
      mode: "hug",
      pinned: false,
      height: 200,
    });
    await page.keyboard.press(undoShortcut);
    await expect.poll(fixedModeState).toEqual({
      mode: "fixed",
      pinned: true,
      height: 200,
    });
    await expect(fixedShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      "200px",
    );
    await page.keyboard.press(redoShortcut);
    await expect.poll(fixedModeState).toEqual({
      mode: "hug",
      pinned: false,
      height: 200,
    });
    await expect(fixedShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      "60px",
    );
    await page.keyboard.press(undoShortcut);
    await expect.poll(fixedModeState).toEqual({
      mode: "fixed",
      pinned: true,
      height: 200,
    });
    await page.reload();
    await page
      .getByRole("treeitem")
      .filter({ hasText: "Fixed screen" })
      .first()
      .click();

    const appearance = page
      .getByRole("heading", { name: "Appearance", exact: true })
      .locator("xpath=ancestor::section");
    const opacity = appearance.locator('input[aria-label="Opacity" i]');
    const radius = appearance.locator('input[aria-label="Corner radius" i]');
    await expect(opacity).toBeVisible();
    await opacity.fill("50");
    await opacity.press("Enter");
    await radius.fill("40");
    await radius.press("Enter");

    await expect
      .poll(async () => {
        const record = await readDesign(request, designId);
        return record.files?.find((file) => file.id === fixedId)?.content ?? "";
      })
      .toContain(
        "<style data-agent-native-screen-frame-rendering>body{contain: paint;overflow: hidden;min-height: 100vh}</style>",
      );
    const fixedFrame = designFrame(page, fixedId);
    const fixedBody = fixedFrame.locator("body");
    const fixedContent = fixedShell.locator("[data-screen-content]");
    await expect(fixedBody).toHaveCSS("opacity", "0.5");
    await expect(fixedBody).toHaveCSS("border-radius", "40px");
    await expect(fixedContent).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await fixedContent.screenshot({
      path: test.info().outputPath("screen-live-appearance-300x200.png"),
    });

    await opacity.fill("0");
    await opacity.press("Enter");
    await expect(fixedBody).toHaveCSS("opacity", "0");
    await fixedContent.screenshot({
      path: test.info().outputPath("screen-live-opacity-zero-300x200.png"),
    });
    await opacity.fill("50");
    await opacity.press("Enter");

    await page.reload();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await page
      .getByRole("treeitem")
      .filter({ hasText: "Fixed screen" })
      .first()
      .click();
    await expect(fixedFrame.locator("body")).toHaveCSS("opacity", "0.5");
    await expect(fixedFrame.locator("body")).toHaveCSS("border-radius", "40px");
    const fixedSource =
      (await readDesign(request, designId)).files?.find(
        (file) => file.id === fixedId,
      )?.content ?? "";
    expect(fixedSource).toContain(
      "<style data-agent-native-screen-frame-rendering>body{contain: paint;overflow: hidden;min-height: 100vh}</style>",
    );
    const hugShell = page.locator(
      `[data-screen-shell][data-frame-id="${hugId}"]`,
    );
    await page
      .getByRole("treeitem")
      .filter({ hasText: "Hug screen" })
      .first()
      .click();
    const hugAppearance = page
      .getByRole("heading", { name: "Appearance", exact: true })
      .locator("xpath=ancestor::section");
    const hugOpacity = hugAppearance.locator('input[aria-label="Opacity" i]');
    const hugRadius = hugAppearance.locator(
      'input[aria-label="Corner radius" i]',
    );
    await expect(hugShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      "844px",
    );
    const hugHeightMode = page.getByRole("button", {
      name: "H sizing mode — Auto",
    });
    await hugHeightMode.click();
    await page.getByRole("menuitem", { name: "Hug contents" }).click();
    await expect
      .poll(async () => {
        const data = designData(await readDesign(request, designId));
        const metadata = data.screenMetadata?.[hugId];
        return [metadata?.heightMode, metadata?.heightPinned];
      })
      .toEqual(["hug", false]);
    await expect(hugShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      "84px",
    );
    await expect(hugShell.locator("[data-screen-content]")).toHaveJSProperty(
      "clientHeight",
      84,
    );
    await expect(page.getByRole("button", { name: "H 84 Hug" })).toBeVisible();
    await expect(designFrame(page, hugId).locator("body")).toHaveCSS(
      "height",
      "84px",
    );
    const modeState = async () => {
      const record = await readDesign(request, designId);
      const data = designData(record);
      const metadata = data.screenMetadata?.[hugId] ?? {};
      return {
        mode: metadata.heightMode ?? "auto",
        height: data.canvasFrames?.[hugId]?.height,
        hasViewportFloor: (
          record.files?.find((file) => file.id === hugId)?.content ?? ""
        ).includes("min-height: 100vh"),
      };
    };
    await expect.poll(modeState).toEqual({
      mode: "hug",
      height: 400,
      hasViewportFloor: false,
    });
    await page.keyboard.press(undoShortcut);
    await expect.poll(modeState).toEqual({
      mode: "auto",
      height: 400,
      hasViewportFloor: true,
    });
    await expect(hugShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      "844px",
    );
    await page.keyboard.press(redoShortcut);
    await expect.poll(modeState).toEqual({
      mode: "hug",
      height: 400,
      hasViewportFloor: false,
    });
    await expect(hugShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      "84px",
    );
    await hugOpacity.fill("50");
    await hugOpacity.press("Enter");
    await hugRadius.fill("20");
    await hugRadius.press("Enter");
    await expect
      .poll(async () => {
        const record = await readDesign(request, designId);
        const content =
          record.files?.find((file) => file.id === hugId)?.content ?? "";
        return {
          hasContainment: content.includes(
            "<style data-agent-native-screen-frame-rendering>body{contain: paint;overflow: hidden}</style>",
          ),
          hasPinnedHeight: content.includes("min-height: 100vh"),
        };
      })
      .toEqual({ hasContainment: true, hasPinnedHeight: false });
    const hugSource =
      (await readDesign(request, designId)).files?.find(
        (file) => file.id === hugId,
      )?.content ?? "";
    expect(hugSource).toContain(
      "<style data-agent-native-screen-default-height></style>",
    );
    expect(hugSource).toContain(
      '<meta data-agent-native-screen-height-mode="hug">',
    );
    expect(hugSource).toContain(
      "<style data-agent-native-screen-frame-rendering>body{contain: paint;overflow: hidden}</style>",
    );
    expect(hugSource).not.toContain("min-height: 100vh");

    await page.reload();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await page
      .getByRole("treeitem")
      .filter({ hasText: "Hug screen" })
      .first()
      .click();
    await expect(page.getByRole("button", { name: "H 84 Hug" })).toBeVisible();
    await expect(
      page.locator(
        `[data-screen-shell][data-frame-id="${hugId}"] [data-screen-card]`,
      ),
    ).toHaveCSS("height", "84px");
    const hugSourceAfterReload =
      (await readDesign(request, designId)).files?.find(
        (file) => file.id === hugId,
      )?.content ?? "";
    expect(hugSourceAfterReload).toBe(hugSource);
    await page
      .getByRole("treeitem")
      .filter({ hasText: "Hug screen" })
      .first()
      .getByRole("button", { name: "Expand layer" })
      .click();
    const naturalFlowLayer = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem")
      .filter({ hasText: "Natural flow" });
    await expect(naturalFlowLayer).toHaveCount(1);
    await naturalFlowLayer.locator("[data-layer-row-button]").click();
    await expect(hugShell.locator("[data-screen-card]")).toHaveCSS(
      "height",
      "84px",
    );
    await expect(hugShell.locator("[data-screen-content]")).toHaveJSProperty(
      "clientHeight",
      84,
    );
    await page.screenshot({
      path: test.info().outputPath("screen-hug-selected-content-84px.png"),
    });
    await page
      .getByRole("tree", { name: "Layers" })
      .locator('[role="treeitem"][aria-level="1"]')
      .filter({ hasText: "Hug screen" })
      .first()
      .locator("[data-layer-row-button]")
      .click();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          write: async (items: ClipboardItem[]) => {
            const blob = await items[0]?.getType("image/png");
            if (blob) {
              (window as Window & { __hugCopiedPng?: Blob }).__hugCopiedPng =
                blob;
            }
          },
        },
      });
    });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Shift+c" : "Control+Shift+c",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __hugCopiedPng?: Blob }).__hugCopiedPng
              ?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    const copiedPngSize = await page.evaluate(async () => {
      const blob = (window as Window & { __hugCopiedPng?: Blob })
        .__hugCopiedPng;
      if (!blob) throw new Error("Copy as PNG did not populate the clipboard");
      const bitmap = await createImageBitmap(blob);
      return { width: bitmap.width, height: bitmap.height };
    });
    expect(copiedPngSize).toEqual({ width: 600, height: 168 });
    const [svgDownload] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await page.getByRole("button", { name: "More" }).click();
        await page.getByRole("menuitem", { name: "Export" }).hover();
        await page
          .getByRole("menuitem", { name: "Download for Figma (SVG)" })
          .click();
      })(),
    ]);
    const svgStream = await svgDownload.createReadStream();
    if (!svgStream) throw new Error("Figma SVG export returned no data");
    const svgChunks: Buffer[] = [];
    for await (const chunk of svgStream) svgChunks.push(Buffer.from(chunk));
    const exportedSvg = Buffer.concat(svgChunks).toString("utf8");
    expect(exportedSvg.match(/<svg\b[^>]*\bwidth="([^"]+)"/)?.[1]).toBe("300");
    expect(exportedSvg.match(/<svg\b[^>]*\bheight="([^"]+)"/)?.[1]).toBe("84");

    await page.goto("about:blank");
    await page.setViewportSize({ width: 300, height: 200 });
    await page.setContent(fixedSource);
    const exportedBody = page.locator("body");
    await expect(exportedBody).toHaveCSS("height", "200px");
    await expect(exportedBody).toHaveCSS("opacity", "0.5");
    await expect(exportedBody).toHaveCSS("border-radius", "40px");
    await page.screenshot({
      path: test.info().outputPath("screen-export-source-300x200.png"),
    });
    await page.setContent(hugSourceAfterReload);
    await expect(page.locator("body")).toHaveCSS("height", "84px");
    await page.screenshot({
      path: test.info().outputPath("screen-export-hug-300x200.png"),
    });
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("all-screens PDF mounts an offscreen Hug screen and exports its natural height", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request, "Offscreen Hug PDF export");
  try {
    await createScreen(request, designId, {
      filename: "Fixed.html",
      content: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#1e293b"><main style="height:60px"></main></body></html>`,
      metadata: { sourceType: "inline", width: 300, height: 200 },
      geometry: { x: 0, y: 0, width: 300, height: 200, z: 0 },
    });
    const hugScreenId = await createScreen(request, designId, {
      filename: "Hug.html",
      content: EXPLICIT_HUG_HTML,
      metadata: {
        sourceType: "inline",
        width: 300,
        height: 400,
        heightMode: "hug",
        heightPinned: false,
      },
      geometry: { x: 100_000, y: 0, width: 300, height: 400, z: 1 },
    });
    await gotoEditor(page, designId);

    const hugShell = page.locator(
      `[data-screen-shell][data-frame-id="${hugScreenId}"]`,
    );
    const hugContent = hugShell.locator("[data-screen-content]");
    await expect(hugContent).toHaveAttribute("data-cull-tier", "placeholder");
    await expect(hugShell.locator("iframe")).toHaveCount(0);

    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await page.getByRole("button", { name: "More" }).click();
        await page.getByRole("menuitem", { name: "Export" }).hover();
        await page
          .getByRole("menuitem", { name: "Download PDF (all screens)" })
          .click();
      })(),
    ]);
    const pdfStream = await pdfDownload.createReadStream();
    if (!pdfStream) throw new Error("All-screens PDF export returned no data");
    const pdfChunks: Buffer[] = [];
    for await (const chunk of pdfStream) pdfChunks.push(Buffer.from(chunk));
    const pdfText = Buffer.concat(pdfChunks).toString("latin1");
    const mediaBoxes = Array.from(
      pdfText.matchAll(
        /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g,
      ),
      (match) => [Number(match[3]), Number(match[4])],
    );
    expect(mediaBoxes).toHaveLength(2);
    expect(mediaBoxes[0]).toEqual([225, 150]);
    expect(mediaBoxes[1]).toEqual([225, 63]);
    await expect(hugShell.locator("iframe")).toHaveCount(0);
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("all-screens PDF reports a broken image and can retry after it recovers", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request, "PDF image failure recovery");
  let assetAvailable = false;
  await page.route("**/qa-missing-image.png", (route) =>
    route.fulfill(
      assetAvailable
        ? {
            status: 200,
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="#3b82f6"/></svg>',
          }
        : { status: 404, body: "Missing test image" },
    ),
  );
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  try {
    await createScreen(request, designId, {
      filename: "Fixed.html",
      content:
        '<!doctype html><html><body style="margin:0"><main>First page</main></body></html>',
      metadata: { sourceType: "inline", width: 300, height: 200 },
      geometry: { x: 0, y: 0, width: 300, height: 200, z: 0 },
    });
    const imageScreenId = await createScreen(request, designId, {
      filename: "Image.html",
      content:
        '<!doctype html><html><body style="margin:0"><img src="/qa-missing-image.png" width="60" height="40" alt="Test image"></body></html>',
      metadata: { sourceType: "inline", width: 300, height: 200 },
      geometry: { x: 100_000, y: 0, width: 300, height: 200, z: 1 },
    });
    await gotoEditor(page, designId);
    const imageShell = page.locator(
      `[data-screen-shell][data-frame-id="${imageScreenId}"]`,
    );
    const exportPdf = async () => {
      await page.getByRole("button", { name: "More" }).click();
      await page.getByRole("menuitem", { name: "Export" }).hover();
      await page
        .getByRole("menuitem", { name: "Download PDF (all screens)" })
        .click();
    };
    await expect(imageShell.locator("iframe")).toHaveCount(0);
    await exportPdf();
    await expect(
      page.getByText("Could not export PDF", { exact: true }),
    ).toBeVisible();
    await expect(imageShell.locator("iframe")).toHaveCount(0);
    expect(downloads).toEqual([]);

    assetAvailable = true;
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      exportPdf(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    await expect(
      page.getByText("PDF downloaded (all screens)", { exact: true }),
    ).toBeVisible();
    await expect(imageShell.locator("iframe")).toHaveCount(0);
    expect(downloads).toHaveLength(1);
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("opacity keys update selected inline Screens as one undo and skip live URLs", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request, "Screen opacity batch");
  try {
    const screenContent = `<!doctype html><html><head><title>Opacity screen</title></head><body style="margin:0;background:#334155"></body></html>`;
    const screenIds = await Promise.all(
      ["first.html", "second.html"].map((filename, index) =>
        createScreen(request, designId, {
          content: screenContent,
          filename,
          metadata: {
            sourceType: "inline",
            width: 300,
            height: 200,
            heightPinned: true,
          },
          geometry: {
            x: index * 350,
            y: 0,
            width: 300,
            height: 200,
            z: index,
          },
        }),
      ),
    );
    const liveUrl = new URL("/preview", e2eBaseURL()).toString();
    await page.route(liveUrl, (route) => route.abort("failed"));
    const liveUrlId = await createScreen(request, designId, {
      content: liveUrl,
      filename: "live-preview.html",
      metadata: {
        sourceType: "url",
        url: liveUrl,
        width: 300,
        height: 200,
        heightPinned: true,
      },
      geometry: { x: 700, y: 0, width: 300, height: 200, z: 2 },
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoEditor(page, designId);
    const screenRows = page
      .getByRole("tree", { name: "Layers" })
      .locator('[role="treeitem"][aria-level="1"]');
    await screenRows.first().locator("[data-layer-row-button]").click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+a" : "Control+a",
    );
    await expect(
      page
        .getByRole("tree", { name: "Layers" })
        .locator('[role="treeitem"][aria-level="1"][aria-selected="true"]'),
    ).toHaveCount(3);

    const readOpacityState = async () => {
      const record = await readDesign(request, designId);
      return {
        inline: screenIds.map(
          (screenId) =>
            record.files?.find((file) => file.id === screenId)?.content ?? "",
        ),
        liveUrl:
          record.files?.find((file) => file.id === liveUrlId)?.content ?? "",
      };
    };
    await page.keyboard.press("5");
    await expect
      .poll(async () =>
        (await readOpacityState()).inline.every((html) =>
          /opacity:\s*0\.5/.test(html),
        ),
      )
      .toBe(true);
    await expect(designFrame(page, screenIds[0]!).locator("body")).toHaveCSS(
      "opacity",
      "0.5",
    );
    await expect(designFrame(page, screenIds[1]!).locator("body")).toHaveCSS(
      "opacity",
      "0.5",
    );
    await expect
      .poll(async () => (await readOpacityState()).liveUrl)
      .toBe(liveUrl);

    const undoShortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";
    const redoShortcut =
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";
    await page.keyboard.press(undoShortcut);
    await expect
      .poll(async () =>
        (await readOpacityState()).inline.every(
          (html) => !/opacity:\s*0\.5/.test(html),
        ),
      )
      .toBe(true);
    await expect(designFrame(page, screenIds[0]!).locator("body")).toHaveCSS(
      "opacity",
      "1",
    );
    await expect(designFrame(page, screenIds[1]!).locator("body")).toHaveCSS(
      "opacity",
      "1",
    );

    await page.keyboard.press(redoShortcut);
    await expect
      .poll(async () =>
        (await readOpacityState()).inline.every((html) =>
          /opacity:\s*0\.5/.test(html),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await page.keyboard.press("7");
    await expect
      .poll(async () =>
        (await readOpacityState()).inline.every((html) =>
          /opacity:\s*0\.5/.test(html),
        ),
      )
      .toBe(true);
    await expect
      .poll(async () => (await readOpacityState()).liveUrl)
      .toBe(liveUrl);
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("K scales Screen contents and history as one root Frame edit", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request, "Screen root K scale");
  let completed = false;
  try {
    const fileId = await createScreen(request, designId, {
      content: SCREEN_K_SCALE_HTML,
      metadata: {
        sourceType: "inline",
        width: 400,
        height: 400,
        heightPinned: true,
        heightMode: "fixed",
      },
      geometry: { x: 0, y: 0, width: 400, height: 400, z: 0 },
    });
    const untouchedFileId = await createScreen(request, designId, {
      filename: "untouched-fractional.html",
      content: '<!doctype html><html><body style="margin:0"></body></html>',
      metadata: {
        sourceType: "inline",
        width: 300,
        height: 200,
        heightPinned: true,
        heightMode: "fixed",
      },
      geometry: {
        x: 700.4,
        y: 700.6,
        width: 300.3,
        height: 200.2,
        z: 1,
      },
    });
    await gotoEditor(page, designId);
    await page.getByRole("button", { name: "All screens" }).click();
    await page.keyboard.press("Shift+1");
    const shell = page.locator(
      `[data-screen-shell][data-frame-id="${fileId}"]`,
    );
    const card = shell.locator("[data-screen-card]");
    const readViewportGeometry = async () =>
      page.evaluate((screenId) => {
        const world = document.querySelector<HTMLElement>(
          "[data-multi-screen-canvas-world]",
        );
        const shellElement = document.querySelector<HTMLElement>(
          `[data-screen-shell][data-frame-id="${screenId}"]`,
        );
        const cardElement =
          shellElement?.querySelector<HTMLElement>("[data-screen-card]");
        if (!world || !shellElement || !cardElement) return null;
        const bounds = (element: HTMLElement) => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        };
        return {
          camera: (() => {
            const computedTransform = getComputedStyle(world).transform;
            const matrix = new DOMMatrixReadOnly(computedTransform);
            return {
              inlineTransform: world.style.transform,
              computedTransform,
              scaleX: matrix.a,
              scaleY: matrix.d,
              translateX: matrix.e,
              translateY: matrix.f,
            };
          })(),
          shellBounds: bounds(shellElement),
          cardBounds: bounds(cardElement),
        };
      }, fileId);
    const waitForSettledViewport = async () => {
      let previous = "";
      let stablePolls = 0;
      await expect
        .poll(
          async () => {
            const geometry = await readViewportGeometry();
            if (!geometry) return 0;
            const signature = JSON.stringify(geometry);
            stablePolls = signature === previous ? stablePolls + 1 : 0;
            previous = signature;
            return stablePolls;
          },
          {
            message: "overview camera and Screen geometry settle",
            timeout: 15_000,
          },
        )
        .toBeGreaterThanOrEqual(2);
    };
    const screenContent = page.frameLocator(
      `[data-screen-iframe-id="${fileId}"]`,
    );
    const layout = screenContent.locator("#layout");
    await expect(layout).toBeVisible();
    await shell.locator("[data-frame-label]").click();
    await page.keyboard.press("k");
    const handle = page.locator(
      '[data-frame-selection-box] [data-resize-handle="se"]',
    );
    await expect(handle).toBeVisible();
    await waitForSettledViewport();
    const [beforeShellBounds, beforeCardBounds, cameraBeforeGesture] =
      await Promise.all([
        shell.boundingBox(),
        card.boundingBox(),
        page
          .locator("[data-multi-screen-canvas-world]")
          .first()
          .evaluate((element) => {
            const world = element as HTMLElement;
            const computedTransform = getComputedStyle(element).transform;
            const matrix = new DOMMatrixReadOnly(computedTransform);
            return {
              inlineTransform: world.style.transform,
              computedTransform,
              scaleX: matrix.a,
              scaleY: matrix.d,
              translateX: matrix.e,
              translateY: matrix.f,
            };
          }),
      ]);
    const contentBefore = await layout.evaluate((element) => {
      const layoutStyle = getComputedStyle(element);
      const layoutRect = element.getBoundingClientRect();
      const fixed = element.querySelector<HTMLElement>("#fixed")!;
      const fill = element.querySelector<HTMLElement>("#fill")!;
      const text = element.querySelector<HTMLElement>("#copy")!;
      const fixedStyle = getComputedStyle(fixed);
      const fillStyle = getComputedStyle(fill);
      const textStyle = getComputedStyle(text);
      const fixedRect = fixed.getBoundingClientRect();
      const fillRect = fill.getBoundingClientRect();
      return {
        layout: {
          left: layoutRect.left,
          top: layoutRect.top,
          width: layoutRect.width,
          height: layoutRect.height,
          columnGap: Number.parseFloat(layoutStyle.columnGap),
          rowGap: Number.parseFloat(layoutStyle.rowGap),
          paddingLeft: Number.parseFloat(layoutStyle.paddingLeft),
          paddingTop: Number.parseFloat(layoutStyle.paddingTop),
          fontSize: Number.parseFloat(layoutStyle.fontSize),
          lineHeight: Number.parseFloat(layoutStyle.lineHeight),
        },
        fixed: {
          width: fixedRect.width,
          height: fixedRect.height,
          flex: fixedStyle.flex,
        },
        fill: {
          width: fillRect.width,
          height: fillRect.height,
          flex: fillStyle.flex,
        },
        text: {
          fontSize: Number.parseFloat(textStyle.fontSize),
          lineHeight: Number.parseFloat(textStyle.lineHeight),
        },
      };
    });
    const readScreenState = async () => {
      const record = await readDesign(request, designId);
      const data = designData(record);
      return {
        frame: data.canvasFrames?.[fileId],
        metadata: data.screenMetadata?.[fileId],
        content: record.files?.find((file) => file.id === fileId)?.content,
      };
    };
    const readScreenSource = async () => {
      const query = new URLSearchParams({
        designId,
        path: "screen.html",
      });
      const response = await request.get(
        appPath(`/_agent-native/actions/read-source-file?${query.toString()}`),
      );
      if (!response.ok()) {
        throw new Error(`read-source-file failed: ${response.status()}`);
      }
      return ((await response.json()) as { content: string }).content;
    };
    const readScaleDiagnostics = async () => {
      const [shellBounds, cardBounds, persisted, camera] = await Promise.all([
        shell.boundingBox(),
        shell.locator("[data-screen-card]").boundingBox(),
        readScreenState(),
        page
          .locator("[data-multi-screen-canvas-world]")
          .first()
          .evaluate((element) => {
            const world = element as HTMLElement;
            const computedTransform = getComputedStyle(element).transform;
            const matrix = new DOMMatrixReadOnly(computedTransform);
            return {
              inlineTransform: world.style.transform,
              computedTransform,
              scaleX: matrix.a,
              scaleY: matrix.d,
              translateX: matrix.e,
              translateY: matrix.f,
            };
          }),
      ]);
      return {
        shellBounds,
        cardBounds,
        persistedFrame: persisted.frame,
        persistedMetadata: persisted.metadata,
        camera,
      };
    };
    const persistedBefore = await readScreenState();
    const untouchedBefore = designData(await readDesign(request, designId))
      .canvasFrames?.[untouchedFileId];
    expect(untouchedBefore).toMatchObject({
      x: 700.4,
      y: 700.6,
      width: 300.3,
      height: 200.2,
    });
    const sourceBefore = await readScreenSource();
    const visualBefore = await readScaleDiagnostics();
    const grip = await handle.boundingBox();
    if (!beforeShellBounds || !beforeCardBounds || !grip)
      throw new Error("Missing scale bounds");
    const handleHit = await page.evaluate(
      ({ x, y }) => {
        const target = document.elementFromPoint(x, y);
        return {
          tag: target?.tagName,
          resizeHandle: target?.getAttribute("data-resize-handle"),
        };
      },
      {
        x: grip.x + grip.width / 2,
        y: grip.y + grip.height / 2,
      },
    );
    expect(handleHit.resizeHandle).toBe("se");
    expect(persistedBefore.frame).toMatchObject({ width: 400, height: 400 });
    expect(persistedBefore.metadata).toMatchObject({
      width: 400,
      height: 400,
      heightPinned: true,
      heightMode: "fixed",
    });
    const startX = grip.x + grip.width / 2;
    const startY = grip.y + grip.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 24, startY + 24, { steps: 4 });
    await expect
      .poll(async () => {
        const diagnostics = await readScaleDiagnostics();
        const fontSize = await layout.evaluate((element) =>
          Number.parseFloat(
            getComputedStyle(element.querySelector("#copy")!).fontSize,
          ),
        );
        return Boolean(
          diagnostics.cardBounds &&
          beforeCardBounds &&
          diagnostics.cardBounds.width > beforeCardBounds.width &&
          fontSize > contentBefore.text.fontSize,
        );
      })
      .toBe(true);
    await page.mouse.up();
    await expect
      .poll(async () => (await readScreenState()).frame?.width)
      .toBeGreaterThan(400);
    await expect
      .poll(async () => (await readScreenState()).frame?.height)
      .toBeGreaterThan(400);
    await expect
      .poll(async () => {
        const saved = await readScreenState();
        return (
          saved.frame?.width !== undefined &&
          saved.frame.height !== undefined &&
          saved.metadata?.width === Math.round(saved.frame.width) &&
          saved.metadata?.height === Math.round(saved.frame.height)
        );
      })
      .toBe(true);

    const persistedAfterRelease = await readScreenState();
    expect(
      designData(await readDesign(request, designId)).canvasFrames?.[
        untouchedFileId
      ],
    ).toEqual(untouchedBefore);
    await expect.poll(readScreenSource).not.toBe(sourceBefore);
    const sourceAfterRelease = await readScreenSource();
    const visualAfterRelease = await readScaleDiagnostics();
    const beforeFrameWidth = persistedBefore.frame?.width;
    const afterFrameWidth = persistedAfterRelease.frame?.width;
    if (!beforeFrameWidth || !afterFrameWidth)
      throw new Error("Missing persisted Screen width for K scale");
    const scale = afterFrameWidth / beforeFrameWidth;
    const frameLabelChromeHeight =
      (beforeShellBounds.height - beforeCardBounds.height) /
      cameraBeforeGesture.scaleY;
    const cardWidthBeforeInWorld =
      beforeCardBounds.width / cameraBeforeGesture.scaleX;
    const cardHeightBeforeInWorld =
      beforeCardBounds.height / cameraBeforeGesture.scaleY;
    console.log(
      "SCREEN_K_BOUNDS_DIAGNOSTICS",
      JSON.stringify({
        atGestureSetup: {
          shellBounds: beforeShellBounds,
          cardBounds: beforeCardBounds,
          camera: cameraBeforeGesture,
        },
        before: visualBefore,
        afterRelease: visualAfterRelease,
        sourceScale: { beforeFrameWidth, afterFrameWidth, scale },
        frameLabelChromeHeight,
      }),
    );
    console.log(
      "SCREEN_K_SOURCE_LENGTHS",
      JSON.stringify({
        layoutNode: sourceAfterRelease.match(/<main\b[^>]*>/)?.[0],
        fixedNode: sourceAfterRelease.match(/id="fixed"[^>]*>/)?.[0],
        layout: sourceAfterRelease.match(/#layout\s*\{([^}]+)\}/)?.[1],
        fixed: sourceAfterRelease.match(/#fixed\s*\{([^}]+)\}/)?.[1],
        fill: sourceAfterRelease.match(/#fill\s*\{([^}]+)\}/)?.[1],
        copy: sourceAfterRelease.match(/#copy\s*\{([^}]+)\}/)?.[1],
      }),
    );
    const assertProportions = async (
      phase: string,
      expectedContent: typeof contentBefore,
    ) => {
      const outer = await shell.boundingBox();
      const cardBounds = await card.boundingBox();
      if (!outer || !cardBounds)
        throw new Error("Missing scaled Screen card bounds");
      const currentCamera = await page
        .locator("[data-multi-screen-canvas-world]")
        .first()
        .evaluate((element) => {
          const computedTransform = getComputedStyle(element).transform;
          const matrix = new DOMMatrixReadOnly(computedTransform);
          return { scaleX: matrix.a, scaleY: matrix.d };
        });
      expect(
        cardBounds.width / currentCamera.scaleX,
        `${phase} Screen card width in design coordinates`,
      ).toBeCloseTo(cardWidthBeforeInWorld * scale, 1);
      expect(
        cardBounds.height / currentCamera.scaleY,
        `${phase} Screen card height in design coordinates`,
      ).toBeCloseTo(cardHeightBeforeInWorld * scale, 1);
      expect(
        (outer.height - cardBounds.height) / currentCamera.scaleY,
        `${phase} frame label chrome height in design coordinates`,
      ).toBeCloseTo(frameLabelChromeHeight, 1);
      const actual = await layout.evaluate((element) => {
        const layoutStyle = getComputedStyle(element);
        const layoutRect = element.getBoundingClientRect();
        const fixed = element.querySelector<HTMLElement>("#fixed")!;
        const fill = element.querySelector<HTMLElement>("#fill")!;
        const text = element.querySelector<HTMLElement>("#copy")!;
        const fixedStyle = getComputedStyle(fixed);
        const fillStyle = getComputedStyle(fill);
        const textStyle = getComputedStyle(text);
        const fixedRect = fixed.getBoundingClientRect();
        const fillRect = fill.getBoundingClientRect();
        return {
          layout: {
            left: layoutRect.left,
            top: layoutRect.top,
            width: layoutRect.width,
            height: layoutRect.height,
            columnGap: Number.parseFloat(layoutStyle.columnGap),
            rowGap: Number.parseFloat(layoutStyle.rowGap),
            paddingLeft: Number.parseFloat(layoutStyle.paddingLeft),
            paddingTop: Number.parseFloat(layoutStyle.paddingTop),
            fontSize: Number.parseFloat(layoutStyle.fontSize),
            lineHeight: Number.parseFloat(layoutStyle.lineHeight),
          },
          fixed: {
            width: fixedRect.width,
            height: fixedRect.height,
            flex: fixedStyle.flex,
          },
          fill: {
            width: fillRect.width,
            height: fillRect.height,
            flex: fillStyle.flex,
          },
          text: {
            fontSize: Number.parseFloat(textStyle.fontSize),
            lineHeight: Number.parseFloat(textStyle.lineHeight),
          },
        };
      });
      for (const property of [
        "left",
        "top",
        "width",
        "height",
        "columnGap",
        "rowGap",
        "paddingLeft",
        "paddingTop",
        "fontSize",
        "lineHeight",
      ] as const) {
        expect(
          actual.layout[property],
          `${phase} layout.${property}`,
        ).toBeCloseTo(expectedContent.layout[property] * scale, 1);
      }
      for (const property of ["width", "height"] as const) {
        expect(
          actual.fixed[property],
          `${phase} fixed.${property}`,
        ).toBeCloseTo(expectedContent.fixed[property] * scale, 1);
        expect(actual.fill[property], `${phase} fill.${property}`).toBeCloseTo(
          expectedContent.fill[property] * scale,
          1,
        );
      }
      for (const property of ["fontSize", "lineHeight"] as const) {
        expect(actual.text[property], `${phase} text.${property}`).toBeCloseTo(
          expectedContent.text[property] * scale,
          1,
        );
      }
      expect(actual.fixed.flex).toBe(expectedContent.fixed.flex);
      expect(actual.fill.flex).toBe(expectedContent.fill.flex);
      expect(actual.fill.width).toBeGreaterThan(actual.fixed.width);
      return actual;
    };

    const afterReleaseContent = await assertProportions(
      "after release",
      contentBefore,
    );
    expect(persistedAfterRelease.frame?.width).toBeGreaterThan(400);
    expect(persistedAfterRelease.metadata?.width).toBe(
      Math.round(persistedAfterRelease.frame?.width ?? 0),
    );
    expect(persistedAfterRelease.metadata?.height).toBe(
      Math.round(persistedAfterRelease.frame?.height ?? 0),
    );
    expect(persistedAfterRelease.metadata).toMatchObject({
      heightPinned: true,
      heightMode: "fixed",
    });
    const undoShortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";
    const redoShortcut =
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";
    await page.keyboard.press(undoShortcut);
    await expect
      .poll(async () => {
        const saved = await readScreenState();
        return {
          frame: {
            width: saved.frame?.width,
            height: saved.frame?.height,
          },
          metadata: {
            width: saved.metadata?.width,
            height: saved.metadata?.height,
            heightPinned: saved.metadata?.heightPinned,
            heightMode: saved.metadata?.heightMode,
          },
        };
      })
      .toEqual({
        frame: { width: 400, height: 400 },
        metadata: {
          width: 400,
          height: 400,
          heightPinned: true,
          heightMode: "fixed",
        },
      });
    await expect
      .poll(async () => {
        const bounds = await shell.boundingBox();
        return bounds && { width: bounds.width, height: bounds.height };
      })
      .toEqual({
        width: beforeShellBounds.width,
        height: beforeShellBounds.height,
      });
    await expect.poll(readScreenSource).toBe(sourceBefore);
    await expect
      .poll(() =>
        layout.evaluate((element) => ({
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          gap: getComputedStyle(element).columnGap,
          padding: getComputedStyle(element).paddingLeft,
          font: getComputedStyle(element).fontSize,
        })),
      )
      .toMatchObject({
        width: contentBefore.layout.width,
        height: contentBefore.layout.height,
        gap: `${contentBefore.layout.columnGap}px`,
        padding: `${contentBefore.layout.paddingLeft}px`,
        font: `${contentBefore.layout.fontSize}px`,
      });

    await page.keyboard.press(redoShortcut);
    await expect
      .poll(async () => {
        const saved = await readScreenState();
        return {
          frame: {
            width: saved.frame?.width,
            height: saved.frame?.height,
          },
          metadata: {
            width: saved.metadata?.width,
            height: saved.metadata?.height,
            heightPinned: saved.metadata?.heightPinned,
            heightMode: saved.metadata?.heightMode,
          },
        };
      })
      .toEqual({
        frame: {
          width: persistedAfterRelease.frame?.width,
          height: persistedAfterRelease.frame?.height,
        },
        metadata: {
          width: persistedAfterRelease.metadata?.width,
          height: persistedAfterRelease.metadata?.height,
          heightPinned: true,
          heightMode: "fixed",
        },
      });
    await expect.poll(readScreenSource).toBe(sourceAfterRelease);
    await expect
      .poll(() =>
        layout.evaluate((element) => ({
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          gap: getComputedStyle(element).columnGap,
          padding: getComputedStyle(element).paddingLeft,
          font: getComputedStyle(element).fontSize,
        })),
      )
      .toMatchObject({
        width: afterReleaseContent.layout.width,
        height: afterReleaseContent.layout.height,
        gap: `${afterReleaseContent.layout.columnGap}px`,
        padding: `${afterReleaseContent.layout.paddingLeft}px`,
        font: `${afterReleaseContent.layout.fontSize}px`,
      });

    await page.reload();
    await expect(layout).toBeVisible();
    await assertProportions("after reload", contentBefore);
    const reloaded = await readScreenState();
    expect(reloaded.frame?.width).toBe(persistedAfterRelease.frame?.width);
    expect(reloaded.frame?.height).toBe(persistedAfterRelease.frame?.height);
    expect(reloaded.metadata?.width).toBe(
      persistedAfterRelease.metadata?.width,
    );
    expect(reloaded.metadata?.height).toBe(
      persistedAfterRelease.metadata?.height,
    );
    expect(reloaded.metadata).toMatchObject({
      heightPinned: true,
      heightMode: "fixed",
    });
    expect(await readScreenSource()).toBe(sourceAfterRelease);

    const scaleTool = page.getByRole("button", {
      name: "Scale",
      exact: true,
    });
    const moveTool = page.getByRole("button", { name: "Move", exact: true });
    await page.keyboard.press("k");
    await expect(scaleTool).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("v");
    await expect(moveTool).toHaveAttribute("aria-pressed", "true");
    await shell.locator("[data-frame-label]").click();
    const beforeNudge = await readScreenState();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await readScreenState()).frame?.x)
      .not.toBe(beforeNudge.frame?.x);
    const afterNudge = await readScreenState();
    expect(afterNudge.frame?.x).toBe(Math.round(afterNudge.frame?.x ?? NaN));
    expect(afterNudge.frame?.width).toBe(persistedAfterRelease.frame?.width);
    expect(afterNudge.frame?.height).toBe(persistedAfterRelease.frame?.height);
    expect(
      designData(await readDesign(request, designId)).canvasFrames?.[
        untouchedFileId
      ],
    ).toEqual(untouchedBefore);
    expect(await readScreenSource()).toBe(sourceAfterRelease);
    completed = test.info().errors.length === 0;
  } finally {
    if (completed) await action(request, "delete-design", { id: designId });
  }
});

test("Screen K rolls back when the scale collector disappears mid-gesture", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request, "Screen K missing collector");
  let completed = false;
  try {
    const fileId = await createScreen(request, designId, {
      content: SCREEN_K_SCALE_HTML,
      metadata: {
        sourceType: "inline",
        width: 400,
        height: 400,
        heightPinned: true,
        heightMode: "fixed",
      },
      geometry: { x: 0, y: 0, width: 400, height: 400, z: 0 },
    });
    await gotoEditor(page, designId);
    await page.getByRole("button", { name: "All screens" }).click();
    const shell = page.locator(
      `[data-screen-shell][data-frame-id="${fileId}"]`,
    );
    const frame = page.frameLocator(`[data-screen-iframe-id="${fileId}"]`);
    await expect(frame.locator("#layout")).toBeVisible();
    await shell.locator("[data-frame-label]").click();
    await page.keyboard.press("k");
    const handle = page.locator(
      '[data-frame-selection-box] [data-resize-handle="se"]',
    );
    await expect(handle).toBeVisible();

    const before = await readDesign(request, designId);
    const beforeGeometry = designData(before).canvasFrames?.[fileId];
    const beforeSource = before.files?.find(
      (file) => file.id === fileId,
    )?.content;
    const beforeBounds = await shell.boundingBox();
    const grip = await handle.boundingBox();
    if (!beforeGeometry || !beforeSource || !beforeBounds || !grip) {
      throw new Error("Missing Screen K rollback fixture state");
    }

    const startX = grip.x + grip.width / 2;
    const startY = grip.y + grip.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await frame.locator("#layout").evaluate(() => {
      const previewWindow = window as Window & {
        __designCanvasScaleContents?: unknown;
      };
      previewWindow.__designCanvasScaleContents = undefined;
    });
    await page.mouse.move(startX + 24, startY + 24, { steps: 3 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const latest = await readDesign(request, designId);
        return designData(latest).canvasFrames?.[fileId];
      })
      .toEqual(beforeGeometry);
    await expect.poll(() => shell.boundingBox()).toEqual(beforeBounds);
    const latest = await readDesign(request, designId);
    expect(latest.files?.find((file) => file.id === fileId)?.content).toBe(
      beforeSource,
    );
    completed = true;
  } finally {
    if (completed) await action(request, "delete-design", { id: designId });
  }
});
