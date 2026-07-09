import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { FIXTURE_HTML } from "./global-setup";
import {
  designFrame,
  enterDirectMode,
  gotoEditor,
  installBridge,
} from "./helpers";

let designId: string;
let baseURLForActions: string;

interface DesignFileRecord {
  id: string;
  filename: string;
  content: string;
  fileType?: string;
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

interface TextEditingChromeSummary {
  screenId: string | null;
  editing: boolean;
  active: boolean;
  text: string;
  overlayVisible: boolean;
  visibleCornerHandles: number;
  visibleEdgeHandles: number;
  visibleRotateHandles: number;
  outlineStyle: string;
  outlineWidth: string;
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
  return page.locator(`button[aria-label="${name}"]`).first();
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
    fileType: typeof file.fileType === "string" ? file.fileType : undefined,
  }));
}

async function fileContent(page: Page, filename: string): Promise<string> {
  const file = (await designFiles(page)).find(
    (candidate) => candidate.filename === filename,
  );
  if (!file) throw new Error(`File not found: ${filename}`);
  return file.content;
}

async function designData(page: Page): Promise<Record<string, any>> {
  const result = await getAction(page.request, "get-design", { id: designId });
  if (typeof result.data !== "string") return {};
  return JSON.parse(result.data || "{}");
}

function htmlScreenFiles(files: DesignFileRecord[]): DesignFileRecord[] {
  return files.filter(
    (file) => file.fileType === "html" && file.filename !== "__board__.html",
  );
}

async function primitiveCount(
  page: Page,
  filename: string,
  kind: string,
): Promise<number> {
  const content = await fileContent(page, filename);
  return page.evaluate(
    ({ html, primitiveKind }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return doc.querySelectorAll(`[data-an-primitive="${primitiveKind}"]`)
        .length;
    },
    { html: content, primitiveKind: kind },
  );
}

async function primitiveNodeIds(
  page: Page,
  filename: string,
  kind: string,
): Promise<string[]> {
  const content = await fileContent(page, filename);
  return page.evaluate(
    ({ html, primitiveKind }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return Array.from(
        doc.querySelectorAll<HTMLElement>(
          `[data-an-primitive="${primitiveKind}"]`,
        ),
      )
        .map((element) => element.dataset.agentNativeNodeId ?? "")
        .filter(Boolean);
    },
    { html: content, primitiveKind: kind },
  );
}

async function primitiveLeftPositions(
  page: Page,
  filename: string,
  kind: string,
): Promise<number[]> {
  const content = await fileContent(page, filename);
  return page.evaluate(
    ({ html, primitiveKind }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return Array.from(
        doc.querySelectorAll<HTMLElement>(
          `[data-an-primitive="${primitiveKind}"]`,
        ),
      )
        .map((element) => Number.parseFloat(element.style.left))
        .filter((value) => Number.isFinite(value));
    },
    { html: content, primitiveKind: kind },
  );
}

async function dragInEmptyCanvasLeftOf(
  page: Page,
  shellName: string,
  options?: { width?: number; height?: number; topOffset?: number },
): Promise<void> {
  const card = screenShell(page, shellName).locator("[data-screen-card]");
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error(`no ${shellName} screen card box`);

  const width = options?.width ?? 96;
  const height = options?.height ?? 96;
  const start = {
    x: cardBox.x - 12,
    y: cardBox.y + (options?.topOffset ?? 120),
  };
  await dragBetween(page, start, {
    x: start.x - width,
    y: start.y + height,
  });
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

async function textEditingChromeSummary(
  page: Page,
): Promise<TextEditingChromeSummary | null> {
  const snapshots = await page
    .locator("iframe[data-design-preview-iframe]")
    .evaluateAll((iframes) =>
      iframes.map((iframe) => {
        const frame = iframe as HTMLIFrameElement;
        const doc = frame.contentDocument;
        const win = frame.contentWindow;
        const editing = doc?.querySelector(
          "[data-agent-native-text-editing]",
        ) as HTMLElement | null;
        const overlay = doc?.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        ) as HTMLElement | null;
        const isVisible = (element: Element) => {
          const style = win?.getComputedStyle(element);
          return (
            !!style &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || 1) > 0
          );
        };
        const countVisible = (selector: string) =>
          Array.from(doc?.querySelectorAll(selector) ?? []).filter(isVisible)
            .length;
        const outline = editing ? win?.getComputedStyle(editing) : null;
        return {
          screenId: frame.dataset.screenIframeId ?? null,
          editing: !!editing,
          active: !!editing && doc?.activeElement === editing,
          text: editing?.textContent ?? "",
          overlayVisible: !!overlay && isVisible(overlay),
          visibleCornerHandles: countVisible("[data-agent-native-edit-handle]"),
          visibleEdgeHandles: countVisible("[data-agent-native-edge-handle]"),
          visibleRotateHandles: countVisible(
            "[data-agent-native-rotate-handle]",
          ),
          outlineStyle: outline?.outlineStyle ?? "",
          outlineWidth: outline?.outlineWidth ?? "",
        };
      }),
    );
  return (
    snapshots.find((snapshot) => snapshot.editing) ??
    snapshots.find((snapshot) => snapshot.overlayVisible) ??
    null
  );
}

async function waitForTextChrome(
  page: Page,
  predicate: (summary: TextEditingChromeSummary) => boolean,
): Promise<TextEditingChromeSummary> {
  await expect
    .poll(
      async () => {
        const summary = await textEditingChromeSummary(page);
        return summary && predicate(summary) ? summary : null;
      },
      { timeout: 20_000 },
    )
    .not.toBeNull();
  const summary = await textEditingChromeSummary(page);
  if (!summary || !predicate(summary)) {
    throw new Error(`Text editing chrome did not reach expected state`);
  }
  return summary;
}

async function replaceActiveText(page: Page, text: string): Promise<void> {
  await waitForTextEditing(page);
  const selectAllShortcut =
    process.platform === "darwin" ? "Meta+A" : "Control+A";
  await page.keyboard.press(selectAllShortcut);
  await page.keyboard.type(text);
  // Figma text editing: Enter inserts a line break; Escape exits and commits.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
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

async function confirmScreenDeletion(page: Page): Promise<void> {
  const dialog = page.getByRole("alertdialog", {
    name: "Delete this screen?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function pressPrimaryShortcut(
  page: Page,
  key: string,
  options: { shift?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    ({ key, primary, shift }) => {
      const isLetter = /^[a-z]$/i.test(key);
      const eventKey = isLetter
        ? shift
          ? key.toUpperCase()
          : key.toLowerCase()
        : key;
      const eventInit: KeyboardEventInit = {
        key: eventKey,
        code: isLetter ? `Key${key.toUpperCase()}` : key,
        bubbles: true,
        cancelable: true,
        composed: true,
        metaKey: primary === "Meta",
        ctrlKey: primary === "Control",
        shiftKey: shift,
      };
      window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
    },
    {
      key,
      primary: process.platform === "darwin" ? "Meta" : "Control",
      shift: options.shift ?? false,
    },
  );
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

async function primitiveViewportBox(
  shell: Locator,
  nodeId: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const iframe = shell.locator("iframe[data-design-preview-iframe]").first();
  await expect(iframe).toBeVisible();
  const box = await iframe
    .contentFrame()
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .boundingBox();
  if (!box) throw new Error(`primitive not found: ${nodeId}`);
  return box;
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

test("Hand and Scale shortcuts project the active move-group tool", async ({
  page,
}) => {
  await page.keyboard.press("h");
  await expect(toolButton(page, "Hand")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(toolButton(page, "Move")).toHaveCount(0);

  // The primary button shows Hand, so clicking it must keep Hand selected.
  await toolButton(page, "Hand").click();
  await expect(toolButton(page, "Hand")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Hand options" }).click();
  await expect(
    page.getByRole("menuitem").filter({ hasText: "Hand" }),
  ).toHaveText(/HandH$/);
  await expect(
    page.getByRole("menuitem").filter({ hasText: "Scale" }),
  ).toHaveText(/ScaleK$/);
  await page.keyboard.press("Escape");

  await page.keyboard.press("k");
  await expect(toolButton(page, "Scale")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(toolButton(page, "Hand")).toHaveCount(0);

  // The primary button shows Scale, so clicking it must keep Scale selected.
  await toolButton(page, "Scale").click();
  await expect(toolButton(page, "Scale")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

async function textEditingCount(page: Page): Promise<number> {
  return page
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
    );
}

async function dblClickText(page: Page, text: string): Promise<void> {
  // Overview -> focused mode replaces the board iframe with the focused
  // DesignCanvas iframe. The outgoing and incoming frames briefly share the
  // same bounds, so geometry/visibility alone can report ready while a click
  // would still land in the outgoing document. Require the same iframe DOM
  // instance to remain mounted across the transition before interacting.
  let stableIframeToken: string | null = null;
  let stableSince = 0;
  await expect
    .poll(
      async () => {
        const iframe = page
          .locator("iframe[data-design-preview-iframe]")
          .last();
        const token = await iframe.evaluate((element) => {
          const frame = element as HTMLIFrameElement & {
            __canvasToolsE2EInstance?: string;
          };
          frame.__canvasToolsE2EInstance ??= crypto.randomUUID();
          return frame.__canvasToolsE2EInstance;
        });
        if (token !== stableIframeToken) {
          stableIframeToken = token;
          stableSince = Date.now();
        }
        return Date.now() - stableSince;
      },
      { timeout: 5_000, intervals: [50] },
    )
    .toBeGreaterThanOrEqual(250);

  const target = designFrame(page).getByText(text).first();
  await target.waitFor({ state: "visible", timeout: 10_000 });
  // The full-view transition is still settling when its iframe first crosses
  // the helper's width threshold. Let Playwright resolve the live hit point at
  // dispatch time; a cached box can move between measurement and dblclick.
  // `force` is intentional because the editor shield owns the real hit target.
  await target.dblclick({ force: true });
}

test("double-click existing text starts inline editing and stays open (overview)", async ({
  page,
}) => {
  await installBridge(page);

  await dblClickText(page, "E2E Hero Heading");

  // Inline editing must begin — the iframe stamps the contenteditable target.
  await waitForTextEditing(page);

  // ...and must stay open. The reported bug tears it down within ~1 frame
  // (the caret "blinks" then focus jumps to the chat composer), so wait a beat
  // and confirm we are still editing with focus.
  await page.waitForTimeout(800);
  const summary = await textEditingChromeSummary(page);
  expect(summary?.editing, "still in inline text-editing mode").toBe(true);
  expect(summary?.active, "editable still holds focus").toBe(true);
  expect(await textEditingCount(page), "exactly one editor open").toBe(1);

  // Typing replaces the text inline (no AI round-trip). Verify by observing
  // the committed text in the iframe DOM rather than a bridge payload shape.
  const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
  await page.keyboard.press(selectAll);
  await page.keyboard.type("Edited Inline");
  await page.keyboard.press("Escape");
  await expect
    .poll(
      async () =>
        page
          .locator("iframe[data-design-preview-iframe]")
          .evaluateAll((iframes) =>
            iframes.some((iframe) =>
              (
                (iframe as HTMLIFrameElement).contentDocument?.body
                  ?.textContent ?? ""
              ).includes("Edited Inline"),
            ),
          ),
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("double-click existing text starts inline editing and stays open (full view)", async ({
  page,
}) => {
  await installBridge(page);
  await enterDirectMode(page);

  await dblClickText(page, "E2E Hero Heading");

  await waitForTextEditing(page);

  await page.waitForTimeout(800);
  const summary = await textEditingChromeSummary(page);
  expect(summary?.editing, "still in inline text-editing mode").toBe(true);
  expect(summary?.active, "editable still holds focus").toBe(true);
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

test("board text focuses immediately and uses editing chrome states", async ({
  page,
}) => {
  const text = `Board text ${Date.now()}`;
  await postAction(page.request, "create-file", {
    designId,
    filename: "about.html",
    content: FIXTURE_HTML.replace("E2E Fixture", "E2E Second Fixture"),
    fileType: "html",
  });
  await gotoEditor(page, designId);
  await expect
    .poll(
      async () =>
        (await designFiles(page)).some(
          (file) => file.filename === "__board__.html",
        ),
      { timeout: 20_000 },
    )
    .toBe(true);

  const aboutCardBox = await screenShell(page, "About")
    .locator("[data-screen-card]")
    .boundingBox();
  if (!aboutCardBox) throw new Error("no about screen card box");

  await page.keyboard.press("t");
  await expect(toolButton(page, "Text")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.mouse.click(
    aboutCardBox.x + aboutCardBox.width + 80,
    aboutCardBox.y + 120,
  );

  const emptyChrome = await waitForTextChrome(
    page,
    (summary) => summary.editing && summary.active && summary.text === "",
  );
  expect(emptyChrome.screenId).toBeNull();
  expect(emptyChrome.overlayVisible).toBe(false);
  expect(emptyChrome.visibleCornerHandles).toBe(0);
  expect(emptyChrome.outlineStyle).toBe("none");

  await page.keyboard.type(text);
  const typedChrome = await waitForTextChrome(
    page,
    (summary) =>
      summary.editing && summary.text === text && summary.overlayVisible,
  );
  expect(typedChrome.visibleCornerHandles).toBe(0);
  expect(typedChrome.visibleEdgeHandles).toBe(0);
  expect(typedChrome.visibleRotateHandles).toBe(0);

  await page.keyboard.press("Escape");
  const selectedChrome = await waitForTextChrome(
    page,
    (summary) => !summary.editing && summary.overlayVisible,
  );
  expect(selectedChrome.visibleCornerHandles).toBe(4);

  const primitive = await waitForTextPrimitive(page, "__board__.html", text);
  expect(primitive.text).toBe(text);
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
  await selectedLayerRow(page).click();

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

test("dragging a rectangle between screens moves it across files", async ({
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
  await installBridge(page);
  await page.evaluate(() => ((window as any).__bridge = []));
  await installBridge(page);
  await page.evaluate(() => ((window as any).__bridge = []));

  const homeShell = screenShell(page, "Home");
  const aboutShell = screenShell(page, "About");
  const homeCard = homeShell.locator("[data-screen-card]");
  const aboutCard = aboutShell.locator("[data-screen-card]");
  const homeCardBox = await homeCard.boundingBox();
  const aboutCardBox = await aboutCard.boundingBox();
  if (!homeCardBox || !aboutCardBox) throw new Error("missing screen card box");

  const homeIdsBefore = await primitiveNodeIds(page, "index.html", "rectangle");
  const aboutIdsBefore = await primitiveNodeIds(
    page,
    "about.html",
    "rectangle",
  );
  const drawStart = {
    x: homeCardBox.x + homeCardBox.width * 0.1,
    y: homeCardBox.y + homeCardBox.height * 0.06,
  };
  const drawEnd = {
    x: homeCardBox.x + homeCardBox.width * 0.2,
    y: homeCardBox.y + homeCardBox.height * 0.14,
  };

  await createDraftPrimitive(page, "Rectangle", "Rectangle", {
    start: drawStart,
    end: drawEnd,
  });
  await expect
    .poll(() => primitiveNodeIds(page, "index.html", "rectangle"), {
      timeout: 20_000,
    })
    .toHaveLength(homeIdsBefore.length + 1);
  const homeIdsAfterCreate = await primitiveNodeIds(
    page,
    "index.html",
    "rectangle",
  );
  const movedId = homeIdsAfterCreate.find((id) => !homeIdsBefore.includes(id));
  if (!movedId) throw new Error("new rectangle id was not found");
  const movedBox = await primitiveViewportBox(homeShell, movedId);

  await dragBetween(
    page,
    {
      x: movedBox.x + movedBox.width / 2,
      y: movedBox.y + movedBox.height / 2,
    },
    {
      x: aboutCardBox.x + aboutCardBox.width * 0.38,
      y: aboutCardBox.y + aboutCardBox.height * 0.16,
    },
  );

  await expect
    .poll(
      async () => {
        const homeIds = await primitiveNodeIds(page, "index.html", "rectangle");
        const aboutIds = await primitiveNodeIds(
          page,
          "about.html",
          "rectangle",
        );
        return {
          aboutHasMoved: aboutIds.includes(movedId),
          aboutCount: aboutIds.length,
          homeHasMoved: homeIds.includes(movedId),
          homeCount: homeIds.length,
        };
      },
      { timeout: 20_000 },
    )
    .toEqual({
      aboutHasMoved: true,
      aboutCount: aboutIdsBefore.length + 1,
      homeHasMoved: false,
      homeCount: homeIdsBefore.length,
    });
});

test("frame insertion inside a screen creates a nested frame", async ({
  page,
}) => {
  const card = await homeScreenCard(page);
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no home screen card box");
  const screenCountBefore = htmlScreenFiles(await designFiles(page)).length;
  const nestedFrameCountBefore = await primitiveCount(
    page,
    "index.html",
    "frame",
  );

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
  await expect(selectedLayerRow(page)).toContainText("Frame");
  await expect
    .poll(() => primitiveCount(page, "index.html", "frame"), {
      timeout: 20_000,
    })
    .toBe(nestedFrameCountBefore + 1);
  expect(htmlScreenFiles(await designFiles(page))).toHaveLength(
    screenCountBefore,
  );
  await restoreHome(page);
});

test("frame drawn left of the first screen creates a new screen", async ({
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

  const filesBeforeFrame = await designFiles(page);
  const screenCountBeforeFrame = htmlScreenFiles(filesBeforeFrame).length;

  await toolButton(page, "Frame").click();
  await expect(toolButton(page, "Frame")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dragInEmptyCanvasLeftOf(page, "Home", { width: 112, height: 132 });

  await expect(toolButton(page, "Move")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(async () => htmlScreenFiles(await designFiles(page)).length, {
      timeout: 20_000,
    })
    .toBe(screenCountBeforeFrame + 1);

  const filesAfterFrame = await designFiles(page);
  const newScreen = htmlScreenFiles(filesAfterFrame).find(
    (file) => !filesBeforeFrame.some((before) => before.id === file.id),
  );
  if (!newScreen) throw new Error("new screen file was not created");

  const frameData = await designData(page);
  const newFrameGeometry = frameData.canvasFrames?.[newScreen.id];
  expect(newFrameGeometry?.x).toBeLessThan(0);
});

test("rectangle drawn left of the first screen persists on the board", async ({
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

  const boardRectanglesBefore = await primitiveCount(
    page,
    "__board__.html",
    "rectangle",
  );

  await toolButton(page, "Rectangle").click();
  await expect(toolButton(page, "Rectangle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dragInEmptyCanvasLeftOf(page, "Home", {
    width: 84,
    height: 76,
    topOffset: 300,
  });

  await expect
    .poll(() => primitiveCount(page, "__board__.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(boardRectanglesBefore + 1);
  await expect
    .poll(async () => {
      const positions = await primitiveLeftPositions(
        page,
        "__board__.html",
        "rectangle",
      );
      return Math.min(...positions);
    })
    .toBeLessThan(0);
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

test("primary undo removes active pen segments without undoing committed vectors", async ({
  page,
}) => {
  const card = await homeScreenCard(page);
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("no home screen card box");

  await toolButton(page, "Pen").click();
  await expect(toolButton(page, "Pen")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(150);

  await page.mouse.click(
    cardBox.x + cardBox.width * 0.26,
    cardBox.y + cardBox.height * 0.3,
  );
  await page.mouse.click(
    cardBox.x + cardBox.width * 0.42,
    cardBox.y + cardBox.height * 0.38,
  );
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(0);
  await expect(selectedLayerRow(page)).toContainText("Vector");

  const committedVector = await waitForVectorPrimitive(
    page,
    "index.html",
    /\bL\b/,
  );

  await page.mouse.click(
    cardBox.x + cardBox.width * 0.52,
    cardBox.y + cardBox.height * 0.32,
  );
  await page.mouse.click(
    cardBox.x + cardBox.width * 0.72,
    cardBox.y + cardBox.height * 0.48,
  );
  await page.mouse.click(
    cardBox.x + cardBox.width * 0.62,
    cardBox.y + cardBox.height * 0.64,
  );
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(1);
  await expect(page.locator("[data-pen-anchor]")).toHaveCount(3);

  const undoShortcut = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
  await page.keyboard.press(undoShortcut);
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(1);
  await expect(page.locator("[data-pen-anchor]")).toHaveCount(2);
  await page.waitForTimeout(500);

  const vectorsAfterSegmentUndo = await vectorPrimitiveSummaries(
    page,
    "index.html",
  );
  expect(vectorsAfterSegmentUndo).toHaveLength(1);
  expect(vectorsAfterSegmentUndo[0]?.d).toBe(committedVector.d);

  await page.keyboard.press(undoShortcut);
  await expect(page.locator("[data-pen-anchor]")).toHaveCount(1);
  await page.keyboard.press(undoShortcut);
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(0);
  await page.waitForTimeout(500);

  const vectorsAfterClearingPath = await vectorPrimitiveSummaries(
    page,
    "index.html",
  );
  expect(vectorsAfterClearingPath).toHaveLength(1);
  expect(vectorsAfterClearingPath[0]?.d).toBe(committedVector.d);
});

test("focused-screen pen authors Bezier paths and undoes active segments", async ({
  page,
}) => {
  await enterDirectMode(page);
  await toolButton(page, "Pen").click();
  await expect(toolButton(page, "Pen")).toHaveAttribute("aria-pressed", "true");

  const overlay = page.locator(
    '[data-design-canvas-creation-overlay][data-creation-tool="pen"]',
  );
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  if (!box) throw new Error("no focused-screen creation overlay box");

  const drawSmoothAnchor = async (
    anchor: { x: number; y: number },
    handleDelta: { x: number; y: number },
  ) => {
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.down();
    await page.mouse.move(anchor.x + handleDelta.x, anchor.y + handleDelta.y, {
      steps: 8,
    });
    await page.mouse.up();
  };

  await drawSmoothAnchor(
    { x: box.x + box.width * 0.3, y: box.y + box.height * 0.34 },
    { x: 70, y: -38 },
  );
  await drawSmoothAnchor(
    { x: box.x + box.width * 0.62, y: box.y + box.height * 0.58 },
    { x: -62, y: 44 },
  );
  await expect(page.locator("[data-pen-anchor]")).toHaveCount(2);
  await expect(page.locator("[data-pen-handle]")).toHaveCount(4);

  const undoShortcut = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
  await page.keyboard.press(undoShortcut);
  await expect(page.locator("[data-pen-anchor]")).toHaveCount(1);
  expect(await vectorPrimitiveSummaries(page, "index.html")).toHaveLength(0);

  await drawSmoothAnchor(
    { x: box.x + box.width * 0.68, y: box.y + box.height * 0.56 },
    { x: -55, y: 48 },
  );
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(0);
  await expect(toolButton(page, "Pen")).toHaveAttribute("aria-pressed", "true");
  await expect(selectedLayerRow(page)).toContainText("Vector");
  await waitForVectorPrimitive(page, "index.html", /\bC\b/);
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

test("overview undo and redo stay global across screen content and canvas geometry", async ({
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

  const homeShell = screenShell(page, "Home");
  const beforeMove = await homeShell.boundingBox();
  if (!beforeMove) throw new Error("no home shell before move");
  const aboutShell = screenShell(page, "About");
  const aboutCard = aboutShell.locator("[data-screen-card]");
  const aboutCardBox = await aboutCard.boundingBox();
  if (!aboutCardBox) throw new Error("no about card box");
  const homeCard = homeShell.locator("[data-screen-card]");
  const homeCardBox = await homeCard.boundingBox();
  if (!homeCardBox) throw new Error("no home card box");
  const homeRectanglesBefore = await primitiveCount(
    page,
    "index.html",
    "rectangle",
  );
  const aboutRectanglesBefore = await primitiveCount(
    page,
    "about.html",
    "rectangle",
  );

  await createDraftPrimitive(page, "Rectangle", "Rectangle", {
    start: {
      x: homeCardBox.x + homeCardBox.width * 0.16,
      y: homeCardBox.y + homeCardBox.height * 0.18,
    },
    end: {
      x: homeCardBox.x + homeCardBox.width * 0.32,
      y: homeCardBox.y + homeCardBox.height * 0.3,
    },
  });
  await expect
    .poll(() => primitiveCount(page, "index.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(homeRectanglesBefore + 1);

  await createDraftPrimitive(page, "Rectangle", "Rectangle", {
    start: {
      x: aboutCardBox.x + aboutCardBox.width * 0.18,
      y: aboutCardBox.y + aboutCardBox.height * 0.2,
    },
    end: {
      x: aboutCardBox.x + aboutCardBox.width * 0.34,
      y: aboutCardBox.y + aboutCardBox.height * 0.32,
    },
  });
  await expect
    .poll(() => primitiveCount(page, "about.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(aboutRectanglesBefore + 1);

  await dragBetween(
    page,
    { x: beforeMove.x + beforeMove.width * 0.34, y: beforeMove.y + 12 },
    {
      x: beforeMove.x + beforeMove.width * 0.34 + 72,
      y: beforeMove.y + 12 + 32,
    },
  );
  const moved = await homeShell.boundingBox();
  if (!moved) throw new Error("no moved home shell");
  expect(moved.x).toBeGreaterThan(beforeMove.x + 20);

  await pressPrimaryShortcut(page, "z");
  await expect
    .poll(async () => {
      const current = await homeShell.boundingBox();
      return current
        ? Math.abs(current.x - beforeMove.x)
        : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(6);
  expect(await primitiveCount(page, "index.html", "rectangle")).toBe(
    homeRectanglesBefore + 1,
  );
  expect(await primitiveCount(page, "about.html", "rectangle")).toBe(
    aboutRectanglesBefore + 1,
  );

  await pressPrimaryShortcut(page, "z");
  await expect
    .poll(() => primitiveCount(page, "about.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(aboutRectanglesBefore);
  expect(await primitiveCount(page, "index.html", "rectangle")).toBe(
    homeRectanglesBefore + 1,
  );

  await pressPrimaryShortcut(page, "z");
  await expect
    .poll(() => primitiveCount(page, "index.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(homeRectanglesBefore);

  await pressPrimaryShortcut(page, "z", { shift: true });
  await expect
    .poll(() => primitiveCount(page, "index.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(homeRectanglesBefore + 1);
  await pressPrimaryShortcut(page, "z", { shift: true });
  await expect
    .poll(() => primitiveCount(page, "about.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(aboutRectanglesBefore + 1);
  await pressPrimaryShortcut(page, "z", { shift: true });
  await expect
    .poll(async () => {
      const current = await homeShell.boundingBox();
      return current ? current.x - beforeMove.x : 0;
    })
    .toBeGreaterThan(20);
});

test("single-screen undo does not consume overview history", async ({
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

  const aboutShell = screenShell(page, "About");
  const aboutCard = aboutShell.locator("[data-screen-card]");
  const aboutCardBox = await aboutCard.boundingBox();
  if (!aboutCardBox) throw new Error("no about card box");
  const aboutRectanglesBefore = await primitiveCount(
    page,
    "about.html",
    "rectangle",
  );

  await createDraftPrimitive(page, "Rectangle", "Rectangle", {
    start: {
      x: aboutCardBox.x + aboutCardBox.width * 0.12,
      y: aboutCardBox.y + aboutCardBox.height * 0.12,
    },
    end: {
      x: aboutCardBox.x + aboutCardBox.width * 0.22,
      y: aboutCardBox.y + aboutCardBox.height * 0.22,
    },
  });
  await expect
    .poll(() => primitiveCount(page, "about.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(aboutRectanglesBefore + 1);

  const sidebar = page.locator("aside").first();
  const allScreens = sidebar.getByRole("button", { name: "All screens" });
  const homeScreen = sidebar
    .getByRole("button", { name: "Home", exact: true })
    .first();
  await homeScreen.click();
  await expect(homeScreen).toHaveAttribute("aria-current", "page");

  await pressPrimaryShortcut(page, "z");
  await page.waitForTimeout(300);
  expect(await primitiveCount(page, "about.html", "rectangle")).toBe(
    aboutRectanglesBefore + 1,
  );

  await allScreens.click();
  await expect(allScreens).toHaveAttribute("aria-current", "page");
  await expect(screenShell(page, "About")).toBeVisible();
  await pressPrimaryShortcut(page, "z");
  await expect
    .poll(() => primitiveCount(page, "about.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(aboutRectanglesBefore);
});

test("overview undo skips deleted screen content history", async ({ page }) => {
  await postAction(page.request, "create-file", {
    designId,
    filename: "about.html",
    content: FIXTURE_HTML.replace("E2E Fixture", "E2E Second Fixture"),
    fileType: "html",
  });
  await gotoEditor(page, designId);
  await expect(screenShell(page, "About")).toBeVisible();

  const aboutFile = (await designFiles(page)).find(
    (file) => file.filename === "about.html",
  );
  if (!aboutFile) throw new Error("about.html was not created");

  const homeShell = screenShell(page, "Home");
  const aboutShell = screenShell(page, "About");
  const homeCardBox = await homeShell
    .locator("[data-screen-card]")
    .boundingBox();
  const aboutCardBox = await aboutShell
    .locator("[data-screen-card]")
    .boundingBox();
  if (!homeCardBox || !aboutCardBox) throw new Error("missing screen card box");
  const homeRectanglesBefore = await primitiveCount(
    page,
    "index.html",
    "rectangle",
  );
  const aboutRectanglesBefore = await primitiveCount(
    page,
    "about.html",
    "rectangle",
  );

  await createDraftPrimitive(page, "Rectangle", "Rectangle", {
    start: {
      x: homeCardBox.x + homeCardBox.width * 0.16,
      y: homeCardBox.y + homeCardBox.height * 0.18,
    },
    end: {
      x: homeCardBox.x + homeCardBox.width * 0.3,
      y: homeCardBox.y + homeCardBox.height * 0.3,
    },
  });
  await expect
    .poll(() => primitiveCount(page, "index.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(homeRectanglesBefore + 1);

  await createDraftPrimitive(page, "Rectangle", "Rectangle", {
    start: {
      x: aboutCardBox.x + aboutCardBox.width * 0.16,
      y: aboutCardBox.y + aboutCardBox.height * 0.18,
    },
    end: {
      x: aboutCardBox.x + aboutCardBox.width * 0.3,
      y: aboutCardBox.y + aboutCardBox.height * 0.3,
    },
  });
  await expect
    .poll(() => primitiveCount(page, "about.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(aboutRectanglesBefore + 1);

  const aboutBox = await aboutShell.boundingBox();
  if (!aboutBox) throw new Error("no about shell box");
  await page.mouse.click(aboutBox.x + aboutBox.width * 0.3, aboutBox.y + 12);
  await page.keyboard.press("Delete");
  await confirmScreenDeletion(page);
  await expect
    .poll(
      async () =>
        htmlScreenFiles(await designFiles(page)).some(
          (file) => file.id === aboutFile.id,
        ),
      { timeout: 20_000 },
    )
    .toBe(false);

  await pressPrimaryShortcut(page, "z");
  await expect
    .poll(() => primitiveCount(page, "index.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(homeRectanglesBefore);
  expect(
    htmlScreenFiles(await designFiles(page)).some(
      (file) => file.id === aboutFile.id,
    ),
  ).toBe(false);

  await pressPrimaryShortcut(page, "z", { shift: true });
  await expect
    .poll(() => primitiveCount(page, "index.html", "rectangle"), {
      timeout: 20_000,
    })
    .toBe(homeRectanglesBefore + 1);
  expect(
    htmlScreenFiles(await designFiles(page)).some(
      (file) => file.id === aboutFile.id,
    ),
  ).toBe(false);
});

test("overview undo does not restore ghost geometry for deleted screens", async ({
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

  const aboutFile = (await designFiles(page)).find(
    (file) => file.filename === "about.html",
  );
  if (!aboutFile) throw new Error("about.html was not created");

  const aboutShell = screenShell(page, "About");
  const aboutBoxBeforeMove = await aboutShell.boundingBox();
  if (!aboutBoxBeforeMove) throw new Error("no about shell before move");
  await dragBetween(
    page,
    {
      x: aboutBoxBeforeMove.x + aboutBoxBeforeMove.width * 0.34,
      y: aboutBoxBeforeMove.y + 12,
    },
    {
      x: aboutBoxBeforeMove.x + aboutBoxBeforeMove.width * 0.34 + 80,
      y: aboutBoxBeforeMove.y + 12 + 36,
    },
  );
  const movedAboutBox = await aboutShell.boundingBox();
  if (!movedAboutBox) throw new Error("no moved about shell box");
  expect(movedAboutBox.x).toBeGreaterThan(aboutBoxBeforeMove.x + 20);

  const aboutBox = await aboutShell.boundingBox();
  if (!aboutBox) throw new Error("no about shell box");
  await page.mouse.click(aboutBox.x + aboutBox.width * 0.3, aboutBox.y + 12);
  await page.keyboard.press("Delete");
  await confirmScreenDeletion(page);

  await expect
    .poll(
      async () =>
        htmlScreenFiles(await designFiles(page)).some(
          (file) => file.id === aboutFile.id,
        ),
      { timeout: 20_000 },
    )
    .toBe(false);

  await pressPrimaryShortcut(page, "z");
  await page.waitForTimeout(300);

  const dataAfterUndo = await designData(page);
  expect(
    Boolean(
      dataAfterUndo.canvasFrames &&
      typeof dataAfterUndo.canvasFrames === "object" &&
      dataAfterUndo.canvasFrames[aboutFile.id],
    ),
  ).toBe(false);
  expect(
    htmlScreenFiles(await designFiles(page)).some(
      (file) => file.id === aboutFile.id,
    ),
  ).toBe(false);
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
