import { expect, test, type Page } from "@playwright/test";

import { appPath, expandAllLayers, gotoEditor } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const SET_ID = "screen-delete-metadata-qa-set";
const ALPHA_HTML = `<!doctype html><html lang="en"><head><title>Delete Alpha</title></head><body style="margin:0;background:#dbeafe"><main style="height:640px;background:#dbeafe">Alpha screen</main></body></html>`;
const BETA_HTML = `<!doctype html><html lang="en"><head><title>Keep Beta</title></head><body style="margin:0;background:#dcfce7"><main style="height:700px;background:#dcfce7">Beta screen</main></body></html>`;

type DesignFile = { id: string; filename: string; content?: string };
type DesignRecord = { data?: unknown; files?: DesignFile[] };

async function action(
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

async function readDesign(page: Page, designId: string): Promise<DesignRecord> {
  const response = await page.request.get(
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

async function renderedCardSize(page: Page, screenId: string) {
  const card = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"] [data-screen-card]`,
  );
  await expect(card).toBeVisible();
  return card.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      cssWidth: style.width,
      cssHeight: style.height,
      renderedWidth: bounds.width,
      renderedHeight: bounds.height,
    };
  });
}

async function zoomTo100(page: Page) {
  const zoom = page
    .getByRole("button")
    .filter({ hasText: /^\s*\d+%\s*$/ })
    .first();
  await expect(zoom).toBeVisible();
  if ((await zoom.innerText()).trim() !== "100%") {
    await zoom.click();
    await page.getByRole("menuitem", { name: "Zoom to 100%" }).click();
  }
  await expect(zoom).toHaveText(/100%/);
}

test("Undo restores deleted Screen metadata and variant membership", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const created = await action(page, "create-design", {
    title: `Screen delete metadata ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id;
  if (typeof designId !== "string") {
    throw new Error("create-design did not return an id");
  }

  try {
    const alphaFile = await action(page, "create-file", {
      designId,
      filename: "index.html",
      content: ALPHA_HTML,
      fileType: "html",
    });
    const betaFile = await action(page, "create-file", {
      designId,
      filename: "beta.html",
      content: BETA_HTML,
      fileType: "html",
    });
    const alphaId = alphaFile.id ?? alphaFile.data?.id;
    const betaId = betaFile.id ?? betaFile.data?.id;
    if (typeof alphaId !== "string" || typeof betaId !== "string") {
      throw new Error("create-file did not return both Screen ids");
    }

    const alphaMetadata = {
      sourceType: "inline",
      title: "Delete Alpha",
      width: 360,
      height: 640,
      heightMode: "fixed",
      heightPinned: true,
    };
    const betaMetadata = {
      sourceType: "inline",
      title: "Keep Beta",
      width: 390,
      height: 700,
      heightMode: "fixed",
      heightPinned: true,
    };
    await action(page, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["screenMetadata", alphaId],
          value: alphaMetadata,
        },
        {
          op: "set",
          path: ["screenMetadata", betaId],
          value: betaMetadata,
        },
        {
          op: "set",
          path: ["canvasFrames", alphaId],
          value: { x: 0, y: 0, width: 360, height: 640, z: 0 },
        },
        {
          op: "set",
          path: ["canvasFrames", betaId],
          value: { x: 520, y: 0, width: 390, height: 700, z: 1 },
        },
        {
          op: "set",
          path: ["designVariantSets", SET_ID],
          value: {
            id: SET_ID,
            prompt: "Screen deletion metadata QA",
            createdAt: new Date().toISOString(),
            screenCount: 2,
            screens: [
              {
                id: alphaId,
                variantId: "alpha",
                label: "Delete Alpha",
                filename: "index.html",
                width: 360,
                height: 640,
              },
              {
                id: betaId,
                variantId: "beta",
                label: "Keep Beta",
                filename: "beta.html",
                width: 390,
                height: 700,
              },
            ],
          },
        },
      ],
    });

    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await zoomTo100(page);
    await expandAllLayers(page);
    const alphaLayer = page
      .getByRole("tree", { name: "Layers" })
      .locator(`[data-layer-row-button][data-layer-node-id="${alphaId}"]`)
      .locator("xpath=ancestor::*[@role='treeitem']");
    await expect(alphaLayer).toHaveCount(1);
    await alphaLayer.locator("[data-layer-row-button]").click();
    await expect(alphaLayer).toHaveAttribute("aria-selected", "true");

    const deleteResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      if (
        request.method() !== "POST" ||
        !response.url().includes("/_agent-native/actions/delete-file")
      ) {
        return false;
      }
      return request.postDataJSON()?.id === alphaId;
    });
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-screen-shell]")).toHaveCount(1);
    const deleteResponse = await deleteResponsePromise;
    const deleteResponseText = await deleteResponse.text();
    let deleteResponseBody: unknown = deleteResponseText;
    try {
      deleteResponseBody = JSON.parse(deleteResponseText);
    } catch {
      // Keep the exact response text in evidence when the action returns a
      // non-JSON error body.
    }
    console.log(
      "[screen-delete-metadata] delete-file response",
      deleteResponse.status(),
      JSON.stringify(deleteResponseBody),
    );
    await test.info().attach("delete-file-response.json", {
      body: JSON.stringify(
        {
          status: deleteResponse.status(),
          body: deleteResponseBody,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    expect(deleteResponse.status()).toBe(200);
    expect(deleteResponseBody).toMatchObject({ id: alphaId, deleted: true });

    await expect
      .poll(async () => {
        const files = (await readDesign(page, designId)).files ?? [];
        return {
          alphaPresent: files.some((file) => file.id === alphaId),
          betaFilename: files.find((file) => file.id === betaId)?.filename,
        };
      })
      .toEqual({ alphaPresent: false, betaFilename: "beta.html" });

    const afterDelete = designData(await readDesign(page, designId));
    expect(afterDelete.screenMetadata?.[alphaId]).toBeUndefined();
    expect(afterDelete.screenMetadata?.[betaId]).toEqual(betaMetadata);

    await page.keyboard.press(`${MOD}+z`);
    let restoredId: string | undefined;
    await expect
      .poll(async () => {
        const files = (await readDesign(page, designId)).files ?? [];
        const restoredFile = files.find(
          (file) => file.id !== alphaId && file.filename === "index.html",
        );
        restoredId = restoredFile?.id;
        return {
          alphaPresent: files.some((file) => file.id === alphaId),
          restored: typeof restoredId === "string",
          betaPresent: files.some((file) => file.id === betaId),
        };
      })
      .toEqual({ alphaPresent: false, restored: true, betaPresent: true });
    if (!restoredId) {
      throw new Error("Undo did not restore the deleted Screen file");
    }
    const restoredScreenId = restoredId;
    let restoredRecord = await readDesign(page, designId);
    let restoredData = designData(restoredRecord);
    const restoreDeadline = Date.now() + 15_000;
    while (Date.now() < restoreDeadline) {
      const members = restoredData.designVariantSets?.[SET_ID]?.screens;
      const memberIds = Array.isArray(members)
        ? members.map((member: unknown) => {
            if (typeof member === "string") return member;
            if (member && typeof member === "object" && "id" in member) {
              return member.id;
            }
            return undefined;
          })
        : [];
      const metadata = restoredData.screenMetadata?.[restoredScreenId];
      const frame = restoredData.canvasFrames?.[restoredScreenId];
      if (
        metadata?.heightMode === "fixed" &&
        metadata?.heightPinned === true &&
        metadata?.width === 360 &&
        metadata?.height === 640 &&
        frame?.width === 360 &&
        frame?.height === 640 &&
        memberIds.includes(restoredScreenId) &&
        memberIds.includes(betaId)
      ) {
        break;
      }
      await page.waitForTimeout(250);
      restoredRecord = await readDesign(page, designId);
      restoredData = designData(restoredRecord);
    }
    const restoredFile = restoredRecord.files?.find(
      (file) => file.id === restoredScreenId,
    );
    if (!restoredFile) {
      throw new Error("Undo did not restore the deleted Screen file");
    }
    expect(restoredFile.filename).toBe("index.html");
    expect(restoredScreenId).not.toBe(alphaId);

    expect
      .soft(
        restoredData.screenMetadata?.[restoredScreenId],
        "restored Screen height metadata",
      )
      .toMatchObject({
        heightMode: "fixed",
        heightPinned: true,
        width: 360,
        height: 640,
      });
    expect
      .soft(restoredData.screenMetadata?.[betaId], "surviving Screen metadata")
      .toEqual(betaMetadata);
    expect.soft(restoredData.canvasFrames?.[restoredScreenId]).toMatchObject({
      width: 360,
      height: 640,
    });
    expect.soft(restoredData.canvasFrames?.[betaId]).toMatchObject({
      width: 390,
      height: 700,
    });
    const restoredMembers = restoredData.designVariantSets?.[SET_ID]?.screens;
    expect
      .soft(restoredMembers, "restored variant membership IDs")
      .toEqual([
        expect.objectContaining({ id: restoredScreenId, variantId: "alpha" }),
        expect.objectContaining({ id: betaId, variantId: "beta" }),
      ]);

    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expect
      .soft(
        page.locator(
          `[data-screen-shell][data-frame-id="${restoredScreenId}"] [data-screen-card]`,
        ),
      )
      .toHaveCSS("width", "360px");
    await expect
      .soft(
        page.locator(
          `[data-screen-shell][data-frame-id="${restoredScreenId}"] [data-screen-card]`,
        ),
      )
      .toHaveCSS("height", "640px");
    const restoredCardSize = await renderedCardSize(page, restoredScreenId);
    const betaCardSize = await renderedCardSize(page, betaId);
    expect
      .soft(restoredCardSize.renderedWidth / betaCardSize.renderedWidth)
      .toBeCloseTo(360 / 390, 2);
    expect
      .soft(restoredCardSize.renderedHeight / betaCardSize.renderedHeight)
      .toBeCloseTo(640 / 700, 2);

    await page.reload();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await zoomTo100(page);
    const reloadedRecord = await readDesign(page, designId);
    const reloadedData = designData(reloadedRecord);
    expect.soft(reloadedData.screenMetadata?.[restoredScreenId]).toMatchObject({
      heightMode: "fixed",
      heightPinned: true,
      width: 360,
      height: 640,
    });
    expect.soft(reloadedData.screenMetadata?.[betaId]).toEqual(betaMetadata);
    expect
      .soft(reloadedData.designVariantSets?.[SET_ID]?.screens)
      .toEqual([
        expect.objectContaining({ id: restoredScreenId, variantId: "alpha" }),
        expect.objectContaining({ id: betaId, variantId: "beta" }),
      ]);
    const reloadedRestoredSize = await renderedCardSize(page, restoredScreenId);
    const reloadedBetaSize = await renderedCardSize(page, betaId);
    expect
      .soft(reloadedRestoredSize.renderedWidth / reloadedBetaSize.renderedWidth)
      .toBeCloseTo(360 / 390, 2);
    expect
      .soft(
        reloadedRestoredSize.renderedHeight / reloadedBetaSize.renderedHeight,
      )
      .toBeCloseTo(640 / 700, 2);
  } finally {
    await action(page, "delete-design", { id: designId });
  }
});
