import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import * as Y from "yjs";

import { appPath, designFrame, gotoEditor } from "./helpers";

const IMAGE_FIXTURE = path.resolve(
  import.meta.dirname,
  "fixtures/async-image-upload-probe.png",
);
const SCREEN_A_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Screen A</title></head><body data-agent-native-layer-name="Screen A" style="margin:0;background-color:#253b50"><main>Screen A source</main></body></html>`;
const SCREEN_B_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Screen B</title></head><body data-agent-native-layer-name="Screen B" style="margin:0;background-color:#805500"><main>Screen B source</main></body></html>`;

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

async function createTwoScreenDesign(page: Page) {
  const created = await postAction(page, "create-design", {
    title: `Screen root delayed image upload ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  await postAction(page, "create-file", {
    designId,
    filename: "screen-a.html",
    content: SCREEN_A_HTML,
    fileType: "html",
  });
  await postAction(page, "create-file", {
    designId,
    filename: "screen-b.html",
    content: SCREEN_B_HTML,
    fileType: "html",
  });
  const design = await readDesign(page, designId);
  const screenAId = design.files?.find(
    (file) => file.filename === "screen-a.html",
  )?.id;
  const screenBId = design.files?.find(
    (file) => file.filename === "screen-b.html",
  )?.id;
  if (!screenAId || !screenBId) throw new Error("Screen files were not saved");
  return { designId, screenAId, screenBId };
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
  if (typeof html !== "string") throw new Error("Screen source was not saved");
  return html;
}

async function readCollabContent(page: Page, screenId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/collab/${encodeURIComponent(screenId)}/state`),
  );
  if (!response.ok()) {
    throw new Error(
      `collab state: ${response.status()} ${await response.text()}`,
    );
  }
  const payload = (await response.json()) as { state?: string };
  if (!payload.state) throw new Error("collab state returned no document");
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, Buffer.from(payload.state, "base64"));
    return document.getText("content").toString();
  } finally {
    document.destroy();
  }
}

async function readBodyFill(page: Page, html: string) {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    const body = doc.body;
    return {
      backgroundColor: body.style.backgroundColor,
      backgroundImage: body.style.backgroundImage,
      sourceText: body.textContent?.trim() ?? "",
    };
  }, html);
}

async function deleteDesign(page: Page, designId: string) {
  await postAction(page, "delete-design", { id: designId });
}

async function waitForGate(gate: Promise<void>, label: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      gate,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}`)),
          45_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

test("delayed Screen-root image upload stays with its original Screen", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { designId, screenAId, screenBId } = await createTwoScreenDesign(page);
  const uploadTimeline: Array<Record<string, unknown>> = [];
  const timelineStart = Date.now();
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/_agent-native/actions/")) return;
    const action = url.split("/_agent-native/actions/")[1]?.split(/[?#]/)[0];
    if (action === "get-design") {
      uploadTimeline.push({
        ms: Date.now() - timelineStart,
        event: "browser-get-design-request",
      });
      return;
    }
    if (action !== "update-file") return;
    let body: Record<string, unknown> = {};
    try {
      body = request.postDataJSON() as Record<string, unknown>;
    } catch {
      // The request observation is diagnostic; the actual request remains
      // authoritative and is asserted through its response and saved source.
    }
    const content = typeof body.content === "string" ? body.content : "";
    uploadTimeline.push({
      ms: Date.now() - timelineStart,
      event: "browser-update-file-request",
      fileId: body.id,
      expectedVersionHash: body.expectedVersionHash ?? null,
      syncCollab: body.syncCollab ?? null,
      hasConcurrentMarker: content.includes(
        "Screen A source updated during upload",
      ),
      hasUploadUrl: /qa-figma-import-assets/.test(content),
      contentLength: content.length,
    });
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/_agent-native/actions/update-file")) {
      const request = response.request();
      let fileId: unknown;
      try {
        fileId = (request.postDataJSON() as Record<string, unknown>).id;
      } catch {
        return;
      }
      if (fileId !== screenAId) return;
      void response
        .json()
        .then((body: Record<string, unknown>) => {
          uploadTimeline.push({
            ms: Date.now() - timelineStart,
            event: "browser-update-file-response",
            status: response.status(),
            versionHash: body.versionHash ?? null,
            skippedStaleMirror: body.skippedStaleMirror ?? false,
            skippedStaleOperation: body.skippedStaleOperation ?? false,
          });
        })
        .catch(() => {});
      return;
    }
    if (!url.includes("/_agent-native/actions/get-design")) return;
    void response
      .json()
      .then((body: DesignRecord) => {
        const file = body.files?.find((entry) => entry.id === screenAId);
        if (!file) return;
        uploadTimeline.push({
          ms: Date.now() - timelineStart,
          event: "browser-get-design-response",
          screenAHasConcurrentMarker: file.content.includes(
            "Screen A source updated during upload",
          ),
          screenAContentLength: file.content.length,
          screenAUpdatedAt: (file as { updatedAt?: string }).updatedAt ?? null,
        });
      })
      .catch(() => {});
  });
  let releaseUpload!: () => void;
  let releaseBrowserDesignReads!: () => void;
  let markUploadStarted!: () => void;
  let markUploadCompleted!: () => void;
  let holdBrowserDesignReads = false;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const browserDesignReadGate = new Promise<void>((resolve) => {
    releaseBrowserDesignReads = resolve;
  });
  const uploadStarted = new Promise<void>((resolve) => {
    markUploadStarted = resolve;
  });
  const uploadCompleted = new Promise<void>((resolve) => {
    markUploadCompleted = resolve;
  });
  let uploadStatus: number | undefined;
  let uploadBody: string | undefined;
  let uploadRouteError: string | undefined;
  const uploadRoute = "**/_agent-native/actions/upload-image";
  const designReadRoute = "**/_agent-native/actions/get-design*";

  try {
    await gotoEditor(page, designId);
    await page.route(designReadRoute, async (route) => {
      if (!holdBrowserDesignReads) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = await response.text();
      let screenAHasConcurrentMarker: boolean | null = null;
      try {
        const design = JSON.parse(body) as DesignRecord;
        const file = design.files?.find((entry) => entry.id === screenAId);
        screenAHasConcurrentMarker =
          file?.content.includes("Screen A source updated during upload") ??
          null;
      } catch {
        screenAHasConcurrentMarker = null;
      }
      uploadTimeline.push({
        ms: Date.now() - timelineStart,
        event: "browser-get-design-held",
        screenAHasConcurrentMarker,
      });
      await waitForGate(browserDesignReadGate, "browser get-design release");
      await route.fulfill({ response, body });
    });
    const layers = page.getByRole("tree", { name: "Layers" });
    const screens = layers.locator('[role="treeitem"][aria-level="1"]');
    await expect(screens).toHaveCount(2);

    const selectScreen = async (name: "Screen A" | "Screen B") => {
      const row = screens.filter({ hasText: name });
      await row.locator("[data-layer-row-button]").click();
      await expect(row).toHaveAttribute("aria-selected", "true");
      return row;
    };

    const screenARow = await selectScreen("Screen A");
    const fill = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Fill", exact: true }),
      })
      .first();
    await fill.getByRole("button", { name: "Open color picker" }).click();
    await page.getByRole("button", { name: "Image", exact: true }).click();
    await page.getByRole("button", { name: "Upload image" }).click();

    await page.route(uploadRoute, async (route) => {
      try {
        markUploadStarted();
        await waitForGate(uploadGate, "upload response release");
        const response = await route.fetch();
        uploadStatus = response.status();
        uploadBody = await response.text();
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

    const clientResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/upload-image"),
      { timeout: 45_000 },
    );
    await page
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles(IMAGE_FIXTURE);
    await uploadStarted;
    expect(
      await readBodyFill(page, await readScreenHtml(page, designId, screenAId)),
    ).toMatchObject({
      backgroundImage: "",
      sourceText: "Screen A source",
    });

    const imagePicker = page.getByRole("dialog").filter({
      has: page.getByRole("textbox", { name: "Image URL" }),
    });
    await expect(imagePicker).toBeVisible();
    await page.getByRole("heading", { name: "Layers", exact: true }).click();
    await expect(imagePicker).toBeHidden();
    const screenBRow = await selectScreen("Screen B");
    const screenBHtmlBefore = await readScreenHtml(page, designId, screenBId);
    await expect
      .poll(() =>
        designFrame(page, screenBId)
          .locator("body")
          .evaluate((body) => getComputedStyle(body).backgroundColor),
      )
      .toBe("rgb(128, 85, 0)");

    const screenAHtmlBeforeEdit = await readScreenHtml(
      page,
      designId,
      screenAId,
    );
    const screenAHtmlWithConcurrentEdit = screenAHtmlBeforeEdit.replace(
      "Screen A source",
      "Screen A source updated during upload",
    );
    expect(screenAHtmlWithConcurrentEdit).not.toBe(screenAHtmlBeforeEdit);
    holdBrowserDesignReads = true;
    const externalUpdateResult = await postAction(page, "update-file", {
      id: screenAId,
      content: screenAHtmlWithConcurrentEdit,
    });
    uploadTimeline.push({
      ms: Date.now() - timelineStart,
      event: "external-update-action-response",
      versionHash: externalUpdateResult?.versionHash ?? null,
      skippedStaleMirror: externalUpdateResult?.skippedStaleMirror ?? false,
    });
    await expect
      .poll(() => readScreenHtml(page, designId, screenAId))
      .toContain("Screen A source updated during upload");
    expect(await readBodyFill(page, screenBHtmlBefore)).toMatchObject({
      backgroundColor: "rgb(128, 85, 0)",
      backgroundImage: "",
      sourceText: "Screen B source",
    });

    uploadTimeline.push({
      ms: Date.now() - timelineStart,
      event: "upload-response-released",
      browserHadObservedConcurrentMarker: uploadTimeline.some(
        (event) =>
          event.event === "browser-get-design-response" &&
          event.screenAHasConcurrentMarker === true,
      ),
    });
    const staleUpdateResponsePromise = page.waitForResponse(
      (response) => {
        if (!response.url().includes("/_agent-native/actions/update-file")) {
          return false;
        }
        try {
          return (
            (response.request().postDataJSON() as Record<string, unknown>)
              .id === screenAId
          );
        } catch {
          return false;
        }
      },
      { timeout: 45_000 },
    );
    releaseUpload();
    const uploadResponse = await clientResponsePromise;
    await uploadCompleted;
    expect(uploadStatus, uploadBody).toBe(200);
    expect(uploadRouteError).toBeUndefined();
    const clientBody = await uploadResponse.text();
    expect(uploadResponse.status(), clientBody).toBe(200);
    const payload = JSON.parse(clientBody || "{}") as {
      url?: string;
    };
    expect(payload.url).toMatch(/^\/api\/qa-figma-import-assets\//);
    const staleUpdateResponse = await staleUpdateResponsePromise;
    const staleUpdateBody = await staleUpdateResponse.text();
    const staleUpdateResult = JSON.parse(staleUpdateBody) as {
      skippedStaleMirror?: boolean;
    };
    if (staleUpdateResponse.status() === 200) {
      expect(staleUpdateResult.skippedStaleMirror).toBe(true);
    } else {
      expect(staleUpdateResponse.status(), staleUpdateBody).toBe(409);
    }
    await expect(
      page.getByText(
        "This screen changed elsewhere. Your last edit was not saved.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      uploadTimeline.some(
        (event) =>
          event.event === "browser-get-design-response" &&
          event.screenAHasConcurrentMarker === true,
      ),
    ).toBe(false);
    expect(
      uploadTimeline.some(
        (event) =>
          event.event === "browser-update-file-request" &&
          event.fileId === screenAId &&
          event.hasConcurrentMarker === false &&
          typeof event.expectedVersionHash === "string",
      ),
    ).toBe(true);
    releaseBrowserDesignReads();
    holdBrowserDesignReads = false;
    await expect
      .poll(() => designFrame(page, screenAId).locator("body").textContent())
      .toContain("Screen A source updated during upload");
    const screenAHtmlAfterUpload = await readScreenHtml(
      page,
      designId,
      screenAId,
    );
    const screenBHtmlAfterUpload = await readScreenHtml(
      page,
      designId,
      screenBId,
    );
    const screenBPreviewAfterUpload = await designFrame(page, screenBId)
      .locator("body")
      .evaluate((body) => ({
        backgroundColor: getComputedStyle(body).backgroundColor,
        backgroundImage: getComputedStyle(body).backgroundImage,
        text: body.querySelector("main")?.textContent?.trim() ?? "",
      }));
    const selectedLayersAfterUpload = await screens.evaluateAll((rows) =>
      rows
        .filter((row) => row.getAttribute("aria-selected") === "true")
        .map((row) => row.textContent?.replace(/\s+/g, " ").trim() ?? ""),
    );
    console.log(
      "screen-image-upload-target-after-release",
      JSON.stringify({
        rejectedImageUrl: payload.url,
        screenAHasUpload: screenAHtmlAfterUpload.includes(payload.url!),
        screenAHasInterveningEdit: screenAHtmlAfterUpload.includes(
          "Screen A source updated during upload",
        ),
        screenBSourceUnchanged: screenBHtmlAfterUpload === screenBHtmlBefore,
        screenBPreview: screenBPreviewAfterUpload,
        selectedLayers: selectedLayersAfterUpload,
      }),
    );
    console.log(
      "screen-image-upload-target-version-timeline",
      JSON.stringify(uploadTimeline),
    );
    await expect
      .poll(() => readScreenHtml(page, designId, screenBId))
      .toBe(screenBHtmlBefore);
    await expect(screenBRow).toHaveAttribute("aria-selected", "true");
    expect(selectedLayersAfterUpload).toHaveLength(1);
    expect(selectedLayersAfterUpload[0]).toContain("Screen b");
    await expect
      .poll(() =>
        designFrame(page, screenBId)
          .locator("body")
          .evaluate((body) => ({
            backgroundColor: getComputedStyle(body).backgroundColor,
            backgroundImage: getComputedStyle(body).backgroundImage,
            text: body.querySelector("main")?.textContent?.trim() ?? "",
          })),
      )
      .toMatchObject({
        backgroundColor: "rgb(128, 85, 0)",
        backgroundImage: "none",
        text: "Screen B source",
      });
    await expect(screenARow).not.toHaveAttribute("aria-selected", "true");
    expect(screenAHtmlAfterUpload).not.toContain(payload.url!);
    expect(screenAHtmlAfterUpload).toContain(
      "Screen A source updated during upload",
    );

    const retryScreenARow = await selectScreen("Screen A");
    await expect(retryScreenARow).toHaveAttribute("aria-selected", "true");
    const retryFill = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Fill", exact: true }),
      })
      .first();
    await retryFill.getByRole("button", { name: "Open color picker" }).click();
    await page.getByRole("button", { name: "Image", exact: true }).click();
    await page.getByRole("button", { name: "Upload image" }).click();
    const retryUploadResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/upload-image"),
      { timeout: 45_000 },
    );
    await page
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles(IMAGE_FIXTURE);
    const retryUploadResponse = await retryUploadResponsePromise;
    const retryUploadBody = await retryUploadResponse.text();
    expect(retryUploadResponse.status(), retryUploadBody).toBe(200);
    const retryPayload = JSON.parse(retryUploadBody) as { url?: string };
    expect(retryPayload.url).toMatch(/^\/api\/qa-figma-import-assets\//);
    await expect
      .poll(
        async () =>
          (
            await readBodyFill(
              page,
              await readScreenHtml(page, designId, screenAId),
            )
          ).backgroundImage,
      )
      .toContain(retryPayload.url!);
    const screenAHtmlAfterRetry = await readScreenHtml(
      page,
      designId,
      screenAId,
    );
    expect(screenAHtmlAfterRetry).toContain(
      "Screen A source updated during upload",
    );
    expect(screenAHtmlAfterRetry).toContain(retryPayload.url!);
    expect(await readScreenHtml(page, designId, screenBId)).toBe(
      screenBHtmlBefore,
    );
    await page.reload();
    await expect
      .poll(async () => readScreenHtml(page, designId, screenAId))
      .toContain("Screen A source updated during upload");
    await expect
      .poll(async () => readScreenHtml(page, designId, screenAId))
      .toContain(retryPayload.url!);
    expect(await readScreenHtml(page, designId, screenBId)).toBe(
      screenBHtmlBefore,
    );
  } finally {
    releaseUpload?.();
    releaseBrowserDesignReads?.();
    await Promise.race([
      uploadCompleted,
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
    await page.unroute(uploadRoute).catch(() => {});
    await page.unroute(designReadRoute).catch(() => {});
    await deleteDesign(page, designId);
  }
});

test("active Screen upload conflict preserves SQL and live-collaboration source", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { designId, screenAId, screenBId } = await createTwoScreenDesign(page);
  const marker = "Screen A source updated during active upload";
  const timeline: Array<Record<string, unknown>> = [];
  let releaseUpload!: () => void;
  let markUploadStarted!: () => void;
  let uploadFinished!: () => void;
  let releaseBrowserReads!: () => void;
  let holdBrowserReads = false;
  let hideRemoteCollabEvents = false;
  let filteredCollabEvents = 0;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const uploadStarted = new Promise<void>((resolve) => {
    markUploadStarted = resolve;
  });
  const uploadDone = new Promise<void>((resolve) => {
    uploadFinished = resolve;
  });
  const browserReadGate = new Promise<void>((resolve) => {
    releaseBrowserReads = resolve;
  });
  const uploadRoute = "**/_agent-native/actions/upload-image";
  const designReadRoute = "**/_agent-native/actions/get-design*";
  const pollRoute = "**/_agent-native/poll?*";
  const eventsRoute = "**/_agent-native/events*";
  const timelineStart = Date.now();

  try {
    const initialHtml = await readScreenHtml(page, designId, screenAId);
    await postAction(page, "update-file", {
      id: screenAId,
      content: initialHtml,
      syncCollab: true,
    });

    await page.route(eventsRoute, async (route) => {
      await route.fulfill({ status: 204, body: "" });
    });
    await page.route(pollRoute, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (!hideRemoteCollabEvents) {
        await route.fulfill({ response, body });
        return;
      }

      const payload = JSON.parse(body) as {
        events?: Array<{ source?: string; docId?: string }>;
        [key: string]: unknown;
      };
      const events = payload.events ?? [];
      const hidden = events.filter(
        (event) => event.source === "collab" && event.docId === screenAId,
      );
      filteredCollabEvents += hidden.length;
      if (hidden.length > 0) {
        timeline.push({
          ms: Date.now() - timelineStart,
          event: "filtered-screen-a-collab-events",
          count: hidden.length,
        });
      }
      await route.fulfill({
        response,
        body: JSON.stringify({
          ...payload,
          events: events.filter(
            (event) => event.source !== "collab" || event.docId !== screenAId,
          ),
        }),
      });
    });
    await page.route(designReadRoute, async (route) => {
      if (!holdBrowserReads) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = await response.text();
      const design = JSON.parse(body) as DesignRecord;
      const source = design.files?.find((file) => file.id === screenAId);
      timeline.push({
        ms: Date.now() - timelineStart,
        event: "held-active-browser-design-read",
        hasMarker: source?.content.includes(marker) ?? false,
      });
      await waitForGate(browserReadGate, "active browser get-design release");
      await route.fulfill({ response, body });
    });

    const collabStateResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/_agent-native/collab/${screenAId}/state`),
      { timeout: 20_000 },
    );
    await gotoEditor(page, designId);
    const collabStateResponse = await collabStateResponsePromise;
    const collabState = (await collabStateResponse.json()) as {
      state?: string;
    };
    expect(collabStateResponse.status()).toBe(200);
    expect(collabState.state).toBeTruthy();
    timeline.push({
      ms: Date.now() - timelineStart,
      event: "screen-a-collab-state-ready",
      status: collabStateResponse.status(),
      hasState: Boolean(collabState.state),
    });

    await page.route(uploadRoute, async (route) => {
      try {
        markUploadStarted();
        await waitForGate(uploadGate, "active upload response release");
        await route.continue();
      } finally {
        uploadFinished();
      }
    });

    const layers = page.getByRole("tree", { name: "Layers" });
    const screenARow = layers
      .locator('[role="treeitem"][aria-level="1"]')
      .filter({ hasText: "Screen A" });
    await screenARow.locator("[data-layer-row-button]").click();
    await expect(screenARow).toHaveAttribute("aria-selected", "true");
    const fill = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Fill", exact: true }),
      })
      .first();
    await fill.getByRole("button", { name: "Open color picker" }).click();
    await page.getByRole("button", { name: "Image", exact: true }).click();
    await page.getByRole("button", { name: "Upload image" }).click();
    await page
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles(IMAGE_FIXTURE);
    await uploadStarted;

    const imagePicker = page.getByRole("dialog").filter({
      has: page.getByRole("textbox", { name: "Image URL" }),
    });
    await expect(imagePicker).toBeVisible();
    await page.getByRole("heading", { name: "Layers", exact: true }).click();
    await expect(imagePicker).toBeHidden();
    await page
      .locator(
        `[data-screen-shell][data-frame-id="${screenAId}"] [data-frame-label]`,
      )
      .dblclick();
    await expect(
      page.locator(`[data-screen-shell][data-frame-id="${screenAId}"]`),
    ).toHaveAttribute("data-screen-interact-mode", "true");
    await expect(
      page.locator(`[data-screen-shell][data-frame-id="${screenBId}"]`),
    ).toHaveAttribute("data-screen-interact-mode", "false");
    await expect(
      page.locator(`iframe[data-screen-iframe-id="${screenAId}"]`),
    ).toBeVisible();

    const activeFrame = page.frameLocator(
      `iframe[data-screen-iframe-id="${screenAId}"]`,
    );
    await expect(activeFrame.locator("body")).toContainText("Screen A source");
    const markerHtml = initialHtml.replace("Screen A source", marker);
    expect(markerHtml).not.toBe(initialHtml);

    hideRemoteCollabEvents = true;
    holdBrowserReads = true;
    const externalResult = await postAction(page, "update-file", {
      id: screenAId,
      content: markerHtml,
      syncCollab: true,
    });
    timeline.push({
      ms: Date.now() - timelineStart,
      event: "external-active-update-result",
      versionHash: externalResult?.versionHash ?? null,
      skippedStaleMirror: externalResult?.skippedStaleMirror ?? false,
    });
    const collabSourceBeforeRelease = await readCollabContent(page, screenAId);
    expect(collabSourceBeforeRelease).toContain(marker);
    timeline.push({
      ms: Date.now() - timelineStart,
      event: "server-collab-source-before-upload-release",
      hasMarker: collabSourceBeforeRelease.includes(marker),
      hasUploadUrl: /qa-figma-import-assets/.test(collabSourceBeforeRelease),
    });
    expect(await readScreenHtml(page, designId, screenAId)).toContain(marker);
    await expect(activeFrame.locator("body")).not.toContainText(marker);

    const uploadResponsePromise = page.waitForResponse(
      (response) => {
        if (!response.url().includes("/_agent-native/actions/upload-image")) {
          return false;
        }
        return response.status() === 200;
      },
      { timeout: 45_000 },
    );
    const fileUpdateResponsePromise = page.waitForResponse(
      (response) => {
        if (!response.url().includes("/_agent-native/actions/update-file")) {
          return false;
        }
        try {
          const body = response.request().postDataJSON() as Record<
            string,
            unknown
          >;
          return (
            body.id === screenAId &&
            /qa-figma-import-assets/.test(String(body.content ?? ""))
          );
        } catch {
          return false;
        }
      },
      { timeout: 45_000 },
    );
    releaseUpload();
    const uploadResponse = await uploadResponsePromise;
    await uploadDone;
    const uploadResponseBody = await uploadResponse.text();
    const uploadResult = JSON.parse(uploadResponseBody) as { url?: string };
    expect(uploadResult.url).toMatch(/^\/api\/qa-figma-import-assets\//);

    const fileUpdateResponse = await fileUpdateResponsePromise;
    const requestBody = fileUpdateResponse.request().postDataJSON() as Record<
      string,
      unknown
    >;
    const fileUpdateBody = JSON.parse(await fileUpdateResponse.text()) as {
      skippedStaleMirror?: boolean;
    };
    timeline.push({
      ms: Date.now() - timelineStart,
      event: "active-upload-update-file-result",
      status: fileUpdateResponse.status(),
      syncCollab: requestBody.syncCollab ?? null,
      expectedVersionHash: requestBody.expectedVersionHash ?? null,
      hasMarker: String(requestBody.content ?? "").includes(marker),
      skippedStaleMirror: fileUpdateBody.skippedStaleMirror ?? false,
      filteredCollabEvents,
    });
    console.log(
      "screen-image-upload-active-collab-timeline",
      JSON.stringify(timeline),
    );
    expect(requestBody.syncCollab, JSON.stringify(timeline)).toBe(true);
    if (fileUpdateResponse.status() === 409) {
      expect(fileUpdateBody.skippedStaleMirror).not.toBe(true);
    } else {
      expect(fileUpdateResponse.status()).toBe(200);
      expect(fileUpdateBody.skippedStaleMirror).toBe(true);
    }
    await expect(
      page.getByText(
        "This screen changed elsewhere. Your last edit was not saved.",
        { exact: true },
      ),
    ).toBeVisible();

    releaseBrowserReads();
    holdBrowserReads = false;
    hideRemoteCollabEvents = false;
    await expect
      .poll(async () => readScreenHtml(page, designId, screenAId))
      .toContain(marker);
    await expect
      .poll(async () => readScreenHtml(page, designId, screenAId))
      .not.toContain(uploadResult.url!);
    await expect
      .poll(async () => readCollabContent(page, screenAId))
      .toContain(marker);
    await expect
      .poll(async () => readCollabContent(page, screenAId))
      .not.toContain(uploadResult.url!);
    await expect(activeFrame.locator("body")).toContainText(marker);
    await expect
      .poll(() =>
        activeFrame
          .locator("body")
          .evaluate((body) => getComputedStyle(body).backgroundImage),
      )
      .not.toContain(uploadResult.url!);
    const collabSourceBeforeReload = await readCollabContent(page, screenAId);
    const sourceBeforeReload = await readScreenHtml(page, designId, screenAId);
    expect(collabSourceBeforeReload).toContain(marker);
    expect(collabSourceBeforeReload).not.toContain(uploadResult.url!);
    expect(sourceBeforeReload).toContain(marker);
    expect(sourceBeforeReload).not.toContain(uploadResult.url!);
    timeline.push({
      ms: Date.now() - timelineStart,
      event: "active-source-and-preview-recovered-before-reload",
      persistedHasMarker: sourceBeforeReload.includes(marker),
      persistedHasUpload: sourceBeforeReload.includes(uploadResult.url!),
      collabHasMarker: collabSourceBeforeReload.includes(marker),
      collabHasUpload: collabSourceBeforeReload.includes(uploadResult.url!),
      previewHasMarker: await activeFrame
        .locator("body")
        .evaluate(
          (body, expectedMarker) =>
            body.textContent?.includes(expectedMarker) ?? false,
          marker,
        ),
      previewBackgroundImage: await activeFrame
        .locator("body")
        .evaluate((body) => getComputedStyle(body).backgroundImage),
    });
    console.log(
      "screen-image-upload-active-collab-before-reload",
      JSON.stringify(timeline),
    );
    await page.reload();
    await expect
      .poll(async () => readScreenHtml(page, designId, screenAId))
      .toContain(marker);
    const persistedHtml = await readScreenHtml(page, designId, screenAId);
    expect(persistedHtml).toContain(marker);
    if (
      fileUpdateResponse.status() === 409 ||
      fileUpdateBody.skippedStaleMirror
    ) {
      expect(persistedHtml).not.toContain(uploadResult.url!);
    }
    const reloadedFrame = page.frameLocator(
      `iframe[data-screen-iframe-id="${screenAId}"]`,
    );
    await expect(reloadedFrame.locator("body")).toContainText(marker);
    const collabSourceAfterReload = await readCollabContent(page, screenAId);
    expect(collabSourceAfterReload).toContain(marker);
    expect(collabSourceAfterReload).not.toContain(uploadResult.url!);
    console.log(
      "screen-image-upload-active-collab-after-reload",
      JSON.stringify({
        persistedHasMarker: persistedHtml.includes(marker),
        persistedHasUpload: persistedHtml.includes(uploadResult.url!),
        previewText: await reloadedFrame.locator("body").innerText(),
      }),
    );
  } finally {
    releaseUpload?.();
    releaseBrowserReads?.();
    await Promise.race([
      uploadDone,
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
    await page.unroute(uploadRoute).catch(() => {});
    await page.unroute(designReadRoute).catch(() => {});
    await page.unroute(pollRoute).catch(() => {});
    await page.unroute(eventsRoute).catch(() => {});
    await deleteDesign(page, designId);
  }
});
