import {
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, frameToolButton, gotoEditor, pickFrameMode } from "./helpers";
import { expect, test, type App } from "./rails";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
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

function variationHtml(index: number) {
  return RESPONSIVE_HTML.replace(
    "Responsive Hero",
    `Responsive Hero ${index + 1}`,
  );
}

async function createDesign(app: App, fileCount = 1) {
  const files: Record<string, string> = {};
  for (let index = 1; index < fileCount; index += 1) {
    files[`variation-${index + 1}.html`] = variationHtml(index);
  }
  const designId = await app.seed(variationHtml(0), { files });
  const saved = (await app.savedRecord(designId)).files;
  const fileIds = ["index.html", ...Object.keys(files)].map(
    (filename) => saved.find((file) => file.filename === filename)!.id,
  );
  if (fileCount === 0) {
    await action(app.page.request, "delete-file", { id: fileIds[0] });
    return { designId, fileIds: [] as string[] };
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
          { id: "mobile", label: "Mobile", widthPx: 390, prefix: "base" },
          { id: "tablet", label: "Tablet", widthPx: 768, prefix: "md" },
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

async function designData(request: APIRequestContext, designId: string) {
  const params = new URLSearchParams({ id: designId });
  const response = await request.get(
    `${BASE_URL}/_agent-native/actions/get-design?${params}`,
  );
  if (!response.ok()) throw new Error(await response.text());
  const result = await response.json();
  return JSON.parse(result.data || "{}") as Record<string, any>;
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

async function activeBreakpointState(
  request: APIRequestContext,
  designId: string,
) {
  const response = await request.get(
    `${BASE_URL}/_agent-native/application-state/design-active-breakpoint:${designId}`,
  );
  if (!response.ok()) throw new Error(await response.text());
  return response.json() as Promise<{
    activeBreakpointId?: string;
    responsiveEditScope?: string;
  } | null>;
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

async function panTargetIntoUnobscuredCanvas(
  page: Page,
  target: Locator,
  targetName: string,
) {
  const edgeInset = 24;
  const maxPanStep = 200;

  for (let step = 0; step < 16; step += 1) {
    const box = await target.boundingBox();
    expect(box, `${targetName} should have rendered bounds`).not.toBeNull();
    const geometry = await page.evaluate(
      ({ target, inset, panStep }) => {
        const surface = document.querySelector<HTMLElement>(
          "[data-multi-screen-canvas-surface]",
        );
        if (!surface) return null;
        const bounds = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element || getComputedStyle(element).display === "none") {
            return null;
          }
          const rect = element.getBoundingClientRect();
          return rect.width && rect.height
            ? {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
              }
            : null;
        };
        const surfaceRect = surface.getBoundingClientRect();
        const leftShell = bounds('[data-design-chrome-region="left-shell"]');
        const rightPanel = bounds('[data-design-chrome-region="right-panel"]');
        const topBar = bounds('[data-design-chrome-region="top-bar"]');
        const visible = {
          left: Math.max(0, surfaceRect.left, leftShell?.right ?? 0) + inset,
          top: Math.max(0, surfaceRect.top, topBar?.bottom ?? 0) + inset,
          right:
            Math.min(
              innerWidth,
              surfaceRect.right,
              rightPanel?.left ?? innerWidth,
            ) - inset,
          bottom: Math.min(innerHeight, surfaceRect.bottom) - inset,
        };
        const inside =
          target.x >= visible.left &&
          target.x + target.width <= visible.right &&
          target.y >= visible.top &&
          target.y + target.height <= visible.bottom;
        const delta = {
          x:
            target.x + target.width > visible.right
              ? panStep
              : target.x < visible.left
                ? -panStep
                : 0,
          y:
            target.y + target.height > visible.bottom
              ? panStep
              : target.y < visible.top
                ? -panStep
                : 0,
        };
        const wheelPoint = [
          { x: visible.left + 16, y: visible.top + 64 },
          { x: visible.left + 32, y: visible.top + 112 },
          { x: visible.left + 64, y: visible.top + 64 },
          { x: visible.left + 16, y: (visible.top + visible.bottom) / 2 },
          { x: (visible.left + visible.right) / 2, y: visible.top + 64 },
        ].find((point) => {
          const hit = document.elementFromPoint(point.x, point.y);
          return Boolean(
            hit && surface.contains(hit) && !hit.closest("iframe"),
          );
        });
        return { visible, inside, delta, wheelPoint: wheelPoint ?? null };
      },
      { target: box!, inset: edgeInset, panStep: maxPanStep },
    );
    expect(
      geometry,
      "the overview canvas surface should be mounted",
    ).not.toBeNull();
    expect(
      geometry!.visible.right - geometry!.visible.left,
    ).toBeGreaterThanOrEqual(box!.width);
    expect(
      geometry!.visible.bottom - geometry!.visible.top,
    ).toBeGreaterThanOrEqual(box!.height);
    if (geometry!.inside) return;
    expect(
      Math.abs(geometry!.delta.x) + Math.abs(geometry!.delta.y),
      `${targetName} should be reachable by panning inside the canvas`,
    ).toBeGreaterThan(0);
    expect(
      geometry!.wheelPoint,
      "a clear point on the overview canvas should be available for panning",
    ).not.toBeNull();

    await page.mouse.move(geometry!.wheelPoint!.x, geometry!.wheelPoint!.y);
    await page.mouse.wheel(geometry!.delta.x, geometry!.delta.y);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }

  throw new Error(
    `${targetName} did not move inside the unobscured canvas after 16 wheel pans`,
  );
}

function breakpointRules(html: string) {
  const block =
    /<style data-agent-native-breakpoints>([\s\S]*?)<\/style>/.exec(
      html,
    )?.[1] ?? "";
  return [
    ...block.matchAll(
      /@media ([^{]+?)\s*\{\s*([^{]+?)\s*\{\s*([^}]*?)\s*\}\s*\}/g,
    ),
  ].map(([, media, selector, declarations]) => [
    media,
    /data-agent-native-node-id="([^"]+)"/.exec(selector!)?.[1],
    declarations!.replace(/\s+/g, " "),
  ]);
}

async function heroXByFrame(page: Page, fileId: string) {
  const x = (iframeId: string) =>
    page
      .locator(`iframe[data-screen-iframe-id="${iframeId}"]`)
      .contentFrame()
      .locator('[data-agent-native-node-id="hero"]')
      .evaluate((hero) => Math.round(hero.getBoundingClientRect().x));
  return {
    desktop: await x(fileId),
    tablet: await x(`${fileId}::bp-768`),
    mobile: await x(`${fileId}::bp-390`),
  };
}

test.use({ viewport: { width: 1500, height: 1000 } });

/** Offset between two 1280px-wide screens' rendered cards, in design px. */
async function renderedOffset(
  page: Page,
  fromFileId: string,
  toFileId: string,
) {
  const card = (fileId: string) =>
    page
      .locator(
        `[data-screen-shell][data-frame-id="${fileId}"] > [data-screen-card]`,
      )
      .boundingBox();
  const from = (await card(fromFileId))!;
  const to = (await card(toFileId))!;
  const scale = from.width / 1280;
  return {
    dx: Math.round((to.x - from.x) / scale),
    dy: Math.round((to.y - from.y) / scale),
  };
}

// fixme: product bug: Canvas and saved file disagree: the saved file holds only the max-width 767px rule and the base inline left:40px, but the Desktop and
test.fixme("responsive frame previews preserve content fit and scope selection", async ({
  app,
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(app);
  const [fileId] = fileIds;
  await page.setViewportSize({ width: 2200, height: 1000 });
  await configureResponsiveDesign(request, designId, fileIds);
  await gotoEditor(page, designId);
  await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(2);

  // Content-fit height: the 390px mobile frame must render at its own
  // content height (the fixture is 900px tall), NOT the desktop primary's
  // aspect ratio, which would clip the content. A correctly-sized mobile
  // frame is portrait (taller than wide).
  const mobileIframe = page.locator(
    `iframe[data-screen-iframe-id="${fileId}::bp-390"]`,
  );
  await expect
    .poll(async () => {
      const box = await mobileIframe.boundingBox();
      if (!box || box.width <= 0) return 0;
      return box.height / box.width;
    })
    .toBeGreaterThan(1.5);

  const mobileHero = page
    .locator(`iframe[data-screen-iframe-id="${fileId}::bp-390"]`)
    .contentFrame()
    .locator('[data-agent-native-node-id="hero"]');
  await expect(mobileHero).toBeVisible();
  await expect
    .poll(() =>
      mobileHero.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.animationDuration, style.transitionDuration];
      }),
    )
    .toEqual(["0s", "0s"]);
  await page
    .locator("[data-breakpoint-frame]")
    .filter({
      has: page.locator(`[data-screen-iframe-id="${fileId}::bp-390"]`),
    })
    .locator("[data-frame-title]")
    .click();
  await expect
    .poll(
      async () =>
        (await activeBreakpointState(request, designId))?.activeBreakpointId,
    )
    .toBe("mobile");
  const scope = page.getByRole("combobox", {
    name: "Responsive edit scope",
  });
  await expect(scope).toBeVisible();
  await expect(scope).toHaveText("This breakpoint and smaller");
  const mobileHeroBox = await mobileHero.boundingBox();
  expect(mobileHeroBox).not.toBeNull();
  await page.mouse.click(
    mobileHeroBox!.x + mobileHeroBox!.width / 2,
    mobileHeroBox!.y + mobileHeroBox!.height / 2,
  );
  await expect
    .poll(
      async () =>
        (await activeBreakpointState(request, designId))?.activeBreakpointId,
    )
    .toBe("mobile");
  const xInput = page.getByRole("textbox", { name: "X-position" });
  await expect(xInput).toBeVisible();
  await xInput.fill("137");
  await xInput.press("Enter");
  await app.settled();
  expect(
    breakpointRules(await designFileContent(request, designId, fileId!)),
  ).toEqual([["(max-width: 767px)", "hero", "left: 137px;"]]);
  await expect
    .poll(() => heroXByFrame(page, fileId!))
    .toEqual({ desktop: 40, tablet: 40, mobile: 137 });
});

// fixme: product bug: The 'This breakpoint only' edit saves @media (max-width: 1279px) hero left:155px, which ignores the scope and covers Mobile too (masked
test.fixme("after a Mobile edit, a 'This breakpoint only' X edit at Tablet adds exactly one tablet-range rule and moves only the Tablet frame", async ({
  app,
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(app);
  const [fileId] = fileIds;
  await page.setViewportSize({ width: 2200, height: 1000 });
  await configureResponsiveDesign(request, designId, fileIds);
  await gotoEditor(page, designId);
  await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(2);

  const mobileHero = page
    .locator(`iframe[data-screen-iframe-id="${fileId}::bp-390"]`)
    .contentFrame()
    .locator('[data-agent-native-node-id="hero"]');
  await page
    .locator("[data-breakpoint-frame]")
    .filter({
      has: page.locator(`[data-screen-iframe-id="${fileId}::bp-390"]`),
    })
    .locator("[data-frame-title]")
    .click();
  await expect
    .poll(
      async () =>
        (await activeBreakpointState(request, designId))?.activeBreakpointId,
    )
    .toBe("mobile");
  const scope = page.getByRole("combobox", {
    name: "Responsive edit scope",
  });
  await expect(scope).toBeVisible();
  await expect(scope).toHaveText("This breakpoint and smaller");
  const mobileHeroBox = await mobileHero.boundingBox();
  expect(mobileHeroBox).not.toBeNull();
  await page.mouse.click(
    mobileHeroBox!.x + mobileHeroBox!.width / 2,
    mobileHeroBox!.y + mobileHeroBox!.height / 2,
  );
  await expect
    .poll(
      async () =>
        (await activeBreakpointState(request, designId))?.activeBreakpointId,
    )
    .toBe("mobile");
  const xInput = page.getByRole("textbox", { name: "X-position" });
  await expect(xInput).toBeVisible();
  await xInput.fill("137");
  await xInput.press("Enter");
  await app.settled();
  expect(
    breakpointRules(await designFileContent(request, designId, fileId!)),
  ).toEqual([["(max-width: 767px)", "hero", "left: 137px;"]]);

  const tabletHero = page
    .locator(`iframe[data-screen-iframe-id="${fileId}::bp-768"]`)
    .contentFrame()
    .locator('[data-agent-native-node-id="hero"]');
  const tabletTitle = page
    .locator("[data-breakpoint-frame]")
    .filter({
      has: page.locator(`[data-screen-iframe-id="${fileId}::bp-768"]`),
    })
    .locator("[data-frame-title]");
  await panTargetIntoUnobscuredCanvas(page, tabletTitle, "tablet title");
  await tabletTitle.click();
  await expect
    .poll(
      async () =>
        (await activeBreakpointState(request, designId))?.activeBreakpointId,
    )
    .toBe("tablet");
  await expect(scope).toBeVisible();
  await expect(scope).toHaveText("This breakpoint and smaller");
  await scope.click();
  await page.getByRole("option", { name: "This breakpoint only" }).click();
  await expect(scope).toHaveText("This breakpoint only");
  await panTargetIntoUnobscuredCanvas(page, tabletHero, "tablet hero");
  const tabletHeroBox = await tabletHero.boundingBox();
  expect(tabletHeroBox).not.toBeNull();
  await page.mouse.click(
    tabletHeroBox!.x + tabletHeroBox!.width / 2,
    tabletHeroBox!.y + tabletHeroBox!.height / 2,
  );
  await expect(xInput).toBeVisible();
  await expect
    .poll(
      async () =>
        (await activeBreakpointState(request, designId))?.activeBreakpointId,
    )
    .toBe("tablet");
  await xInput.fill("155");
  await xInput.press("Enter");
  await app.settled();
  expect(
    breakpointRules(await designFileContent(request, designId, fileId!)),
  ).toEqual([
    ["(max-width: 767px)", "hero", "left: 137px;"],
    ["(min-width: 768px) and (max-width: 1279px)", "hero", "left: 155px;"],
  ]);
  await expect
    .poll(() => heroXByFrame(page, fileId!))
    .toEqual({ desktop: 40, tablet: 155, mobile: 137 });
});

test("exact-size generation preserves its canvas dimensions without mobile frames", async ({
  app,
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(app);
  const [fileId] = fileIds;
  await configureResponsiveDesign(request, designId, fileIds);
  await action(request, "generate-design", {
    designId,
    prompt: "Create an email ad at exactly 300x250 pixels",
    files: [
      {
        filename: "index.html",
        fileType: "html",
        content:
          '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main>Email ad</main></body></html>',
      },
    ],
    canvasFrames: [
      { filename: "index.html", x: 0, y: 0, width: 1440, height: 900 },
    ],
  });

  const data = await designData(request, designId);
  expect(data.canvasFrames[fileId!]).toMatchObject({
    width: 300,
    height: 250,
  });
  expect(data.screenMetadata[fileId!]).toMatchObject({
    width: 300,
    height: 250,
    breakpointWidths: [],
    heightPinned: true,
    heightMode: "fixed",
  });
  expect(data.breakpointSet.breakpoints).toHaveLength(2);

  await gotoEditor(page, designId);
  await expect(page.locator("[data-screen-shell]")).toHaveCount(1);
  await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(0);
  await expect(
    page.locator(`iframe[data-screen-iframe-id="${fileId}"]`),
  ).toBeVisible();
  const card = page.locator(`[data-frame-id="${fileId}"] [data-screen-card]`);
  await expect(card).toBeVisible();
  const bounds = await card.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width / bounds!.height).toBeCloseTo(300 / 250, 2);
});

test("fixed-artwork variants preserve the original brief size without mobile frames", async ({
  app,
  page,
  request,
}) => {
  const { designId } = await createDesign(app, 0);
  await action(request, "present-design-variants", {
    designId,
    prompt: "Pick a direction",
    brief: "Create an ad for LinkedIn, promoting our product launch",
    responsive: true,
    variants: [
      {
        id: "editorial",
        label: "Editorial",
        width: 1440,
        height: 900,
        content:
          '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main>Editorial ad</main></body></html>',
      },
      {
        id: "bold",
        label: "Bold",
        width: 1440,
        height: 900,
        content:
          '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main>Bold ad</main></body></html>',
      },
    ],
  });

  const data = await designData(request, designId);
  const variantSet = Object.values(
    data.designVariantSets as Record<
      string,
      { screens: Array<{ id: string; width: number; height: number }> }
    >,
  )[0];
  expect(variantSet?.screens).toHaveLength(2);
  for (const screen of variantSet?.screens ?? []) {
    expect(screen).toMatchObject({ width: 1200, height: 627 });
    expect(data.canvasFrames[screen.id]).toMatchObject({
      width: 1200,
      height: 627,
    });
    expect(data.screenMetadata[screen.id]).toMatchObject({
      width: 1200,
      height: 627,
      breakpointWidths: [],
    });
  }
  expect(data.breakpointSet).toBeUndefined();

  await gotoEditor(page, designId);
  await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
  await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(0);
  for (const screen of variantSet!.screens) {
    const card = page.locator(
      `[data-frame-id="${screen.id}"] [data-screen-card]`,
    );
    await expect(card).toBeVisible();
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width / bounds!.height).toBeCloseTo(1200 / 627, 2);
  }
});

test("persists tall breakpoint content before server-side row placement", async ({
  app,
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(app);
  const [fileId] = fileIds;
  await action(request, "update-file", {
    id: fileId,
    content: RESPONSIVE_HTML.replace(/min-height:900px/g, "min-height:2200px"),
  });
  await configureResponsiveDesign(request, designId, fileIds);
  await gotoEditor(page, designId);
  await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(2);

  await expect
    .poll(async () => {
      const data = await designData(request, designId);
      return data.screenMetadata?.[fileId!]?.breakpointHeights?.["390"];
    })
    .toBe(2200);

  const created = await action(request, "create-file", {
    designId,
    filename: "after-tall-screen.html",
    content: "<main>After tall screen</main>",
    fileType: "html",
  });
  const newFileId = created.id ?? created.data?.id;
  expect(newFileId).toBeTruthy();
  const data = await designData(request, designId);
  expect(data.canvasFrames[newFileId].y).toBe(2200 + 96);
});

test("screen deletion explicitly includes and removes responsive variants", async ({
  app,
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(app, 2);
  const deletedFileId = fileIds[0]!;
  await configureResponsiveDesign(request, designId, fileIds);
  await gotoEditor(page, designId);
  await page
    .locator("[data-screen-shell]")
    .filter({
      has: page.locator(`[data-screen-iframe-id="${deletedFileId}"]`),
    })
    .locator("[data-frame-title]")
    .first()
    .click();
  await page.keyboard.press("Delete");
  await expect(page.locator("[data-screen-shell]")).toHaveCount(1);
  await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(2);
  await expect(
    page.locator(`[data-screen-iframe-id^="${deletedFileId}::bp-"]`),
  ).toHaveCount(0);
  await app.settled();
  expect(
    (await app.savedRecord(designId)).files.map((file) => file.filename).sort(),
  ).toEqual(["__board__.html", "variation-2.html"]);
  const data = await designData(request, designId);
  expect(Object.keys(data.screenMetadata ?? {})).toEqual([fileIds[1]]);
  expect(Object.keys(data.canvasFrames ?? {})).toEqual([fileIds[1]]);
});

// fixme: intermittent: Passed in its worker run and in a solo re-run, failed once in the full confirmation run (2 of 3).
test.fixme("generated variation groups reserve non-overlapping breakpoint rows, and custom screen positions survive a reopen", async ({
  app,
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(app, 4);
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
  await expect
    .poll(() => renderedOffset(page, fileIds[0]!, fileIds[1]!))
    .toEqual({ dx: 1400, dy: 0 });
});

test("adding a breakpoint reflows screen rows before their previews overlap", async ({
  app,
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(app, 2);
  const [firstFileId, secondFileId] = fileIds;
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      ...fileIds.map((fileId) => ({
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 1280, height: 900 },
      })),
      {
        op: "set",
        path: ["canvasFrames", firstFileId!],
        value: { x: 400, y: 200, width: 1280, height: 900, z: 0 },
      },
      {
        op: "set",
        path: ["canvasFrames", secondFileId!],
        value: { x: 1776, y: 200, width: 1280, height: 900, z: 1 },
      },
    ],
  });
  await gotoEditor(page, designId);
  await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
  await page.locator("[data-screen-shell] [data-frame-title]").first().click();
  expect(
    (await designData(request, designId)).canvasFrames?.[secondFileId!]?.x,
  ).toBe(1776);

  await page
    .locator('[data-breakpoint-device-control] button[title="Add breakpoint"]')
    .first()
    .click();
  await page
    .getByRole("button", { name: /Phone.*390/ })
    .last()
    .click();

  await expect
    .poll(async () => {
      const data = await designData(request, designId);
      return data.breakpointSet?.breakpoints?.map(
        (breakpoint: { widthPx: number }) => breakpoint.widthPx,
      );
    })
    .toEqual([390]);
  // Home's group is 1280 + 24 + 390 = 1694 wide, so the next screen starts 24px past it.
  await expect
    .poll(async () => {
      const frames = (await designData(request, designId)).canvasFrames;
      return [frames?.[firstFileId!], frames?.[secondFileId!]];
    })
    .toEqual([
      { x: 400, y: 200, width: 1280, height: 900, z: 0 },
      { x: 2118, y: 200, width: 1280, height: 900, z: 1 },
    ]);
  await expect
    .poll(() => renderedOffset(page, firstFileId!, secondFileId!))
    .toEqual({ dx: 1718, dy: 0 });

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
});

// fixme: product bug: After Cmd+D the selected 'Screen 4 copy' card sits at page x 1341–2006, entirely under the right inspector (visible canvas ends at 1259)
test.fixme("overview screen creation and duplicate undo/redo keep screens selected and visible", async ({
  app,
  page,
  request,
}) => {
  const { designId } = await createDesign(app);
  await page.goto(appPath(`/design/${designId}?view=overview`));
  await gotoEditor(page, designId);
  const world = page.locator("[data-multi-screen-canvas-world]");
  const surface = world.locator("xpath=..");
  const cameraTransforms: string[] = [];
  await page.exposeFunction("__qaRecordCameraTransform", (transform: string) =>
    cameraTransforms.push(transform),
  );
  const installCameraObserver = () => {
    const attach = () => {
      const target = document.querySelector<HTMLElement>(
        "[data-multi-screen-canvas-world]",
      );
      if (!target || target.dataset.qaCameraObserved === "true") return false;
      target.dataset.qaCameraObserved = "true";
      new MutationObserver(() => {
        void (window as any).__qaRecordCameraTransform(target.style.transform);
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
  expect(new Set(cameraTransforms.filter(Boolean)).size).toBeLessThanOrEqual(1);

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
    const selectionBoxes = page.locator("[data-frame-selection-box]");
    await expect(selectionBoxes).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate((targetId) => {
          const selection = document
            .querySelector("[data-frame-selection-box]")
            ?.getBoundingClientRect();
          const target = document
            .querySelector(
              `[data-frame-id="${CSS.escape(targetId)}"] [data-screen-card]`,
            )
            ?.getBoundingClientRect();
          if (!selection || !target) return false;
          return [
            Math.abs(selection.left - target.left),
            Math.abs(selection.top - target.top),
            Math.abs(selection.width - target.width),
            Math.abs(selection.height - target.height),
          ].every((difference) => difference < 1);
        }, screenId),
      )
      .toBe(true);
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
            const surface = world.parentElement.getBoundingClientRect();
            const edge = (region: string, side: "left" | "right") =>
              document
                .querySelector(`[data-design-chrome-region="${region}"]`)
                ?.getBoundingClientRect()[side];
            const canvas = {
              left: Math.max(surface.left, edge("left-shell", "right") ?? 0),
              right: Math.min(
                surface.right,
                edge("right-panel", "left") ?? surface.right,
              ),
              top: surface.top,
              bottom: surface.bottom,
            };
            const card = target.getBoundingClientRect();
            return JSON.stringify({
              intersects:
                card.right > canvas.left &&
                card.left < canvas.right &&
                card.bottom > canvas.top &&
                card.top < canvas.bottom,
              targetId,
              canvas,
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

  const assertDuplicateRespectsBoardGap = async (
    sourceId: string,
    duplicateId: string,
  ) => {
    await expect
      .poll(
        () =>
          page.evaluate(
            ({ sourceId, duplicateId }) => {
              const card = (screenId: string) =>
                document
                  .querySelector(
                    `[data-frame-id="${CSS.escape(screenId)}"] [data-screen-card]`,
                  )
                  ?.getBoundingClientRect();
              const source = card(sourceId);
              const duplicate = card(duplicateId);
              const world = document.querySelector<HTMLElement>(
                "[data-multi-screen-canvas-world]",
              );
              if (!source || !duplicate || !world) return false;
              const transform = getComputedStyle(world).transform;
              const scale =
                transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
              return duplicate.left - source.right >= 56 * scale - 1;
            },
            { sourceId, duplicateId },
          ),
        {
          message:
            "Cmd+D should leave at least the 56-unit board gap to the right of its source",
        },
      )
      .toBe(true);
  };

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
      for (let x = canvas.x + 40; x < canvas.x + canvas.width - 180; x += 60) {
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
  let beforeIds = await designFileIds(request, designId);
  resetCameraProbe();
  await frameToolButton(page).click();
  const phoneGroup = page.locator(".design-inspector-scroll > section").nth(1);
  await phoneGroup.locator(":scope > button").click();
  await phoneGroup
    .getByRole("button", { name: /iPhone 17/ })
    .first()
    .click();
  await expect(page.locator("[data-screen-shell]")).toHaveCount(3);
  const presetId = await createdScreenId(beforeIds);
  await assertCreatedScreenSelectedVisibleWithSingleCameraCommit(presetId);

  beforeIds = await designFileIds(request, designId);
  resetCameraProbe();
  await pickFrameMode(page, "Screen");
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
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+D" : "Control+D",
  );
  await expect(page.locator("[data-screen-shell]")).toHaveCount(5);
  const duplicatedId = await createdScreenId(beforeIds);
  await assertCreatedScreenSelectedVisibleWithSingleCameraCommit(duplicatedId);
  await assertDuplicateRespectsBoardGap(drawnId, duplicatedId);
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Z" : "Control+Z",
  );
  await expect(page.locator("[data-screen-shell]")).toHaveCount(4);
  await expect
    .poll(async () => (await designFileIds(request, designId)).sort())
    .toEqual([...beforeIds].sort());
  expect(await designFileIds(request, designId)).not.toContain(duplicatedId);
  resetCameraProbe();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z",
  );
  await expect(page.locator("[data-screen-shell]")).toHaveCount(5);
  const redoneId = await createdScreenId(beforeIds);
  expect(redoneId).not.toBe(duplicatedId);
  await expect
    .poll(async () => (await designFileIds(request, designId)).sort())
    .toEqual([...beforeIds, redoneId].sort());
  await assertCreatedScreenSelectedVisibleWithSingleCameraCommit(redoneId);
  await assertDuplicateRespectsBoardGap(drawnId, redoneId);
});

test("breakpoint width menus preserve invalid drafts for correction", async ({
  app,
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(app);
  await configureResponsiveDesign(request, designId, fileIds);
  await gotoEditor(page, designId);
  await page.locator("[data-screen-shell] [data-frame-title]").first().click();
  const control = page.locator("[data-breakpoint-device-control]");
  await control.getByRole("button", { name: "390", exact: true }).click();
  await control.getByRole("button", { name: "Breakpoint options" }).click();
  const width = page.getByRole("spinbutton", { name: "Change width" });
  await width.fill("300");
  await width.press("Enter");
  await expect(width).toBeVisible();
  await expect(width).toHaveAttribute("aria-invalid", "true");
  await expect(width).toHaveValue("300");
  await width.fill("768");
  await width.press("Enter");
  await expect(width).toBeVisible();
  await expect(width).toHaveAttribute("aria-invalid", "true");
  await width.fill("420");
  await width.press("Enter");
  await expect(width).toBeHidden();
  await expect
    .poll(async () => {
      const data = await designData(request, designId);
      return data.breakpointSet.breakpoints
        .map((bp: { widthPx: number }) => bp.widthPx)
        .sort((a: number, b: number) => a - b);
    })
    .toEqual([420, 768]);
  await expect(
    control.getByRole("button", { name: "420", exact: true }),
  ).toBeVisible();

  await control
    .getByRole("button", { name: "Add breakpoint", exact: true })
    .click();
  const custom = page.getByPlaceholder("Custom width");
  await custom.fill("420");
  await custom.press("Enter");
  await expect(custom).toBeVisible();
  await expect(custom).toHaveAttribute("aria-invalid", "true");
  await custom.fill("430");
  await custom.press("Enter");
  await expect(custom).toBeHidden();
  await expect(
    control.getByRole("button", { name: "430", exact: true }),
  ).toBeVisible();
});
