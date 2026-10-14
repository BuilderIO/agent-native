import { readFile } from "node:fs/promises";
import path from "node:path";

import { type Page, type Route } from "@playwright/test";

import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const PNG_FIXTURE = path.resolve(
  import.meta.dirname,
  "fixtures/async-image-upload-probe.png",
);
const WEBM_FIXTURE = path.resolve(
  import.meta.dirname,
  "fixtures/design-media-probe.webm",
);
const PNG_URL = "/e2e-assets/design-media-probe.png";
const WEBM_URL = "/e2e-assets/design-media-probe.webm";
const SCREEN_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body data-agent-native-node-id="page" style="margin:0"><main data-agent-native-node-id="media-root" data-agent-native-layer-name="Media root" style="position:relative;width:640px;height:480px;background:#20242b"></main></body></html>`;
const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

test.use({ viewport: { width: 1600, height: 1000 } });

async function seedMediaScreen(app: App) {
  const id = await app.seed(SCREEN_HTML);
  const screenId = (await app.savedRecord(id)).files.find(
    (file) => file.filename === "index.html",
  )!.id;
  await app.open(id);
  await app.zoomToFit();
  return { id, screenId };
}

function screenMedia(app: App, selector: "img" | "video", name: string) {
  return app.page
    .locator(LIVE_SCREEN)
    .contentFrame()
    .locator(`${selector}[data-agent-native-layer-name="${name}"]`);
}

/** The live Screen iframe; its source type decides whether the localhost recovery overlay covers it. */
function liveScreen(page: Page) {
  return page.locator(LIVE_SCREEN);
}

async function installAssetRoute(
  page: Page,
  url: string,
  body: Buffer,
  contentType: string,
) {
  const pathname = new URL(url, page.url()).pathname;
  await page.route(`**${pathname}`, (route) =>
    route.fulfill({ body, contentType }),
  );
}

async function addToolbarMedia(page: Page, fixture: string) {
  await page.getByRole("button", { name: "Shapes options" }).click();
  await page.getByRole("menuitem", { name: "Image/video..." }).click();
  const input = page.locator('[data-design-bottom-toolbar] input[type="file"]');
  await expect(input).toHaveAttribute("accept", "image/*,video/*");
  await input.setInputFiles(fixture);
}

type UploadGate = {
  started: Promise<void>;
  release: () => void;
  error: () => string | undefined;
};

/** Holds the upload response until `release`, so the blob: preview can be checked first. */
async function gateUpload(
  page: Page,
  pattern: string,
  response: { status: number; body: Record<string, string> },
  assertRequest: (route: Route) => Promise<void>,
): Promise<UploadGate> {
  let markStarted!: () => void;
  let release!: () => void;
  let routeError: string | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    try {
      await assertRequest(route);
      markStarted();
      await gate;
      await route.fulfill({
        status: response.status,
        contentType: "application/json",
        body: JSON.stringify(response.body),
      });
    } catch (error) {
      routeError = error instanceof Error ? error.message : String(error);
      markStarted();
      await route.abort("failed").catch(() => {});
    }
  });
  return { started, release, error: () => routeError };
}

async function assertWebmUpload(route: Route) {
  const request = route.request();
  expect(request.headers()["content-type"]).toContain("multipart/form-data");
  expect(request.postDataBuffer()?.includes("design-media-probe.webm")).toBe(
    true,
  );
  expect(request.postDataBuffer()?.includes("video/webm")).toBe(true);
}

/** The one saved layer `name` added since `before`, checked to be the only change. */
function savedMediaLayer(
  before: Map<string, SavedNode>,
  after: Map<string, SavedNode>,
  name: string,
) {
  const added = [...after.keys()].filter((id) => !before.has(id));
  expect(added).toHaveLength(1);
  expectOnlyChanged(before, after, added);
  const layer = after.get(added[0])!;
  expect(layer.attrs["data-agent-native-layer-name"]).toBe(name);
  return layer;
}

// fixme: product bug: Once the video's durable URL on this host (http://<loopback>/e2e-assets/…webm) is saved, the inline Screen is reclassified as
test.fixme("toolbar inserts image and video through preview, upload, save, and reload", async ({
  app,
}) => {
  test.setTimeout(120_000);
  const page = app.page;
  const { id, screenId } = await seedMediaScreen(app);
  await expect(liveScreen(page)).toHaveAttribute(
    "data-design-source-type",
    "inline",
  );
  await installAssetRoute(
    page,
    PNG_URL,
    await readFile(PNG_FIXTURE),
    "image/png",
  );
  await installAssetRoute(
    page,
    WEBM_URL,
    await readFile(WEBM_FIXTURE),
    "video/webm",
  );
  const frameLabel = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-label]`,
  );

  await frameLabel.click();
  const beforeImage = await app.savedNodes(id);
  const imageUpload = await gateUpload(
    page,
    "**/_agent-native/actions/upload-image",
    { status: 200, body: { url: PNG_URL } },
    async (route) => {
      const body = route.request().postDataJSON() as {
        data?: string;
        filename?: string;
      };
      expect(body.filename).toBe("async-image-upload-probe.png");
      expect(body.data).toMatch(/^data:image\/png;base64,/);
    },
  );
  const image = screenMedia(app, "img", "async-image-upload-probe.png");
  await addToolbarMedia(page, PNG_FIXTURE);
  await imageUpload.started;
  expect(imageUpload.error()).toBeUndefined();
  await expect(image).toHaveAttribute("src", /^blob:/);
  imageUpload.release();
  await expect(image).toHaveAttribute("src", PNG_URL);
  await app.settled();
  const withImage = await app.savedNodes(id);
  const savedImage = savedMediaLayer(
    beforeImage,
    withImage,
    "async-image-upload-probe.png",
  );
  expect(savedImage).toMatchObject({ tag: "img", parent: "page" });
  expect(savedImage.attrs.src).toBe(PNG_URL);
  expect(
    styleOf(savedImage),
    "the 8×8 image lands at the Screen's centre",
  ).toMatchObject({
    position: "absolute",
    width: "8px",
    height: "8px",
    left: "716px",
    top: "508px",
  });

  await page.reload();
  await expect(image).toHaveAttribute("src", PNG_URL);
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(8);

  const webmUrl = new URL(WEBM_URL, page.url()).href;
  await app.zoomToFit();
  await frameLabel.click();
  const videoUpload = await gateUpload(
    page,
    "**/_agent-native/file-upload",
    { status: 201, body: { url: webmUrl } },
    assertWebmUpload,
  );
  const video = screenMedia(app, "video", "design-media-probe.webm");
  await addToolbarMedia(page, WEBM_FIXTURE);
  await videoUpload.started;
  expect(videoUpload.error()).toBeUndefined();
  await expect(video).toHaveAttribute("src", /^blob:/);
  await expect(video).toHaveAttribute("preload", "metadata");
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).videoWidth),
    )
    .toBe(32);
  videoUpload.release();
  await expect(video).toHaveAttribute("src", webmUrl);
  await app.settled();
  const savedVideo = savedMediaLayer(
    withImage,
    await app.savedNodes(id),
    "design-media-probe.webm",
  );
  expect(savedVideo).toMatchObject({ tag: "video", parent: "page" });
  expect(savedVideo.attrs.src).toBe(webmUrl);
  expect(
    styleOf(savedVideo),
    "the 32×24 video lands at the Screen's centre",
  ).toMatchObject({
    position: "absolute",
    width: "32px",
    height: "24px",
    left: "704px",
    top: "500px",
  });
  await expect
    .soft(
      liveScreen(page),
      "a media URL on this host does not turn the Screen into a localhost preview",
    )
    .toHaveAttribute("data-design-source-type", "inline");

  await page.reload();
  await expect(video).toHaveAttribute("src", webmUrl);
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).videoHeight),
    )
    .toBe(24);
  await expect
    .soft(liveScreen(page), "the Screen is still an inline Screen after reload")
    .toHaveAttribute("data-design-source-type", "inline");
});

// fixme: product bug: Once the video's durable URL on this host (http://<loopback>/e2e-assets/…webm) is saved, the inline Screen is reclassified as
test.fixme("pasting a desktop video file uploads and persists a playable layer", async ({
  app,
}) => {
  test.setTimeout(120_000);
  const page = app.page;
  const { id } = await seedMediaScreen(app);
  await expect(liveScreen(page)).toHaveAttribute(
    "data-design-source-type",
    "inline",
  );
  await installAssetRoute(
    page,
    WEBM_URL,
    await readFile(WEBM_FIXTURE),
    "video/webm",
  );
  const before = await app.savedNodes(id);
  const webmUrl = new URL(WEBM_URL, page.url()).href;
  const upload = await gateUpload(
    page,
    "**/_agent-native/file-upload",
    { status: 201, body: { url: webmUrl } },
    assertWebmUpload,
  );

  // Playwright cannot put a file on the OS clipboard, so the paste event carries it directly.
  const fixtureBytes = [...(await readFile(WEBM_FIXTURE))];
  const pasteWasHandled = await page
    .locator(LIVE_SCREEN)
    .contentFrame()
    .locator("body")
    .evaluate((body, bytes) => {
      const file = new File(
        [Uint8Array.from(bytes)],
        "design-media-probe.webm",
        {
          type: "video/webm",
        },
      );
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      });
      body.dispatchEvent(event);
      return event.defaultPrevented;
    }, fixtureBytes);
  expect(pasteWasHandled).toBe(true);

  const video = screenMedia(app, "video", "design-media-probe.webm");
  await upload.started;
  expect(upload.error()).toBeUndefined();
  await expect(video).toHaveAttribute("src", /^blob:/);
  await expect(video).toHaveAttribute("preload", "metadata");
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).videoWidth),
    )
    .toBe(32);

  upload.release();
  await expect(video).toHaveAttribute("src", webmUrl);
  await app.settled();
  const saved = savedMediaLayer(
    before,
    await app.savedNodes(id),
    "design-media-probe.webm",
  );
  expect(saved).toMatchObject({ tag: "video", parent: "page" });
  expect(saved.attrs.src).toBe(webmUrl);
  expect(
    styleOf(saved),
    "the 32×24 video lands at the Screen's centre",
  ).toMatchObject({
    position: "absolute",
    width: "32px",
    height: "24px",
    left: "704px",
    top: "500px",
  });
  await expect
    .soft(
      liveScreen(page),
      "a media URL on this host does not turn the Screen into a localhost preview",
    )
    .toHaveAttribute("data-design-source-type", "inline");

  await page.reload();
  await expect(video).toHaveAttribute("src", webmUrl);
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).videoHeight),
    )
    .toBe(24);
  await expect
    .soft(liveScreen(page), "the Screen is still an inline Screen after reload")
    .toHaveAttribute("data-design-source-type", "inline");
});
