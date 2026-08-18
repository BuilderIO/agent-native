import { expect, test, type APIRequestContext } from "@playwright/test";

import { gotoEditor } from "./helpers";

const VIEWPORT_RELATIVE_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Stable frame height</title></head>
  <body style="box-sizing:content-box;margin:0;min-height:100vh;padding:24px">
    <main>Viewport-relative content must not chase its own iframe height.</main>
  </body>
</html>`;

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:9333";
  const response = await request.post(
    `${baseUrl.replace(/\/$/, "")}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

test("viewport-relative content does not grow its overview frame forever", async ({
  page,
  request,
}) => {
  const created = await postAction(request, "create-design", {
    title: `Frame height stability ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, "create-file", {
      designId,
      filename: "index.html",
      content: VIEWPORT_RELATIVE_HTML,
      fileType: "html",
    });
    await gotoEditor(page, designId);

    const iframe = page.locator(
      "iframe[data-design-preview-iframe][data-screen-iframe-id]",
    );
    await expect(iframe).toBeVisible();
    await page.waitForTimeout(1_200);
    const settledHeight = await iframe.evaluate((node) => node.clientHeight);
    await page.waitForTimeout(2_500);
    const laterHeight = await iframe.evaluate((node) => node.clientHeight);

    expect(laterHeight).toBe(settledHeight);
  } finally {
    await postAction(request, "delete-design", { id: designId }).catch(
      () => {},
    );
  }
});
