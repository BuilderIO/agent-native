import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath, gotoEditor } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:9340";
const RESPONSIVE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@keyframes qa-pulse { from { opacity:.5 } to { opacity:1 } }
.hero { animation: qa-pulse 5s linear infinite; transition: transform 3s linear; }
</style></head><body style="margin:0;min-height:900px">
<main data-agent-native-node-id="main" style="position:relative;min-height:900px">
  <h1 class="hero" data-agent-native-node-id="hero" style="position:absolute;left:40px;top:48px">Responsive Hero</h1>
</main></body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${BASE_URL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext, fileCount = 1) {
  const created = await action(request, "create-design", {
    title: `Responsive overview QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const fileIds: string[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    const file = await action(request, "create-file", {
      designId,
      filename: index === 0 ? "index.html" : `variation-${index + 1}.html`,
      content: RESPONSIVE_HTML.replace(
        "Responsive Hero",
        `Responsive Hero ${index + 1}`,
      ),
      fileType: "html",
    });
    const fileId = file.id ?? file.data?.id;
    if (!fileId) throw new Error("create-file returned no id");
    fileIds.push(fileId);
  }
  return { designId, fileIds };
}

async function configureResponsiveDesign(
  request: APIRequestContext,
  designId: string,
  fileIds: string[],
  options?: { grouped?: boolean; customFirstGroup?: boolean },
) {
  const dataOperations: Array<Record<string, unknown>> = [
    {
      op: "set",
      path: ["breakpointSet"],
      value: {
        id: "qa-breakpoints",
        breakpoints: [
          { id: "mobile", label: "Mobile", widthPx: 390 },
          { id: "tablet", label: "Tablet", widthPx: 768 },
        ],
      },
    },
  ];
  fileIds.forEach((fileId, index) => {
    const groupIndex = Math.floor(index / 2) + 1;
    const withinGroup = index % 2;
    dataOperations.push(
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: {
          sourceType: "inline",
          width: 1280,
          height: 900,
          ...(options?.grouped ? { variantSetId: `set-${groupIndex}` } : {}),
        },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: {
          x:
            options?.customFirstGroup && index === 0 ? 400 : withinGroup * 1376,
          y: 0,
          width: 1280,
          height: 900,
          z: index,
        },
      },
    );
  });
  await action(request, "update-design", { id: designId, dataOperations });
}

async function designFileContent(
  request: APIRequestContext,
  designId: string,
  fileId: string,
) {
  const params = new URLSearchParams({ id: designId });
  const response = await request.get(
    `${BASE_URL}/_agent-native/actions/get-design?${params}`,
  );
  if (!response.ok()) throw new Error(await response.text());
  const result = await response.json();
  return result.files.find((file: { id: string }) => file.id === fileId)
    ?.content as string;
}

async function designData(request: APIRequestContext, designId: string) {
  const params = new URLSearchParams({ id: designId });
  const response = await request.get(
    `${BASE_URL}/_agent-native/actions/get-design?${params}`,
  );
  if (!response.ok()) throw new Error(await response.text());
  const result = await response.json();
  return JSON.parse(result.data || "{}") as Record<string, any>;
}

async function designFileIds(
  request: APIRequestContext,
  designId: string,
): Promise<string[]> {
  const params = new URLSearchParams({ id: designId });
  const response = await request.get(
    `${BASE_URL}/_agent-native/actions/get-design?${params}`,
  );
  if (!response.ok()) throw new Error(await response.text());
  const result = await response.json();
  return result.files.map((file: { id: string }) => file.id);
}

test.use({ viewport: { width: 1500, height: 1000 } });

test("responsive frames select and edit directly with explicit scope persistence", async ({
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(request);
  const [fileId] = fileIds;
  try {
    await configureResponsiveDesign(request, designId, fileIds);
    await gotoEditor(page, designId);
    await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(2);

    const mobileFrame = page
      .locator(`iframe[data-screen-iframe-id="${fileId}::bp-390"]`)
      .contentFrame();
    const mobileHero = mobileFrame.locator(
      '[data-agent-native-node-id="hero"]',
    );
    await expect(mobileHero).toBeVisible();
    await expect
      .poll(() =>
        mobileHero.evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.animationDuration, style.transitionDuration];
        }),
      )
      .toEqual(["0s", "0s"]);
    await mobileHero.click({ force: true });

    const scope = page.getByRole("combobox", {
      name: "Responsive edit scope",
    });
    await expect(scope).toBeVisible();
    await expect(scope).toHaveText("This breakpoint and smaller");
    const xInput = page.getByRole("textbox", { name: "X-position" });
    await expect(xInput).toBeVisible();
    await xInput.fill("137");
    await xInput.press("Enter");
    await expect
      .poll(() => designFileContent(request, designId, fileId!))
      .toContain("@media (max-width: 767px)");

    const tabletFrame = page
      .locator(`iframe[data-screen-iframe-id="${fileId}::bp-768"]`)
      .contentFrame();
    await tabletFrame
      .locator('[data-agent-native-node-id="hero"]')
      .click({ force: true });
    await scope.click();
    await page.getByRole("option", { name: "This breakpoint only" }).click();
    await expect(scope).toHaveText("This breakpoint only");
    await xInput.fill("155");
    await xInput.press("Enter");
    await expect
      .poll(() => designFileContent(request, designId, fileId!))
      .toContain("@media (min-width: 768px) and (max-width: 1279px)");

    await page
      .locator("[data-breakpoint-frame]")
      .filter({
        has: page.locator(`[data-screen-iframe-id="${fileId}::bp-768"]`),
      })
      .locator("[data-frame-full-view]")
      .click();
    await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(0);
    const focusedHero = page
      .locator(`iframe[data-screen-iframe-id="${fileId}"]`)
      .contentFrame()
      .locator('[data-agent-native-node-id="hero"]');
    await expect
      .poll(() =>
        focusedHero.evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.animationDuration, style.transitionDuration];
        }),
      )
      .toEqual(["5s", "3s"]);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("screen deletion explicitly includes and removes responsive variants", async ({
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(request);
  try {
    await configureResponsiveDesign(request, designId, fileIds);
    await gotoEditor(page, designId);
    await page
      .locator("[data-screen-shell] [data-frame-title]")
      .first()
      .click();
    await page.keyboard.press("Delete");
    const dialog = page.getByRole("alertdialog", {
      name: "Delete this screen?",
    });
    await expect(dialog).toContainText("all of its responsive variants");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(0);
    await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(0);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("multiple generated variation groups reserve breakpoint rows without overlap", async ({
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(request, 4);
  try {
    await configureResponsiveDesign(request, designId, fileIds, {
      grouped: true,
    });
    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(4);
    await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(8);

    const overlappingPairs = async () => {
      const boxes = await page
        .locator("[data-screen-shell]")
        .evaluateAll((shells) =>
          shells.map((shell) => {
            const cards = Array.from(
              shell.querySelectorAll<HTMLElement>("[data-screen-card]"),
            ).map((card) => card.getBoundingClientRect());
            return {
              left: Math.min(...cards.map((box) => box.left)),
              top: Math.min(...cards.map((box) => box.top)),
              right: Math.max(...cards.map((box) => box.right)),
              bottom: Math.max(...cards.map((box) => box.bottom)),
            };
          }),
        );
      const pairs: string[] = [];
      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          const first = boxes[a]!;
          const second = boxes[b]!;
          const overlaps =
            first.left < second.right - 1 &&
            first.right > second.left + 1 &&
            first.top < second.bottom - 1 &&
            first.bottom > second.top + 1;
          if (overlaps) pairs.push(`${a + 1}/${b + 1}`);
        }
      }
      return pairs;
    };
    await expect.poll(overlappingPairs).toEqual([]);
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+-" : "Control+-",
    );
    await page.waitForTimeout(300);
    await expect.poll(overlappingPairs).toEqual([]);

    await action(request, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", fileIds[0]!],
          value: { x: 400, y: 200, width: 1280, height: 900, z: 0 },
        },
        {
          op: "set",
          path: ["canvasFrames", fileIds[1]!],
          value: { x: 1800, y: 200, width: 1280, height: 900, z: 1 },
        },
      ],
    });
    await gotoEditor(page, designId);
    await page.waitForTimeout(600);
    await expect
      .poll(async () => {
        const data = await designData(request, designId);
        return [
          data.canvasFrames?.[fileIds[0]!]?.x,
          data.canvasFrames?.[fileIds[0]!]?.y,
          data.canvasFrames?.[fileIds[1]!]?.x,
          data.canvasFrames?.[fileIds[1]!]?.y,
        ];
      })
      .toEqual([400, 200, 1800, 200]);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("add duplicate undo and redo keep the created screen selected and visible", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview`));
    await gotoEditor(page, designId);
    const world = page.locator("[data-multi-screen-canvas-world]");
    const surface = world.locator("xpath=..");
    const cameraTransforms: string[] = [];
    await page.exposeFunction(
      "__qaRecordCameraTransform",
      (transform: string) => cameraTransforms.push(transform),
    );
    const installCameraObserver = () => {
      const attach = () => {
        const target = document.querySelector<HTMLElement>(
          "[data-multi-screen-canvas-world]",
        );
        if (!target || target.dataset.qaCameraObserved === "true") return false;
        target.dataset.qaCameraObserved = "true";
        new MutationObserver(() => {
          void (window as any).__qaRecordCameraTransform(
            target.style.transform,
          );
        }).observe(target, { attributes: true, attributeFilter: ["style"] });
        return true;
      };
      if (attach()) return;
      const observer = new MutationObserver(() => {
        if (attach()) observer.disconnect();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };
    await page.addInitScript(installCameraObserver);
    await page.evaluate(installCameraObserver);

    await page.getByRole("button", { name: "Add screen" }).click();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expect(page.locator("[data-frame-selection-box]")).toBeVisible();
    const selectedShell = page.locator("[data-screen-shell]").last();
    const selectedBox = await selectedShell
      .locator("[data-screen-card]")
      .boundingBox();
    const surfaceBox = await surface.boundingBox();
    if (!selectedBox || !surfaceBox) throw new Error("missing created screen");
    expect(selectedBox.x + selectedBox.width).toBeGreaterThan(surfaceBox.x);
    expect(selectedBox.x).toBeLessThan(surfaceBox.x + surfaceBox.width);
    expect(new Set(cameraTransforms.filter(Boolean)).size).toBeLessThanOrEqual(
      1,
    );

    const resetCameraProbe = () => {
      cameraTransforms.length = 0;
    };
    const createdScreenId = async (beforeIds: readonly string[]) => {
      let createdId: string | undefined;
      await expect
        .poll(async () => {
          const afterIds = await designFileIds(request, designId);
          createdId = afterIds.find((fileId) => !beforeIds.includes(fileId));
          return createdId;
        })
        .toBeTruthy();
      if (!createdId) throw new Error("created screen did not persist");
      return createdId;
    };
    const assertCreatedScreenSelectedVisibleWithSingleCameraCommit = async (
      screenId: string,
    ) => {
      await expect(page.locator("[data-frame-selection-box]")).toBeVisible();
      try {
        await expect
          .poll(() =>
            page.evaluate((targetId) => {
              const world = document.querySelector(
                "[data-multi-screen-canvas-world]",
              );
              const target = document
                .querySelector(`[data-frame-id="${CSS.escape(targetId)}"]`)
                ?.querySelector("[data-screen-card]");
              if (!world?.parentElement || !target) {
                return JSON.stringify({
                  intersects: false,
                  targetId,
                  availableFrameIds: Array.from(
                    document.querySelectorAll("[data-frame-id]"),
                  ).map((node) => node.getAttribute("data-frame-id")),
                });
              }
              const canvas = world.parentElement.getBoundingClientRect();
              const card = target.getBoundingClientRect();
              return JSON.stringify({
                intersects:
                  card.right > canvas.left &&
                  card.left < canvas.right &&
                  card.bottom > canvas.top &&
                  card.top < canvas.bottom,
                targetId,
                canvas: canvas.toJSON(),
                card: card.toJSON(),
                worldTransform: getComputedStyle(world).transform,
              });
            }, screenId),
          )
          .toContain('"intersects":true');
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\ncamera transforms: ${cameraTransforms.join(" | ") || "none"}`,
        );
      }
      await page.waitForTimeout(250);
      expect(
        new Set(cameraTransforms.filter(Boolean)).size,
        `camera transforms: ${cameraTransforms.join(" | ")}`,
      ).toBeLessThanOrEqual(1);
    };

    let beforeIds = await designFileIds(request, designId);
    resetCameraProbe();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+D" : "Control+D",
    );
    await expect(page.locator("[data-screen-shell]")).toHaveCount(3);
    const duplicatedId = await createdScreenId(beforeIds);
    await assertCreatedScreenSelectedVisibleWithSingleCameraCommit(
      duplicatedId,
    );
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Z" : "Control+Z",
    );
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    resetCameraProbe();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z",
    );
    await expect(page.locator("[data-screen-shell]")).toHaveCount(3);
    const redoneId = await createdScreenId(beforeIds);
    await assertCreatedScreenSelectedVisibleWithSingleCameraCommit(redoneId);

    const findEmptyCanvasPoint = async () => {
      await expect(surface).toBeVisible();
      const canvas = await surface.boundingBox();
      if (!canvas) throw new Error("missing canvas surface");
      const cards = await page
        .locator("[data-screen-card]")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const box = node.getBoundingClientRect();
            return {
              left: box.left,
              top: box.top,
              right: box.right,
              bottom: box.bottom,
            };
          }),
        );
      for (let y = canvas.y + 40; y < canvas.y + canvas.height - 180; y += 60) {
        for (
          let x = canvas.x + 40;
          x < canvas.x + canvas.width - 180;
          x += 60
        ) {
          if (
            cards.every(
              (box) =>
                x + 140 < box.left ||
                x > box.right ||
                y + 160 < box.top ||
                y > box.bottom,
            )
          ) {
            return { x, y };
          }
        }
      }
      throw new Error("no empty canvas point");
    };
    beforeIds = await designFileIds(request, designId);
    resetCameraProbe();
    await page.getByRole("button", { name: "Frame", exact: true }).click();
    const empty = await findEmptyCanvasPoint();
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x + 140, empty.y + 160, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(4);
    const drawnId = await createdScreenId(beforeIds);
    await assertCreatedScreenSelectedVisibleWithSingleCameraCommit(drawnId);

    beforeIds = await designFileIds(request, designId);
    resetCameraProbe();
    await page.getByRole("button", { name: "Frame", exact: true }).click();
    await page
      .getByRole("button", { name: /iPhone 17/ })
      .first()
      .click();
    await expect(page.locator("[data-screen-shell]")).toHaveCount(5);
    const presetId = await createdScreenId(beforeIds);
    await assertCreatedScreenSelectedVisibleWithSingleCameraCommit(presetId);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
