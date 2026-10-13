import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  type Page,
  type FrameLocator,
  type Locator,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { FIXTURE_HTML, SEED_TITLE } from "./global-setup";

export async function readSeedDesignId(): Promise<string> {
  const authDir = process.env.E2E_AUTH_DIR
    ? path.resolve(process.env.E2E_AUTH_DIR)
    : path.join(import.meta.dirname, ".auth");
  const seedPath = path.join(authDir, "seed.json");
  const raw = await readFile(seedPath, "utf8");
  const { designId } = JSON.parse(raw) as { designId: string };
  if (!designId) throw new Error("no seeded designId - global-setup failed");
  return designId;
}

function e2eBaseUrl(page: Page): string {
  const currentUrl = page.url();
  if (currentUrl && currentUrl !== "about:blank") {
    return new URL(currentUrl).origin;
  }
  return e2eBaseURL();
}

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
  baseUrl = e2eBaseUrl(page),
): Promise<any> {
  const res = await page.request.post(
    `${baseUrl}/_agent-native/actions/${name}`,
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

export async function createFixtureDesign(
  page: Page,
  title = SEED_TITLE,
): Promise<string> {
  const created = await postAction(page, "create-design", {
    title,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) {
    throw new Error(
      `create-design did not return an id: ${JSON.stringify(created)}`,
    );
  }
  await postAction(page, "create-file", {
    designId,
    filename: "index.html",
    content: FIXTURE_HTML,
    fileType: "html",
  });
  return designId;
}

export async function canvasZoom(page: Page): Promise<number> {
  const card = await page.locator("[data-screen-card]").first().boundingBox();
  if (!card) throw new Error("no screen card to measure zoom against");
  const contentWidth = await page
    .locator(DESIGN_SCREEN_IFRAME_SELECTOR)
    .first()
    .contentFrame()
    .locator("body")
    .evaluate(() => document.documentElement.clientWidth);
  if (!contentWidth) throw new Error("screen reported no content width");
  return card.width / contentWidth;
}

export async function enableLab(
  page: Page,
  key: string,
): Promise<() => Promise<void>> {
  const baseUrl = e2eBaseUrl(page);
  const response = await page.request.get(
    `${baseUrl}/_agent-native/actions/get-lab-states`,
  );
  if (!response.ok()) {
    throw new Error(
      `get-lab-states failed: ${response.status()} ${await response.text()}`,
    );
  }
  const states = await response.json();
  const previousEnabled = states[key]?.enabled;
  if (typeof previousEnabled !== "boolean") {
    throw new Error(`get-lab-states did not return a state for ${key}`);
  }
  const enabled = await postAction(
    page,
    "set-lab",
    { key, enabled: true },
    baseUrl,
  );
  expect(enabled.enabled).toBe(true);
  return async () => {
    // set-lab has no unset operation; inherited states restore their effective value.
    const restored = await postAction(
      page,
      "set-lab",
      { key, enabled: previousEnabled },
      baseUrl,
    );
    expect(restored.enabled).toBe(previousEnabled);
  };
}

export async function enableFeatureFlag(
  page: Page,
  key: string,
): Promise<() => Promise<void>> {
  await postAction(page, "set-feature-flag", {
    operation: "replace-rules",
    key,
    rules: { mode: "on" },
  });
  return async () => {
    await postAction(page, "set-feature-flag", { operation: "off", key });
  };
}

const DESIGN_PREVIEW_IFRAME_SELECTOR = "iframe[data-design-preview-iframe]";
const DESIGN_SCREEN_IFRAME_SELECTOR = `${DESIGN_PREVIEW_IFRAME_SELECTOR}[data-screen-iframe-id]`;
const BOARD_SURFACE_IFRAME_SELECTOR = `[data-board-surface-layer] ${DESIGN_PREVIEW_IFRAME_SELECTOR}`;
const E2E_BASE_URL =
  process.env.E2E_BASE_URL ??
  `http://127.0.0.1:${process.env.E2E_PORT ?? "9333"}`;
const E2E_BASE_PATH = (() => {
  try {
    return new URL(E2E_BASE_URL).pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
})();

export function appPath(path: string): string {
  const route = new URL(path, "http://agent-native.local");
  const url = new URL(E2E_BASE_URL);
  url.pathname = `${E2E_BASE_PATH}${route.pathname}`;
  url.search = route.search;
  url.hash = route.hash;
  return url.toString();
}

function activeScreenTargetFromUrl(page: Page): string | undefined {
  const url = new URL(page.url());
  return (
    url.searchParams.get("screen") ??
    url.searchParams.get("fileId") ??
    url.searchParams.get("filename") ??
    undefined
  );
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeScreenTarget(value: string): string {
  return value
    .trim()
    .replace(/^\.?\//, "")
    .replace(/\.html?$/i, "")
    .toLowerCase();
}

function screenFrameSelector(screenTarget?: string): string {
  if (!screenTarget) return DESIGN_SCREEN_IFRAME_SELECTOR;

  const normalizedTarget = normalizeScreenTarget(screenTarget);
  const filenameCandidates = new Set([
    screenTarget,
    normalizedTarget,
    `${normalizedTarget}.htm`,
    `${normalizedTarget}.html`,
    `./${normalizedTarget}.htm`,
    `./${normalizedTarget}.html`,
    `/${normalizedTarget}.htm`,
    `/${normalizedTarget}.html`,
  ]);
  return [
    `${DESIGN_SCREEN_IFRAME_SELECTOR}[data-screen-iframe-id="${cssAttributeValue(screenTarget)}"]`,
    ...[...filenameCandidates].map(
      (filename) =>
        `[data-screen-shell]:has([data-frame-title][title="${cssAttributeValue(filename)}" i]) ${DESIGN_SCREEN_IFRAME_SELECTOR}:not([data-screen-iframe-id*="::bp-"])`,
    ),
  ].join(", ");
}

function screenFrame(page: Page, screenTarget?: string): FrameLocator {
  const matchingFrames = page.locator(screenFrameSelector(screenTarget));
  // ponytail: no route target uses the last Screen; inspect editor state if exact focus matters.
  // Route targets stay strict so ambiguous filenames cannot select the wrong Screen.
  const iframe = screenTarget ? matchingFrames : matchingFrames.last();
  return iframe.contentFrame();
}

export function designFrame(page: Page, screenId?: string): FrameLocator {
  return screenFrame(page, screenId ?? activeScreenTargetFromUrl(page));
}

async function selectableNodeByText(
  page: Page,
  text: string,
  screenId?: string,
): Promise<Locator> {
  const targetScreen = screenId ?? activeScreenTargetFromUrl(page);
  const matchingFrames = page.locator(screenFrameSelector(targetScreen));
  const matchingFrameCount = targetScreen ? await matchingFrames.count() : 0;
  if (targetScreen && matchingFrameCount !== 1) {
    throw new Error(
      matchingFrameCount === 0
        ? `No Screen iframe matches route target ${JSON.stringify(targetScreen)}`
        : `Multiple Screen iframes match route target ${JSON.stringify(targetScreen)}`,
    );
  }
  const frame = screenFrame(page, targetScreen);
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const candidates = frame.locator("[data-agent-native-node-id]", {
    hasText: text,
  });
  const candidateCount = await candidates.count();
  let bestIndex = -1;
  let bestPriority = Number.POSITIVE_INFINITY;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let index = 0; index < candidateCount; index += 1) {
    const candidate = candidates.nth(index);
    const { candidateText, priority } = await candidate.evaluate((node) => ({
      candidateText: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
      priority: node.hasAttribute("data-agent-native-layer-name")
        ? 0
        : node.hasAttribute("data-an-text")
          ? 1
          : node.children.length === 0
            ? 2
            : 3,
    }));
    if (candidateText !== normalizedText) continue;
    const box = await candidate.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) continue;
    const area = box.width * box.height;
    if (
      priority < bestPriority ||
      (priority === bestPriority && area < bestArea)
    ) {
      bestIndex = index;
      bestPriority = priority;
      bestArea = area;
    }
  }
  if (bestIndex >= 0) return scrolledIntoView(candidates.nth(bestIndex));

  const exactText = frame.getByText(text, { exact: true });
  if ((await exactText.count()) === 0) {
    throw new Error(
      `no exact selectable node found for ${JSON.stringify(text)}`,
    );
  }
  return scrolledIntoView(exactText.first());
}

async function scrolledIntoView(locator: Locator): Promise<Locator> {
  await locator.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
  return locator;
}

export async function expandAllLayers(page: Page): Promise<void> {
  await page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .first()
    .waitFor({ timeout: 30_000 });
  for (let depth = 0; depth < 128; depth += 1) {
    const expand = page.getByRole("button", { name: "Expand layer" }).first();
    if ((await expand.count()) === 0) return;
    await expand.click({ timeout: 5_000 });
    await page.waitForTimeout(100);
  }
  const remaining = await page
    .getByRole("button", { name: "Expand layer" })
    .count();
  if (remaining > 0) {
    throw new Error(
      `Layers tree still has ${remaining} collapsed rows after 128 expansions`,
    );
  }
}

/**
 * The Frame group's main button. It arms whichever of Frame and Screen was used
 * last, so it is found by its group, not by a label.
 */
export function frameToolButton(page: Page): Locator {
  return page
    .locator(
      '[data-design-bottom-toolbar] [data-design-toolbar-group="frame"] button',
    )
    .first();
}

/** Toolbar tools that sit in a group's menu, and the group each one is in. */
const MENU_TOOL_GROUP = {
  Move: "Move",
  Hand: "Move",
  Scale: "Move",
  Frame: "Frame",
  Screen: "Frame",
  Rectangle: "Shapes",
  Line: "Shapes",
  Arrow: "Shapes",
  Ellipse: "Shapes",
  Polygon: "Shapes",
  Star: "Shapes",
} as const;
export type ToolbarTool = keyof typeof MENU_TOOL_GROUP | "Text";

/**
 * Arm a tool the way a user does: Text is a button of its own; every other tool
 * is an item in its group's menu, opened from the chevron. A group's main button
 * only arms the tool used last, so it cannot be relied on to reach a particular
 * one.
 */
export async function selectTool(page: Page, tool: ToolbarTool): Promise<void> {
  const toolbar = page.locator("[data-design-bottom-toolbar]");
  if (tool === "Text") {
    await toolbar.getByRole("button", { name: "Text", exact: true }).click();
    return;
  }
  await toolbar
    .getByRole("button", {
      name: `${MENU_TOOL_GROUP[tool]} options`,
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: new RegExp(`^${tool}\\b`) }).click();
}

export async function pickFrameMode(
  page: Page,
  mode: "Frame" | "Screen",
): Promise<void> {
  await selectTool(page, mode);
}

export async function resetPersistedCanvasState(page: Page): Promise<void> {
  for (const key of ["design-selection", "navigation"]) {
    const response = await page.request.delete(
      appPath(`/_agent-native/application-state/${key}`),
      { headers: { "X-Agent-Native-CSRF": "1" } },
    );
    if (!response.ok() && response.status() !== 404) {
      throw new Error(
        `could not clear ${key}: ${response.status()} ${await response.text()}`,
      );
    }
  }
}

export async function openAppMenuSubmenu(
  page: Page,
  submenu: "File" | "Edit" | "View" | "Preferences" | "Help",
): Promise<void> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: submenu, exact: true }).hover();
}

export async function gotoEditor(page: Page, designId: string): Promise<void> {
  await resetPersistedCanvasState(page);
  await page.goto(appPath(`/design/${designId}`), {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await waitForDesignBridgeReady(page);
}

async function waitForDesignBridgeReady(page: Page): Promise<void> {
  await expect(
    page.locator(DESIGN_PREVIEW_IFRAME_SELECTOR).first(),
  ).toBeVisible();
  const overviewChromeVisible = await page
    .locator("[data-screen-shell]")
    .first()
    .isVisible()
    .catch(() => false);
  await expect
    .poll(
      async () => {
        const previewIframes = page.locator(DESIGN_PREVIEW_IFRAME_SELECTOR);
        const previewIframeCount = await previewIframes.count();
        let selectableNodeCount = 0;
        for (let index = 0; index < previewIframeCount; index += 1) {
          const frame = previewIframes.nth(index).contentFrame();
          selectableNodeCount += await frame
            .locator("[data-agent-native-node-id], h1, h2, p, button")
            .count()
            .catch(() => 0);
        }
        return selectableNodeCount;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  if (overviewChromeVisible) {
    await expect(page.locator("[data-screen-shell]").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect
      .poll(
        async () => {
          const box = await page
            .locator("[data-screen-shell]")
            .first()
            .locator("[data-screen-card]")
            .first()
            .boundingBox();
          return box && box.width > 0 && box.height > 0;
        },
        { timeout: 10_000 },
      )
      .toBeTruthy();
    await page.waitForTimeout(750);
  }
}

export async function enterDirectMode(
  page: Page,
  _options?: { screenId?: string; waitForBridgeReady?: boolean },
): Promise<void> {
  const screenId = _options?.screenId ?? activeScreenTargetFromUrl(page);
  const allScreens = page
    .locator("aside")
    .first()
    .getByRole("button", { name: "All screens" });
  if (
    (await allScreens.count()) > 0 &&
    (await allScreens.getAttribute("aria-current")) !== "page"
  ) {
    await allScreens.click();
    await expect(allScreens).toHaveAttribute("aria-current", "page");
  }
  await waitForDesignBridgeReady(page);
  // The board surface iframe carries no data-screen-iframe-id, so a `screen=`
  // URL that targets the board never matches a Screen iframe.
  const targetsBoard =
    !_options?.screenId &&
    (await page.locator(screenFrameSelector(screenId)).count()) === 0 &&
    (await page.locator(BOARD_SURFACE_IFRAME_SELECTOR).count()) > 0;
  const frameSelector = targetsBoard
    ? BOARD_SURFACE_IFRAME_SELECTOR
    : screenFrameSelector(screenId);
  await expect(
    (targetsBoard
      ? page.locator(BOARD_SURFACE_IFRAME_SELECTOR).contentFrame()
      : designFrame(page, screenId)
    )
      .locator('[data-agent-native-edit-overlay="shield"]')
      .first(),
  ).toBeAttached({ timeout: 15_000 });
  if (_options?.waitForBridgeReady) {
    await page.evaluate(
      (selector) =>
        new Promise<void>((resolve, reject) => {
          const frame = document.querySelector<HTMLIFrameElement>(selector);
          const source = frame?.contentWindow;
          if (!source) {
            reject(
              new Error(
                `Screen iframe not available for bridge probe: ${selector}`,
              ),
            );
            return;
          }
          let timeoutId: number | undefined;
          const onMessage = (event: MessageEvent) => {
            if (
              event.source !== source ||
              (event.data as { type?: string } | null)?.type !==
                "agent-native:editor-chrome-ready"
            ) {
              return;
            }
            if (timeoutId !== undefined) window.clearTimeout(timeoutId);
            window.removeEventListener("message", onMessage);
            resolve();
          };
          window.addEventListener("message", onMessage);
          timeoutId = window.setTimeout(() => {
            window.removeEventListener("message", onMessage);
            reject(
              new Error(
                `Screen editor bridge did not respond to probe: ${selector}`,
              ),
            );
          }, 15_000);
          source.postMessage(
            { type: "agent-native:editor-chrome-ready-probe" },
            "*",
          );
        }),
      frameSelector,
    );
  }
}

export async function enterInteractView(
  page: Page,
  options?: { screenId?: string },
): Promise<void> {
  const fullView = options?.screenId
    ? page
        .locator(
          `[data-screen-shell][data-frame-id="${options.screenId.replace(/"/g, '\\"')}"]`,
        )
        .locator("[data-frame-full-view]")
    : page.locator("[data-frame-full-view]").last();
  await expect(fullView).toHaveCount(1);
  const screenShell = fullView.locator("xpath=ancestor::*[@data-screen-shell]");
  await expect(screenShell).toHaveAttribute(
    "data-screen-interact-mode",
    "false",
  );
  const previewIframe = screenShell
    .locator(DESIGN_PREVIEW_IFRAME_SELECTOR)
    .first();
  await expect(previewIframe).toBeVisible();
  // The frame's "Focus screen" button only selects the Screen and fits the
  // camera to it; Interact is entered from the top bar for that focused Screen.
  await fullView.evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect(previewIframe).toBeVisible();
  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  await expect(screenShell).toHaveAttribute(
    "data-screen-interact-mode",
    "true",
  );
  await expect(
    page.locator("[data-design-top-bar] [data-design-interact-route]"),
  ).toBeVisible();
  // Interact loads the page afresh with only its own bridges, so the preview
  // is a new iframe; the screen still has exactly one.
  await expect(screenShell.locator(DESIGN_PREVIEW_IFRAME_SELECTOR)).toHaveCount(
    1,
  );
  await expect
    .poll(
      async () =>
        (
          await screenShell
            .locator(DESIGN_PREVIEW_IFRAME_SELECTOR)
            .last()
            .boundingBox()
        )?.width ?? 0,
      { timeout: 10_000 },
    )
    // The responsive preview is intentionally narrower than the overview
    // canvas once the inspector rails are mounted; assert it is usable rather
    // than baking in a desktop-only width.
    .toBeGreaterThan(400);
}

export async function installBridge(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as any;
    if (!Array.isArray(win.__bridge)) win.__bridge = [];
    if (win.__bridgeInstalled) return;
    win.__bridgeInstalled = true;
    window.addEventListener("message", (e: MessageEvent) => {
      const t = (e.data as any)?.type;
      if (
        typeof t === "string" &&
        (/^(element-|visual-)/.test(t) || t === "text-content-change")
      ) {
        if (!Array.isArray(win.__bridge)) win.__bridge = [];
        win.__bridge.push(e.data);
      }
    });
  });
}

export async function bridgeMessages(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__bridge ?? []);
}

export async function waitForBridge(
  page: Page,
  type: string,
  timeout = 15_000,
  options?: { phase?: string },
): Promise<any> {
  const handle = await page.waitForFunction(
    ({ t, phase }) =>
      [...((window as any).__bridge ?? [])]
        .reverse()
        .find((m: any) => m.type === t && (!phase || m.phase === phase)) ??
      null,
    { t: type, phase: options?.phase },
    { timeout },
  );
  return handle.jsonValue();
}

export async function selectByText(
  page: Page,
  text: string,
  options?: {
    screenId?: string;
    clearPreviousSelection?: boolean;
    deep?: boolean;
    additive?: boolean;
  },
): Promise<any> {
  const screenId = options?.screenId ?? activeScreenTargetFromUrl(page);
  await enterDirectMode(page, {
    screenId,
    waitForBridgeReady: true,
  });
  await installBridge(page);
  if (options?.clearPreviousSelection) {
    await page
      .locator(screenFrameSelector(screenId))
      .evaluate((frame: HTMLIFrameElement) => {
        frame.contentWindow?.postMessage({ type: "clear-selection" }, "*");
      });
    await expect(
      designFrame(page, screenId)
        .locator('[data-agent-native-edit-overlay="selection"]')
        .first(),
    ).toHaveCSS("display", "none");
  }
  const target = await selectableNodeByText(page, text, screenId);
  await target.waitFor({ state: "visible", timeout: 8_000 });
  const box = await target.boundingBox();
  if (!box) throw new Error(`no bounding box for ${JSON.stringify(text)}`);
  const expected = await target.evaluate((node) => ({
    tagName: node.tagName.toLowerCase(),
    sourceId: node.getAttribute("data-agent-native-node-id"),
    textContent: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
  }));
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (expected.textContent !== normalizedText) {
    throw new Error(
      `text ${JSON.stringify(text)} resolved to ${expected.tagName} with text ${JSON.stringify(expected.textContent)}`,
    );
  }
  await page.evaluate(() => ((window as any).__bridge = []));
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const modifiers: Array<"Shift" | "Meta" | "Control"> = options?.additive
    ? ["Shift"]
    : options?.deep === false
      ? []
      : [modifier];
  await target.click({
    force: true,
    ...(modifiers.length > 0 ? { modifiers } : {}),
  });
  let selectionHandle;
  try {
    selectionHandle = await page.waitForFunction(
      ({ tagName, sourceId }) =>
        [...((window as any).__bridge ?? [])].reverse().find((message: any) => {
          if (message.type !== "element-select") return false;
          const payload = message.payload ?? message;
          return (
            payload.tagName === tagName &&
            (!sourceId || payload.sourceId === sourceId)
          );
        }) ?? null,
      expected,
      { timeout: 15_000 },
    );
  } catch (error) {
    const diagnostic = await page.evaluate(
      ({ screenTarget, x, y }) => {
        const messages = (window as any).__bridge ?? [];
        const iframe = screenTarget
          ? document.querySelector(
              `[data-screen-iframe-id="${CSS.escape(screenTarget)}"]`,
            )
          : null;
        const frameRect = iframe?.getBoundingClientRect();
        const hit = document.elementFromPoint(x, y);
        return {
          url: location.href,
          clickHit: hit
            ? {
                tagName: hit.tagName.toLowerCase(),
                id: hit.id,
                className: String((hit as HTMLElement).className ?? "").slice(
                  0,
                  160,
                ),
                role: hit.getAttribute("role"),
                label: hit.getAttribute("aria-label"),
              }
            : null,
          messageTypes: messages.slice(-30).map((message: any) => message.type),
          selections: messages
            .filter((message: any) => message.type === "element-select")
            .slice(-5)
            .map((message: any) => message.payload ?? message),
          iframe: iframe
            ? {
                src: (iframe as HTMLIFrameElement).src,
                pointerEvents: getComputedStyle(iframe).pointerEvents,
                clientWidth: (iframe as HTMLIFrameElement).clientWidth,
                clientHeight: (iframe as HTMLIFrameElement).clientHeight,
                rect: frameRect
                  ? {
                      x: frameRect.x,
                      y: frameRect.y,
                      width: frameRect.width,
                      height: frameRect.height,
                    }
                  : null,
              }
            : null,
        };
      },
      {
        screenTarget: screenId,
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      },
    );
    const targetState = await target.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return {
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        hitTagName: hit?.tagName.toLowerCase() ?? null,
        hitClassName: String(
          (hit as HTMLElement | null)?.className ?? "",
        ).slice(0, 160),
        hitNodeId: hit?.getAttribute("data-agent-native-node-id") ?? null,
        hitOverlay: hit?.getAttribute("data-agent-native-edit-overlay") ?? null,
        isTopWindow: window.parent === window.top,
        parentOrigin: (() => {
          try {
            return window.parent.location.origin;
          } catch {
            return "cross-origin";
          }
        })(),
        pointerEvents: getComputedStyle(node).pointerEvents,
      };
    });
    throw new Error(
      `selection bridge did not report ${expected.tagName} source ${expected.sourceId ?? "<pending>"}; ${JSON.stringify({ ...diagnostic, targetState })}; ${String(error)}`,
    );
  }
  const selection = await selectionHandle.jsonValue();
  const payload = selection?.payload ?? selection;
  expect(payload?.tagName).toBe(expected.tagName);
  if (expected.sourceId) {
    expect(payload?.sourceId).toBe(expected.sourceId);
  } else {
    expect(payload?.pendingNodeId || payload?.sourceId).toBeTruthy();
  }
  if (!payload?.textContentTruncated) {
    expect(
      String(payload?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    ).toBe(expected.textContent);
  }
  return payload;
}

export async function inspectorInputCount(page: Page): Promise<number> {
  return page.locator("input").count();
}

export async function dragCanvasByText(
  page: Page,
  text: string,
  dx: number,
  dy: number,
): Promise<string[]> {
  const screenId = activeScreenTargetFromUrl(page);
  await selectByText(page, text, { screenId });
  await page.evaluate(() => ((window as any).__bridge = []));
  const target = await selectableNodeByText(page, text, screenId);
  const box = await target.boundingBox();
  if (!box) throw new Error(`no bounding box for "${text}"`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const msgs = await bridgeMessages(page);
  return [...new Set(msgs.map((m) => m.type))];
}

export async function cdpScreenshot(
  page: Page,
  filePath: string,
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(filePath, Buffer.from(data, "base64"));
}

export function elementInner(html: string, nodeId: string): string {
  const openIndex = html.indexOf(`data-agent-native-node-id="${nodeId}"`);
  if (openIndex < 0) throw new Error(`node ${nodeId} not found`);
  const tagStart = html.lastIndexOf("<", openIndex);
  const tag = /^<([a-zA-Z0-9-]+)/.exec(html.slice(tagStart))?.[1];
  if (!tag) throw new Error(`no tag for ${nodeId}`);
  const contentStart = html.indexOf(">", openIndex) + 1;
  const pattern = new RegExp(`</?${tag}\\b`, "g");
  pattern.lastIndex = contentStart;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(contentStart, match.index);
  }
  throw new Error(`unbalanced ${tag} for ${nodeId}`);
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

export function childNodeIds(html: string, parentId: string): string[] {
  const ids: string[] = [];
  let depth = 0;
  for (const tag of elementInner(html, parentId).matchAll(
    /<(\/?)([a-zA-Z0-9-]+)([^>]*)>/g,
  )) {
    const [, slash, name, attrs] = tag as unknown as [
      string,
      string,
      string,
      string,
    ];
    if (slash === "/") {
      depth -= 1;
      continue;
    }
    if (depth === 0) {
      const id = /data-agent-native-node-id="([^"]+)"/.exec(attrs)?.[1];
      if (id) ids.push(id);
    }
    if (!attrs.trimEnd().endsWith("/") && !VOID_TAGS.has(name.toLowerCase())) {
      depth += 1;
    }
  }
  return ids;
}
