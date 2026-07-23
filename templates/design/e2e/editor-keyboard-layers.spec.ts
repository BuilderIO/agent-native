import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath, designFrame, enterDirectMode, gotoEditor } from "./helpers";

const SOURCE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Keyboard Source</title>
    <style data-agent-native-breakpoints>
      @media (max-width: 1279px) {
        [data-agent-native-node-id="source-card"][data-agent-native-node-id="source-card"] { padding: 18px; }
        [data-agent-native-node-id="source-peer"][data-agent-native-node-id="source-peer"] { opacity: 0.5; }
      }
      @media (max-width: 809px) {
        [data-agent-native-node-id="source-card-title"][data-agent-native-node-id="source-card-title"] { font-size: 22px; }
      }
    </style>
    <style data-agent-native-states>
      [data-agent-native-node-id="source-card"]:hover { background-color: black !important; }
      [data-agent-native-node-id="source-peer"]:focus { color: orange !important; }
    </style>
    <style data-agent-native-state-breakpoints>
      @media (max-width: 809px) {
        [data-agent-native-node-id="source-card-child"][data-agent-native-node-id="source-card-child"]:focus-visible { color: yellow !important; }
      }
    </style>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#111827;color:#f9fafb">
    <main data-agent-native-node-id="source-root" data-agent-native-layer-name="Source Root" style="position:relative;min-height:560px;padding:48px">
      <section data-agent-native-node-id="source-card" data-agent-native-layer-name="Copy Card" class="max-[1279px]:p-6" style="position:absolute;left:40px;top:60px;width:260px;padding:20px;border-radius:16px;background:#1f2937;display:flex;flex-direction:column;gap:12px;transform:rotate(2deg);font-family:'IBM Plex Sans',sans-serif">
        <h2 data-agent-native-node-id="source-card-title" data-agent-native-layer-name="Copy Card Title" style="margin:0 0 12px;font-size:24px">Copy Card Title</h2>
        <img data-agent-native-node-id="source-card-image" data-agent-native-layer-name="Card Image" src="/favicon.ico" alt="Card art" style="width:32px;height:32px" />
        <button data-agent-native-node-id="source-card-child" data-agent-native-layer-name="Nested CTA" style="padding:10px 16px;border:0;border-radius:10px;background:#38bdf8;color:#082f49">Nested CTA</button>
      </section>
      <button data-agent-native-node-id="source-peer" data-agent-native-layer-name="Source Peer" style="position:absolute;left:340px;top:80px;padding:12px 18px;border:0;border-radius:10px;background:#a78bfa;color:#1f1147">Source Peer</button>
    </main>
  </body>
</html>`;

const TARGET_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Keyboard Target</title>
    <style data-agent-native-breakpoints>
      @media (max-width: 999px) {
        [data-agent-native-node-id="target-heading"][data-agent-native-node-id="target-heading"] { letter-spacing: 1px; }
      }
    </style>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a">
    <main data-agent-native-node-id="target-root" data-agent-native-layer-name="Target Root" style="position:relative;min-height:560px;padding:48px">
      <h1 data-agent-native-node-id="target-heading" data-agent-native-layer-name="Target Heading" style="margin:0;font-size:32px">Target Screen</h1>
    </main>
  </body>
</html>`;

const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";

test.describe("editor keyboard layer clipboard", () => {
  let designId: string;
  let additionalDesignIds: string[] = [];

  test.afterEach(async ({ request, baseURL }) => {
    await Promise.all(
      [designId, ...additionalDesignIds]
        .filter(Boolean)
        .map((id) =>
          postAction(request, baseURL, "delete-design", { id }).catch(() => {}),
        ),
    );
    designId = "";
    additionalDesignIds = [];
  });

  test("round-trips a styled nested layer across independent designs, route remounts, and browser tabs as one undo step", async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    designId = await createKeyboardDesign(
      request,
      baseURL,
      "E2E Cross Design Clipboard Source",
    );
    const targetDesignId = await createKeyboardDesign(
      request,
      baseURL,
      "E2E Cross Design Clipboard Target",
    );
    additionalDesignIds.push(targetDesignId);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(actionBaseUrl(baseURL)).origin,
    });

    await gotoEditor(page, designId);
    await selectLayerRow(page, "Copy Card");
    await pressPrimaryShortcut(page, "c");

    // Recreate the reported flow: leave the source editor (the designs grid
    // remounts the editor), enter another design, then paste there.
    await page.goto(appPath("/"));
    await gotoEditor(page, targetDesignId);
    await selectScreenRow(page, "Target");
    await pressPrimaryShortcut(page, "v");
    await expectFileContent(
      request,
      baseURL,
      targetDesignId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(1);
        expect(count(html, ">Nested CTA<")).toBe(1);
        expect(html).toContain("border-radius: 16px");
        expect(html).toContain("transform: rotate(2deg)");
        expect(html).toContain("IBM Plex Sans");
        expect(html).toContain('src="/favicon.ico"');
        expect(html).not.toContain("agent-native-clipboard-v1");
        expect(html).toContain("max-width: 1279px");
        expect(html).toContain("max-width: 999px");
        expect(html).toContain("max-width: 809px");
        expect(count(html, "font-size: 22px")).toBe(1);
        expect(count(html, "background-color: black")).toBe(2);
        expect(count(html, "color: yellow")).toBe(2);
        expect(html).toContain("letter-spacing: 1px");
        expect(html).toContain("max-[1279px]:p-6");
        expect(html).not.toContain("opacity: 0.5");
        expect(html).not.toContain("color: orange");
        expect(html).not.toContain('data-agent-native-node-id="source-card"');
        expect(allNodeIdsAreUnique(html)).toBe(true);
      },
    );

    await pressPrimaryShortcut(page, "z");
    await expectFileContent(
      request,
      baseURL,
      targetDesignId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(0);
        expect(count(html, "font-size: 22px")).toBe(0);
        expect(html).toContain("letter-spacing: 1px");
      },
    );

    // A second editor tab has no shared React refs. Copy in that tab and paste
    // back in the target tab to prove the OS clipboard representation is the
    // source of truth rather than same-page memory.
    const sourceTab = await context.newPage();
    await gotoEditor(sourceTab, designId);
    await selectLayerRow(sourceTab, "Copy Card");
    await pressPrimaryShortcut(sourceTab, "c");
    await sourceTab.close();
    await page.bringToFront();
    await pressPrimaryShortcut(page, "v");
    await expectFileContent(
      request,
      baseURL,
      targetDesignId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(1);
        expect(count(html, ">Nested CTA<")).toBe(1);
        expect(allNodeIdsAreUnique(html)).toBe(true);
        expect(count(html, "font-size: 22px")).toBe(1);
        expect(count(html, "background-color: black")).toBe(2);
        expect(count(html, "color: yellow")).toBe(2);
      },
    );

    await pressPrimaryShortcut(page, "z");
    await expectFileContent(
      request,
      baseURL,
      targetDesignId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(0);
        expect(count(html, "font-size: 22px")).toBe(0);
        expect(count(html, "background-color: black")).toBe(0);
        expect(count(html, "color: yellow")).toBe(0);
        expect(html).toContain("max-width: 999px");
        expect(html).toContain("letter-spacing: 1px");
      },
    );
    // Rapid consecutive undo: paste two distinct clones from the same live
    // system clipboard, then remove the latest and the prior clone with two
    // immediate Cmd+Z presses.
    await pressPrimaryShortcut(page, "v");
    await expectFileContent(
      request,
      baseURL,
      targetDesignId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(1);
      },
    );
    await pressPrimaryShortcut(page, "v");
    await expectFileContent(
      request,
      baseURL,
      targetDesignId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(2);
        expect(count(html, "font-size: 22px")).toBe(2);
      },
    );
    await pressPrimaryShortcut(page, "z");
    await expectFileContent(
      request,
      baseURL,
      targetDesignId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(1);
        expect(count(html, "font-size: 22px")).toBe(1);
      },
    );
    await pressPrimaryShortcut(page, "z");
    await expectFileContent(
      request,
      baseURL,
      targetDesignId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(0);
        expect(count(html, "font-size: 22px")).toBe(0);
        expect(html).toContain("letter-spacing: 1px");
      },
    );

    // Repeat after the route-remount, cross-tab copy, and rapid undo cycles.
    // Prior history depth must not collapse the next pair into one entry.
    for (const expected of [1, 2]) {
      await pressPrimaryShortcut(page, "v");
      await expectFileContent(
        request,
        baseURL,
        targetDesignId,
        "target.html",
        (html) => {
          expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(
            expected,
          );
          expect(count(html, "font-size: 22px")).toBe(expected);
        },
      );
    }
    await pressPrimaryShortcut(page, "z");
    await expectFileContent(
      request,
      baseURL,
      targetDesignId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(1);
        expect(count(html, "font-size: 22px")).toBe(1);
      },
    );
    await page.waitForTimeout(1_000);
    await pressPrimaryShortcut(page, "z");
    await expectFileContent(
      request,
      baseURL,
      targetDesignId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(0);
        expect(count(html, "font-size: 22px")).toBe(0);
        expect(html).toContain("letter-spacing: 1px");
      },
    );
  });

  test("keeps two responsive pastes distinct across settled undo and redo", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createKeyboardDesign(
      request,
      baseURL,
      "E2E Settled Clipboard Undo",
    );
    await gotoEditor(page, designId);
    await selectLayerRow(page, "Copy Card");
    await pressPrimaryShortcut(page, "c");
    const createdDesign = await getDesign(request, baseURL, designId);
    const targetFileId = createdDesign.files.find(
      (file: { filename?: string }) => file.filename === "target.html",
    )?.id;
    expect(targetFileId).toBeTruthy();
    await page.goto(
      appPath(`/design/${designId}?view=overview&screen=${targetFileId}`),
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-screen-shell]").first()).toBeVisible();
    await expect(
      designFrame(page, targetFileId).getByText("Target Screen", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 });

    for (const expected of [1, 2]) {
      await pressPrimaryShortcut(page, "v");
      await expectFileContent(
        request,
        baseURL,
        designId,
        "target.html",
        (html) => {
          expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(
            expected,
          );
          expect(count(html, "font-size: 22px")).toBe(expected);
        },
      );
    }

    await pressPrimaryShortcut(page, "z");
    await expectFileContent(
      request,
      baseURL,
      designId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(1);
        expect(count(html, "font-size: 22px")).toBe(1);
      },
    );
    await page.waitForTimeout(1_000);
    await pressPrimaryShortcut(page, "z");
    await expectFileContent(
      request,
      baseURL,
      designId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(0);
        expect(count(html, "font-size: 22px")).toBe(0);
        expect(html).toContain("letter-spacing: 1px");
      },
    );

    for (const expected of [1, 2]) {
      await pressPrimaryShortcut(page, "z", { shift: true });
      await expectFileContent(
        request,
        baseURL,
        designId,
        "target.html",
        (html) => {
          expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(
            expected,
          );
          expect(count(html, "font-size: 22px")).toBe(expected);
        },
      );
    }
  });

  test("pastes a nested selected layer on the same screen and another screen with fresh ids after reload", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createKeyboardDesign(
      request,
      baseURL,
      "E2E Keyboard Paste",
    );
    await gotoEditor(page, designId);

    await selectLayerRow(page, "Copy Card");
    await pressPrimaryShortcut(page, "c");
    await pressPrimaryShortcut(page, "v");

    await expectFileContent(
      request,
      baseURL,
      designId,
      "source.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(2);
        expect(count(html, ">Nested CTA<")).toBe(2);
        expect(actualNodeIdCount(html, "source-card")).toBe(1);
        expect(actualNodeIdCount(html, "source-card-child")).toBe(1);
        expect(allNodeIdsAreUnique(html)).toBe(true);
      },
    );

    await selectScreenRow(page, "Target");
    await pressPrimaryShortcut(page, "v");

    await expectFileContent(
      request,
      baseURL,
      designId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(1);
        expect(count(html, ">Nested CTA<")).toBe(1);
        expect(html).not.toContain('data-agent-native-node-id="source-card"');
        expect(html).not.toContain(
          'data-agent-native-node-id="source-card-child"',
        );
        expect(allNodeIdsAreUnique(html)).toBe(true);
      },
    );

    await gotoEditor(page, designId);
    await selectScreenRow(page, "Target");
    await enterDirectMode(page);
    await expect(
      designFrame(page).getByRole("heading", { name: "Target Screen" }),
    ).toBeVisible();
    await expect(
      designFrame(page).getByRole("button", { name: "Nested CTA" }),
    ).toBeVisible();
  });

  test("pastes a multi-selection across screens with each layer and child id regenerated", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createKeyboardDesign(
      request,
      baseURL,
      "E2E Keyboard Multi Paste",
    );
    await gotoEditor(page, designId);

    await selectLayerRow(page, "Copy Card");
    await additiveSelectLayerRow(page, "Source Peer");
    await expect.poll(() => selectedRowCount(page)).toBe(2);

    await pressPrimaryShortcut(page, "c");
    await selectScreenRow(page, "Target");
    await pressPrimaryShortcut(page, "v");

    await expectFileContent(
      request,
      baseURL,
      designId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(1);
        expect(count(html, 'data-agent-native-layer-name="Source Peer"')).toBe(
          1,
        );
        expect(count(html, ">Nested CTA<")).toBe(1);
        expect(html).not.toContain('data-agent-native-node-id="source-card"');
        expect(html).not.toContain(
          'data-agent-native-node-id="source-card-child"',
        );
        expect(html).not.toContain('data-agent-native-node-id="source-peer"');
        expect(allNodeIdsAreUnique(html)).toBe(true);
      },
    );
  });

  test("duplicates, deletes, cuts, undoes, and redoes selected layers from the keyboard", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createKeyboardDesign(
      request,
      baseURL,
      "E2E Keyboard Layer Edits",
    );
    await gotoEditor(page, designId);
    await selectScreenRow(page, "Source");
    await enterDirectMode(page);

    await selectLayerRow(page, "Source Peer");
    await pressPrimaryShortcut(page, "d");
    await expectFileContent(
      request,
      baseURL,
      designId,
      "source.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Source Peer"')).toBe(
          2,
        );
        expect(actualNodeIdCount(html, "source-peer")).toBe(1);
        expect(allNodeIdsAreUnique(html)).toBe(true);
      },
    );
    await expectPreviewLayerCount(page, "Source Peer", 2);

    await pressEditorKey(page, "Delete");
    await expectFileContent(
      request,
      baseURL,
      designId,
      "source.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Source Peer"')).toBe(
          1,
        );
      },
    );
    await expectPreviewLayerCount(page, "Source Peer", 1);

    await pressPrimaryShortcut(page, "z");
    await expectFileContent(
      request,
      baseURL,
      designId,
      "source.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Source Peer"')).toBe(
          2,
        );
      },
    );
    await expectPreviewLayerCount(page, "Source Peer", 2);

    await pressPrimaryShortcut(page, "z", { shift: true });
    await expectFileContent(
      request,
      baseURL,
      designId,
      "source.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Source Peer"')).toBe(
          1,
        );
      },
    );
    await expectPreviewLayerCount(page, "Source Peer", 1);

    await selectLayerRow(page, "Copy Card");
    await pressPrimaryShortcut(page, "x");
    await expectFileContent(
      request,
      baseURL,
      designId,
      "source.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(0);
        expect(count(html, ">Nested CTA<")).toBe(0);
      },
    );

    await selectScreenRow(page, "Target");
    await pressPrimaryShortcut(page, "v");
    await expectFileContent(
      request,
      baseURL,
      designId,
      "target.html",
      (html) => {
        expect(count(html, 'data-agent-native-layer-name="Copy Card"')).toBe(1);
        expect(count(html, ">Nested CTA<")).toBe(1);
        expect(html).not.toContain('data-agent-native-node-id="source-card"');
        expect(allNodeIdsAreUnique(html)).toBe(true);
      },
    );
  });
});

async function createKeyboardDesign(
  request: APIRequestContext,
  baseURL: string | undefined,
  title: string,
): Promise<string> {
  const created = await postAction(request, baseURL, "create-design", {
    title,
    projectType: "prototype",
  });
  const id: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!id) throw new Error(`create-design did not return id: ${created}`);

  await postAction(request, baseURL, "create-file", {
    designId: id,
    filename: "source.html",
    fileType: "html",
    content: SOURCE_HTML,
  });
  await postAction(request, baseURL, "create-file", {
    designId: id,
    filename: "target.html",
    fileType: "html",
    content: TARGET_HTML,
  });
  return id;
}

async function postAction(
  request: APIRequestContext,
  baseURL: string | undefined,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const res = await request.post(
    `${actionBaseUrl(baseURL)}/_agent-native/actions/${name}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!res.ok()) {
    throw new Error(
      `action ${name} failed: ${res.status()} ${await res.text()}`,
    );
  }
  return res.json();
}

function actionBaseUrl(baseURL: string | undefined): string {
  return (
    baseURL ??
    process.env.E2E_BASE_URL ??
    `http://127.0.0.1:${process.env.E2E_PORT ?? "9333"}`
  ).replace(/\/$/, "");
}

async function getDesign(
  request: APIRequestContext,
  baseURL: string | undefined,
  id: string,
): Promise<any> {
  const params = new URLSearchParams({ id });
  const res = await request.get(
    `${actionBaseUrl(baseURL)}/_agent-native/actions/get-design?${params}`,
    {
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!res.ok()) {
    throw new Error(
      `action get-design failed: ${res.status()} ${await res.text()}`,
    );
  }
  const result = await res.json();
  if (hasFiles(result)) return result;
  if (hasFiles(result?.result)) return result.result;
  if (hasFiles(result?.design)) return result.design;
  if (hasFiles(result?.data)) return result.data;
  return result;
}

async function expectFileContent(
  request: APIRequestContext,
  baseURL: string | undefined,
  designId: string,
  filename: string,
  assertContent: (html: string) => void,
) {
  await expect
    .poll(
      async () => {
        const design = await getDesign(request, baseURL, designId);
        const files = Array.isArray(design?.files) ? design.files : [];
        const file = files.find(
          (candidate: { filename?: string }) => candidate.filename === filename,
        );
        if (!file) {
          return {
            ok: false,
            message: `missing file "${filename}"; saw files: ${files
              .map((candidate: { filename?: string }) => candidate.filename)
              .filter(Boolean)
              .join(", ")}`,
          };
        }
        if (typeof file.content !== "string") {
          return {
            ok: false,
            message: `file "${filename}" has no string content`,
          };
        }
        try {
          assertContent(file.content);
          return { ok: true, message: "" };
        } catch (error) {
          return {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      },
      { timeout: 15_000 },
    )
    .toEqual({ ok: true, message: "" });
}

function hasFiles(value: any): value is { files: any[] } {
  return !!value && typeof value === "object" && Array.isArray(value.files);
}

function layerTree(page: Page) {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRowButton(page: Page, name: string) {
  return layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${cssString(name)}"]`) })
    .first();
}

function layerRow(page: Page, name: string) {
  return layerRowButton(page, name).locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
}

function screenButton(page: Page, name: string) {
  return page
    .locator("button:not([data-layer-row-button])")
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(name)}\\s*$`) })
    .first();
}

async function selectLayerRow(page: Page, name: string): Promise<void> {
  await openLayerSearch(page, name);
  const button = layerRowButton(page, name);
  await expect(button).toBeVisible();
  await button.click({ force: true });
  await expect(layerRow(page, name)).toHaveAttribute("aria-selected", "true");
}

async function additiveSelectLayerRow(page: Page, name: string): Promise<void> {
  await openLayerSearch(page, "");
  const button = layerRowButton(page, name);
  await expect(button).toBeVisible();
  await button.click({
    force: true,
    modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
  });
  await expect(layerRow(page, name)).toHaveAttribute("aria-selected", "true");
}

async function selectScreenRow(page: Page, name: string): Promise<void> {
  await openLayerSearch(page, "");
  const button = screenButton(page, name);
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
}

async function selectedRowCount(page: Page): Promise<number> {
  return layerTree(page)
    .locator('[role="treeitem"][aria-selected="true"]')
    .count();
}

async function expectPreviewLayerCount(
  page: Page,
  name: string,
  expected: number,
): Promise<void> {
  await expect
    .poll(
      async () =>
        designFrame(page)
          .locator(`[data-agent-native-layer-name="${cssString(name)}"]`)
          .count(),
      { timeout: 10_000 },
    )
    .toBe(expected);
}

async function openLayerSearch(page: Page, query: string): Promise<void> {
  const normalized = query.trim().toLowerCase();
  const input = page.getByPlaceholder("Search layers...");
  if (!(await input.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: "Search layers...", exact: true })
      .click();
    await expect(input).toBeVisible();
  }
  await input.fill(query);
  await expect(input).toHaveValue(query);
  await expect
    .poll(
      async () => {
        const names = await visibleLayerNames(page);
        return normalized
          ? names.some((name) => name.toLowerCase().includes(normalized))
          : names.length > 0;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function visibleLayerNames(page: Page): Promise<string[]> {
  return await layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent ?? "").trim())
        .filter((name) => name.length > 0),
    );
}

async function pressPrimaryShortcut(
  page: Page,
  key: string,
  options: { shift?: boolean } = {},
): Promise<void> {
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
  });
  const parts = [PRIMARY];
  if (options.shift) parts.push("Shift");
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  await page.keyboard.press(parts.join("+"));
}

async function pressEditorKey(page: Page, key: string): Promise<void> {
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
  });
  await page.keyboard.press(key);
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function allNodeIdsAreUnique(html: string): boolean {
  const markupOnly = htmlWithoutRawTextBodies(html);
  const ids = Array.from(
    markupOnly.matchAll(/data-agent-native-node-id="([^"]+)"/g),
  ).map((match) => match[1]);
  return ids.length === new Set(ids).size;
}

function actualNodeIdCount(html: string, nodeId: string): number {
  return count(
    htmlWithoutRawTextBodies(html),
    `data-agent-native-node-id="${nodeId}"`,
  );
}

function htmlWithoutRawTextBodies(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
}

function cssString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
