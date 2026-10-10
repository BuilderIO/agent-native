import { expect, test } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { E2E_MENTION_EMAIL, E2E_PASSWORD } from "./global-setup";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const SYNTHETIC_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQSFjwHwAD5AIge4YO3AAAAABJRU5ErkJggg==",
  "base64",
);
const NOW = "2026-10-09T12:00:00.000Z";

function actionUrl(name: string): string {
  return `${BASE_URL}/_agent-native/actions/${name}`;
}

test("renders an authorized private replay image in the opaque presentation frame", async ({
  browser,
  page,
}) => {
  const design = await page.request.post(actionUrl("create-design"), {
    data: { title: "Private screenshot preview E2E", projectType: "prototype" },
  });
  expect(design.ok(), await design.text()).toBe(true);
  const designBody = await design.json();
  const designId =
    designBody?.id ?? designBody?.data?.id ?? designBody?.design?.id;
  expect(designId).toBeTruthy();
  const nodeKey = "design::synthetic-preview";
  const exampleIndex = 0;
  const unusedScreenshotPath =
    "/api/design-board-replay-screenshots/jcs_e2e_unselected_candidate";

  const viewerContext = await browser.newContext();
  const deniedContext = await browser.newContext();

  try {
    const staged = await page.request.post(
      actionUrl("stage-journey-canvas-frames"),
      {
        data: {
          designId,
          importId: `private-preview-${Date.now()}`,
          frames: [
            {
              frameKey: `${nodeKey}\u0000${exampleIndex}`,
              replayId: "synthetic-replay",
              app: "design",
              route: "/synthetic-private-preview",
              offsetMs: 0,
              width: 1,
              height: 1,
              capturedAt: NOW,
              pngBase64: SYNTHETIC_PNG.toString("base64"),
            },
          ],
        },
      },
    );
    expect(staged.ok(), await staged.text()).toBe(true);
    const stagedBody = await staged.json();
    const stagedFrameId = stagedBody?.stagedFrames?.[0]?.stagedFrameId;
    expect(stagedFrameId).toBeTruthy();

    const createdCanvas = await page.request.post(
      actionUrl("create-journey-canvas"),
      {
        data: {
          title: "Synthetic private screenshot preview",
          designId,
          tree: {
            window: { from: NOW, to: NOW },
            app: "design",
            rootN: 1,
            coverage: {
              sessionsWithEvents: 1,
              sessionsWithReplay: 1,
              truncated: false,
            },
            nodes: [
              {
                kind: "step",
                key: nodeKey,
                label: "Synthetic preview",
                parentKey: null,
                depth: 0,
                examples: [
                  {
                    sessionId: "synthetic-session",
                    recordingId: "synthetic-replay",
                    ts: NOW,
                    offsetMs: 0,
                    viewport: { width: 1, height: 1 },
                  },
                ],
                n: 1,
                pctOfRoot: 100,
                pctOfParent: 100,
                dropoffN: 0,
                dropoffPct: 0,
              },
            ],
          },
          frames: [
            {
              nodeKey,
              sourceApp: "design",
              route: "/synthetic-private-preview",
              exampleIndex,
              stagedFrameId,
              screenshotOffsetMs: 0,
              recordingStartedAt: NOW,
              width: 1,
              height: 1,
              capturedAt: NOW,
            },
          ],
        },
      },
    );
    expect(createdCanvas.ok(), await createdCanvas.text()).toBe(true);

    const designRead = await page.request.get(actionUrl("get-design"), {
      params: { id: designId },
    });
    expect(designRead.ok(), await designRead.text()).toBe(true);
    const readBody = await designRead.json();
    const screenshotPath = (readBody?.files ?? [])
      .map((file: { content?: string }) => file.content ?? "")
      .map(
        (content: string) =>
          content.match(
            /\/api\/design-board-replay-screenshots\/(jcs_[A-Za-z0-9_-]+)/,
          )?.[0],
      )
      .find((path: string | undefined) => path);
    expect(screenshotPath).toBeTruthy();

    const createFile = await page.request.post(actionUrl("create-file"), {
      data: {
        designId,
        filename: "index.html",
        fileType: "html",
        content: [
          "<!doctype html><html><body>",
          `<img data-e2e-private-preview alt="" width="1" height="1" src="${screenshotPath}">`,
          `<img data-e2e-private-preview alt="" width="1" height="1" srcset="${screenshotPath} 1x">`,
          `<picture><source media="not all" srcset="${unusedScreenshotPath} 1x"><source srcset="${screenshotPath} 1x"><img data-e2e-private-preview alt="" width="1" height="1"></picture>`,
          "</body></html>",
        ].join(""),
      },
    });
    expect(createFile.ok(), await createFile.text()).toBe(true);

    const grant = await page.request.post(actionUrl("share-resource"), {
      data: {
        resourceType: "design",
        resourceId: designId,
        principalType: "user",
        principalId: E2E_MENTION_EMAIL,
        role: "viewer",
        notify: false,
      },
    });
    expect(grant.ok(), await grant.text()).toBe(true);

    const viewerLogin = await viewerContext.request.post(
      `${BASE_URL}/_agent-native/auth/login`,
      { data: { email: E2E_MENTION_EMAIL, password: E2E_PASSWORD } },
    );
    expect(viewerLogin.ok(), await viewerLogin.text()).toBe(true);
    const viewerPage = await viewerContext.newPage();

    const viewerDesign = await viewerContext.request.get(
      actionUrl("get-design"),
      { params: { id: designId } },
    );
    expect(viewerDesign.ok(), await viewerDesign.text()).toBe(true);
    expect(await viewerDesign.json()).toMatchObject({ accessRole: "viewer" });

    const scopedScreenshotUrl = `${BASE_URL}${screenshotPath}?designId=${encodeURIComponent(designId)}`;
    const authorizedResponse =
      await viewerContext.request.get(scopedScreenshotUrl);
    expect(authorizedResponse.status()).toBe(200);
    expect(authorizedResponse.headers()["cross-origin-resource-policy"]).toBe(
      "same-origin",
    );
    expect((await authorizedResponse.body()).subarray(0, 8)).toEqual(
      Buffer.from("89504e470d0a1a0a", "hex"),
    );

    const deniedRegistration = await deniedContext.request.post(
      `${BASE_URL}/_agent-native/auth/register`,
      {
        data: {
          email: "bob+private-preview-e2e@local.test",
          password: E2E_PASSWORD,
        },
      },
    );
    expect([200, 201, 409]).toContain(deniedRegistration.status());
    const deniedLogin = await deniedContext.request.post(
      `${BASE_URL}/_agent-native/auth/login`,
      {
        data: {
          email: "bob+private-preview-e2e@local.test",
          password: E2E_PASSWORD,
        },
      },
    );
    expect(deniedLogin.ok(), await deniedLogin.text()).toBe(true);
    const deniedResponse = await deniedContext.request.get(scopedScreenshotUrl);
    expect(deniedResponse.status()).toBe(403);
    expect(deniedResponse.headers()["cross-origin-resource-policy"]).toBe(
      "same-origin",
    );

    let screenshotResponseHeaders: Record<string, string> | undefined;
    let screenshotResponseUrl: string | undefined;
    const screenshotResponsePaths: string[] = [];
    viewerPage.on("response", async (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith("/api/design-board-replay-screenshots/")) {
        screenshotResponsePaths.push(pathname);
      }
      if (pathname === screenshotPath) {
        screenshotResponseUrl = response.url();
        screenshotResponseHeaders = await response.allHeaders();
      }
    });
    await viewerPage.goto(`${BASE_URL}/present/${designId}`, {
      waitUntil: "domcontentloaded",
    });
    const screen = viewerPage
      .locator("iframe[data-design-preview-iframe]")
      .first();
    await expect(screen).toBeVisible({ timeout: 45_000 });
    await viewerPage.keyboard.press("ArrowRight");
    await viewerPage.keyboard.press("ArrowRight");
    await expect(screen).toHaveAttribute("title", /index\.html$/);
    expect(await screen.getAttribute("sandbox")).not.toContain(
      "allow-same-origin",
    );

    const images = screen
      .contentFrame()
      .locator("img[data-e2e-private-preview]");
    await expect
      .poll(() =>
        images.evaluateAll((elements) =>
          elements.map((element) => {
            const image = element as HTMLImageElement;
            return {
              naturalWidth: image.naturalWidth,
              privateBlob: image.currentSrc.startsWith("blob:"),
            };
          }),
        ),
      )
      .toEqual([
        { naturalWidth: 1, privateBlob: true },
        { naturalWidth: 1, privateBlob: true },
        { naturalWidth: 1, privateBlob: true },
      ]);
    await expect
      .poll(() => screenshotResponseHeaders?.["cross-origin-resource-policy"])
      .toBe("same-origin");
    await expect.poll(() => screenshotResponseUrl).toBeTruthy();
    expect(new URL(screenshotResponseUrl!).searchParams.get("designId")).toBe(
      designId,
    );
    expect(screenshotResponsePaths).toEqual([screenshotPath]);
  } finally {
    const deletion = await page.request.post(actionUrl("delete-design"), {
      data: { id: designId },
    });
    if (!deletion.ok()) {
      throw new Error(
        `Could not clean up the synthetic E2E design: ${deletion.status()}`,
      );
    }
    await viewerContext.close();
    await deniedContext.close();
  }
});
