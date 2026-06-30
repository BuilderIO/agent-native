import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { FIXTURE_HTML } from "./global-setup";
import { gotoEditor } from "./helpers";

let designId: string;
let baseURLForActions: string;

interface DesignFileRecord {
  id: string;
  filename: string;
  content: string;
}

interface TextPrimitiveSummary {
  text: string;
  style: string;
  display: string;
  width: string;
  height: string;
}

interface VectorPrimitiveSummary {
  d: string;
  viewBox: string;
  style: string;
}

async function postAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${baseURLForActions}/_agent-native/actions/${actionName}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function getAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) params.append(`${key}[]`, String(item));
      }
      continue;
    }
    if (value != null) params.append(key, String(value));
  }
  const response = await request.get(
    `${baseURLForActions}/_agent-native/actions/${actionName}?${params}`,
    {
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

test.beforeEach(async ({ page }, workerInfo) => {
  baseURLForActions =
    (workerInfo.project.use.baseURL as string | undefined) ??
    "http://127.0.0.1:9333";
  const created = await postAction(page.request, "create-design", {
    title: "E2E Canvas Tools",
    projectType: "prototype",
  });
  designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) {
    throw new Error(`create-design did not return an id: ${created}`);
  }
  await postAction(page.request, "create-file", {
    designId,
    filename: "index.html",
    content: FIXTURE_HTML,
    fileType: "html",
  });
  await gotoEditor(page, designId);
});

test.use({ viewport: { width: 1440, height: 1000 } });

test.afterEach(async ({ page }) => {
  if (!designId) return;
  await postAction(page.request, "delete-design", { id: designId }).catch(
    () => {},
  );
  designId = "";
});

function toolButton(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true });
}

function selectedLayerRow(page: Page): Locator {
  return page.locator('[role="treeitem"][aria-selected="true"]').first();
}

function homeLayerRow(page: Page): Locator {
  return page
    .locator("[data-layer-node-id]")
    .filter({ hasText: "Home" })
    .first();
}

function screenShell(page: Page, name = "Home"): Locator {
  return page.locator("[data-screen-shell]").filter({ hasText: name }).first();
}

async function dragBetween(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.waitForTimeout(250);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function createDraftPrimitive(
  page: Page,
  toolName: string,
  selectionLabel: string,
  drag: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  },
): Promise<void> {
  await toolButton(page, toolName).click();
  await expect(toolButton(page, toolName)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.waitForTimeout(150);
  await dragBetween(page, drag.start, drag.end);
  await expect(toolButton(page, "Move")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(selectedLayerRow(page)).toContainText(selectionLabel);
}

async function designFiles(page: Page): Promise<DesignFileRecord[]> {
  const result = await getAction(page.request, "get-design", { id: designId });
  return (result.files ?? []).map((file: any) => ({
    id: String(file.id ?? ""),
    filename: String(file.filename ?? ""),
    content: String(file.content ?? ""),
  }));
}

async function fileContent(page: Page, filename: string): Promise<string> {
  const file = (await designFiles(page)).find(
    (candidate) => candidate.filename === filename,
  );
  if (!file) throw new Error(`File not found: ${filename}`);
  return file.content;
}

async function textPrimitiveSummaries(
  page: Page,
  filename: string,
): Promise<TextPrimitiveSummary[]> {
  const content = await fileContent(page, filename);
  return page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.querySelectorAll('[data-an-primitive="text"]')).map(
      (element) => {
        const host = element as HTMLElement;
        return {
          text: host.textContent ?? "",
          style: host.getAttribute("style") ?? "",
          display: host.style.display,
          width: host.style.width,
          height: host.style.height,
        };
      },
    );
  }, content);
}

async function waitForTextPrimitive(
  page: Page,
  filename: string,
  text: string,
): Promise<TextPrimitiveSummary> {
  await expect
    .poll(
      async () =>
        (await textPrimitiveSummaries(page, filename)).find((primitive) =>
          primitive.text.includes(text),
        ) ?? null,
      { timeout: 20_000 },
    )
    .not.toBeNull();
  const primitive = (await textPrimitiveSummaries(page, filename)).find(
    (candidate) => candidate.text.includes(text),
  );
  if (!primitive) throw new Error(`Text primitive not found: ${text}`);
  return primitive;
}

async function waitForTextEditing(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
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
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
}

async function replaceActiveText(page: Page, text: string): Promise<void> {
  await waitForTextEditing(page);
  const selectAllShortcut =
    process.platform === "darwin" ? "Meta+A" : "Control+A";
  await page.keyboard.press(selectAllShortcut);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function insertTextByClick(
  page: Page,
  shell: Locator,
  text: string,
): Promise<void> {
  const card = shell.locator("[data-screen-card]");
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no screen card box");

  await toolButton(page, "Text").click();
  await expect(toolButton(page, "Text")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.mouse.click(cardBox.x + cardBox.width * 0.32, cardBox.y + 120);
  await replaceActiveText(page, text);
}

async function insertTextByDrag(
  page: Page,
  shell: Locator,
  text: string,
): Promise<void> {
  const card = shell.locator("[data-screen-card]");
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no screen card box");

  await toolButton(page, "Text").click();
  await expect(toolButton(page, "Text")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dragBetween(
    page,
    {
      x: cardBox.x + cardBox.width * 0.28,
      y: cardBox.y + cardBox.height * 0.28,
    },
    {
      x: cardBox.x + cardBox.width * 0.64,
      y: cardBox.y + cardBox.height * 0.38,
    },
  );
  await replaceActiveText(page, text);
}

function countOccurrences(content: string, text: string): number {
  return content.split(text).length - 1;
}

async function vectorPrimitiveSummaries(
  page: Page,
  filename: string,
): Promise<VectorPrimitiveSummary[]> {
  const content = await fileContent(page, filename);
  return page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(
      doc.querySelectorAll('svg[data-agent-native-layer-name="Vector"]'),
    ).map((element) => {
      const svg = element as SVGElement;
      return {
        d: svg.querySelector("path")?.getAttribute("d") ?? "",
        viewBox: svg.getAttribute("viewBox") ?? "",
        style: svg.getAttribute("style") ?? "",
      };
    });
  }, content);
}

async function waitForVectorPrimitive(
  page: Page,
  filename: string,
  pathPattern: RegExp,
): Promise<VectorPrimitiveSummary> {
  await expect
    .poll(
      async () =>
        (await vectorPrimitiveSummaries(page, filename)).find((primitive) =>
          pathPattern.test(primitive.d),
        ) ?? null,
      { timeout: 20_000 },
    )
    .not.toBeNull();
  const primitive = (await vectorPrimitiveSummaries(page, filename)).find(
    (candidate) => pathPattern.test(candidate.d),
  );
  if (!primitive) {
    throw new Error(`Vector primitive not found in ${filename}`);
  }
  return primitive;
}

function expectPathStartsInsideViewBox(vector: VectorPrimitiveSummary): void {
  const viewBox = vector.viewBox
    .split(/\s+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const start = vector.d.match(/M\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
  if (viewBox.length !== 4 || !start) {
    throw new Error(
      `Could not inspect vector geometry: viewBox=${vector.viewBox} d=${vector.d}`,
    );
  }

  const [x, y, width, height] = viewBox;
  const startX = Number(start[1]);
  const startY = Number(start[2]);
  expect(startX).toBeGreaterThanOrEqual(x - 0.1);
  expect(startX).toBeLessThanOrEqual(x + width + 0.1);
  expect(startY).toBeGreaterThanOrEqual(y - 0.1);
  expect(startY).toBeLessThanOrEqual(y + height + 0.1);
}

async function restoreHome(page: Page): Promise<void> {
  const allScreens = page.getByRole("button", {
    name: "All screens",
    exact: true,
  });
  if (await allScreens.isVisible()) {
    await allScreens.click();
  }
  await homeLayerRow(page).click();
  await expect(toolButton(page, "Move")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(selectedLayerRow(page)).toContainText("Home");
}

function homeScreenCard(page: Page): Locator {
  return screenShell(page).locator("[data-screen-card]");
}

async function screenCardLayoutSize(shell: Locator): Promise<{
  width: number;
  height: number;
}> {
  return shell.locator("[data-screen-card]").evaluate((element) => ({
    width: (element as HTMLElement).clientWidth,
    height: (element as HTMLElement).clientHeight,
  }));
}

async function screenIframeViewportSize(shell: Locator): Promise<{
  width: number;
  height: number;
}> {
  const iframe = shell.locator("iframe[data-design-preview-iframe]").first();
  await expect(iframe).toBeVisible();
  return iframe.evaluate((element) => ({
    width: (element as HTMLIFrameElement).clientWidth,
    height: (element as HTMLIFrameElement).clientHeight,
  }));
}

function expectCloseToFrameSize(
  viewport: { width: number; height: number },
  frame: { width: number; height: number },
) {
  // The frame card is measured as border-box while the preview iframe reports
  // content-box. The overview card has a 1px border on each side.
  expect(Math.abs(viewport.width - frame.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(viewport.height - frame.height)).toBeLessThanOrEqual(2);
}

test("toolbar modes toggle the editor mode buttons", async ({ page }) => {
  await expect(toolButton(page, "Edit")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(toolButton(page, "Interact")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(toolButton(page, "Annotate")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await toolButton(page, "Interact").click();
  await expect(toolButton(page, "Interact")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(toolButton(page, "Edit")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await toolButton(page, "Annotate").click();
  await expect(toolButton(page, "Annotate")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(toolButton(page, "Interact")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await toolButton(page, "Edit").click();
  await expect(toolButton(page, "Edit")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("text insertion keeps the new primitive selected", async ({ page }) => {
  const card = await homeScreenCard(page);
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no home screen card box");

  await createDraftPrimitive(page, "Text", "Text", {
    start: {
      x: cardBox.x + cardBox.width * 0.28,
      y: cardBox.y + cardBox.height * 0.28,
    },
    end: {
      x: cardBox.x + cardBox.width * 0.5,
      y: cardBox.y + cardBox.height * 0.36,
    },
  });
  await restoreHome(page);
});

test("click text creates auto-width text and survives reload", async ({
  page,
}) => {
  const text = `Auto width text ${Date.now()}`;

  await insertTextByClick(page, screenShell(page), text);

  const primitive = await waitForTextPrimitive(page, "index.html", text);
  expect(primitive.display).toBe("inline-block");
  expect(primitive.width).toBe("");
  expect(primitive.height).toBe("");
  expect(primitive.style).not.toMatch(/(^|;)\s*width\s*:/);
  expect(primitive.style).not.toMatch(/(^|;)\s*height\s*:/);

  await gotoEditor(page, designId);
  await expect
    .poll(async () => fileContent(page, "index.html"), { timeout: 20_000 })
    .toContain(text);
});

test("drag text creates bounded text", async ({ page }) => {
  const text = `Bounded text ${Date.now()}`;

  await insertTextByDrag(page, screenShell(page), text);

  const primitive = await waitForTextPrimitive(page, "index.html", text);
  expect(primitive.display).toBe("flex");
  expect(primitive.width).toMatch(/px$/);
  expect(primitive.height).toMatch(/px$/);
});

test("text insertion targets the clicked screen in all-screens canvas", async ({
  page,
}) => {
  const text = `Second screen text ${Date.now()}`;
  await postAction(page.request, "create-file", {
    designId,
    filename: "about.html",
    content: FIXTURE_HTML.replace("E2E Fixture", "E2E Second Fixture"),
    fileType: "html",
  });
  await gotoEditor(page, designId);

  await insertTextByClick(page, screenShell(page, "About"), text);

  await waitForTextPrimitive(page, "about.html", text);
  expect(await fileContent(page, "index.html")).not.toContain(text);
});

test("copy and paste duplicates selected text", async ({ page }) => {
  const text = `Copied text ${Date.now()}`;
  await insertTextByClick(page, screenShell(page), text);
  await waitForTextPrimitive(page, "index.html", text);

  const copyShortcut = process.platform === "darwin" ? "Meta+C" : "Control+C";
  const pasteShortcut = process.platform === "darwin" ? "Meta+V" : "Control+V";
  await page.keyboard.press(copyShortcut);
  await page.keyboard.press(pasteShortcut);

  await expect
    .poll(
      async () => countOccurrences(await fileContent(page, "index.html"), text),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(2);
});

test("rectangle insertion keeps the new primitive selected", async ({
  page,
}) => {
  const card = await homeScreenCard(page);
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no home screen card box");

  await createDraftPrimitive(page, "Rectangle", "Rectangle", {
    start: {
      x: cardBox.x + cardBox.width * 0.58,
      y: cardBox.y + cardBox.height * 0.56,
    },
    end: {
      x: cardBox.x + cardBox.width * 0.8,
      y: cardBox.y + cardBox.height * 0.78,
    },
  });
  await restoreHome(page);
});

test("frame insertion creates a new screen and can return to Home", async ({
  page,
}) => {
  const card = await homeScreenCard(page);
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no home screen card box");

  await toolButton(page, "Frame").click();
  await expect(toolButton(page, "Frame")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.waitForTimeout(150);
  await dragBetween(
    page,
    {
      x: cardBox.x + cardBox.width * 0.2,
      y: cardBox.y + cardBox.height * 0.2,
    },
    {
      x: cardBox.x + cardBox.width * 0.5,
      y: cardBox.y + cardBox.height * 0.48,
    },
  );

  await expect(toolButton(page, "Move")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(selectedLayerRow(page)).toContainText("Screen 2");
  await restoreHome(page);
});

test("pen escape cancels the in-progress path and enter commits vector art", async ({
  page,
}) => {
  const card = await homeScreenCard(page);
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no home screen card box");

  await toolButton(page, "Pen").click();
  await expect(toolButton(page, "Pen")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(150);
  await page.mouse.click(
    cardBox.x + cardBox.width * 0.3,
    cardBox.y + cardBox.height * 0.3,
  );
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(0);
  await expect(toolButton(page, "Pen")).toHaveAttribute("aria-pressed", "true");

  await page.mouse.click(
    cardBox.x + cardBox.width * 0.36,
    cardBox.y + cardBox.height * 0.42,
  );
  await page.mouse.click(
    cardBox.x + cardBox.width * 0.58,
    cardBox.y + cardBox.height * 0.54,
  );
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(0);
  await expect(toolButton(page, "Pen")).toHaveAttribute("aria-pressed", "true");
  await expect(selectedLayerRow(page)).toContainText("Vector");

  await restoreHome(page);
});

test("pen Bezier vector stays visible and persists through reload", async ({
  page,
}) => {
  await postAction(page.request, "create-file", {
    designId,
    filename: "about.html",
    content: FIXTURE_HTML.replace("E2E Fixture", "E2E Second Fixture"),
    fileType: "html",
  });
  await gotoEditor(page, designId);
  await expect(screenShell(page, "About")).toBeVisible();

  const card = screenShell(page, "About").locator("[data-screen-card]");
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no about screen card box");

  await toolButton(page, "Pen").click();
  await expect(toolButton(page, "Pen")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(150);

  const start = {
    x: cardBox.x + cardBox.width * 0.68,
    y: cardBox.y + cardBox.height * 0.3,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 92, start.y - 52, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(1);

  const end = {
    x: cardBox.x + cardBox.width * 0.84,
    y: cardBox.y + cardBox.height * 0.48,
  };
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  await page.mouse.move(end.x - 84, end.y + 68, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("[data-pen-handle]")).toHaveCount(4);

  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(0);
  await expect(selectedLayerRow(page)).toContainText("Vector");

  const vector = await waitForVectorPrimitive(page, "about.html", /\bC\b/);
  expect(vector.style).toContain("position:absolute");
  expectPathStartsInsideViewBox(vector);
  expect(await fileContent(page, "index.html")).not.toContain(vector.d);

  await gotoEditor(page, designId);
  const reloaded = await waitForVectorPrimitive(page, "about.html", /\bC\b/);
  expect(reloaded.d).toBe(vector.d);
  expectPathStartsInsideViewBox(reloaded);
});

test("pen closes a vector path by clicking the first anchor", async ({
  page,
}) => {
  const card = await homeScreenCard(page);
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no home screen card box");

  const first = {
    x: cardBox.x + cardBox.width * 0.46,
    y: cardBox.y + cardBox.height * 0.36,
  };
  const second = {
    x: cardBox.x + cardBox.width * 0.64,
    y: cardBox.y + cardBox.height * 0.52,
  };

  await toolButton(page, "Pen").click();
  await expect(toolButton(page, "Pen")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(150);
  await page.mouse.click(first.x, first.y);
  await page.mouse.click(second.x, second.y);
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(1);

  await page.mouse.click(first.x, first.y);
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(0);
  await expect(selectedLayerRow(page)).toContainText("Vector");

  const vector = await waitForVectorPrimitive(page, "index.html", /\bZ$/);
  expect(vector.d).toContain(" Z");
  expectPathStartsInsideViewBox(vector);
});

test("dragging the Home screen shell moves it", async ({ page }) => {
  const shell = screenShell(page);
  const before = await shell.boundingBox();
  if (!before) throw new Error("no home screen shell box");

  await dragBetween(
    page,
    { x: before.x + before.width * 0.34, y: before.y + 12 },
    { x: before.x + before.width * 0.34 + 64, y: before.y + 12 + 28 },
  );

  const moved = await shell.boundingBox();
  if (!moved) throw new Error("no moved shell box");
  expect(moved.x).toBeGreaterThan(before.x + 20);
  expect(moved.y).toBeGreaterThan(before.y + 10);
  const movedViewport = await screenIframeViewportSize(shell);
  expectCloseToFrameSize(movedViewport, await screenCardLayoutSize(shell));

  await dragBetween(
    page,
    { x: moved.x + moved.width * 0.34, y: moved.y + 12 },
    { x: moved.x + moved.width * 0.34 - 64, y: moved.y + 12 - 28 },
  );
  const movedBack = await shell.boundingBox();
  if (!movedBack) throw new Error("no restored shell box");
  expect(Math.abs(movedBack.x - before.x)).toBeLessThan(6);
  expect(Math.abs(movedBack.y - before.y)).toBeLessThan(6);
});

test("Escape cancels an in-progress overview screen drag", async ({ page }) => {
  const shell = screenShell(page);
  const before = await shell.boundingBox();
  if (!before) throw new Error("no home screen shell box");

  const start = {
    x: before.x + before.width * 0.34,
    y: before.y + 12,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 72, start.y + 36, { steps: 8 });

  const during = await shell.boundingBox();
  if (!during) throw new Error("no dragging shell box");
  expect(during.x).toBeGreaterThan(before.x + 20);
  expect(during.y).toBeGreaterThan(before.y + 10);

  await page.keyboard.press("Escape");
  await page.mouse.move(start.x + 144, start.y + 72, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  const after = await shell.boundingBox();
  if (!after) throw new Error("no cancelled shell box");
  expect(Math.abs(after.x - before.x)).toBeLessThan(6);
  expect(Math.abs(after.y - before.y)).toBeLessThan(6);
});
