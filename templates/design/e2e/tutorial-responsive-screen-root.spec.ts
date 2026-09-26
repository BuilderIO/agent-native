import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  cdpScreenshot,
  createFixtureDesign,
  designFrame,
  gotoEditor,
  pickFrameMode,
} from "./helpers";

type DesignRecord = {
  data?: unknown;
  files?: Array<{ id: string; content?: string }>;
};

function designData(record: DesignRecord): Record<string, any> {
  return typeof record.data === "string"
    ? JSON.parse(record.data || "{}")
    : ((record.data ?? {}) as Record<string, any>);
}

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

async function readScreenHtml(page: Page, designId: string, screenId: string) {
  const record = await readDesign(page, designId);
  return record.files?.find((file) => file.id === screenId)?.content ?? "";
}

async function readScreenGeometry(
  page: Page,
  designId: string,
  screenId: string,
) {
  const record = await readDesign(page, designId);
  const data = designData(record);
  return {
    canvasFrame: data.canvasFrames?.[screenId],
    metadata: data.screenMetadata?.[screenId],
  };
}

async function screenCheckpoint(
  page: Page,
  designId: string,
  screenId: string,
) {
  const shell = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"]`,
  );
  // [data-frame-title] is a flex-1 span whose hit box can stretch well past
  // its short visible text (e.g. "Screen 2") toward frame center — where a
  // selected screen's always-visible "Interact" button (data-frame-full-view,
  // MultiScreenCanvas.tsx) sits. A default center click lands on that empty
  // stretch and hits the button instead, so click inside the actual glyphs.
  await shell.locator("[data-frame-title]").click({ position: { x: 4, y: 4 } });
  const width = page.getByRole("textbox", {
    name: /^W(?: size in pixels)?$/,
  });
  const heightValue = page.getByRole("textbox", {
    name: /^H(?: size in pixels)?$/,
  });
  const height = page.getByRole("button", {
    name: /^H sizing mode — (?:Fixed|Hug|Auto)$/,
  });
  const screenCard = shell.locator("[data-screen-card]");
  const rendered = await screenCard.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      styleWidth: style.width,
      styleHeight: style.height,
      boundsWidth: rect.width,
      boundsHeight: rect.height,
    };
  });
  const contentBounds = await designFrame(page, screenId)
    .locator("body")
    .evaluate((body) => {
      const documentElement = body.ownerDocument.documentElement;
      const bodyStyle = getComputedStyle(body);
      const rect = body.getBoundingClientRect();
      return {
        viewportWidth: body.ownerDocument.defaultView?.innerWidth ?? 0,
        viewportHeight: body.ownerDocument.defaultView?.innerHeight ?? 0,
        clientWidth: documentElement.clientWidth,
        clientHeight: documentElement.clientHeight,
        scrollHeight: documentElement.scrollHeight,
        bodyWidth: bodyStyle.width,
        bodyHeight: bodyStyle.height,
        bodyBoundsWidth: rect.width,
        bodyBoundsHeight: rect.height,
      };
    });
  return {
    screenId,
    saved: await readScreenGeometry(page, designId, screenId),
    inspector: {
      width: await width.inputValue(),
      height: await height.getAttribute("aria-label"),
      heightValue: await heightValue.inputValue(),
    },
    rendered,
    contentBounds,
  };
}

async function emptyBoardPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-card]"),
    ).map((element) => element.getBoundingClientRect());
    for (let y = rect.top + 60; y < rect.bottom - 60; y += 40) {
      for (let x = rect.left + 60; x < rect.right - 60; x += 40) {
        if (
          cards.some(
            (card) =>
              x >= card.left - 24 &&
              x <= card.right + 24 &&
              y >= card.top - 24 &&
              y <= card.bottom + 24,
          )
        ) {
          continue;
        }
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty canvas point found");
  return point;
}

type HmrSignal = { type: string; at: number };

function hmrSignals(page: Page) {
  return (page as Page & { hmrUpdates: HmrSignal[] }).hmrUpdates;
}

function reportTutorialCheckpoint(page: Page, label: string) {
  console.log("tutorial-checkpoint", {
    label,
    at: Date.now(),
    hmrUpdates: [...hmrSignals(page)],
  });
}

test.beforeEach(async ({ page }) => {
  const updates: HmrSignal[] = [];
  const targetHost = new URL(e2eBaseURL()).host;
  page.on("websocket", (socket) => {
    if (!socket.url().includes(targetHost)) return;
    socket.on("framereceived", (event) => {
      try {
        const message = JSON.parse(String(event.payload));
        if (["update", "full-reload"].includes(message.type)) {
          updates.push({ type: message.type, at: Date.now() });
        }
      } catch {
        // Vite sends non-JSON frames for heartbeat and connection control.
      }
    });
  });
  (page as typeof page & { hmrUpdates: HmrSignal[] }).hmrUpdates = updates;
});

test.afterEach(async ({ page }) => {
  expect(hmrSignals(page), "No Vite HMR during the UI tutorial proof").toEqual(
    [],
  );
});

test("a Screen-root responsive card uses UI-created children and auto layout", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const designId = await createFixtureDesign(
    page,
    `Screen-root responsive card ${Date.now()}`,
  );
  let completed = false;
  try {
    await gotoEditor(page, designId);
    const initial = await readDesign(page, designId);
    const beforeIds = new Set(initial.files?.map((file) => file.id));

    await pickFrameMode(page, "Screen");
    const from = await emptyBoardPoint(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 190, from.y + 150, { steps: 16 });
    await page.mouse.up();

    let screenId = "";
    await expect
      .poll(async () => {
        const record = await readDesign(page, designId);
        const screen = record.files?.find((file) => !beforeIds.has(file.id));
        if (!screen) return null;
        screenId = screen.id;
        return screen.id;
      })
      .not.toBeNull();

    const screenShell = page.locator(
      `[data-screen-shell][data-frame-id="${screenId}"]`,
    );
    await screenShell.locator("[data-frame-title]").click();
    const width = page.getByRole("textbox", {
      name: /^W(?: size in pixels)?$/,
    });
    const height = page.getByRole("textbox", {
      name: /^H(?: size in pixels)?$/,
    });
    await width.fill("360");
    await width.press("Enter");
    console.log("after-screen-width", {
      screenId,
      geometry: await readScreenGeometry(page, designId, screenId),
      inspectorWidth: await width.inputValue(),
      rendered: await screenShell
        .locator("[data-screen-card]")
        .evaluate((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return { width: style.width, boundsWidth: rect.width };
        }),
    });
    await height.fill("315");
    await height.press("Enter");
    console.log("after-screen-height", {
      screenId,
      geometry: await readScreenGeometry(page, designId, screenId),
      inspectorWidth: await width.inputValue(),
      inspectorHeight: await height.inputValue(),
    });
    await expect
      .poll(async () => {
        const { canvasFrame, metadata } = await readScreenGeometry(
          page,
          designId,
          screenId,
        );
        return [
          canvasFrame?.width,
          canvasFrame?.height,
          metadata?.width,
          metadata?.height,
        ];
      })
      .toEqual([360, 315, 360, 315]);
    reportTutorialCheckpoint(page, "screen-size-360x315");

    await page.keyboard.press("Shift+a");
    const layoutHeading = page.getByRole("heading", {
      name: "Auto layout",
      exact: true,
    });
    const layout = layoutHeading.locator("xpath=ancestor::section");
    await expect(layoutHeading).toBeVisible();
    await layout.getByRole("button", { name: "Vertical", exact: true }).click();
    await layout.getByRole("textbox", { name: "Gap", exact: true }).fill("12");
    await layout
      .getByRole("textbox", { name: "Gap", exact: true })
      .press("Enter");
    // Exact match: PR #5824 added a "Left margin / Right margin" row to the
    // same Auto layout section, and the old /Left.*Right/ regex matched it
    // too (both share the literal substring), so a loose match here resolves
    // to two textboxes instead of the padding row alone.
    const horizontalPadding = layout.getByRole("textbox", {
      name: "Left / Right",
      exact: true,
    });
    await horizontalPadding.fill("12");
    await horizontalPadding.press("Enter");
    const verticalPadding = layout.getByRole("textbox", {
      name: "Top / Bottom",
      exact: true,
    });
    await verticalPadding.fill("12");
    await verticalPadding.press("Enter");
    await expect(page.locator('[data-flow-value="vertical"]')).toBeVisible();
    await expect
      .poll(async () => {
        const html = await readScreenHtml(page, designId, screenId);
        return /display:\s*flex/i.test(html) && /gap:\s*12px/i.test(html);
      })
      .toBe(true);
    console.log(
      "after-screen-layout",
      await screenCheckpoint(page, designId, screenId),
    );
    reportTutorialCheckpoint(page, "screen-auto-layout-padding-gap");

    const body = designFrame(page, screenId).locator("body");
    const bodyBox = await body.boundingBox();
    if (!bodyBox) throw new Error("Screen-root body has no rendered bounds");
    const screenCard = screenShell.locator("[data-screen-card]");
    const cardBox = await screenCard.boundingBox();
    if (!cardBox) throw new Error("Screen card has no rendered bounds");
    const scale = cardBox.width / 360;
    const startX = bodyBox.x;
    const startY = bodyBox.y;
    await page.keyboard.press("r");
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 64 * scale, startY + 42 * scale, {
      steps: 8,
    });
    await page.mouse.up();
    await expect
      .poll(async () =>
        (await readScreenHtml(page, designId, screenId)).includes(
          'data-agent-native-layer-name="Rectangle"',
        ),
      )
      .toBe(true);
    console.log(
      "after-art-draw",
      await screenCheckpoint(page, designId, screenId),
    );
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { name: /^Rectangle / })
      .getByRole("button", { name: "Rectangle", exact: true })
      .click();

    const absolutePosition = page.getByRole("button", {
      name: "Absolute position",
      exact: true,
    });
    // Figma adds a newly drawn child to an auto-layout frame's flow. Toggle
    // ignore-auto-layout on and off to cover both states explicitly.
    await expect(absolutePosition).toHaveAttribute("aria-pressed", "false");
    await absolutePosition.click();
    await expect(absolutePosition).toHaveAttribute("aria-pressed", "true");
    await absolutePosition.click();
    await expect(absolutePosition).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(async () => {
        const html = await readScreenHtml(page, designId, screenId);
        return /position:\s*relative/i.test(html);
      })
      .toBe(true);
    console.log(
      "after-art-flow",
      await screenCheckpoint(page, designId, screenId),
    );
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { name: /^Rectangle / })
      .getByRole("button", { name: "Rectangle", exact: true })
      .click();

    const artWidth = page.getByRole("textbox", {
      name: /^W(?: size in pixels)?$/,
    });
    const artHeight = page.getByRole("textbox", {
      name: /^H(?: size in pixels)?$/,
    });
    await expect(artWidth).toBeVisible();
    await artWidth.fill("336");
    await artWidth.press("Enter");
    await artHeight.fill("240");
    await artHeight.press("Enter");
    await expect
      .poll(async () => {
        const html = await readScreenHtml(page, designId, screenId);
        return /width:\s*336px/i.test(html) && /height:\s*240px/i.test(html);
      })
      .toBe(true);
    console.log(
      "after-art-fixed-size",
      await screenCheckpoint(page, designId, screenId),
    );
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { name: /^Rectangle / })
      .getByRole("button", { name: "Rectangle", exact: true })
      .click();
    await page
      .getByRole("button", { name: "W sizing mode — Fixed", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Fill container" }).click();
    await expect
      .poll(async () => {
        const html = await readScreenHtml(page, designId, screenId);
        return (
          /width:\s*auto/i.test(html) && /align-self:\s*stretch/i.test(html)
        );
      })
      .toBe(true);
    console.log(
      "after-art-fill-sizing",
      await screenCheckpoint(page, designId, screenId),
    );
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { name: /^Rectangle / })
      .getByRole("button", { name: "Rectangle", exact: true })
      .click();

    const imagePicker = page.getByRole("button", {
      name: "Open color picker",
    });
    await imagePicker.last().click();
    await page.getByRole("button", { name: "Image", exact: true }).click();
    await page.getByRole("button", { name: "Upload image" }).click();
    await page
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles(
        path.resolve(
          import.meta.dirname,
          "fixtures/responsive-card-art-photo.png",
        ),
      );
    await page.keyboard.press("Escape");
    const fillDialog = page.getByRole("dialog");
    if (await fillDialog.isVisible()) {
      await page.getByRole("heading", { name: "Layers" }).click();
    }
    await expect(fillDialog).toBeHidden();
    console.log(
      "after-art-fill",
      await screenCheckpoint(page, designId, screenId),
    );

    await expect
      .poll(async () => {
        const content = await readScreenHtml(page, designId, screenId);
        return content.includes("/api/qa-figma-import-assets/");
      })
      .toBe(true);
    reportTutorialCheckpoint(page, "album-art-uploaded");
    await cdpScreenshot(
      page,
      test.info().outputPath("screen-root-responsive-card-stage1.png"),
    );

    const bodyBounds = await body.boundingBox();
    const cardBounds = await screenCard.boundingBox();
    if (!bodyBounds || !cardBounds) {
      throw new Error("responsive card body lost its rendered bounds");
    }
    const cardScale = cardBounds.width / 360;
    const addText = async (value: string, offsetY: number) => {
      await page.keyboard.press("t");
      await expect(
        page.locator('button[aria-label="Text"]').first(),
      ).toHaveAttribute("aria-pressed", "true");
      await page.mouse.click(
        bodyBounds.x + 12 * cardScale,
        bodyBounds.y + offsetY * cardScale,
      );
      await expect
        .poll(async () =>
          page
            .locator("iframe[data-design-preview-iframe]")
            .evaluateAll((iframes) =>
              iframes.reduce((count, iframe) => {
                const frame = iframe as HTMLIFrameElement;
                return (
                  count +
                  (frame.contentDocument?.querySelectorAll(
                    "[data-agent-native-text-editing]",
                  ).length ?? 0)
                );
              }, 0),
            ),
        )
        .toBeGreaterThan(0);
      await page.keyboard.type(value, { delay: 40 });
      await page.keyboard.press("Escape");
      await expect
        .poll(async () =>
          (await readScreenHtml(page, designId, screenId)).includes(value),
        )
        .toBe(true);
    };
    await addText("The Summer Mix", 264);
    await addText("Calypso Radio", 286);
    console.log(
      "after-card-text",
      await screenCheckpoint(page, designId, screenId),
      await readScreenHtml(page, designId, screenId),
    );
    reportTutorialCheckpoint(page, "title-and-creator-created");

    const layerRows = page.getByRole("tree", { name: "Layers" });
    const textRow = (name: string) =>
      layerRows
        .locator("[data-layer-row-button]")
        .filter({ hasText: name })
        .first();
    await textRow("The Summer Mix").click();
    await textRow("Calypso Radio").click({ modifiers: ["Shift"] });
    console.log(
      "metadata-selection",
      await page
        .getByRole("tree", { name: "Layers" })
        .locator('[role="treeitem"]')
        .evaluateAll((items) =>
          items.map((item) => ({
            text: item.textContent?.replace(/\\s+/g, " ").trim(),
            selected: item.getAttribute("aria-selected"),
            id: item.getAttribute("data-node-id"),
          })),
        ),
    );
    await page.keyboard.press("Shift+a");
    const metadataLayoutHeading = page.getByRole("heading", {
      name: "Auto layout",
      exact: true,
    });
    await expect(metadataLayoutHeading).toBeVisible();
    const metadataLayout = metadataLayoutHeading.locator(
      "xpath=ancestor::section",
    );
    await metadataLayout
      .getByRole("button", { name: "Vertical", exact: true })
      .click();
    await metadataLayout
      .getByRole("textbox", { name: "Gap", exact: true })
      .fill("4");
    await metadataLayout
      .getByRole("textbox", { name: "Gap", exact: true })
      .press("Enter");
    const flow = page.getByRole("button", {
      name: "Absolute position",
      exact: true,
    });
    const flowStartedAt = Date.now();
    // These text layers were created inside the Screen's auto-layout flow,
    // so they already participate in it when selected together.
    await expect(flow).toBeVisible();
    await expect(flow).toHaveAttribute("aria-pressed", "false");
    await flow.click();
    await expect(flow).toHaveAttribute("aria-pressed", "true");
    await flow.click();
    await expect(flow).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(async () => {
        const html = await readScreenHtml(page, designId, screenId);
        return /position:\s*relative/i.test(html);
      })
      .toBe(true);
    const flowFinishedAt = Date.now();
    console.log("metadata-flow-toggle-interval", {
      startedAt: flowStartedAt,
      finishedAt: flowFinishedAt,
      hmrDuringStep: hmrSignals(page).filter(
        (signal) => signal.at >= flowStartedAt && signal.at <= flowFinishedAt,
      ),
    });
    const groupWidthMode = page.getByRole("button", {
      name: /^(?:W sizing mode —|W \d)/,
    });
    await groupWidthMode.click();
    await page.getByRole("menuitem", { name: "Fill container" }).click();
    console.log(
      "after-metadata-auto-layout",
      await screenCheckpoint(page, designId, screenId),
      await readScreenHtml(page, designId, screenId),
      await designFrame(page, screenId)
        .locator('[data-agent-native-layer-name="Frame"]')
        .evaluate((group) => {
          const art = group.ownerDocument.querySelector(
            '[data-agent-native-layer-name="Rectangle"]',
          );
          const groupBounds = group.getBoundingClientRect();
          const artBounds = art?.getBoundingClientRect();
          return {
            group: { top: groupBounds.top, height: groupBounds.height },
            art: artBounds
              ? { bottom: artBounds.bottom, height: artBounds.height }
              : null,
          };
        }),
    );
    reportTutorialCheckpoint(page, "metadata-flow-fill");

    const setFontFamily = async (text: string) => {
      const frameRow = layerRows.getByRole("treeitem", { name: /Frame/ });
      const expandFrame = frameRow.getByRole("button", {
        name: "Expand layer",
      });
      if (await expandFrame.count()) await expandFrame.click();
      await textRow(text).click();
      const typography = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Typography" }) })
        .first();
      await expect(typography).toBeVisible();
      const font = typography.getByRole("button", { name: "Font" });
      await font.click();
      await page.getByRole("combobox", { name: "Search" }).fill("Lato");
      await page.getByRole("option", { name: "Lato", exact: true }).click();
    };
    await setFontFamily("The Summer Mix");
    await expect
      .poll(async () => {
        const html = await readScreenHtml(page, designId, screenId);
        return /font-family:\s*['"]?Lato/i.test(html);
      })
      .toBe(true);
    reportTutorialCheckpoint(page, "title-font-lato");
    console.log(
      "after-title-font-family",
      await designFrame(page, screenId)
        .getByText("The Summer Mix", { exact: true })
        .evaluate((element) => {
          const target = element as HTMLElement;
          return {
            fontFamily: getComputedStyle(target).fontFamily,
            sourceStyle: target.getAttribute("style"),
          };
        }),
    );
    await cdpScreenshot(
      page,
      test.info().outputPath("screen-root-responsive-card-final.png"),
    );

    const current = await readDesign(page, designId);
    const data = designData(current);
    console.log({
      designId,
      screenId,
      geometry: data.canvasFrames?.[screenId],
      metadata: data.screenMetadata?.[screenId],
      screenHtml: current.files?.find((file) => file.id === screenId)?.content,
    });
    completed = true;
  } finally {
    if (completed && hmrSignals(page).length === 0) {
      const response = await page.request.post(
        appPath("/_agent-native/actions/delete-design"),
        { data: { id: designId } },
      );
      if (!response.ok()) throw new Error(await response.text());
    } else {
      console.error("Preserved responsive card design", { designId });
    }
  }
});
