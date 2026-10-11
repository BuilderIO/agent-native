import {
  expect,
  test,
  type Page,
  type Request,
  type Response,
  type Route,
} from "@playwright/test";

import { appPath, expandAllLayers, gotoEditor } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const CREATE_ACTION = "**/_agent-native/actions/create-file";
const DELETE_ACTION = "**/_agent-native/actions/delete-file";
const VARIANT_SET_ID = "partial-screen-recreation-retry-qa";
const ALPHA_FILENAME = "index.html";
const BETA_FILENAME = "beta.html";
const ALPHA_HTML =
  '<!doctype html><html lang="en"><head><title>Retry Alpha</title></head><body style="margin:0"><main>Retry Alpha</main></body></html>';
const BETA_HTML =
  '<!doctype html><html lang="en"><head><title>Retry Beta</title></head><body style="margin:0"><main>Retry Beta</main></body></html>';

type DesignFile = { id: string; filename: string; content?: string };
type DesignRecord = { data?: unknown; files?: DesignFile[] };
type ActionBody = Record<string, unknown>;

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath("/_agent-native/actions/" + name),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      name + ": " + response.status() + " " + (await response.text()),
    );
  }
  return response.json();
}

async function readDesign(page: Page, designId: string): Promise<DesignRecord> {
  const response = await page.request.get(
    appPath(
      "/_agent-native/actions/get-design?id=" + encodeURIComponent(designId),
    ),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

function designData(record: DesignRecord): Record<string, any> {
  return typeof record.data === "string"
    ? JSON.parse(record.data || "{}")
    : ((record.data ?? {}) as Record<string, any>);
}

function requireId(value: any, label: string): string {
  const id = value?.id ?? value?.data?.id;
  if (typeof id !== "string") throw new Error(label + " returned no id");
  return id;
}

function bodyForAction(response: Response, name: string): ActionBody | null {
  const request = response.request();
  if (
    request.method() !== "POST" ||
    !response.url().includes("/_agent-native/actions/" + name)
  ) {
    return null;
  }
  try {
    return request.postDataJSON() as ActionBody;
  } catch {
    return null;
  }
}

function screenRowButton(page: Page, screenId: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator('[data-layer-row-button][data-layer-node-id="' + screenId + '"]');
}

function screenIds(record: DesignRecord): string[] {
  return (record.files ?? [])
    .filter((file) => file.filename !== "__board__.html")
    .map((file) => file.id)
    .sort();
}

function variantMemberIds(data: Record<string, any>): string[] {
  const members = data.designVariantSets?.[VARIANT_SET_ID]?.screens ?? [];
  return members
    .map((member: unknown) =>
      typeof member === "string" ? member : (member as { id?: string })?.id,
    )
    .filter((id: unknown): id is string => typeof id === "string");
}

function allVariantMemberIds(data: Record<string, any>): string[] {
  return Object.values(data.designVariantSets ?? {}).flatMap((set: any) => {
    const members = Array.isArray(set?.screens) ? set.screens : [];
    return members
      .map((member: unknown) =>
        typeof member === "string" ? member : (member as { id?: string })?.id,
      )
      .filter((id: unknown): id is string => typeof id === "string");
  });
}

async function renderedCardSize(page: Page, screenId: string) {
  const card = page.locator(
    '[data-screen-shell][data-frame-id="' + screenId + '"] [data-screen-card]',
  );
  await expect(card).toBeVisible();
  return card.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
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

async function assertUndoReady(page: Page) {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: /^Edit$/ }).hover();
  await expect(page.getByRole("menuitem", { name: /Undo/ })).toBeEnabled();
  await page.keyboard.press("Escape");
}

async function cleanupDesign(page: Page, designId: string) {
  await action(page, "delete-design", { id: designId });
}

test("partial Screen recreation retry restores each recreated file and membership", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const designId = requireId(
    await action(page, "create-design", {
      title: "Partial Screen restore " + Date.now(),
      projectType: "prototype",
      designSystemId: null,
    }),
    "create-design",
  );

  const alphaMetadata = {
    sourceType: "inline",
    title: "Retry Alpha",
    width: 360,
    height: 640,
    heightMode: "fixed",
    heightPinned: true,
  };
  const betaMetadata = {
    sourceType: "inline",
    title: "Retry Beta",
    width: 390,
    height: 844,
    heightMode: "fixed",
    heightPinned: true,
  };
  const alphaFrame = { x: 40, y: 60, width: 360, height: 640, z: 4 };
  const betaFrame = { x: 540, y: 80, width: 390, height: 844, z: 5 };
  const alphaMember = {
    id: "alpha-placeholder",
    variantId: "desktop",
    label: "Retry Alpha",
    filename: ALPHA_FILENAME,
    width: 360,
    height: 640,
  };
  const betaMember = {
    id: "beta-placeholder",
    variantId: "mobile",
    label: "Retry Beta",
    filename: BETA_FILENAME,
    width: 390,
    height: 844,
  };

  let routeHandlersInstalled = false;
  let releaseSecondCreateFailure = () => {};
  let firstUndoPress: Promise<void> | undefined;
  let alphaId = "";
  let betaId = "";
  let firstRestoreFilename = "";
  let secondRestoreFilename = "";
  let recreatedFirstId: string | undefined;
  let secondCreateFailureCount = 0;
  const cleanupFirstIds: string[] = [];
  const createRequests: string[] = [];
  let requestObserverInstalled = false;
  let signalSecondCreateIntercepted = () => {};
  const secondCreateIntercepted = new Promise<void>((resolve) => {
    signalSecondCreateIntercepted = resolve;
  });
  let releaseSecondCreateGate = () => {};
  const secondCreateGate = new Promise<void>((resolve) => {
    releaseSecondCreateGate = resolve;
  });
  const requestObserver = (request: Request) => {
    if (
      request.method() !== "POST" ||
      !request.url().includes("/_agent-native/actions/create-file")
    ) {
      return;
    }
    try {
      const body = request.postDataJSON() as ActionBody;
      if (body.designId === designId && typeof body.filename === "string") {
        createRequests.push(body.filename);
      }
    } catch {
      // Malformed unrelated requests do not belong in the create ledger.
    }
  };
  const failSecondRecreate = async (route: Route) => {
    const body = route.request().postDataJSON() as ActionBody;
    if (body.designId !== designId || body.filename !== secondRestoreFilename) {
      await route.continue();
      return;
    }
    secondCreateFailureCount += 1;
    signalSecondCreateIntercepted();
    await secondCreateGate;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "intentional E2E route failure" }),
    });
  };
  const failFirstCleanup = async (route: Route) => {
    const body = route.request().postDataJSON() as ActionBody;
    if (!recreatedFirstId || body.id !== recreatedFirstId) {
      await route.continue();
      return;
    }
    cleanupFirstIds.push(recreatedFirstId);
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "intentional E2E route failure" }),
    });
  };

  try {
    alphaId = requireId(
      await action(page, "create-file", {
        designId,
        filename: ALPHA_FILENAME,
        content: ALPHA_HTML,
        fileType: "html",
      }),
      "create-file Alpha",
    );
    await action(page, "update-design", {
      id: designId,
      dataOperations: [
        { op: "set", path: ["screenMetadata", alphaId], value: alphaMetadata },
        { op: "set", path: ["canvasFrames", alphaId], value: alphaFrame },
      ],
    });
    betaId = requireId(
      await action(page, "create-file", {
        designId,
        filename: BETA_FILENAME,
        content: BETA_HTML,
        fileType: "html",
      }),
      "create-file Beta",
    );
    await action(page, "update-design", {
      id: designId,
      dataOperations: [
        { op: "set", path: ["screenMetadata", betaId], value: betaMetadata },
        { op: "set", path: ["canvasFrames", betaId], value: betaFrame },
        {
          op: "set",
          path: ["designVariantSets", VARIANT_SET_ID],
          value: {
            id: VARIANT_SET_ID,
            prompt: "Partial Screen recreation retry",
            createdAt: new Date().toISOString(),
            screenCount: 2,
            screens: [
              { ...alphaMember, id: alphaId },
              { ...betaMember, id: betaId },
            ],
          },
        },
      ],
    });

    const initialRecord = await readDesign(page, designId);
    const initialData = designData(initialRecord);
    expect(screenIds(initialRecord)).toEqual([alphaId, betaId].sort());
    expect(
      initialRecord.files
        ?.filter((file) => file.filename !== "__board__.html")
        .map((file) => file.id),
    ).toEqual([alphaId, betaId]);
    expect(Object.keys(initialData.designVariantSets ?? {})).toEqual([
      VARIANT_SET_ID,
    ]);
    expect(variantMemberIds(initialData)).toEqual([alphaId, betaId]);

    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expect
      .poll(async () => {
        const record = await readDesign(page, designId);
        const board = record.files?.find(
          (file) => file.filename === "__board__.html",
        );
        return !!board && designData(record).boardFileId === board.id;
      })
      .toBe(true);
    await zoomTo100(page);
    await expandAllLayers(page);
    const alphaButton = screenRowButton(page, alphaId);
    const betaButton = screenRowButton(page, betaId);
    await expect(alphaButton).toBeVisible();
    await expect(betaButton).toBeVisible();
    await alphaButton.click();
    await expect(
      alphaButton.locator('xpath=ancestor::*[@role="treeitem"][1]'),
    ).toHaveAttribute("aria-selected", "true");
    await betaButton.click({ modifiers: ["Shift"] });
    await expect
      .poll(() =>
        page.evaluate(() =>
          [
            ...((window as any).__designSelection?.selectedScreenIds ?? []),
          ].sort(),
        ),
      )
      .toEqual([alphaId, betaId].sort());

    const deleteResponse = page.waitForResponse((response) => {
      const body = bodyForAction(response, "delete-file");
      const fileIds = body?.fileIds;
      return (
        Array.isArray(fileIds) &&
        fileIds.includes(alphaId) &&
        fileIds.includes(betaId) &&
        response.status() === 200
      );
    });
    await page.keyboard.press("Delete");
    const deleted = await deleteResponse;
    const deletedResult = (await deleted.json()) as {
      deletedIds?: string[];
      deletedFiles?: { id: string; filename: string }[];
    };
    expect(deletedResult.deletedIds?.slice().sort()).toEqual(
      [alphaId, betaId].sort(),
    );
    expect(deletedResult.deletedFiles?.map((file) => file.id).sort()).toEqual(
      [alphaId, betaId].sort(),
    );
    if (!Array.isArray(deletedResult.deletedFiles)) {
      throw new Error("delete-file response omitted deletedFiles");
    }
    const deletedFiles = deletedResult.deletedFiles;
    expect(deletedFiles).toHaveLength(2);
    const screenDetails = (filename: string) => {
      if (filename === ALPHA_FILENAME) {
        return {
          id: alphaId,
          filename,
          metadata: alphaMetadata,
          frame: alphaFrame,
          sourceText: "Retry Alpha",
        };
      }
      if (filename === BETA_FILENAME) {
        return {
          id: betaId,
          filename,
          metadata: betaMetadata,
          frame: betaFrame,
          sourceText: "Retry Beta",
        };
      }
      throw new Error(`delete-file returned unexpected Screen ${filename}`);
    };
    const firstRestore = screenDetails(deletedFiles[0]!.filename);
    const secondRestore = screenDetails(deletedFiles[1]!.filename);
    expect([firstRestore.id, secondRestore.id].sort()).toEqual(
      [alphaId, betaId].sort(),
    );
    firstRestoreFilename = firstRestore.filename;
    secondRestoreFilename = secondRestore.filename;
    await expect(page.locator("[data-screen-shell]")).toHaveCount(0);
    await expect
      .poll(async () => {
        const record = await readDesign(page, designId);
        const data = designData(record);
        return {
          screens: screenIds(record),
          alphaMetadata: data.screenMetadata?.[alphaId],
          betaMetadata: data.screenMetadata?.[betaId],
          alphaFrame: data.canvasFrames?.[alphaId],
          betaFrame: data.canvasFrames?.[betaId],
          set: data.designVariantSets?.[VARIANT_SET_ID],
        };
      })
      .toEqual({
        screens: [],
        alphaMetadata: undefined,
        betaMetadata: undefined,
        alphaFrame: undefined,
        betaFrame: undefined,
        set: undefined,
      });

    page.on("request", requestObserver);
    requestObserverInstalled = true;

    await page.route(CREATE_ACTION, failSecondRecreate);
    await page.route(DELETE_ACTION, failFirstCleanup);
    routeHandlersInstalled = true;
    await assertUndoReady(page);

    const firstCreateResponse = page.waitForResponse((response) => {
      const body = bodyForAction(response, "create-file");
      return (
        body?.designId === designId &&
        body.filename === firstRestoreFilename &&
        response.status() === 200
      );
    });
    const secondCreateFailureResponse = page.waitForResponse((response) => {
      const body = bodyForAction(response, "create-file");
      return (
        body?.designId === designId &&
        body.filename === secondRestoreFilename &&
        response.status() === 500
      );
    });
    const firstCleanupFailureResponse = page.waitForResponse((response) => {
      const body = bodyForAction(response, "delete-file");
      return (
        !!recreatedFirstId &&
        body?.id === recreatedFirstId &&
        response.status() === 500
      );
    });
    firstUndoPress = page.keyboard.press(MOD + "+z");
    const [firstResponse] = await Promise.all([
      firstCreateResponse,
      secondCreateIntercepted,
    ]);
    const confirmedRecreatedFirstId = requireId(
      await firstResponse.json(),
      `recreate ${firstRestore.filename}`,
    );
    recreatedFirstId = confirmedRecreatedFirstId;
    expect(confirmedRecreatedFirstId).not.toBe(firstRestore.id);
    releaseSecondCreateFailure = releaseSecondCreateGate;
    releaseSecondCreateFailure();
    const [failedSecond, failedFirstCleanup] = await Promise.all([
      secondCreateFailureResponse,
      firstCleanupFailureResponse,
    ]);
    await firstUndoPress;
    expect(failedSecond.status()).toBe(500);
    expect(failedFirstCleanup.status()).toBe(500);
    expect(secondCreateFailureCount).toBe(1);
    expect(cleanupFirstIds).toEqual([confirmedRecreatedFirstId]);
    await expect
      .poll(async () => {
        const record = await readDesign(page, designId);
        const data = designData(record);
        const members = allVariantMemberIds(data);
        return {
          screens: screenIds(record),
          firstHasSource: record.files
            ?.find((file) => file.id === confirmedRecreatedFirstId)
            ?.content?.includes(firstRestore.sourceText),
          firstMetadata: data.screenMetadata?.[confirmedRecreatedFirstId],
          firstFrame: data.canvasFrames?.[confirmedRecreatedFirstId],
          secondMetadata: data.screenMetadata?.[secondRestore.id],
          secondFrame: data.canvasFrames?.[secondRestore.id],
          variantSetAbsent:
            data.designVariantSets?.[VARIANT_SET_ID] === undefined,
          memberIds: members,
          oldIdsAbsent:
            !Object.prototype.hasOwnProperty.call(
              data.screenMetadata ?? {},
              alphaId,
            ) &&
            !Object.prototype.hasOwnProperty.call(
              data.screenMetadata ?? {},
              betaId,
            ) &&
            !Object.prototype.hasOwnProperty.call(
              data.canvasFrames ?? {},
              alphaId,
            ) &&
            !Object.prototype.hasOwnProperty.call(
              data.canvasFrames ?? {},
              betaId,
            ) &&
            !members.includes(alphaId) &&
            !members.includes(betaId),
        };
      })
      .toEqual({
        screens: [confirmedRecreatedFirstId],
        firstHasSource: true,
        firstMetadata: firstRestore.metadata,
        firstFrame: firstRestore.frame,
        secondMetadata: undefined,
        secondFrame: undefined,
        variantSetAbsent: true,
        memberIds: [],
        oldIdsAbsent: true,
      });
    const partialRecord = await readDesign(page, designId);
    const partialData = designData(partialRecord);
    expect(
      partialRecord.files?.find((file) => file.id === confirmedRecreatedFirstId)
        ?.content,
    ).toContain(firstRestore.sourceText);
    expect(partialData.screenMetadata?.[confirmedRecreatedFirstId]).toEqual(
      firstRestore.metadata,
    );
    expect(partialData.canvasFrames?.[confirmedRecreatedFirstId]).toEqual(
      firstRestore.frame,
    );
    expect(partialData.screenMetadata?.[secondRestore.id]).toBeUndefined();
    expect(partialData.canvasFrames?.[secondRestore.id]).toBeUndefined();
    expect(partialData.designVariantSets?.[VARIANT_SET_ID]).toBeUndefined();
    expect(allVariantMemberIds(partialData)).toEqual([]);
    expect(partialData.screenMetadata).not.toHaveProperty(alphaId);
    expect(partialData.screenMetadata).not.toHaveProperty(betaId);
    expect(partialData.canvasFrames).not.toHaveProperty(alphaId);
    expect(partialData.canvasFrames).not.toHaveProperty(betaId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(1);
    await assertUndoReady(page);

    await page.unroute(CREATE_ACTION, failSecondRecreate);
    await page.unroute(DELETE_ACTION, failFirstCleanup);
    routeHandlersInstalled = false;

    const secondRetryResponse = page.waitForResponse((response) => {
      const body = bodyForAction(response, "create-file");
      return (
        body?.designId === designId &&
        body.filename === secondRestoreFilename &&
        response.status() === 200
      );
    });
    await page.keyboard.press(MOD + "+z");
    const secondResponse = await secondRetryResponse;
    const recreatedSecondId = requireId(
      await secondResponse.json(),
      `retry ${secondRestore.filename}`,
    );
    expect(recreatedSecondId).not.toBe(secondRestore.id);

    const recreatedAlphaId =
      firstRestore.filename === ALPHA_FILENAME
        ? confirmedRecreatedFirstId
        : recreatedSecondId;
    const recreatedBetaId =
      firstRestore.filename === BETA_FILENAME
        ? confirmedRecreatedFirstId
        : recreatedSecondId;
    const expectedIds = [confirmedRecreatedFirstId, recreatedSecondId].sort();
    await expect
      .poll(async () => screenIds(await readDesign(page, designId)))
      .toEqual(expectedIds);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expect(
      page.locator(
        '[data-screen-shell][data-frame-id="' + recreatedAlphaId + '"]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-screen-shell][data-frame-id="' + recreatedBetaId + '"]',
      ),
    ).toHaveCount(1);

    await expect
      .poll(async () => {
        const data = designData(await readDesign(page, designId));
        return {
          alphaMetadata: data.screenMetadata?.[recreatedAlphaId],
          betaMetadata: data.screenMetadata?.[recreatedBetaId],
          alphaFrame: data.canvasFrames?.[recreatedAlphaId],
          betaFrame: data.canvasFrames?.[recreatedBetaId],
          members: variantMemberIds(data),
        };
      })
      .toEqual({
        alphaMetadata,
        betaMetadata,
        alphaFrame,
        betaFrame,
        members: [recreatedAlphaId, recreatedBetaId],
      });

    const restored = await readDesign(page, designId);
    const restoredData = designData(restored);
    for (const oldId of [alphaId, betaId]) {
      expect(restoredData.screenMetadata).not.toHaveProperty(oldId);
      expect(restoredData.canvasFrames).not.toHaveProperty(oldId);
      expect(variantMemberIds(restoredData)).not.toContain(oldId);
    }
    expect(
      createRequests.filter((filename) => filename === ALPHA_FILENAME),
    ).toHaveLength(firstRestore.filename === ALPHA_FILENAME ? 1 : 2);
    expect(
      createRequests.filter((filename) => filename === BETA_FILENAME),
    ).toHaveLength(firstRestore.filename === BETA_FILENAME ? 1 : 2);
    expect(screenIds(restored)).toEqual(expectedIds);
    expect(
      restored.files?.find((file) => file.id === recreatedAlphaId)?.filename,
    ).toBe(ALPHA_FILENAME);
    expect(
      restored.files?.find((file) => file.id === recreatedAlphaId)?.content,
    ).toContain("Retry Alpha");
    expect(
      restored.files?.find((file) => file.id === recreatedBetaId)?.filename,
    ).toBe(BETA_FILENAME);
    expect(
      restored.files?.find((file) => file.id === recreatedBetaId)?.content,
    ).toContain("Retry Beta");
    expect(variantMemberIds(restoredData)).toEqual([
      recreatedAlphaId,
      recreatedBetaId,
    ]);
    expect(await renderedCardSize(page, recreatedAlphaId)).toEqual({
      width: 360,
      height: 640,
    });
    expect(await renderedCardSize(page, recreatedBetaId)).toEqual({
      width: 390,
      height: 844,
    });

    await page.reload();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await zoomTo100(page);
    const reloaded = await readDesign(page, designId);
    const reloadedData = designData(reloaded);
    expect(screenIds(reloaded)).toEqual(expectedIds);
    expect(
      reloaded.files?.find((file) => file.id === recreatedAlphaId)?.content,
    ).toContain("Retry Alpha");
    expect(
      reloaded.files?.find((file) => file.id === recreatedBetaId)?.content,
    ).toContain("Retry Beta");
    expect(reloadedData.screenMetadata?.[recreatedAlphaId]).toEqual(
      alphaMetadata,
    );
    expect(reloadedData.screenMetadata?.[recreatedBetaId]).toEqual(
      betaMetadata,
    );
    expect(reloadedData.canvasFrames?.[recreatedAlphaId]).toEqual(alphaFrame);
    expect(reloadedData.canvasFrames?.[recreatedBetaId]).toEqual(betaFrame);
    expect(variantMemberIds(reloadedData)).toEqual([
      recreatedAlphaId,
      recreatedBetaId,
    ]);
    expect(await renderedCardSize(page, recreatedAlphaId)).toEqual({
      width: 360,
      height: 640,
    });
    expect(await renderedCardSize(page, recreatedBetaId)).toEqual({
      width: 390,
      height: 844,
    });
  } finally {
    releaseSecondCreateFailure();
    if (routeHandlersInstalled) {
      await page.unroute(CREATE_ACTION, failSecondRecreate).catch(() => {});
      await page.unroute(DELETE_ACTION, failFirstCleanup).catch(() => {});
    }
    if (requestObserverInstalled) page.off("request", requestObserver);
    await cleanupDesign(page, designId);
  }
});
