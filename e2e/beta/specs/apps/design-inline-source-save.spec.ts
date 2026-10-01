import { expect, test } from "@playwright/test";

import {
  assertSignedInOnBeta,
  runMarker,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import { originFor, selectedSites, siteById } from "../../lib/fleet";
import { BETA_E2E_TEST_TRAFFIC_HEADERS } from "../../lib/test-traffic";

skipUnlessAuthed();

const SITE = siteById("design");
const ORIGIN = originFor(SITE);
const NODE_ID = "beta-inline-source-save-target";
const COLOR = "rgb(22, 101, 52)";
const ACTION_HEADERS = {
  ...BETA_E2E_TEST_TRAFFIC_HEADERS,
  "X-Agent-Native-Frontend": "1",
};
const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Beta inline source save</title></head>
  <body><main data-agent-native-node-id="${NODE_ID}" data-agent-native-layer-name="Save target" style="color:rgb(153, 27, 27)">Save target</main></body>
</html>`;

async function postAction(
  page: import("@playwright/test").Page,
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await page.request.post(
    `${ORIGIN}/_agent-native/actions/${name}`,
    { data: input, headers: ACTION_HEADERS },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: HTTP ${response.status()} ${await response.text()}`,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

async function readSource(
  page: import("@playwright/test").Page,
  designId: string,
): Promise<string> {
  const response = await page.request.get(
    new URL("/_agent-native/actions/read-source-file", ORIGIN).href,
    { params: { designId, path: "index.html" }, headers: ACTION_HEADERS },
  );
  if (!response.ok()) {
    throw new Error(`read-source-file failed: HTTP ${response.status()}`);
  }
  const result = (await response.json()) as { content?: unknown };
  if (typeof result.content !== "string") {
    throw new Error("read-source-file returned no source content");
  }
  return result.content;
}

test("Design inline source visual edits persist through reload and cleanup", async ({
  browser,
}) => {
  test.skip(
    !selectedSites().some((site) => site.id === SITE.id),
    "design is not selected by BETA_E2E_APPS",
  );
  const context = await signedInContext(browser, SITE, { seedModel: false });
  const page = await context.newPage();
  let designId = "";
  let primaryFailure: unknown;
  try {
    await assertSignedInOnBeta(context, SITE);

    const created = await postAction(page, "create-design", {
      title: runMarker(`Design inline source save ${Date.now()}`),
      projectType: "prototype",
    });
    designId = String(created?.id ?? created?.data?.id ?? "");
    if (!designId) throw new Error("create-design returned no id");
    await postAction(page, "create-file", {
      designId,
      filename: "index.html",
      content: FIXTURE,
      fileType: "html",
    });

    await page.goto(`${ORIGIN}/design/${designId}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({
      timeout: 45_000,
    });
    const preview = page
      .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
      .first()
      .contentFrame();
    const target = preview.locator(`[data-agent-native-node-id="${NODE_ID}"]`);
    await expect(target).toHaveCSS("color", "rgb(153, 27, 27)");

    const edit = await postAction(page, "apply-visual-edit", {
      source: { kind: "design-file", designId, filename: "index.html" },
      intent: {
        kind: "style",
        target: { nodeId: NODE_ID },
        property: "color",
        value: COLOR,
      },
    });
    expect(edit.persisted).toBe(true);
    await expect.poll(() => readSource(page, designId)).toContain(COLOR);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({
      timeout: 45_000,
    });
    await expect(
      page
        .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
        .first()
        .contentFrame()
        .locator(`[data-agent-native-node-id="${NODE_ID}"]`),
    ).toHaveCSS("color", COLOR);
    await expect.poll(() => readSource(page, designId)).toContain(COLOR);
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const cleanupFailures: string[] = [];
    if (designId) {
      try {
        const deleted = await postAction(page, "delete-design", {
          id: designId,
        });
        expect(deleted).toMatchObject({ id: designId, deleted: true });
        const readAfterDelete = await page.request.get(
          `${ORIGIN}/_agent-native/actions/get-design`,
          { params: { id: designId }, headers: ACTION_HEADERS },
        );
        expect(readAfterDelete.status()).toBe(404);
      } catch (error) {
        cleanupFailures.push(
          `delete-design verification failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    try {
      await context.close();
    } catch (error) {
      cleanupFailures.push(
        `context.close failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (cleanupFailures.length > 0) {
      const message = `[beta-e2e] Design source save teardown failures: ${cleanupFailures.join("; ")}`;
      if (primaryFailure) {
        test.info().annotations.push({
          type: "cleanup-failure",
          description: message,
        });
        console.error(message);
      } else {
        throw new Error(message);
      }
    }
  }
});
