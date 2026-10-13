import { expect, test, type Page } from "@playwright/test";

import { buildCodeLayerProjection } from "../shared/code-layer";
import { appPath, designFrame, expandAllLayers, gotoEditor } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const SHARED_NODE_ID = "history-shared-note";
const A_HTML =
  '<!doctype html><html lang="en"><head><title>A</title></head><body style="margin:0"><main><article><p class="target-note" data-agent-native-node-id="' +
  SHARED_NODE_ID +
  '" data-agent-native-layer-name="A Target Note" style="margin:0;font-family:Arial,sans-serif;font-size:16px;line-height:20px"><span>Shared note</span></p></article></main></body></html>';
const B_HTML =
  '<!doctype html><html lang="en"><head><title>B</title></head><body style="margin:0"><main><article><p class="target-note" data-agent-native-node-id="' +
  SHARED_NODE_ID +
  '" data-agent-native-layer-name="B Target Note" style="margin:0;font-family:Arial,sans-serif;font-size:18px;line-height:24px"><span>Shared note</span></p></article></main></body></html>';
const VARIANT_SET_ID = "screen-delete-sequential-history-qa";

type DesignFile = { id: string; filename: string; content?: string };
type DesignRecord = { data?: unknown; files?: DesignFile[] };

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

function fileById(record: DesignRecord, id: string): DesignFile {
  const file = record.files?.find((candidate) => candidate.id === id);
  if (!file) throw new Error("Missing file " + id);
  return file;
}

function projectedTarget(file: DesignFile) {
  if (typeof file.content !== "string") {
    throw new Error("Missing source for " + file.filename);
  }
  const node = buildCodeLayerProjection(file.content, {
    source: { kind: "design-file", fileId: file.id },
  }).nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] ===
        SHARED_NODE_ID &&
      candidate.dataAttributes["data-agent-native-layer-name"] ===
        "A Target Note",
  );
  if (!node) throw new Error("Could not project the A text descendant");
  const sourceId = node.dataAttributes["data-agent-native-node-id"];
  if (typeof sourceId !== "string") {
    throw new Error("Projected A text descendant has no persisted source id");
  }
  return { id: node.id, sourceId };
}

async function sourceStyle(
  page: Page,
  file: DesignFile,
  selector: string,
  property: string,
): Promise<string | null> {
  if (typeof file.content !== "string") return null;
  return page.evaluate(
    ({ html, cssSelector, cssProperty }) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      const element = document.querySelector(cssSelector) as HTMLElement | null;
      return element?.style.getPropertyValue(cssProperty) ?? null;
    },
    { html: file.content, cssSelector: selector, cssProperty: property },
  );
}

async function sourceCount(
  page: Page,
  file: DesignFile,
  selector: string,
): Promise<number> {
  if (typeof file.content !== "string") return 0;
  return page.evaluate(
    ({ html, cssSelector }) =>
      new DOMParser()
        .parseFromString(html, "text/html")
        .querySelectorAll(cssSelector).length,
    { html: file.content, cssSelector: selector },
  );
}

async function selectedElementState(page: Page) {
  return page.evaluate(() => {
    const selected = (window as any).__designSelection?.selectedElement;
    return selected
      ? {
          sourceId: selected.sourceId ?? null,
          sourceLayerIdentity: selected.sourceLayerIdentity ?? null,
        }
      : null;
  });
}

async function selectedLayerButton(page: Page) {
  const selectedRow = page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"][aria-selected="true"]');
  await expect(selectedRow).toHaveCount(1);
  const button = selectedRow.locator(
    "[data-layer-row-button][data-layer-node-id]",
  );
  await expect(button).toHaveCount(1);
  return button;
}

async function selectedLayerNodeId(page: Page): Promise<string | null> {
  const buttons = page
    .getByRole("tree", { name: "Layers" })
    .locator(
      '[role="treeitem"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
    );
  if ((await buttons.count()) !== 1) return null;
  return buttons.getAttribute("data-layer-node-id");
}

function screenRowButton(page: Page, screenId: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator('[data-layer-row-button][data-layer-node-id="' + screenId + '"]');
}

async function selectLayerRowById(page: Page, nodeId: string): Promise<void> {
  const row = page
    .getByRole("tree", { name: "Layers" })
    .locator('[data-layer-row-button][data-layer-node-id="' + nodeId + '"]');
  await expect(row).toBeVisible();
  await row.click({ force: true });
  await expect(
    row.locator('xpath=ancestor::*[@role="treeitem"][1]'),
  ).toHaveAttribute("aria-selected", "true");
}

async function deleteScreenFromLayers(page: Page, screenId: string) {
  await expandAllLayers(page);
  const button = screenRowButton(page, screenId);
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("data-layer-node-id", screenId);
  await button.click();
  await expect(
    button.locator('xpath=ancestor::*[@role="treeitem"][1]'),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Delete");
}

async function cleanupDesign(page: Page, designId: string) {
  const response = await page.request.post(
    appPath("/_agent-native/actions/delete-design"),
    { data: { id: designId } },
  );
  if (!response.ok()) {
    throw new Error("delete-design: " + (await response.text()));
  }
}

test("deleted Screen recreation remaps nested text history and duplicate target", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const designId = requireId(
    await action(page, "create-design", {
      title: "Delete Screen descendant history " + Date.now(),
      projectType: "prototype",
      designSystemId: null,
    }),
    "create-design",
  );
  try {
    const alphaId = requireId(
      await action(page, "create-file", {
        designId,
        filename: "index.html",
        content: A_HTML,
        fileType: "html",
      }),
      "create-file A",
    );
    const betaId = requireId(
      await action(page, "create-file", {
        designId,
        filename: "b.html",
        content: B_HTML,
        fileType: "html",
      }),
      "create-file B",
    );
    await action(page, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", alphaId],
          value: { x: 0, y: 0, width: 500, height: 320, z: 0 },
        },
        {
          op: "set",
          path: ["canvasFrames", betaId],
          value: { x: 600, y: 0, width: 500, height: 320, z: 1 },
        },
        {
          op: "set",
          path: ["screenMetadata", alphaId],
          value: {
            width: 500,
            height: 320,
            heightMode: "fixed",
            heightPinned: true,
          },
        },
        {
          op: "set",
          path: ["screenMetadata", betaId],
          value: {
            width: 500,
            height: 320,
            heightMode: "fixed",
            heightPinned: true,
          },
        },
      ],
    });

    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expandAllLayers(page);
    const betaSourceBefore = fileById(
      await readDesign(page, designId),
      betaId,
    ).content;
    if (typeof betaSourceBefore !== "string")
      throw new Error("Missing B source");

    const initialSource = fileById(await readDesign(page, designId), alphaId);
    const initialTarget = projectedTarget(initialSource);
    const initialTargetId = initialTarget.id;
    expect(initialTarget.sourceId).toBe(SHARED_NODE_ID);
    expect(alphaId).not.toBe(initialTargetId);
    await selectLayerRowById(page, initialTargetId);
    const initialSelectionButton = await selectedLayerButton(page);
    await expect(initialSelectionButton).toHaveAttribute(
      "data-layer-node-id",
      initialTargetId,
    );
    await expect
      .poll(() => selectedElementState(page))
      .toMatchObject({
        sourceId: initialTarget.sourceId,
        sourceLayerIdentity: { screenId: alphaId, nodeId: initialTargetId },
      });

    const sizeInput = page.locator('input[aria-label="Size" i]').first();
    await expect(sizeInput).toBeVisible();
    await sizeInput.fill("30");
    await sizeInput.press("Enter");
    await expect(sizeInput).toHaveValue("30px");
    await expect
      .poll(async () =>
        sourceStyle(
          page,
          fileById(await readDesign(page, designId), alphaId),
          '.target-note[data-agent-native-layer-name="A Target Note"]',
          "font-size",
        ),
      )
      .toBe("30px");
    await expect
      .poll(() =>
        designFrame(page, alphaId)
          .locator('.target-note[data-agent-native-layer-name="A Target Note"]')
          .evaluate((node) => getComputedStyle(node).fontSize),
      )
      .toBe("30px");
    expect(fileById(await readDesign(page, designId), betaId).content).toBe(
      betaSourceBefore,
    );

    await deleteScreenFromLayers(page, alphaId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(1);
    await expect
      .poll(async () =>
        (await readDesign(page, designId)).files?.some(
          (file) => file.id === alphaId,
        ),
      )
      .toBe(false);
    expect(fileById(await readDesign(page, designId), betaId).content).toBe(
      betaSourceBefore,
    );

    await page.keyboard.press(MOD + "+z");
    let restoredAlphaId: string | undefined;
    await expect
      .poll(async () => {
        const record = await readDesign(page, designId);
        restoredAlphaId = record.files?.find(
          (file) => file.filename === "index.html",
        )?.id;
        return (
          typeof restoredAlphaId === "string" && restoredAlphaId !== alphaId
        );
      })
      .toBe(true);
    if (!restoredAlphaId) throw new Error("Undo did not recreate Screen A");
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expect(screenRowButton(page, restoredAlphaId)).toBeVisible();
    await expect
      .poll(async () =>
        sourceStyle(
          page,
          fileById(await readDesign(page, designId), restoredAlphaId!),
          '.target-note[data-agent-native-layer-name="A Target Note"]',
          "font-size",
        ),
      )
      .toBe("30px");
    expect(fileById(await readDesign(page, designId), betaId).content).toBe(
      betaSourceBefore,
    );

    await page.keyboard.press(MOD + "+z");
    const restoredSource = fileById(
      await readDesign(page, designId),
      restoredAlphaId,
    );
    const restoredTarget = projectedTarget(restoredSource);
    const restoredTargetId = restoredTarget.id;
    expect(restoredTarget.sourceId).toBe(SHARED_NODE_ID);
    await expect
      .poll(async () =>
        sourceStyle(
          page,
          fileById(await readDesign(page, designId), restoredAlphaId!),
          '.target-note[data-agent-native-layer-name="A Target Note"]',
          "font-size",
        ),
      )
      .toBe("30px");
    await expect
      .poll(() =>
        designFrame(page, restoredAlphaId)
          .locator('.target-note[data-agent-native-layer-name="A Target Note"]')
          .evaluate((node) => getComputedStyle(node).fontSize),
      )
      .toBe("30px");
    await expect
      .poll(async () => {
        const selection = await selectedElementState(page);
        return {
          exactTarget:
            selection?.sourceId === SHARED_NODE_ID &&
            selection?.sourceLayerIdentity?.screenId === restoredAlphaId &&
            selection?.sourceLayerIdentity?.nodeId === restoredTargetId &&
            (await selectedLayerNodeId(page)) === restoredTargetId,
        };
      })
      .toEqual({ exactTarget: true });

    await page.keyboard.press(MOD + "+z");
    await expect
      .poll(async () =>
        sourceStyle(
          page,
          fileById(await readDesign(page, designId), restoredAlphaId!),
          '.target-note[data-agent-native-layer-name="A Target Note"]',
          "font-size",
        ),
      )
      .toBe("16px");
    await expect
      .poll(() =>
        designFrame(page, restoredAlphaId)
          .locator('.target-note[data-agent-native-layer-name="A Target Note"]')
          .evaluate((node) => getComputedStyle(node).fontSize),
      )
      .toBe("16px");
    await expect
      .poll(async () => {
        const selection = await selectedElementState(page);
        const rowNodeId = await selectedLayerNodeId(page);
        return {
          exactTarget:
            selection?.sourceId === SHARED_NODE_ID &&
            selection?.sourceLayerIdentity?.screenId === restoredAlphaId &&
            selection?.sourceLayerIdentity?.nodeId === restoredTargetId &&
            rowNodeId === restoredTargetId,
        };
      })
      .toEqual({ exactTarget: true });

    await page.keyboard.press(MOD + "+Shift+z");
    await expect
      .poll(async () =>
        sourceStyle(
          page,
          fileById(await readDesign(page, designId), restoredAlphaId!),
          '.target-note[data-agent-native-layer-name="A Target Note"]',
          "font-size",
        ),
      )
      .toBe("30px");
    const redoSource = fileById(
      await readDesign(page, designId),
      restoredAlphaId,
    );
    const redoTarget = projectedTarget(redoSource);
    const redoTargetId = redoTarget.id;
    expect(redoTarget.sourceId).toBe(SHARED_NODE_ID);
    await expect
      .poll(() => selectedElementState(page))
      .toMatchObject({
        sourceId: SHARED_NODE_ID,
        sourceLayerIdentity: {
          screenId: restoredAlphaId,
          nodeId: redoTargetId,
        },
      });
    await expect(await selectedLayerButton(page)).toHaveAttribute(
      "data-layer-node-id",
      redoTargetId,
    );
    expect(restoredAlphaId).not.toBe(alphaId);

    await page.keyboard.press(MOD + "+d");
    await expect
      .poll(async () => {
        const record = await readDesign(page, designId);
        return {
          aNotes: await sourceCount(
            page,
            fileById(record, restoredAlphaId!),
            ".target-note",
          ),
          bSource: fileById(record, betaId).content,
        };
      })
      .toEqual({ aNotes: 2, bSource: betaSourceBefore });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);

    await page.reload();
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expect(
      designFrame(page, restoredAlphaId).locator(".target-note"),
    ).toHaveCount(2);
    await expect(designFrame(page, betaId).locator(".target-note")).toHaveCount(
      1,
    );
    const reloaded = await readDesign(page, designId);
    expect(fileById(reloaded, betaId).content).toBe(betaSourceBefore);
    expect(
      await sourceCount(
        page,
        fileById(reloaded, restoredAlphaId),
        ".target-note",
      ),
    ).toBe(2);
  } finally {
    await cleanupDesign(page, designId);
  }
});

test("sequential Screen deletion Undo preserves surviving variant order", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const designId = requireId(
    await action(page, "create-design", {
      title: "Sequential Screen history " + Date.now(),
      projectType: "prototype",
      designSystemId: null,
    }),
    "create-design",
  );
  try {
    const ids = {
      a: requireId(
        await action(page, "create-file", {
          designId,
          filename: "a.html",
          content: "<!doctype html><html><body><main>A</main></body></html>",
          fileType: "html",
        }),
        "create-file A",
      ),
      b: requireId(
        await action(page, "create-file", {
          designId,
          filename: "b.html",
          content: "<!doctype html><html><body><main>B</main></body></html>",
          fileType: "html",
        }),
        "create-file B",
      ),
      c: requireId(
        await action(page, "create-file", {
          designId,
          filename: "c.html",
          content: "<!doctype html><html><body><main>C</main></body></html>",
          fileType: "html",
        }),
        "create-file C",
      ),
    };
    const metadata = {
      a: {
        title: "A",
        width: 360,
        height: 640,
        heightMode: "fixed",
        heightPinned: true,
      },
      b: {
        title: "B",
        width: 390,
        height: 844,
        heightMode: "fixed",
        heightPinned: true,
      },
      c: {
        title: "C",
        width: 412,
        height: 915,
        heightMode: "fixed",
        heightPinned: true,
      },
    };
    const members = [
      { id: ids.a, variantId: "desktop", label: "A" },
      { id: ids.b, variantId: "tablet", label: "B" },
      { id: ids.c, variantId: "mobile", label: "C" },
    ];
    await action(page, "update-design", {
      id: designId,
      dataOperations: [
        ...Object.entries(ids).map(([key, id], index) => ({
          op: "set",
          path: ["canvasFrames", id],
          value: {
            x: index * 520,
            y: 0,
            width: metadata[key as keyof typeof metadata].width,
            height: metadata[key as keyof typeof metadata].height,
            z: index,
          },
        })),
        ...Object.entries(ids).map(([key, id]) => ({
          op: "set",
          path: ["screenMetadata", id],
          value: metadata[key as keyof typeof metadata],
        })),
        {
          op: "set",
          path: ["designVariantSets", VARIANT_SET_ID],
          value: {
            id: VARIANT_SET_ID,
            prompt: "Sequential deletion history QA",
            createdAt: new Date().toISOString(),
            screenCount: 3,
            screens: members,
          },
        },
      ],
    });

    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(3);
    await expandAllLayers(page);

    const memberIds = async () => {
      const data = designData(await readDesign(page, designId));
      const screens = data.designVariantSets?.[VARIANT_SET_ID]?.screens ?? [];
      return screens.map((screen: unknown) =>
        typeof screen === "string" ? screen : (screen as { id?: string }).id,
      );
    };
    const removeThenCheck = async (
      id: string,
      expectedScreenIds: string[],
      expectedVariantMembers = expectedScreenIds,
    ) => {
      await deleteScreenFromLayers(page, id);
      await expect(page.locator("[data-screen-shell]")).toHaveCount(
        expectedScreenIds.length,
      );
      await expect.poll(memberIds).toEqual(expectedVariantMembers);
    };

    await removeThenCheck(ids.a, [ids.b, ids.c]);
    await removeThenCheck(ids.c, [ids.b], []);
    const afterDeletes = designData(await readDesign(page, designId));
    expect(afterDeletes.designVariantSets?.[VARIANT_SET_ID]).toBeUndefined();
    expect(afterDeletes.screenMetadata?.[ids.a]).toBeUndefined();
    expect(afterDeletes.screenMetadata?.[ids.c]).toBeUndefined();
    expect(afterDeletes.screenMetadata?.[ids.b]).toEqual(metadata.b);

    await page.keyboard.press(MOD + "+z");
    let restoredCId: string | undefined;
    await expect
      .poll(async () => {
        const record = await readDesign(page, designId);
        restoredCId = record.files?.find(
          (file) => file.filename === "c.html",
        )?.id;
        return typeof restoredCId === "string" && restoredCId !== ids.c;
      })
      .toBe(true);
    if (!restoredCId) throw new Error("Undo did not restore C");
    await expect.poll(memberIds).toEqual([ids.b, restoredCId]);

    await page.keyboard.press(MOD + "+z");
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expect.poll(memberIds).toEqual([ids.b, restoredCId]);
    const afterSelectionUndo = await readDesign(page, designId);
    expect(afterSelectionUndo.files?.some((file) => file.id === ids.a)).toBe(
      false,
    );
    expect(
      afterSelectionUndo.files?.some((file) => file.id === restoredCId),
    ).toBe(true);
    expect(designData(afterSelectionUndo).screenMetadata?.[ids.b]).toEqual(
      metadata.b,
    );
    expect(
      designData(afterSelectionUndo).screenMetadata?.[restoredCId],
    ).toEqual(metadata.c);

    await page.keyboard.press(MOD + "+z");
    let restoredAId: string | undefined;
    await expect
      .poll(async () => {
        const record = await readDesign(page, designId);
        restoredAId = record.files?.find(
          (file) => file.filename === "a.html",
        )?.id;
        return typeof restoredAId === "string" && restoredAId !== ids.a;
      })
      .toBe(true);
    if (!restoredAId) throw new Error("Undo did not restore A");
    await expect.poll(memberIds).toEqual([restoredAId, ids.b, restoredCId]);
    const restored = designData(await readDesign(page, designId));
    expect(restored.screenMetadata?.[restoredAId]).toEqual(metadata.a);
    expect(restored.screenMetadata?.[ids.b]).toEqual(metadata.b);
    expect(restored.screenMetadata?.[restoredCId]).toEqual(metadata.c);

    await page.reload();
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(3);
    await expect.poll(memberIds).toEqual([restoredAId, ids.b, restoredCId]);
    const visibleScreenIds = await page
      .locator("[data-screen-shell][data-frame-id]")
      .evaluateAll((shells) =>
        shells
          .map((shell) => shell.getAttribute("data-frame-id"))
          .filter((id): id is string => id !== null)
          .sort(),
      );
    expect(visibleScreenIds).toEqual([restoredAId, ids.b, restoredCId].sort());
  } finally {
    await cleanupDesign(page, designId);
  }
});
