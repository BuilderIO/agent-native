import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath, cdpScreenshot, expandAllLayers, gotoEditor } from "./helpers";

const SCREEN = `<!doctype html><html><body style="margin:0;position:relative;width:800px;height:600px">
<div data-agent-native-node-id="free" data-agent-native-layer-name="Free element" style="position:absolute;left:80px;top:80px;width:120px;height:70px;background:#2563eb"></div>
<div data-agent-native-node-id="root" data-agent-native-layer-name="Root element" data-an-primitive="frame" style="position:absolute;left:80px;top:200px;width:120px;height:70px;background:#f97316"></div>
<section data-agent-native-node-id="nested-auto" data-agent-native-layer-name="Nested auto" data-an-primitive="frame" style="position:absolute;left:380px;top:80px;width:300px;height:180px;display:flex;flex-direction:row;gap:12px;padding:12px;background:#dbeafe;box-sizing:border-box">
<div data-agent-native-node-id="flow-child" data-agent-native-layer-name="Flow child" style="flex:0 0 100px;height:50px;background:#7c3aed"></div>
<div data-agent-native-node-id="auto-peer" data-agent-native-layer-name="Peer" style="flex:0 0 100px;height:50px;background:#06b6d4"></div>
</section></body></html>`;
const DESTINATION = `<!doctype html><html><body style="margin:0;position:relative;width:800px;height:600px">
<section data-agent-native-node-id="root" data-agent-native-layer-name="Destination" data-an-primitive="frame" style="position:absolute;left:180px;top:180px;width:260px;height:160px;background:#f97316"></section>
</body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok())
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  return response.json();
}

async function createScreens(
  request: APIRequestContext,
  secondContent = SCREEN,
) {
  const created = await action(request, "create-design", {
    title: "drag acceptance",
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id;
  if (!designId) throw new Error("create-design returned no id");
  const ids: string[] = [];
  for (const [index, filename] of ["index.html", "second.html"].entries()) {
    const file = await action(request, "create-file", {
      designId,
      filename,
      content: index === 0 ? SCREEN : secondContent,
      fileType: "html",
    });
    const fileId = file.id ?? file.data?.id;
    if (!fileId) throw new Error(`create-file returned no id for ${filename}`);
    ids.push(fileId);
    await action(request, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["screenMetadata", fileId],
          value: { sourceType: "inline", width: 800, height: 600 },
        },
        {
          op: "set",
          path: ["canvasFrames", fileId],
          value: { x: index * 1100, y: 0, width: 800, height: 600, z: index },
        },
      ],
    });
  }
  return { designId, ids };
}

function screenById(page: Page, fileId: string) {
  return page.locator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${fileId}"]`,
  );
}

async function file(
  request: APIRequestContext,
  designId: string,
  filename: string,
) {
  const result = await request
    .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
    .then((r) => r.json());
  const found = result.files?.find(
    (item: { filename: string }) => item.filename === filename,
  );
  if (!found) throw new Error(`missing ${filename}`);
  return found.content as string;
}

async function ownership(page: Page, html: string, ids: string[]) {
  return page.evaluate(
    ({ html, ids }) => {
      const template = document.createElement("template");
      template.innerHTML = html;
      return Object.fromEntries(
        ids.map((id) => {
          const element = template.content.querySelector(
            `[data-agent-native-node-id="${id}"]`,
          );
          return [
            id,
            {
              exists: element !== null,
              parent:
                element?.parentElement?.getAttribute(
                  "data-agent-native-node-id",
                ) ?? null,
              position:
                element instanceof HTMLElement ? element.style.position : null,
            },
          ];
        }),
      );
    },
    { html, ids },
  );
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("free-position drag exposes its live position and persists after reload", async ({
  page,
  request,
}) => {
  const { designId, ids } = await createScreens(request);
  try {
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    const source = screenById(page, ids[0]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="free"]');
    await expect(source).toBeVisible();
    const start = (await source.boundingBox())!;
    const origin = {
      x: start.x + start.width / 2,
      y: start.y + start.height / 2,
    };
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 8, origin.y + 4, { steps: 3 });
    await page.mouse.move(origin.x + 100, origin.y + 60, { steps: 12 });
    const selection = screenById(page, ids[0]!)
      .contentFrame()
      .locator('[data-agent-native-edit-overlay="selection"]');
    await expect(selection).toBeVisible();
    const live = await source.boundingBox();
    expect(live!.x).toBeGreaterThan(start.x + 60);
    expect(live!.y).toBeGreaterThan(start.y + 30);
    const feedback = await selection.boundingBox();
    expect(feedback!.x).toBeGreaterThan(start.x + 60);
    expect(feedback!.y).toBeGreaterThan(start.y + 30);
    const heldScreenshot = test.info().outputPath("free-drag-held.png");
    await cdpScreenshot(page, heldScreenshot);
    await test.info().attach("free-drag-held.png", {
      path: heldScreenshot,
      contentType: "image/png",
    });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await file(request, designId, "index.html")).match(
            /data-agent-native-node-id="free"[^>]*style="([^"]+)"/,
          )?.[1] ?? "",
      )
      .not.toContain("left:80px");
    const committed = await file(request, designId, "index.html");
    const movedStyle =
      /data-agent-native-node-id="free"[^>]*style="([^"]+)"/.exec(
        committed,
      )?.[1];
    expect(movedStyle).toContain("left:");
    expect(movedStyle).toContain("top:");
    await page.reload({ waitUntil: "domcontentloaded" });
    const persistedNode = screenById(page, ids[0]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="free"]');
    await expect(persistedNode).toBeVisible();
    const persisted = await persistedNode.evaluate((el) => ({
      left: (el as HTMLElement).style.left,
      top: (el as HTMLElement).style.top,
    }));
    expect(persisted.left).not.toBe("80px");
    expect(persisted.top).not.toBe("80px");
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Option-dragging a root Screen previews, creates, and persists a duplicate", async ({
  page,
  request,
}) => {
  const { designId, ids } = await createScreens(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview&zoom=50`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
      timeout: 30_000,
    });
    const fileCountBefore = await page.request
      .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
      .then((r) => r.json())
      .then((result) => result.files.length);
    await expect(page.locator("[data-screen-card]").first()).toBeVisible();
    await page.locator("[data-frame-label]").first().click({ force: true });
    const source = page.locator("[data-frame-drag-surface]").first();
    await expect(source).toBeVisible();
    const box = (await source.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(point.x + 14, point.y + 8, { steps: 3 });
    await expect(page.locator("[data-duplicate-preview-ghost]")).toBeVisible();
    await page.mouse.move(point.x + 160, point.y + 90, { steps: 12 });
    const duplicateGhost = await page
      .locator("[data-duplicate-preview-ghost]")
      .boundingBox();
    expect(duplicateGhost).not.toBeNull();
    expect(duplicateGhost!.x).toBeGreaterThan(box.x + 80);
    const heldScreenshot = test.info().outputPath("screen-duplicate-held.png");
    await cdpScreenshot(page, heldScreenshot);
    await test.info().attach("screen-duplicate-held.png", {
      path: heldScreenshot,
      contentType: "image/png",
    });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect(page.locator("[data-screen-shell]")).toHaveCount(3, {
      timeout: 20_000,
    });
    await expect
      .poll(
        async () =>
          (
            await page.request
              .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
              .then((r) => r.json())
          ).files?.length,
      )
      .toBeGreaterThan(fileCountBefore);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(3, {
      timeout: 30_000,
    });
    const result = await page.request
      .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
      .then((r) => r.json());
    expect(result.files.length).toBeGreaterThan(fileCountBefore);
    const duplicates = result.files.filter(
      (entry: { filename: string; id: string }) =>
        !ids.includes(entry.id) && /copy/i.test(entry.filename),
    );
    expect(duplicates.length).toBeGreaterThan(0);
    const sourceHtml = result.files.find(
      (entry: { id: string }) => entry.id === ids[0],
    ).content as string;
    const sourceNodeIds = [
      ...sourceHtml.matchAll(/data-agent-native-node-id="([^"]+)"/g),
    ].map((match) => match[1]);
    const duplicate = duplicates.find((entry: { content: string }) => {
      const copiedNodeIds = [
        ...entry.content.matchAll(/data-agent-native-node-id="([^"]+)"/g),
      ].map((match) => match[1]);
      return (
        entry.content.includes('data-agent-native-layer-name="Flow child"') &&
        copiedNodeIds.length === sourceNodeIds.length &&
        copiedNodeIds.every((id: string) => !sourceNodeIds.includes(id))
      );
    });
    expect(duplicate).toBeDefined();
    expect(JSON.parse(result.data).canvasFrames?.[duplicate!.id]).toMatchObject(
      {
        x: 320,
        y: 180,
        width: 800,
        height: 600,
      },
    );
    const sourceCard = page.locator(
      `[data-screen-shell][data-frame-id="${ids[0]}"] [data-screen-card]`,
    );
    const duplicateCard = page.locator(
      `[data-screen-shell][data-frame-id="${duplicate!.id}"] [data-screen-card]`,
    );
    const sourceBox = await sourceCard.boundingBox();
    const duplicateBox = await duplicateCard.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(duplicateBox).not.toBeNull();
    expect(Math.abs(duplicateBox!.x - sourceBox!.x - 160)).toBeLessThan(2);
    expect(Math.abs(duplicateBox!.y - sourceBox!.y - 90)).toBeLessThan(2);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("moving a flow child out of nested auto layout across Screens previews reparenting and persists", async ({
  page,
  request,
}) => {
  const { designId, ids } = await createScreens(request, DESTINATION);
  try {
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    const source = screenById(page, ids[0]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="flow-child"]');
    const destinationId = ids[1]!;
    const target = screenById(page, destinationId)
      .contentFrame()
      .locator('[data-agent-native-node-id="root"]');
    await page.mouse.click(
      (await source.boundingBox())!.x + (await source.boundingBox())!.width / 2,
      (await source.boundingBox())!.y +
        (await source.boundingBox())!.height / 2,
    );
    const initial = await source.boundingBox();
    await page.mouse.dblclick(
      initial!.x + initial!.width / 2,
      initial!.y + initial!.height / 2,
    );
    await page.keyboard.press("Escape");
    const start = (await source.boundingBox())!;
    const end = (await target.boundingBox())!;
    const origin = {
      x: start.x + start.width / 2,
      y: start.y + start.height / 2,
    };
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x - 12, origin.y, { steps: 4 });
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
      steps: 24,
    });
    await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator("[data-cross-screen-drag-ghost]")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      screenById(page, destinationId)
        .contentFrame()
        .locator("[data-agent-native-hit-test-preview]"),
    ).toBeVisible({ timeout: 5_000 });
    expect(
      await source.evaluate((element) =>
        element.parentElement?.getAttribute("data-agent-native-node-id"),
      ),
    ).toBe("nested-auto");
    const hitPreview = await screenById(page, destinationId)
      .contentFrame()
      .locator("[data-agent-native-hit-test-preview]")
      .boundingBox();
    expect(hitPreview).not.toBeNull();
    expect(hitPreview!.x + hitPreview!.width / 2).toBeGreaterThan(end.x - 40);
    expect(hitPreview!.x + hitPreview!.width / 2).toBeLessThan(
      end.x + end.width + 40,
    );
    const ghost = await page
      .locator("[data-cross-screen-drag-ghost]")
      .boundingBox();
    expect(ghost).not.toBeNull();
    expect(ghost!.x + ghost!.width / 2).toBeGreaterThan(end.x - 40);
    expect(ghost!.x + ghost!.width / 2).toBeLessThan(end.x + end.width + 40);
    const heldScreenshot = test
      .info()
      .outputPath("cross-screen-reparent-held.png");
    await cdpScreenshot(page, heldScreenshot);
    await test.info().attach("cross-screen-reparent-held.png", {
      path: heldScreenshot,
      contentType: "image/png",
    });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (
            await ownership(
              page,
              await file(request, designId, "second.html"),
              ["flow-child"],
            )
          )["flow-child"]?.parent,
      )
      .toBe("root");
    const sourceHtml = await file(request, designId, "index.html");
    const targetHtml = await file(request, designId, "second.html");
    const sourceOwnership = await ownership(page, sourceHtml, [
      "nested-auto",
      "flow-child",
      "auto-peer",
    ]);
    const targetOwnership = await ownership(page, targetHtml, [
      "root",
      "flow-child",
    ]);
    expect(sourceOwnership["flow-child"]?.exists).toBe(false);
    expect(sourceOwnership["auto-peer"]?.parent).toBe("nested-auto");
    expect(targetOwnership["flow-child"]?.exists).toBe(true);
    expect(targetOwnership["flow-child"]?.parent).toBe("root");
    expect(targetOwnership["flow-child"]?.position).toBe("absolute");
    await page.reload({ waitUntil: "domcontentloaded" });
    const reloadedSourceFrame = screenById(page, ids[0]!).contentFrame();
    const reloadedTargetFrame = screenById(page, ids[1]!).contentFrame();
    await expect(
      reloadedSourceFrame.locator('[data-agent-native-node-id="auto-peer"]'),
    ).toBeVisible();
    await expect(
      reloadedSourceFrame.locator('[data-agent-native-node-id="flow-child"]'),
    ).toHaveCount(0);
    const reloadedTargetChild = reloadedTargetFrame.locator(
      '[data-agent-native-node-id="flow-child"]',
    );
    await expect(reloadedTargetChild).toBeVisible();
    expect(
      await reloadedTargetChild.evaluate((element) =>
        element.parentElement?.getAttribute("data-agent-native-node-id"),
      ),
    ).toBe("root");
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
