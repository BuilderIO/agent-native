import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const PNG_FIXTURE = path.resolve(
  import.meta.dirname,
  "fixtures/async-image-upload-probe.png",
);
const SVG_FIXTURE = path.resolve(
  import.meta.dirname,
  "fixtures/sonora-play-button.svg",
);
const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<main data-agent-native-node-id="upload-root" data-agent-native-layer-name="Root" style="position:relative;width:640px;height:480px">
  <div data-agent-native-node-id="upload-target-a" data-agent-native-layer-name="Original A" data-an-primitive="frame" style="position:absolute;left:48px;top:48px;width:200px;height:140px;background-color:#253b50"></div>
  <div data-agent-native-node-id="upload-target-b" data-agent-native-layer-name="Next B" data-an-primitive="frame" style="position:absolute;left:320px;top:48px;width:200px;height:140px;background-color:#805500"></div>
</main>
</body></html>`;
const OTHER_SCREEN_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<main data-agent-native-node-id="other-upload-root" data-agent-native-layer-name="Other Root" style="position:relative;width:640px;height:480px">
  <div data-agent-native-node-id="upload-target-c" data-agent-native-layer-name="Other Screen C" data-an-primitive="frame" style="position:absolute;left:80px;top:80px;width:200px;height:140px;background-color:#25633b"></div>
</main>
</body></html>`;

type DesignRecord = {
  files?: Array<{ id: string; filename: string; content: string }>;
};

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    {
      data: input,
    },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createUploadDesign(page: Page, includeOtherScreen = false) {
  const created = await postAction(page, "create-design", {
    title: `Async image fill upload ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId,
    filename: "screen.html",
    content: HTML,
    fileType: "html",
  });
  const design = await readDesign(page, designId);
  const screenId = design.files?.find(
    (file) => file.filename === "screen.html",
  )?.id;
  if (!screenId) throw new Error("screen.html was not returned by get-design");
  let otherScreenId: string | undefined;
  if (includeOtherScreen) {
    await postAction(page, "create-file", {
      designId,
      filename: "other-screen.html",
      content: OTHER_SCREEN_HTML,
      fileType: "html",
    });
    const withOtherScreen = await readDesign(page, designId);
    otherScreenId = withOtherScreen.files?.find(
      (file) => file.filename === "other-screen.html",
    )?.id;
    if (!otherScreenId)
      throw new Error("other-screen.html was not returned by get-design");
  }
  return { designId, screenId, otherScreenId };
}

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  return (await response.json()) as DesignRecord;
}

async function readScreenHtml(page: Page, designId: string, screenId: string) {
  const design = await readDesign(page, designId);
  const html = design.files?.find((file) => file.id === screenId)?.content;
  if (typeof html !== "string")
    throw new Error("screen source was not returned");
  return html;
}

async function readImageFills(page: Page, designId: string, screenId: string) {
  const html = await readScreenHtml(page, designId, screenId);
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    const backgroundImage = (id: string) => {
      const element = doc.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${id}"]`,
      );
      if (!element) throw new Error(`missing saved layer ${id}`);
      return element.style.backgroundImage;
    };
    return {
      originalA: backgroundImage("upload-target-a"),
      nextB: backgroundImage("upload-target-b"),
    };
  }, html);
}

async function readImageFillUrl(
  page: Page,
  designId: string,
  screenId: string,
  nodeId: string,
) {
  const html = await readScreenHtml(page, designId, screenId);
  return page.evaluate(
    ({ source, targetId }) => {
      const doc = new DOMParser().parseFromString(source, "text/html");
      const element = doc.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${targetId}"]`,
      );
      if (!element) throw new Error(`missing saved layer ${targetId}`);
      return element.style.backgroundImage;
    },
    { source: html, targetId: nodeId },
  );
}

async function readSavedBackgroundStyles(
  page: Page,
  designId: string,
  screenId: string,
  nodeId: string,
) {
  const source = await readScreenHtml(page, designId, screenId);
  return page.evaluate(
    ({ html, targetId }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const element = doc.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${targetId}"]`,
      );
      if (!element) throw new Error(`missing saved layer ${targetId}`);
      return {
        backgroundImage: element.style.backgroundImage,
        backgroundSize: element.style.backgroundSize,
        backgroundRepeat: element.style.backgroundRepeat,
        backgroundPosition: element.style.backgroundPosition,
      };
    },
    { html: source, targetId: nodeId },
  );
}

function imageUrlFromCss(value: string) {
  return value.match(/url\(["']?([^"')]+)["']?\)/i)?.[1] ?? "";
}

async function assertImageSavedAndRendered(
  page: Page,
  designId: string,
  screenId: string,
  returnedUrl: string,
  expectedSize: { width: number; height: number },
) {
  await expect
    .poll(async () => {
      const fills = await readImageFills(page, designId, screenId);
      return {
        originalA: imageUrlFromCss(fills.originalA),
        nextB: imageUrlFromCss(fills.nextB),
      };
    })
    .toEqual({ originalA: returnedUrl, nextB: "" });

  const live = designFrame(page, screenId).locator(
    '[data-agent-native-node-id="upload-target-a"]',
  );
  await expect(live).toHaveCount(1);
  const rendered = await live.evaluate(async (element, url) => {
    const image = new Image();
    image.src = new URL(url, document.baseURI).href;
    await image.decode();
    const bounds = element.getBoundingClientRect();
    return {
      backgroundImage: getComputedStyle(element).backgroundImage,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      renderedWidth: bounds.width,
      renderedHeight: bounds.height,
    };
  }, returnedUrl);
  expect(rendered.backgroundImage).toContain(returnedUrl);
  expect(rendered).toMatchObject({
    naturalWidth: expectedSize.width,
    naturalHeight: expectedSize.height,
  });
  expect(rendered.renderedWidth).toBeGreaterThan(0);
  expect(rendered.renderedHeight).toBeGreaterThan(0);
}

async function assertAddFillKeepsUploadedImage(
  page: Page,
  designId: string,
  screenId: string,
  imageUrl: string,
) {
  const targetId = "upload-target-a";
  const beforeAdd = await readSavedBackgroundStyles(
    page,
    designId,
    screenId,
    targetId,
  );
  expect(beforeAdd.backgroundImage).toContain(imageUrl);
  expect(beforeAdd).toMatchObject({
    backgroundSize: "cover",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center center",
  });

  const layers = page.getByRole("tree", { name: "Layers" });
  await page.getByRole("heading", { name: "Layers", exact: true }).click();
  await layers.getByRole("button", { name: "Original A", exact: true }).click();
  const fill = page
    .getByRole("heading", { name: "Fill", exact: true })
    .locator("xpath=ancestor::section")
    .first();
  await fill.getByRole("button", { name: "Add fill", exact: true }).click();

  let afterAdd = await readSavedBackgroundStyles(
    page,
    designId,
    screenId,
    targetId,
  );
  await expect
    .poll(async () => {
      afterAdd = await readSavedBackgroundStyles(
        page,
        designId,
        screenId,
        targetId,
      );
      return (
        afterAdd.backgroundImage.includes("linear-gradient") &&
        afterAdd.backgroundImage.includes(imageUrl)
      );
    })
    .toBe(true);
  expect(afterAdd).toMatchObject({
    backgroundSize: "auto, cover",
    backgroundRepeat: "no-repeat, no-repeat",
  });

  const paintRows = fill.locator('[data-inspector-layout="drag-paint-row"]');
  await expect(paintRows).toHaveCount(2);
  const live = designFrame(page, screenId).locator(
    `[data-agent-native-node-id="${targetId}"]`,
  );
  await expect
    .poll(() =>
      live.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundImage: style.backgroundImage.includes("linear-gradient"),
          backgroundSize: style.backgroundSize,
          backgroundRepeat: style.backgroundRepeat,
        };
      }),
    )
    .toEqual({
      backgroundImage: true,
      backgroundSize: "auto, cover",
      backgroundRepeat: "no-repeat, no-repeat",
    });
  const renderedAfterAdd = await live.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      backgroundSize: style.backgroundSize,
      backgroundRepeat: style.backgroundRepeat,
    };
  });
  expect(renderedAfterAdd.backgroundImage).toContain(imageUrl);
  expect(renderedAfterAdd.backgroundImage).toContain("linear-gradient");
  expect(renderedAfterAdd.backgroundSize).toBe("auto, cover");
  expect(renderedAfterAdd.backgroundRepeat).toBe("no-repeat, no-repeat");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(layers).toBeVisible();
  await enterDirectMode(page);
  await expandAllLayers(page);
  await layers.getByRole("button", { name: "Original A", exact: true }).click();
  const afterReload = await readSavedBackgroundStyles(
    page,
    designId,
    screenId,
    targetId,
  );
  expect(afterReload).toEqual(afterAdd);
  await expect(paintRows).toHaveCount(2);
  await expect
    .poll(() =>
      live.evaluate((element, expectedUrl) => {
        const style = getComputedStyle(element);
        return (
          style.backgroundImage.includes(expectedUrl) &&
          style.backgroundImage.includes("linear-gradient") &&
          style.backgroundSize === "auto, cover" &&
          style.backgroundRepeat === "no-repeat, no-repeat"
        );
      }, imageUrl),
    )
    .toBe(true);
}

async function uploadBeforePickerCloses(
  page: Page,
  fixture: string,
  expectedSize: { width: number; height: number },
) {
  const { designId, screenId } = await createUploadDesign(page);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    const fileInput = await openImageFill(page, "Original A");
    const uploadResponse = page.waitForResponse((response) =>
      response.url().includes("/_agent-native/actions/upload-image"),
    );
    await fileInput.setInputFiles(fixture);
    const response = await uploadResponse;
    const responseBody = await response.text();
    expect(response.status(), responseBody).toBe(200);
    const payload = JSON.parse(responseBody) as { url?: string };
    expect(payload.url).toMatch(/^\/api\/qa-figma-import-assets\//);
    await assertImageSavedAndRendered(
      page,
      designId,
      screenId,
      payload.url!,
      expectedSize,
    );
    await assertAddFillKeepsUploadedImage(
      page,
      designId,
      screenId,
      payload.url!,
    );
  } finally {
    await deleteDesign(page, designId);
  }
}

async function uploadAfterPickerCloses(
  page: Page,
  fixture: string,
  expectedSize: { width: number; height: number },
  switchToOtherScreen = false,
) {
  const { designId, screenId, otherScreenId } = await createUploadDesign(
    page,
    switchToOtherScreen,
  );
  let releaseUpload!: () => void;
  let markUploadStarted!: () => void;
  let markUploadCompleted!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const uploadStarted = new Promise<void>((resolve) => {
    markUploadStarted = resolve;
  });
  const uploadCompleted = new Promise<void>((resolve) => {
    markUploadCompleted = resolve;
  });
  let uploadStatus: number | undefined;
  let uploadPayload: { url?: string } | undefined;
  let uploadBody: string | undefined;
  let uploadRouteError: string | undefined;
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await page.route("**/_agent-native/actions/upload-image", async (route) => {
      try {
        markUploadStarted();
        await uploadGate;
        const response = await route.fetch();
        uploadStatus = response.status();
        uploadBody = await response.text();
        uploadPayload = JSON.parse(uploadBody) as { url?: string };
        await route.fulfill({
          status: uploadStatus,
          headers: response.headers(),
          body: uploadBody,
        });
      } catch (error) {
        uploadRouteError =
          error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        markUploadCompleted();
      }
    });

    const fileInput = await openImageFill(page, "Original A");
    const clientResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/upload-image"),
      { timeout: 45_000 },
    );
    await fileInput.setInputFiles(fixture);
    await uploadStarted;
    expect(await readImageFills(page, designId, screenId)).toEqual({
      originalA: "",
      nextB: "",
    });

    const imageUrlInput = page.getByRole("textbox", { name: "Image URL" });
    const imagePicker = page.getByRole("dialog").filter({ has: imageUrlInput });
    await expect(imagePicker).toBeVisible();
    const layers = page.getByRole("tree", { name: "Layers" });
    await page.getByRole("heading", { name: "Layers", exact: true }).click();
    await expect(imagePicker).toBeHidden();
    const nextSelection = switchToOtherScreen
      ? layers.getByRole("button", {
          name: "Other Screen C",
          exact: true,
        })
      : layers.getByRole("button", { name: "Next B", exact: true });
    await nextSelection.click();
    await expect(
      layers.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText(switchToOtherScreen ? "Other Screen C" : "Next B");
    console.log(
      "async-image-fill-selection-before-release",
      JSON.stringify({
        designId,
        screenId,
        otherScreenId,
        selectedLayer: await layers
          .locator('[role="treeitem"][aria-selected="true"]')
          .innerText(),
        fills: await readImageFills(page, designId, screenId),
      }),
    );

    releaseUpload();
    const clientResponse = await clientResponsePromise;
    await uploadCompleted;
    expect(uploadStatus, uploadBody).toBe(200);
    const clientBody = await clientResponse.text();
    expect(clientResponse.status(), clientBody).toBe(200);
    const clientPayload = JSON.parse(clientBody) as { url?: string };
    expect(clientPayload.url).toMatch(/^\/api\/qa-figma-import-assets\//);
    expect(uploadPayload?.url).toBe(clientPayload.url);
    await assertImageSavedAndRendered(
      page,
      designId,
      screenId,
      clientPayload.url!,
      expectedSize,
    );
    if (switchToOtherScreen) {
      if (!otherScreenId) throw new Error("missing other Screen id");
      expect(
        imageUrlFromCss(
          await readImageFillUrl(
            page,
            designId,
            otherScreenId,
            "upload-target-c",
          ),
        ),
      ).toBe("");
    }
    const selectedLayerAfterUpload = await layers
      .locator('[role="treeitem"][aria-selected="true"]')
      .innerText();
    const fillsAfterUpload = await readImageFills(page, designId, screenId);
    console.log(
      "async-image-fill-selection-after-upload",
      JSON.stringify({
        designId,
        screenId,
        otherScreenId,
        assetUrl: clientPayload.url,
        selectedLayer: selectedLayerAfterUpload,
        fills: fillsAfterUpload,
      }),
    );
    await page.screenshot({
      path: test.info().outputPath("async-image-fill-after-upload.png"),
    });
    await expect(
      layers.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText(switchToOtherScreen ? "Other Screen C" : "Next B");
    if (switchToOtherScreen) {
      await page.reload();
      await expect(
        designFrame(page, screenId).locator(
          '[data-agent-native-node-id="upload-target-a"]',
        ),
      ).toHaveCount(1);
      await assertImageSavedAndRendered(
        page,
        designId,
        screenId,
        clientPayload.url!,
        expectedSize,
      );
      if (!otherScreenId) throw new Error("missing other Screen id");
      expect(
        imageUrlFromCss(
          await readImageFillUrl(
            page,
            designId,
            otherScreenId,
            "upload-target-c",
          ),
        ),
      ).toBe("");
    }
    console.log(
      "close-before-upload-result",
      JSON.stringify({
        uploadStatus,
        uploadPayload,
        uploadBody,
        uploadRouteError,
      }),
    );
  } finally {
    releaseUpload?.();
    await Promise.race([
      uploadCompleted,
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
    await page.unroute("**/_agent-native/actions/upload-image").catch(() => {});
    await deleteDesign(page, designId);
  }
}

async function openImageFill(page: Page, layerName: string) {
  const layers = page.getByRole("tree", { name: "Layers" });
  await layers.getByRole("button", { name: layerName, exact: true }).click();
  const fill = page
    .getByRole("heading", { name: "Fill", exact: true })
    .locator("xpath=ancestor::section")
    .first();
  await fill.getByRole("button", { name: "Open color picker" }).click();
  await page.getByRole("button", { name: "Image", exact: true }).click();
  await page.getByRole("button", { name: "Upload image" }).click();
  return page.locator('input[type="file"][accept="image/*"]');
}

async function deleteDesign(page: Page, designId: string) {
  await postAction(page, "delete-design", { id: designId });
}

test("PNG image fill upload stays renderable after Add fill and reload", async ({
  page,
}) => {
  await uploadBeforePickerCloses(page, PNG_FIXTURE, { width: 8, height: 8 });
});

test("PNG upload still saves on its original layer after the picker closes", async ({
  page,
}) => {
  await uploadAfterPickerCloses(page, PNG_FIXTURE, { width: 8, height: 8 });
});

test("Sonora SVG fill upload stays renderable after Add fill and reload", async ({
  page,
}) => {
  await uploadBeforePickerCloses(page, SVG_FIXTURE, { width: 48, height: 48 });
});

test("Sonora SVG upload stays on its original layer after the picker closes", async ({
  page,
}) => {
  await uploadAfterPickerCloses(page, SVG_FIXTURE, { width: 48, height: 48 });
});

test("delayed PNG fill keeps its original Screen target after switching Screens", async ({
  page,
}) => {
  await uploadAfterPickerCloses(
    page,
    PNG_FIXTURE,
    { width: 8, height: 8 },
    true,
  );
});
