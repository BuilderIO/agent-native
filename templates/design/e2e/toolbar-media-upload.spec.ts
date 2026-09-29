import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page, type Route } from "@playwright/test";

import { appPath, designFrame, enterDirectMode, gotoEditor } from "./helpers";

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
const SCREEN_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main data-agent-native-node-id="media-root" data-agent-native-layer-name="Media root" style="position:relative;width:640px;height:480px;background:#20242b"></main></body></html>`;

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
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createMediaDesign(page: Page) {
  const created = await postAction(page, "create-design", {
    title: `Toolbar media upload ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId,
    filename: "screen.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const design = await readDesign(page, designId);
  const screenId = design.files?.find(
    (file) => file.filename === "screen.html",
  )?.id;
  if (!screenId) throw new Error("screen.html was not returned by get-design");
  return { designId, screenId };
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
  if (typeof html !== "string") throw new Error("screen source was not saved");
  return html;
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
  await page.getByRole("button", { name: "Rectangle options" }).click();
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

async function verifyToolbarMedia(
  page: Page,
  options: {
    designId: string;
    screenId: string;
    fixture: string;
    name: string;
    selector: "img" | "video";
    durableUrl: string;
    route: string;
    responseStatus: number;
    responseBody: Record<string, string>;
    assertUpload: (route: Route) => Promise<void>;
    assetBody: Buffer;
    contentType: string;
  },
) {
  await page
    .locator(
      `[data-screen-shell][data-frame-id="${options.screenId}"] [data-frame-label]`,
    )
    .click();
  const upload = await gateUpload(
    page,
    options.route,
    { status: options.responseStatus, body: options.responseBody },
    options.assertUpload,
  );
  const media = designFrame(page, options.screenId).locator(
    `${options.selector}[data-agent-native-layer-name="${options.name}"]`,
  );
  try {
    await addToolbarMedia(page, options.fixture);
    await upload.started;
    expect(upload.error()).toBeUndefined();
    await expect(media).toHaveCount(1);
    const previewUrl = await media.getAttribute("src");
    expect(previewUrl).toMatch(/^blob:/);
    if (options.selector === "video") {
      await expect
        .poll(() =>
          media.evaluate((element) => (element as HTMLVideoElement).videoWidth),
        )
        .toBe(32);
      await expect(media).toHaveAttribute("preload", "metadata");
    }

    upload.release();
    await expect.poll(() => media.getAttribute("src")).toBe(options.durableUrl);
    await expect
      .poll(async () =>
        (
          await readScreenHtml(page, options.designId, options.screenId)
        ).includes(options.durableUrl),
      )
      .toBe(true);
    const persisted = await readScreenHtml(
      page,
      options.designId,
      options.screenId,
    );
    expect(persisted).toContain(
      `data-agent-native-layer-name="${options.name}"`,
    );
    expect(persisted).not.toContain("blob:");

    await installAssetRoute(
      page,
      options.durableUrl,
      options.assetBody,
      options.contentType,
    );
    await page.reload();
    const reloadedMedia = designFrame(page, options.screenId).locator(
      `${options.selector}[data-agent-native-layer-name="${options.name}"]`,
    );
    await expect(reloadedMedia).toHaveAttribute("src", options.durableUrl);
    if (options.selector === "img") {
      await expect
        .poll(() =>
          reloadedMedia.evaluate(
            (element) => (element as HTMLImageElement).naturalWidth,
          ),
        )
        .toBe(8);
    } else {
      await expect
        .poll(() =>
          reloadedMedia.evaluate(
            (element) => (element as HTMLVideoElement).videoHeight,
          ),
        )
        .toBe(24);
    }
  } finally {
    upload.release();
    await page.unroute(options.route).catch(() => {});
  }
}

test("toolbar inserts image and video through preview, upload, save, and reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { designId, screenId } = await createMediaDesign(page);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);

    await verifyToolbarMedia(page, {
      designId,
      screenId,
      fixture: PNG_FIXTURE,
      name: "async-image-upload-probe.png",
      selector: "img",
      durableUrl: PNG_URL,
      route: "**/_agent-native/actions/upload-image",
      responseStatus: 200,
      responseBody: { url: PNG_URL },
      assertUpload: async (route) => {
        const body = route.request().postDataJSON() as {
          data?: string;
          filename?: string;
        };
        expect(body.filename).toBe("async-image-upload-probe.png");
        expect(body.data).toMatch(/^data:image\/png;base64,/);
      },
      assetBody: await readFile(PNG_FIXTURE),
      contentType: "image/png",
    });

    await verifyToolbarMedia(page, {
      designId,
      screenId,
      fixture: WEBM_FIXTURE,
      name: "design-media-probe.webm",
      selector: "video",
      durableUrl: new URL(WEBM_URL, page.url()).href,
      route: "**/_agent-native/file-upload",
      responseStatus: 201,
      responseBody: { url: new URL(WEBM_URL, page.url()).href },
      assertUpload: async (route) => {
        const request = route.request();
        expect(request.headers()["content-type"]).toContain(
          "multipart/form-data",
        );
        expect(
          request.postDataBuffer()?.includes("design-media-probe.webm"),
        ).toBe(true);
        expect(request.postDataBuffer()?.includes("video/webm")).toBe(true);
      },
      assetBody: await readFile(WEBM_FIXTURE),
      contentType: "video/webm",
    });
  } finally {
    await postAction(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("pasting a desktop video file uploads and persists a playable layer", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { designId, screenId } = await createMediaDesign(page);
  let upload: UploadGate | undefined;
  try {
    await gotoEditor(page, designId);
    const durableUrl = new URL(WEBM_URL, page.url()).href;
    upload = await gateUpload(
      page,
      "**/_agent-native/file-upload",
      { status: 201, body: { url: durableUrl } },
      async (route) => {
        const request = route.request();
        expect(request.headers()["content-type"]).toContain(
          "multipart/form-data",
        );
        expect(
          request.postDataBuffer()?.includes("design-media-probe.webm"),
        ).toBe(true);
        expect(request.postDataBuffer()?.includes("video/webm")).toBe(true);
      },
    );
    await enterDirectMode(page);
    const fixtureBytes = [...(await readFile(WEBM_FIXTURE))];
    const pasteWasPrevented = await designFrame(page, screenId)
      .locator("body")
      .evaluate((body, bytes) => {
        const file = new File(
          [Uint8Array.from(bytes)],
          "design-media-probe.webm",
          { type: "video/webm" },
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
    expect(pasteWasPrevented).toBe(true);

    const media = designFrame(page, screenId).locator(
      'video[data-agent-native-layer-name="design-media-probe.webm"]',
    );
    await upload.started;
    expect(upload.error()).toBeUndefined();
    await expect(media).toHaveCount(1);
    await expect(media).toHaveAttribute("preload", "metadata");
    await expect
      .poll(() =>
        media.evaluate((element) => (element as HTMLVideoElement).videoWidth),
      )
      .toBe(32);
    await expect(media).toHaveAttribute("src", /^blob:/);

    upload.release();
    await expect.poll(() => media.getAttribute("src")).toBe(durableUrl);
    await expect
      .poll(() => readScreenHtml(page, designId, screenId))
      .toContain(durableUrl);
    const saved = await readScreenHtml(page, designId, screenId);
    expect(saved).toContain(
      'data-agent-native-layer-name="design-media-probe.webm"',
    );
    expect(saved).not.toContain("blob:");

    await installAssetRoute(
      page,
      WEBM_URL,
      await readFile(WEBM_FIXTURE),
      "video/webm",
    );
    await page.reload();
    const reloadedMedia = designFrame(page, screenId).locator(
      'video[data-agent-native-layer-name="design-media-probe.webm"]',
    );
    await expect(reloadedMedia).toHaveAttribute("src", durableUrl);
    await expect
      .poll(() =>
        reloadedMedia.evaluate(
          (element) => (element as HTMLVideoElement).videoHeight,
        ),
      )
      .toBe(24);
  } finally {
    upload?.release();
    await page.unroute("**/_agent-native/file-upload").catch(() => {});
    await postAction(page, "delete-design", { id: designId }).catch(() => {});
  }
});
