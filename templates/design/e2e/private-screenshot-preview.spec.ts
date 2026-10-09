import { expect, test } from "@playwright/test";

import { appPath } from "./helpers";

const SCREENSHOT_PATH =
  "/api/design-board-replay-screenshots/e2e-private-preview";
const SYNTHETIC_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bksAAAAASUVORK5CYII=",
  "base64",
);

test("loads a synthetic private replay image in the read-only presentation iframe", async ({
  page,
}) => {
  const createDesign = await page.request.post(
    appPath("/_agent-native/actions/create-design"),
    { data: { title: "Private screenshot preview", projectType: "prototype" } },
  );
  expect(createDesign.ok()).toBe(true);
  const created = await createDesign.json();
  const designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  expect(designId).toBeTruthy();

  try {
    const createFile = await page.request.post(
      appPath("/_agent-native/actions/create-file"),
      {
        data: {
          designId,
          filename: "index.html",
          fileType: "html",
          content: `<!doctype html><html><body><img data-e2e-private-preview alt="" width="1" height="1" src="${SCREENSHOT_PATH}"></body></html>`,
        },
      },
    );
    expect(createFile.ok()).toBe(true);

    let imageResponseHeaders: Record<string, string> | undefined;
    page.on("response", async (response) => {
      if (response.url().includes(SCREENSHOT_PATH)) {
        imageResponseHeaders = await response.allHeaders();
      }
    });
    await page.route(`**${SCREENSHOT_PATH}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        headers: { "Cross-Origin-Resource-Policy": "cross-origin" },
        body: SYNTHETIC_PNG,
      }),
    );

    await page.goto(appPath(`/present/${designId}`), {
      waitUntil: "domcontentloaded",
    });
    const screen = page.locator("iframe[data-design-preview-iframe]").first();
    await expect(screen).toBeVisible({ timeout: 45_000 });
    expect(await screen.getAttribute("sandbox")).not.toContain(
      "allow-same-origin",
    );

    const image = screen
      .contentFrame()
      .locator("img[data-e2e-private-preview]");
    await expect
      .poll(() =>
        image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    await expect
      .poll(() => imageResponseHeaders?.["cross-origin-resource-policy"])
      .toBe("cross-origin");
  } finally {
    await page.request
      .post(appPath("/_agent-native/actions/delete-design"), {
        data: { id: designId },
      })
      .catch(() => undefined);
  }
});
