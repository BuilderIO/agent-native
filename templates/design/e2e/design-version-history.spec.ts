import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  layerRow,
  newDesign,
  openEditor,
  postAction,
  setBaseURL,
} from "./drag-and-drop.shared";
import { appPath, gotoEditor } from "./helpers";

const HOME_HTML = `<!doctype html><html lang="en"><head><title>Home</title></head><body><main>Home</main></body></html>`;

async function listVersions(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/list-design-versions?designId=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as {
    versions: Array<{
      id: string;
      source: string;
      fileCount: number;
    }>;
  };
}

async function fileIdByFilename(
  page: Page,
  designId: string,
  filename: string,
): Promise<string> {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  const record = (await response.json()) as {
    files?: Array<{ id?: string; filename?: string }>;
  };
  const file = record.files?.find(
    (candidate) => candidate.filename === filename,
  );
  if (!file?.id) throw new Error(`Missing ${filename}`);
  return file.id;
}

async function filenames(page: Page, designId: string): Promise<string[]> {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  const record = (await response.json()) as {
    files?: Array<{ filename?: string }>;
  };
  return (
    record.files?.flatMap((file) => (file.filename ? [file.filename] : [])) ??
    []
  );
}

async function overviewScreenIds(page: Page): Promise<string[]> {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"][aria-level="1"]')
    .evaluateAll((rows) =>
      rows.flatMap((row) => {
        const id = row
          .querySelector<HTMLElement>("[data-layer-row-button]")
          ?.getAttribute("data-layer-node-id");
        return id ? [id] : [];
      }),
    );
}

async function selectedOverviewScreenIds(page: Page): Promise<string[]> {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"][aria-level="1"][aria-selected="true"]')
    .evaluateAll((rows) =>
      rows.flatMap((row) => {
        const id = row
          .querySelector<HTMLElement>("[data-layer-row-button]")
          ?.getAttribute("data-layer-node-id");
        return id ? [id] : [];
      }),
    );
}

async function openHistory(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Version history" }).click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
}

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test("editor checkpoints survive browser restart and restore screen identity", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const designId = await newDesign(page, HOME_HTML);
  const second = await postAction(page, "create-file", {
    designId,
    filename: "second.html",
    content: new URL("/preview", e2eBaseURL()).toString(),
    fileType: "html",
  });
  const secondId = second.id ?? second.data?.id;
  if (typeof secondId !== "string") {
    throw new Error("create-file did not return the URL-backed screen id");
  }
  const secondUrl = new URL("/preview", e2eBaseURL()).toString();
  await postAction(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", secondId],
        value: {
          sourceType: "url",
          url: secondUrl,
          title: "Second",
          width: 390,
          height: 844,
          heightPinned: true,
        },
      },
      {
        op: "set",
        path: ["canvasFrames", secondId],
        value: { x: 520, y: 0, width: 390, height: 844, z: 1 },
      },
    ],
  });
  await page.route(secondUrl, (route) => route.abort("failed"));

  await openEditor(page, designId);
  const homeId = await fileIdByFilename(page, designId, "index.html");
  await expect(layerRow(page, "Second")).toHaveCount(1);
  await layerRow(page, "Home").click();
  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Home")).toHaveCount(0);
  await expect
    .poll(() => filenames(page, designId))
    .not.toContain("index.html");

  await expect
    .poll(async () => {
      const result = await listVersions(page, designId);
      return result.versions.some(
        (version) => version.source === "editor" && version.fileCount === 3,
      );
    })
    .toBe(true);

  const restartedPage = await page.context().newPage();
  await page.close();
  try {
    await gotoEditor(restartedPage, designId);
    await expect(layerRow(restartedPage, "Home")).toHaveCount(0);
    await openHistory(restartedPage);

    const savedVersion = restartedPage
      .getByRole("button")
      .filter({ hasText: /3 screens/ })
      .first();
    await expect(savedVersion).toBeVisible();
    await savedVersion.click();
    await restartedPage
      .getByRole("button", { name: "Restore this version" })
      .click();
    await expect(restartedPage.getByText("Version restored")).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(() => filenames(restartedPage, designId))
      .toContain("index.html");

    await expect(layerRow(restartedPage, "Home")).toHaveCount(1, {
      timeout: 15_000,
    });
    expect(await fileIdByFilename(restartedPage, designId, "index.html")).toBe(
      homeId,
    );
    const restored = await restartedPage.request.get(
      appPath(`/_agent-native/actions/get-design?id=${designId}`),
    );
    if (!restored.ok()) throw new Error(await restored.text());
    const restoredDesign = (await restored.json()) as {
      data?: string;
      files?: Array<{ id?: string; filename?: string; content?: string }>;
    };
    const restoredData = JSON.parse(restoredDesign.data ?? "{}");
    expect(
      restoredDesign.files?.find((file) => file.id === secondId),
    ).toMatchObject({
      filename: "second.html",
      content: secondUrl,
    });
    expect(restoredData.screenMetadata?.[secondId]).toMatchObject({
      sourceType: "url",
      url: secondUrl,
      width: 390,
      height: 844,
      heightPinned: true,
    });
  } finally {
    await restartedPage.close();
  }
});

test("multi-screen delete uses one durable checkpoint, Undo, and redo", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const designId = await newDesign(page, HOME_HTML);
  await postAction(page, "create-file", {
    designId,
    filename: "second.html",
    content:
      "<!doctype html><html><head><title>Second</title></head><body>Second</body></html>",
    fileType: "html",
  });
  await postAction(page, "create-file", {
    designId,
    filename: "third.html",
    content:
      "<!doctype html><html><head><title>Third</title></head><body>Third</body></html>",
    fileType: "html",
  });

  await openEditor(page, designId);
  const originalFileIds = await Promise.all(
    ["index.html", "second.html", "third.html"].map(async (filename) => [
      filename,
      await fileIdByFilename(page, designId, filename),
    ]),
  );
  const filenameByOriginalId = new Map(
    originalFileIds.map(([filename, fileId]) => [fileId, filename]),
  );
  const screens = page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"][aria-level="1"]');
  await expect(screens).toHaveCount(3);
  const screenIdsBeforeDelete = await overviewScreenIds(page);
  expect(screenIdsBeforeDelete).toHaveLength(3);
  await screens.nth(0).locator("[data-layer-row-button]").click();
  await page.keyboard.press(
    `${process.platform === "darwin" ? "Meta" : "Control"}+A`,
  );
  await screens
    .nth(2)
    .locator("[data-layer-row-button]")
    .click({
      modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
    });
  await expect(screens.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(screens.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(screens.nth(2)).toHaveAttribute("aria-selected", "false");
  await expect
    .poll(() => selectedOverviewScreenIds(page))
    .toEqual(screenIdsBeforeDelete.slice(0, 2));
  const versionsBeforeDelete = await listVersions(page, designId);
  const fullDesignVersionCountBeforeDelete =
    versionsBeforeDelete.versions.filter(
      (version) => version.source === "editor" && version.fileCount === 4,
    ).length;

  await page.keyboard.press("Delete");
  await expect
    .poll(async () =>
      (await filenames(page, designId)).filter(
        (filename) => filename !== "__board__.html",
      ),
    )
    .toHaveLength(1);
  await expect(screens).toHaveCount(1);
  expect(await overviewScreenIds(page)).toEqual([screenIdsBeforeDelete[2]]);
  await expect.poll(() => selectedOverviewScreenIds(page)).toEqual([]);

  await expect
    .poll(async () => {
      const result = await listVersions(page, designId);
      return (
        result.versions.filter(
          (version) => version.source === "editor" && version.fileCount === 4,
        ).length - fullDesignVersionCountBeforeDelete
      );
    })
    .toBe(1);

  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await filenames(page, designId)).sort())
    .toEqual(["__board__.html", "index.html", "second.html", "third.html"]);
  const deletedFilenames = screenIdsBeforeDelete
    .slice(0, 2)
    .map((fileId) => filenameByOriginalId.get(fileId))
    .filter((filename): filename is string => Boolean(filename));
  expect(deletedFilenames).toHaveLength(2);
  const restoredSelectedIds = await Promise.all(
    deletedFilenames.map((filename) =>
      fileIdByFilename(page, designId, filename),
    ),
  );
  await expect
    .poll(() => selectedOverviewScreenIds(page))
    .toEqual(restoredSelectedIds);

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () =>
      (await filenames(page, designId)).filter(
        (filename) => filename !== "__board__.html",
      ),
    )
    .toHaveLength(1);
  await expect(screens).toHaveCount(1);
  expect(await overviewScreenIds(page)).toEqual([screenIdsBeforeDelete[2]]);

  await page.reload();
  await expect(page.getByRole("tree", { name: "Layers" })).toBeVisible();
  await expect
    .poll(async () =>
      (await filenames(page, designId)).filter(
        (filename) => filename !== "__board__.html",
      ),
    )
    .toHaveLength(1);
  await expect(screens).toHaveCount(1);
  expect(await overviewScreenIds(page)).toEqual([screenIdsBeforeDelete[2]]);
});
