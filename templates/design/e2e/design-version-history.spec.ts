import type { Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  layerRow,
  openEditor,
  postAction,
  setBaseURL,
} from "./drag-and-drop.shared";
import {
  appPath,
  openAppMenuSubmenu,
  resetPersistedCanvasState,
} from "./helpers";
import { expect, test } from "./rails";

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
  await openAppMenuSubmenu(page, "File");
  await page.getByRole("menuitem", { name: "Version history" }).click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
}

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

// fixme: product bug: Version restore reorders screens: the Layers stack goes from [Second, Home] to [Home, Second] (ids) and the Screens list flips from Home
test.fixme("an editor checkpoint survives reopening the editor, and restoring it brings Home back with its id and content and leaves the URL screen intact", async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  const secondUrl = new URL("/preview", e2eBaseURL()).toString();
  const designId = await app.seed(HOME_HTML, {
    files: { "second.html": secondUrl },
  });
  const seeded = await app.savedRecord(designId);
  const homeId = seeded.files.find(
    (file) => file.filename === "index.html",
  )!.id;
  const secondId = seeded.files.find(
    (file) => file.filename === "second.html",
  )!.id;
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
  await expect(layerRow(page, "Second")).toHaveCount(1);
  const homeBeforeDelete = await app.savedHtml(designId, "index.html");
  const screenOrderBeforeDelete = await overviewScreenIds(page);
  const framesBeforeDelete = (await app.savedRecord(designId)).data
    ?.canvasFrames as Record<string, unknown>;
  expect(
    framesBeforeDelete[homeId],
    "Home has a canvas frame before the delete",
  ).toMatchObject({
    x: expect.any(Number),
    y: expect.any(Number),
  });
  await layerRow(page, "Home").click();
  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Home")).toHaveCount(0);
  await expect
    .poll(() => filenames(page, designId))
    .not.toContain("index.html");
  await expect
    .poll(async () =>
      (await listVersions(page, designId)).versions.some(
        (version) => version.source === "editor" && version.fileCount === 3,
      ),
    )
    .toBe(true);
  await app.settled();

  await page.goto("about:blank");
  await resetPersistedCanvasState(page);
  await openEditor(page, designId);
  await expect(layerRow(page, "Second")).toHaveCount(1);
  await expect(layerRow(page, "Home")).toHaveCount(0);
  await openHistory(page);
  await page
    .getByRole("button")
    .filter({ hasText: /3 screens/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Restore this version" }).click();
  await expect(page.getByText("Version restored")).toBeVisible({
    timeout: 15_000,
  });
  await expect(layerRow(page, "Home")).toHaveCount(1, { timeout: 15_000 });
  await app.settled();

  const restored = await app.savedRecord(designId);
  const restoredHome = restored.files.find(
    (file) => file.filename === "index.html",
  );
  expect(
    { id: restoredHome?.id, content: restoredHome?.content },
    "Home comes back as the same screen",
  ).toEqual({
    id: homeId,
    content: homeBeforeDelete,
  });
  expect(
    (restored.data?.canvasFrames as Record<string, unknown>)[homeId],
    "Home's canvas frame comes back as checkpointed",
  ).toEqual(framesBeforeDelete[homeId]);
  expect(restored.files.find((file) => file.id === secondId)).toMatchObject({
    filename: "second.html",
    content: secondUrl,
  });
  expect(
    (restored.data?.screenMetadata as Record<string, unknown>)[secondId],
  ).toMatchObject({
    sourceType: "url",
    url: secondUrl,
    width: 390,
    height: 844,
    heightPinned: true,
  });
  await expect
    .poll(() => overviewScreenIds(page), {
      message: "the screens keep their checkpointed order",
    })
    .toStrictEqual(screenOrderBeforeDelete);
});

// fixme: intermittent: Passed in its worker run and in a solo re-run, failed once in the full confirmation run (2 of 3).
test.fixme("multi-screen delete uses one durable checkpoint, Undo, and redo", async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  const designId = await app.seed(HOME_HTML, {
    files: {
      "second.html":
        "<!doctype html><html><head><title>Second</title></head><body>Second</body></html>",
      "third.html":
        "<!doctype html><html><head><title>Third</title></head><body>Third</body></html>",
    },
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
    .toStrictEqual(screenIdsBeforeDelete.slice(0, 2));
  const versionsBeforeDelete = await listVersions(page, designId);
  const fullDesignVersionCountBeforeDelete =
    versionsBeforeDelete.versions.filter(
      (version) => version.source === "editor" && version.fileCount === 4,
    ).length;

  const survivorId = screenIdsBeforeDelete[2]!;
  const survivorFrame = (
    (await app.savedRecord(designId)).data?.canvasFrames as Record<
      string,
      unknown
    >
  )[survivorId];
  expect(
    survivorFrame,
    "the surviving screen has a canvas frame",
  ).toMatchObject({
    x: expect.any(Number),
    y: expect.any(Number),
  });
  const contentBeforeDelete = new Map<string, string>();
  for (const filename of ["index.html", "second.html", "third.html"]) {
    contentBeforeDelete.set(filename, await app.savedHtml(designId, filename));
  }

  await page.keyboard.press("Delete");
  await expect
    .poll(async () =>
      (await filenames(page, designId)).filter(
        (filename) => filename !== "__board__.html",
      ),
    )
    .toHaveLength(1);
  await expect(screens).toHaveCount(1);
  expect(await overviewScreenIds(page)).toStrictEqual([
    screenIdsBeforeDelete[2],
  ]);
  await expect.poll(() => selectedOverviewScreenIds(page)).toStrictEqual([]);

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
    .toStrictEqual(restoredSelectedIds);
  await app.settled();
  const restoredContents = await Promise.all(
    deletedFilenames.map((filename) => app.savedHtml(designId, filename)),
  );
  expect(
    restoredContents,
    "Undo restores the deleted screens' content",
  ).toEqual(
    deletedFilenames.map((filename) => contentBeforeDelete.get(filename)),
  );

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () =>
      (await filenames(page, designId)).filter(
        (filename) => filename !== "__board__.html",
      ),
    )
    .toHaveLength(1);
  await expect(screens).toHaveCount(1);
  expect(await overviewScreenIds(page)).toStrictEqual([
    screenIdsBeforeDelete[2],
  ]);

  await app.settled();
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
  expect(await overviewScreenIds(page)).toStrictEqual([
    screenIdsBeforeDelete[2],
  ]);
  const survivorFilename = filenameByOriginalId.get(survivorId)!;
  const saved = await app.savedRecord(designId);
  expect(
    {
      frame: (saved.data?.canvasFrames as Record<string, unknown>)[survivorId],
      content: saved.files.find((file) => file.id === survivorId)?.content,
    },
    "the surviving screen keeps its place and content",
  ).toEqual({
    frame: survivorFrame,
    content: contentBeforeDelete.get(survivorFilename),
  });
});
