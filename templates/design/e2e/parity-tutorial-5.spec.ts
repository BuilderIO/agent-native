import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { buildCodeLayerProjection } from "../shared/code-layer";
import { e2eBaseURL } from "./base-url";
import {
  createFixtureDesign,
  designFrame,
  enterInteractView,
  gotoEditor,
  installBridge,
  selectByText,
} from "./helpers";

/**
 * Parity spec for Figma Learn Tutorial 5: "Design an interactive button
 * component".
 * https://help.figma.com/hc/en-us/articles/20953528101783
 *
 * Condensed steps (figma-interaction-spec.md Part 2 §5):
 *  1. 24x24 "icon" frame (no fill), centered 12x18 rectangle, Shift+X swap
 *     fill/stroke, stroke settings, corner radius 1
 *  2. Vector-edit mode (Enter), add a point, set Y, Cmd+Opt+K component
 *  3. "Create variant" for the icon; boolean-style true/false property
 *  4. Build button main component (text -> Shift+A -> style, same recipe as
 *     Tutorial 1), rename "button/default/unsaved"
 *  5. Option/Alt-drag the icon instance into the button, gap 12
 *  6. Boolean component properties "Show label"/"Show icon"
 *  7. "Add variant" x3 to build a state x status grid
 *  8. Prototype tab: hover/mousedown/mouseup -> Change to, Smart animate
 *  9. Preview (Shift+Space), click/hover to verify state machine
 *
 * Design has no component/variant/prototyping system (per
 * figma-interaction-spec.md and prior tutorial specs), so steps 3, 6, 7, 8
 * have no direct equivalent -- recorded as findings, severity low,
 * ownedBy unknown, and the spec exercises the closest equivalent instead
 * (Cmd+Opt+K annotation, alt-drag duplicate, Interact view).
 */

let baseURLForActions: string;
let currentDesignId = "";

test.use({ viewport: { width: 1440, height: 1000 } });

test.beforeEach(({}, workerInfo) => {
  baseURLForActions =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
});

async function postAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${baseURLForActions}/_agent-native/actions/${actionName}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function deleteDesign(request: APIRequestContext, id: string) {
  await postAction(request, "delete-design", { id }).catch(() => {});
}

async function getDesignFiles(
  page: Page,
): Promise<{ filename?: string; content?: string }[]> {
  const params = new URLSearchParams({ id: currentDesignId });
  const res = await page.request.get(
    `${baseURLForActions}/_agent-native/actions/get-design?${params}`,
  );
  if (!res.ok()) throw new Error(`get-design failed: ${res.status()}`);
  const payload = await res.json();
  const design = [
    payload,
    payload?.result,
    payload?.design,
    payload?.data,
  ].find((candidate) => Array.isArray(candidate?.files));
  return design?.files ?? [];
}

async function fileContent(page: Page, filename: string): Promise<string> {
  const files = await getDesignFiles(page);
  const file = files.find((f) => f.filename === filename);
  if (typeof file?.content !== "string") {
    throw new Error(`${filename} has no content`);
  }
  return file.content;
}

/**
 * Board-level frames/shapes drawn outside any screen render inside the
 * board's own same-origin iframe stamped only with data-agent-native-node-id
 * (shared/board-file.ts) — no `data-board-object-id` attribute exists
 * anywhere in the app, and even if it did `page.locator` cannot pierce an
 * iframe boundary. Parse __board__.html's own markup instead (mirrors
 * parity-tutorial-2.spec.ts's boardObjects helper).
 */
async function boardObjects(page: Page): Promise<Record<string, true>> {
  const html = await fileContent(page, "__board__.html");
  const result: Record<string, true> = {};
  for (const match of html.matchAll(/data-agent-native-node-id="([^"]+)"/g)) {
    result[match[1]!] = true;
  }
  return result;
}

/** Page-relative bounding box of a node id wherever it lives — the screen
 * iframe or the board iframe alike — by reaching directly into each
 * same-origin iframe's contentDocument.
 *
 * The overview canvas zooms by CSS-transform-scaling an ancestor of the
 * iframe, not by resizing it: `iframe.getBoundingClientRect()` reflects that
 * scale (it is page space), but `el.getBoundingClientRect()` computed INSIDE
 * the iframe's own document does not — it is the iframe's native, unscaled
 * layout space. Adding the two directly only works at 100% zoom; at any other
 * zoom (the overview's usual "fit all screens" default) it returns a page
 * position off by the zoom factor, which silently sends a driven mouse drag
 * built from it to empty canvas. Rescale by the iframe's own
 * rendered-vs-native width ratio (mirrors helpers.ts's canvasZoom, and
 * parity-tutorial-1.spec.ts's identical helper) before combining the two
 * coordinate spaces. */
async function boardObjectBoundingBox(
  page: Page,
  nodeId: string,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate((id) => {
    for (const iframe of Array.from(
      document.querySelectorAll("iframe"),
    ) as HTMLIFrameElement[]) {
      const doc = iframe.contentDocument;
      const el = doc?.querySelector(`[data-agent-native-node-id="${id}"]`);
      if (!el) continue;
      const iframeRect = iframe.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const scale = iframe.clientWidth
        ? iframeRect.width / iframe.clientWidth
        : 1;
      return {
        x: iframeRect.left + elRect.left * scale,
        y: iframeRect.top + elRect.top * scale,
        width: elRect.width * scale,
        height: elRect.height * scale,
      };
    }
    return null;
  }, nodeId);
}

async function waitForBoardObjectBoundingBox(
  page: Page,
  nodeId: string,
  timeoutMs = 10_000,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const box = await boardObjectBoundingBox(page, nodeId);
    if (box) return box;
    await page.waitForTimeout(300);
  }
  throw new Error("board object must render before dragging");
}

/** Poll until a NEW board object id (not in `before`) appears. */
async function waitForNewBoardObjectId(
  page: Page,
  before: Set<string>,
  timeoutMs = 10_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ids = Object.keys(await boardObjects(page)).filter(
      (id) => !before.has(id) && !id.startsWith("draft-"),
    );
    if (ids.length > 0) return ids[0]!;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("no new stable board object id appeared in time");
}

/** An empty point on the overview board, away from any screen card — a
 * fixed offset from the screen shell can land on left-shell chrome instead
 * of open canvas (see parity-tutorial-2.spec.ts's identical helper). */
async function emptyBoardPoint(page: Page, clearance = 0) {
  const point = await page.evaluate((clearance) => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const boardLayer = document.querySelector<HTMLElement>(
      "[data-board-surface-layer]",
    );
    const r = (boardLayer ?? surface).getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-card]"),
    ).map((el) => el.getBoundingClientRect());
    for (
      let y = r.top + 60 + clearance;
      y < r.bottom - 60 - clearance;
      y += 40
    ) {
      for (
        let x = r.left + 60 + clearance;
        x < r.right - 60 - clearance;
        x += 40
      ) {
        if (
          cards.some(
            (c) =>
              x >= c.left - 24 - clearance &&
              x <= c.right + 24 + clearance &&
              y >= c.top - 24 - clearance &&
              y <= c.bottom + 24 + clearance,
          )
        )
          continue;
        const hit = document.elementFromPoint(x, y);
        if (
          hit &&
          surface.contains(hit) &&
          !hit.closest("[data-screen-card], [data-board-object-selection-box]")
        ) {
          return { x, y };
        }
      }
    }
    return null;
  }, clearance);
  if (!point) throw new Error("no empty canvas point found");
  return point;
}

function screenShell(page: Page): Locator {
  return page.locator("[data-screen-shell]").first();
}

function homeScreenCard(page: Page): Locator {
  return screenShell(page).locator("[data-screen-card]").first();
}

function toolButton(page: Page, name: string): Locator {
  return page.locator(`button[aria-label="${name}"]`).first();
}

async function pressToolKey(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
}

function styleOf(html: string, nodeId: string): Record<string, string> {
  const marker = `data-agent-native-node-id="${nodeId}"`;
  const openIndex = html.indexOf(marker);
  if (openIndex < 0) throw new Error(`node ${nodeId} not found in HTML`);
  const tagStart = html.lastIndexOf("<", openIndex);
  const tagEnd = html.indexOf(">", openIndex);
  const tag = html.slice(tagStart, tagEnd + 1);
  const styleMatch = /style="([^"]*)"/.exec(tag);
  const out: Record<string, string> = {};
  if (!styleMatch) return out;
  for (const decl of styleMatch[1]!.split(";")) {
    const [prop, ...rest] = decl.split(":");
    if (!prop || rest.length === 0) continue;
    out[prop.trim()] = rest.join(":").trim();
  }
  return out;
}

function layerNameOf(html: string, nodeId: string): string | null {
  return (
    buildCodeLayerProjection(html).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === nodeId,
    )?.layerName ?? null
  );
}

function hasNode(html: string, nodeId: string): boolean {
  return html.includes(`data-agent-native-node-id="${nodeId}"`);
}

async function parentIdsOf(
  page: Page,
  html: string,
): Promise<Record<string, string | null>> {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    const parentIds: Record<string, string | null> = {};
    for (const node of Array.from(
      doc.querySelectorAll<HTMLElement>("[data-agent-native-node-id]"),
    )) {
      const id = node.getAttribute("data-agent-native-node-id");
      if (!id) continue;
      parentIds[id] =
        node.parentElement
          ?.closest<HTMLElement>("[data-agent-native-node-id]")
          ?.getAttribute("data-agent-native-node-id") ?? null;
    }
    return parentIds;
  }, html);
}

async function parentIdOf(
  page: Page,
  html: string,
  nodeId: string,
): Promise<string | null> {
  return (await parentIdsOf(page, html))[nodeId] ?? null;
}

async function textPrimitiveNodeIds(
  page: Page,
  filename: string,
  text: string,
): Promise<string[]> {
  const content = await fileContent(page, filename);
  const ids: string[] = await page.evaluate(
    ({ html, text }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return Array.from(doc.querySelectorAll("[data-agent-native-node-id]"))
        .filter((el) => (el.textContent ?? "").trim() === text)
        .map((el) => el.getAttribute("data-agent-native-node-id")!);
    },
    { html: content, text },
  );
  return [...new Set(ids)];
}

async function waitForTextPrimitiveNodeId(
  page: Page,
  filename: string,
  text: string,
): Promise<string> {
  let ids: string[] = [];
  await expect
    .poll(
      async () => {
        ids = await textPrimitiveNodeIds(page, filename, text);
        return ids.length;
      },
      {
        timeout: 15_000,
        message: `text node ${JSON.stringify(text)} must persist before continuing`,
      },
    )
    .toBe(1);
  return ids[0]!;
}

async function placeText(
  page: Page,
  card: { x: number; y: number; width: number; height: number },
  text: string,
): Promise<void> {
  await pressToolKey(page, "t");
  await expect(toolButton(page, "Text")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.mouse.click(card.x + card.width * 0.5, card.y + card.height - 24);
  await page.waitForTimeout(200);
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await page.keyboard.press("v");
  await page.waitForTimeout(200);
}

/** Draw a shape with the given tool key from (x,y) to (x+w,y+h). */
async function drawShape(
  page: Page,
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<void> {
  await pressToolKey(page, key);
  await page.waitForTimeout(150);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + w, y + h, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press("v");
  await page.waitForTimeout(150);
}

async function renameLayerViaPanel(
  page: Page,
  currentName: string,
  nextName: string,
): Promise<void> {
  const searchButton = page.getByRole("button", {
    name: "Search layers...",
    exact: true,
  });
  const searchInput = page.getByPlaceholder("Search layers...");
  if (!(await searchInput.isVisible().catch(() => false))) {
    await searchButton.click();
    await expect(searchInput).toBeVisible();
  }
  await searchInput.fill(currentName);
  const row = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${currentName}"]`) })
    .first();
  await expect(row).toBeVisible();
  await row.click({ force: true });
  await page.waitForTimeout(300);
  const nodeId = await row.getAttribute("data-layer-node-id");
  if (!nodeId) throw new Error(`layer node "${currentName}" has no id`);
  const stableRow = page
    .getByRole("tree", { name: "Layers" })
    .locator(`[data-layer-row-button][data-layer-node-id="${nodeId}"]`);
  await stableRow.dblclick({ force: true });
  const input = stableRow.locator("input");
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(nextName);
  await input.press("Enter");
  await searchInput.fill("");
}

function layerRowByName(page: Page, name: string): Locator {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
}

async function expectLayerSelectedByName(
  page: Page,
  name: string,
): Promise<void> {
  const button = layerRowByName(page, name);
  await expect(button).toBeVisible();
  await expect(
    button.locator('xpath=ancestor::*[@role="treeitem"]'),
  ).toHaveAttribute("aria-selected", "true");
}

test.describe("parity: Figma Tutorial 5 - interactive button component (in-screen build)", () => {
  test("step 1a: Frame tool draws a nested frame with Figma defaults (white fill, clips content)", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 Icon Frame",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const card = await homeScreenCard(page).boundingBox();
    if (!card) throw new Error("no screen card box");
    // Draw a small 24x24-ish frame near the bottom of the fixture screen.
    const x = card.x + card.width * 0.5;
    const y = card.y + card.height - 80;
    await drawShape(page, "f", x, y, 48, 48);

    await page.waitForTimeout(300);
    const html = await fileContent(page, "index.html");
    // Find the most-recently-added frame-like node (a data-agent-native-node-id
    // wrapper not present in the seed fixture).
    const allIds = [
      ...new Set(
        [...html.matchAll(/data-agent-native-node-id="([^"]+)"/g)].map(
          (m) => m[1]!,
        ),
      ),
    ];
    const knownSeedIds = [
      "e2e-alpha-button",
      "e2e-beta-button",
      "e2e-component-button",
      "e2e-token-sample",
      "e2e-audit-image",
      "e2e-audit-input",
      "e2e-audit-focus-button",
    ];
    const newIds = allIds.filter((id) => !knownSeedIds.includes(id));
    expect(
      newIds.length,
      "expected the Frame tool to add a new node",
    ).toBeGreaterThan(0);
    const frameId = newIds[newIds.length - 1]!;
    const style = styleOf(html, frameId);

    test.info().annotations.push({
      type: "frame-tool-defaults",
      description: JSON.stringify(style),
    });
    expect(
      /fff|white|rgb\(\s*255,\s*255,\s*255\s*\)/i.test(
        style["background"] ?? style["background-color"] ?? "",
      ),
      `Figma's Frame tool gives a fresh frame a white fill; got background="${style["background"]}" background-color="${style["background-color"]}"`,
    ).toBe(true);
    expect(
      style["overflow"],
      "Figma's Frame tool turns clip content ON by default",
    ).toBe("hidden");
  });

  test("step 1b: Rectangle tool draws a shape parented inside the enclosing frame", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 Rect In Frame",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const card = await homeScreenCard(page).boundingBox();
    if (!card) throw new Error("no screen card box");
    const fx = card.x + card.width * 0.5;
    const fy = card.y + card.height - 120;
    await drawShape(page, "f", fx, fy, 80, 80);
    await page.waitForTimeout(300);

    let html = await fileContent(page, "index.html");
    const knownSeedIds = new Set([
      "e2e-alpha-button",
      "e2e-beta-button",
      "e2e-component-button",
      "e2e-token-sample",
      "e2e-audit-image",
      "e2e-audit-input",
      "e2e-audit-focus-button",
    ]);
    let allIds = [
      ...new Set(
        [...html.matchAll(/data-agent-native-node-id="([^"]+)"/g)].map(
          (m) => m[1]!,
        ),
      ),
    ];
    const frameId = allIds.filter((id) => !knownSeedIds.has(id)).pop()!;
    expect(frameId, "expected the new frame to exist").toBeTruthy();

    // Draw a rectangle centered inside that frame's on-canvas bounds.
    const frameNode = designFrame(page)
      .locator(`[data-agent-native-node-id="${frameId}"]`)
      .first();
    const frameBox = await frameNode.boundingBox();
    if (!frameBox) throw new Error("no bounding box for new frame");
    const rx = frameBox.x + frameBox.width * 0.5 - 10;
    const ry = frameBox.y + frameBox.height * 0.5 - 12;
    await drawShape(page, "r", rx, ry, 20, 24);
    await page.waitForTimeout(300);

    html = await fileContent(page, "index.html");
    allIds = [
      ...new Set(
        [...html.matchAll(/data-agent-native-node-id="([^"]+)"/g)].map(
          (m) => m[1]!,
        ),
      ),
    ];
    const rectId = allIds
      .filter((id) => !knownSeedIds.has(id) && id !== frameId)
      .pop();
    expect(
      rectId,
      "expected the Rectangle tool to add a new node",
    ).toBeTruthy();
    const parentId = await parentIdOf(page, html, rectId!);
    expect(
      parentId,
      `expected the rectangle drawn inside the frame's bounds to be parented under ${frameId}, got parent ${parentId}`,
    ).toBe(frameId);
  });

  test("step 1c: Shift+X swaps fill and stroke colors (peer-owned inspector shortcut)", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(page, "E2E Tutorial 5 Shift X");
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    await selectByText(page, "Alpha Button");
    let html = await fileContent(page, "index.html");
    const before = styleOf(html, "e2e-alpha-button");
    const fillBefore = before["background"] ?? before["background-color"] ?? "";
    const borderBefore = before["border-color"] ?? before["border"] ?? "";

    await page.keyboard.press("Shift+X");
    await page.waitForTimeout(300);

    html = await fileContent(page, "index.html");
    const after = styleOf(html, "e2e-alpha-button");
    const fillAfter = after["background"] ?? after["background-color"] ?? "";
    const borderAfter = after["border-color"] ?? after["border"] ?? "";

    test.info().annotations.push({
      type: "shift-x-swap",
      description: `fill ${fillBefore} -> ${fillAfter}; border ${borderBefore} -> ${borderAfter}`,
    });
    expect(
      fillAfter !== fillBefore || borderAfter !== borderBefore,
      "Shift+X should swap the fill and stroke colors on the selected node",
    ).toBe(true);
  });

  test("step 2: Enter opens vector edit mode and Escape preserves the shape", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 Vector Edit",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const card = await homeScreenCard(page).boundingBox();
    if (!card) throw new Error("no screen card box");
    await drawShape(page, "r", card.x + 40, card.y + 40, 40, 40);
    await page.waitForTimeout(300);

    const before = await fileContent(page, "index.html");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    await expect(page.locator("[data-vector-anchor]")).toHaveCount(4);

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-vector-edit-overlay]")).toHaveCount(0);
    expect(await fileContent(page, "index.html")).toBe(before);
  });

  test("step 2b: Cmd+Opt+K annotates a frame as a component (closest equivalent; no component/variant system)", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 Frame Component",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const card = await homeScreenCard(page).boundingBox();
    if (!card) throw new Error("no screen card box");
    await drawShape(page, "f", card.x + card.width * 0.5, card.y + 60, 48, 48);
    await page.waitForTimeout(300);

    let html = await fileContent(page, "index.html");
    const knownSeedIds = new Set([
      "e2e-alpha-button",
      "e2e-beta-button",
      "e2e-component-button",
      "e2e-token-sample",
      "e2e-audit-image",
      "e2e-audit-input",
      "e2e-audit-focus-button",
    ]);
    const frameId = [
      ...new Set(
        [...html.matchAll(/data-agent-native-node-id="([^"]+)"/g)].map(
          (m) => m[1]!,
        ),
      ),
    ]
      .filter((id) => !knownSeedIds.has(id))
      .pop()!;
    expect(frameId).toBeTruthy();

    // Select the frame on canvas (it has no text, so selectByText can't
    // target it) before invoking the create-component hotkey.
    const frameNode = designFrame(page)
      .locator(`[data-agent-native-node-id="${frameId}"]`)
      .first();
    const frameBox = await frameNode.boundingBox();
    if (!frameBox) throw new Error("no bounding box for new frame");
    await page.mouse.click(
      frameBox.x + frameBox.width / 2,
      frameBox.y + frameBox.height / 2,
    );
    await page.waitForTimeout(300);

    const primary = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${primary}+Alt+K`);
    await page.waitForTimeout(600);

    html = await fileContent(page, "index.html");
    const isAnnotatedComponent = new RegExp(
      `data-agent-native-node-id="${frameId}"[^>]*data-agent-native-component=`,
    ).test(html);
    expect(
      isAnnotatedComponent,
      "Cmd+Alt+K should annotate the frame with data-agent-native-component",
    ).toBe(true);
  });

  test("step 3 (no equivalent): no 'Create variant' affordance exists for an annotated component", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 No Variant Affordance",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    await selectByText(page, "Variant CTA");
    await page.waitForTimeout(300);
    const createVariant = page.getByRole("button", { name: /create variant/i });
    const addVariant = page.getByRole("menuitem", { name: /add variant/i });
    expect(await createVariant.count()).toBe(0);
    expect(await addVariant.count()).toBe(0);
  });

  test("step 4: rename supports a slash-delimited component-style name (button/default/unsaved)", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 Slash Rename",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const card = await homeScreenCard(page).boundingBox();
    if (!card) throw new Error("no screen card box");
    await placeText(page, card, "Save");

    const textId = await waitForTextPrimitiveNodeId(page, "index.html", "Save");
    const originalHtml = await fileContent(page, "index.html");
    const originalParentId = await parentIdOf(page, originalHtml, textId);
    expect(originalParentId, "new text needs its original parent").toBeTruthy();
    // Figma keeps newly-created text selected after Escape exits text editing;
    // this direct sequence catches a stale Screen selection before Shift+A.
    await expectLayerSelectedByName(page, "Save");
    await page.keyboard.press("Shift+A");

    let html = await fileContent(page, "index.html");
    let wrapperId: string | null = null;
    await expect
      .poll(
        async () => {
          html = await fileContent(page, "index.html");
          wrapperId = await parentIdOf(page, html, textId);
          return wrapperId === originalParentId ? null : wrapperId;
        },
        {
          timeout: 15_000,
          message:
            "Shift+A should persist a new parent around the selected text",
        },
      )
      .toBeTruthy();
    expect(
      wrapperId,
      "Shift+A should wrap only the selected new text layer",
    ).not.toBe(originalParentId);
    expect(styleOf(html, wrapperId!)!.display).toBe("flex");
    const wrapperName = layerNameOf(html, wrapperId!) ?? "Group";

    await renameLayerViaPanel(page, wrapperName, "button/default/unsaved");
    await expect
      .poll(async () =>
        layerNameOf(await fileContent(page, "index.html"), wrapperId!),
      )
      .toBe("button/default/unsaved");
  });

  test("step 5: Alt-drag duplicates a frame into another frame, gap set via auto-layout inspector", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 Alt Drag Icon",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const card = await homeScreenCard(page).boundingBox();
    if (!card) throw new Error("no screen card box");

    // Build the "button" auto-layout frame (text -> Shift+A).
    await placeText(page, card, "Save");
    const textId = await waitForTextPrimitiveNodeId(page, "index.html", "Save");
    const initialHtml = await fileContent(page, "index.html");
    const initialParentId = await parentIdOf(page, initialHtml, textId);
    expect(initialParentId, "new text needs its original parent").toBeTruthy();
    await expectLayerSelectedByName(page, "Save");
    await page.keyboard.press("Shift+A");
    let html = await fileContent(page, "index.html");
    let buttonFrameIdCandidate: string | null = null;
    await expect
      .poll(
        async () => {
          html = await fileContent(page, "index.html");
          buttonFrameIdCandidate = await parentIdOf(page, html, textId);
          return buttonFrameIdCandidate === initialParentId
            ? null
            : buttonFrameIdCandidate;
        },
        {
          timeout: 15_000,
          message: "Shift+A wrapper must persist before the Alt-drag setup",
        },
      )
      .toBeTruthy();
    const buttonFrameId = buttonFrameIdCandidate!;
    expect(buttonFrameId).not.toBe(initialParentId);
    expect(styleOf(html, buttonFrameId).display).toBe("flex");

    // Build a small standalone "icon" frame elsewhere on the same screen.
    const iconOrigin = { x: card.x + 60, y: card.y + 60 };
    await drawShape(page, "f", iconOrigin.x, iconOrigin.y, 24, 24);
    await page.waitForTimeout(300);
    html = await fileContent(page, "index.html");
    const knownIds = new Set([
      "e2e-alpha-button",
      "e2e-beta-button",
      "e2e-component-button",
      "e2e-token-sample",
      "e2e-audit-image",
      "e2e-audit-input",
      "e2e-audit-focus-button",
      textId,
      buttonFrameId,
    ]);
    const iconFrameId = [
      ...new Set(
        [...html.matchAll(/data-agent-native-node-id="([^"]+)"/g)].map(
          (m) => m[1]!,
        ),
      ),
    ]
      .filter((id) => !knownIds.has(id))
      .pop()!;
    expect(iconFrameId, "expected a new icon frame").toBeTruthy();
    const iconNode = designFrame(page)
      .locator(`[data-agent-native-node-id="${iconFrameId}"]`)
      .first();
    await expect(iconNode).toBeVisible();

    // Alt-drag the icon frame into the button frame.
    const iconBox = await iconNode.boundingBox();
    const buttonNode = designFrame(page)
      .locator(`[data-agent-native-node-id="${buttonFrameId}"]`)
      .first();
    const buttonBox = await buttonNode.boundingBox();
    if (!iconBox || !buttonBox) throw new Error("missing bounding boxes");

    await page.mouse.move(
      iconBox.x + iconBox.width / 2,
      iconBox.y + iconBox.height / 2,
    );
    await page.keyboard.down("Alt");
    await page.mouse.down();
    const targetX = buttonBox.x + 8;
    const targetY = buttonBox.y + buttonBox.height / 2;
    await page.mouse.move(
      (iconBox.x + targetX) / 2,
      (iconBox.y + targetY) / 2,
      { steps: 8 },
    );
    await page.mouse.move(targetX, targetY, { steps: 8 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.keyboard.up("Alt");
    let parentIds: Record<string, string | null> = {};
    let copyId: string | undefined;
    await expect
      .poll(
        async () => {
          html = await fileContent(page, "index.html");
          parentIds = await parentIdsOf(page, html);
          const allIds = [
            ...new Set(
              [...html.matchAll(/data-agent-native-node-id="([^"]+)"/g)].map(
                (m) => m[1]!,
              ),
            ),
          ];
          copyId = allIds.find(
            (id) =>
              id !== iconFrameId &&
              id !== textId &&
              parentIds[id] === buttonFrameId,
          );
          return copyId ?? null;
        },
        { timeout: 10_000, message: "alt-drag copy must persist" },
      )
      .toBeTruthy();
    // The original icon frame must still exist untouched (alt-drag copies).
    expect(hasNode(html, iconFrameId)).toBe(true);
    const copyName = copyId ? layerNameOf(html, copyId) : null;
    test.info().annotations.push({
      type: "alt-drag-copy-id",
      description: String(copyId),
    });
    expect(
      copyId,
      "expected an alt-drag copy as a second child of the button frame",
    ).toBeTruthy();
    expect(
      copyName,
      "the duplicated frame should preserve its authored layer name",
    ).toBe("Frame");
    expect(
      parentIds[copyId!],
      "expected the copy to be reparented into the button frame it was dropped on",
    ).toBe(buttonFrameId);

    // One undo should remove exactly the copy (alt-drag = one undo step).
    const primary = process.platform === "darwin" ? "Meta" : "Control";
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await page.keyboard.press(`${primary}+Z`);
    await page.waitForTimeout(300);
    html = await fileContent(page, "index.html");
    expect(
      hasNode(html, copyId!),
      "one undo of the alt-drag should remove the copy",
    ).toBe(false);
    expect(hasNode(html, iconFrameId)).toBe(true);

    // Set the auto-layout gap via the inspector after the history assertion so
    // that the style edit cannot become the duplicate's undo predecessor.
    const buttonLayer = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Frame 2", exact: true });
    await expect(buttonLayer).toBeVisible();
    await buttonLayer.click();
    await page.waitForTimeout(250);
    const autoLayoutSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /Auto layout/i }) })
      .first();
    const gapInput = autoLayoutSection
      .locator('input[aria-label="Gap" i]')
      .first();
    let gapApplied = false;
    if ((await gapInput.count()) > 0) {
      await gapInput.fill("12");
      await gapInput.press("Enter");
      await expect
        .poll(
          async () => {
            html = await fileContent(page, "index.html");
            return /12px/.test(styleOf(html, buttonFrameId)["gap"] ?? "");
          },
          { timeout: 10_000, message: "auto-layout gap did not persist" },
        )
        .toBe(true);
      gapApplied = true;
    }
    test.info().annotations.push({
      type: "gap-applied",
      description: String(gapApplied),
    });
    expect(
      gapApplied,
      "auto-layout gap 12 was not applied to the button frame",
    ).toBe(true);
  });

  test("step 6 (no equivalent): no boolean component-property affordance ('Show label'/'Show icon')", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 No Boolean Props",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    await selectByText(page, "Variant CTA");
    await page.waitForTimeout(300);
    const addProperty = page.getByRole("button", {
      name: /add.*propert(y|ies)/i,
    });
    expect(await addProperty.count()).toBe(0);
  });

  test("step 7 (no equivalent): no 'Add variant' state x status grid exists", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 No Variant Grid",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    await selectByText(page, "Variant CTA");
    await page.waitForTimeout(300);
    const target = designFrame(page)
      .locator(`[data-agent-native-node-id="e2e-component-button"]`)
      .first();
    await expect(
      target,
      "e2e-component-button must be rendered to right-click it",
    ).toBeVisible({
      timeout: 10_000,
    });
    await target.click({ force: true, button: "right" });
    const menuItem = page.getByRole("menuitem", { name: /variant/i });
    expect(await menuItem.count()).toBe(0);
  });

  test("step 8 (no equivalent): no Prototype tab / interaction-trigger UI exists", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 No Prototype Tab",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    await selectByText(page, "Variant CTA");
    const prototypeTab = page.getByRole("tab", { name: /prototype/i });
    const smartAnimate = page.getByText(/smart animate/i);
    expect(await prototypeTab.count()).toBe(0);
    expect(await smartAnimate.count()).toBe(0);
  });

  test("step 9: Interact view is the closest equivalent to Figma's Preview (Shift+Space)", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 Interact Preview",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    // Design has no Shift+Space preview shortcut; the closest equivalent is
    // the per-screen Interact view, which keeps the editor rails mounted while
    // rendering the screen live (see helpers.ts enterInteractView). The
    // overview action is an in-place preview, so there is no responsive-mode
    // Exit button to assert here.
    await enterInteractView(page);
    await expect(page.locator("[data-screen-shell]").last()).toBeVisible();
    await expect(
      page.locator("iframe[data-design-preview-iframe]").last(),
    ).toBeVisible();
  });

  test.afterEach(async ({ request }) => {
    if (currentDesignId) await deleteDesign(request, currentDesignId);
    currentDesignId = "";
  });
});

test.describe("parity: Tutorial 5 - overview canvas (outside any screen) and cross-boundary", () => {
  test("Frame tool on empty overview canvas creates a board-object frame with the same white-fill default", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 Board Frame",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const { x: outsideX, y: outsideY } = await emptyBoardPoint(page);

    const before = new Set(Object.keys(await boardObjects(page)));
    await pressToolKey(page, "f");
    await page.mouse.move(outsideX, outsideY);
    await page.mouse.down();
    await page.mouse.move(outsideX + 60, outsideY + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const newFrameIds = async () =>
      Object.keys(await boardObjects(page)).filter(
        (id) => !before.has(id) && !id.startsWith("draft-"),
      );
    await expect
      .poll(newFrameIds, {
        timeout: 10_000,
        message: "one Frame-tool gesture must create exactly one board frame",
      })
      .toHaveLength(1);
    const [frameId] = await newFrameIds();
    if (!frameId) throw new Error("Frame-tool gesture created no board frame");
    const box = await boardObjectBoundingBox(page, frameId);
    expect(
      box,
      "board-object-camera-and-click: harness could not locate the created board frame",
    ).not.toBeNull();
    expect(
      box!.width,
      "created board frame must have a real width",
    ).toBeGreaterThan(0);
    expect(
      box!.height,
      "created board frame must have a real height",
    ).toBeGreaterThan(0);
  });

  test("Alt-drag duplicates a board-object frame outside any screen", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 Board Alt Drag",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const { x: outsideX, y: outsideY } = await emptyBoardPoint(page, 160);

    await expect
      .poll(
        async () => {
          try {
            return (await fileContent(page, "__board__.html")).length > 0;
          } catch {
            return false;
          }
        },
        {
          timeout: 15_000,
          message: "board file should be ready before drawing",
        },
      )
      .toBe(true);
    const beforeDraw = new Set(Object.keys(await boardObjects(page)));
    await pressToolKey(page, "r");
    // A plain click (no drag) never committed a shape here — draw it with a
    // real drag instead (proven reliable elsewhere in this suite).
    await page.mouse.move(outsideX, outsideY);
    await page.mouse.down();
    await page.mouse.move(outsideX + 100, outsideY + 100, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const shapeId = await waitForNewBoardObjectId(page, beforeDraw);
    // Drawing a shape leaves the Rectangle tool itself still armed — a
    // mouse-down on the shape without switching back to Move would start
    // drawing a SECOND shape instead of alt-dragging the existing one.
    await pressToolKey(page, "v");
    await page.waitForTimeout(200);
    const countBefore = Object.keys(await boardObjects(page)).length;
    const dragBox = await waitForBoardObjectBoundingBox(page, shapeId);
    const dropPoint = await emptyBoardPoint(page);

    await page.mouse.move(
      dragBox.x + dragBox.width / 2,
      dragBox.y + dragBox.height / 2,
    );
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 10 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.waitForTimeout(400);
    await expect
      .poll(async () => Object.keys(await boardObjects(page)).length, {
        timeout: 15_000,
        message:
          "alt-drag on the overview canvas should duplicate the board object",
      })
      .toBe(countBefore + 1);
    expect(await boardObjects(page)).toHaveProperty(shapeId);
  });

  test("Dragging the built button frame out of the screen onto the board, then back in, reparents it both ways", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 5 Button Cross Boundary",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const card = await homeScreenCard(page).boundingBox();
    if (!card) throw new Error("no screen card box");
    await placeText(page, card, "Save");
    const textId = await waitForTextPrimitiveNodeId(page, "index.html", "Save");
    // tutorial5-10 (test-authoring bug, fixed): this pressed "Shift+A", which
    // is not bound to anything — Frame selection's real shortcut is Figma's
    // Cmd+Alt+G (useDesignHotkeys.ts's onFrameSelection, gated on
    // event.altKey), matching every other Frame-selection e2e in this suite
    // (parity-group-frame.spec.ts, parity-tutorial-8.spec.ts). The wrong
    // shortcut silently no-opped, so `buttonFrameId` below resolved to the
    // text's actual DOM parent (the screen's own <body>) instead of a real
    // wrapper frame, and "dragging the button frame out of the screen" was
    // actually dragging the screen's own root — which can never leave it.
    // Clear the creation selection so selectByText observes a real transition
    // after the debounced publication settles.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await selectByText(page, "Save");
    const primary = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${primary}+Alt+g`);
    await page.waitForTimeout(400);
    let html = await fileContent(page, "index.html");
    const buttonFrameId = (await parentIdOf(page, html, textId))!;
    expect(buttonFrameId).toBeTruthy();
    expect(layerNameOf(html, buttonFrameId!)).toBe("Frame");

    // Frame selection wraps the text at its intrinsic size. Give the wrapper
    // real background area so the drag starts on the frame, not its text leaf.
    const widthInput = page.getByLabel("W size in pixels");
    const heightInput = page.getByLabel("H size in pixels");
    await widthInput.fill("120");
    await widthInput.press("Enter");
    await heightInput.fill("48");
    await heightInput.press("Enter");
    await expect
      .poll(async () => {
        const nextHtml = await fileContent(page, "index.html");
        const style = styleOf(nextHtml, buttonFrameId!);
        return style.width === "120px" && style.height === "48px";
      })
      .toBe(true);

    const target = homeScreenCard(page)
      .locator("iframe[data-design-preview-iframe]")
      .contentFrame()
      .locator(`[data-agent-native-node-id="${buttonFrameId}"]`)
      .first();
    const box = await target.boundingBox();
    if (!box) throw new Error("no bounding box for button frame");
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    // A fixed offset from the screen shell can land on left-shell chrome
    // instead of open canvas — scan for a real empty point instead.
    const { x: outsideX, y: outsideY } = await emptyBoardPoint(page);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + outsideX) / 2, (startY + outsideY) / 2, {
      steps: 8,
    });
    await page.mouse.move(outsideX, outsideY, { steps: 8 });
    await page.waitForTimeout(150);
    await page.mouse.up();

    let indexHtml = await fileContent(page, "index.html");
    let boardHtml = await fileContent(page, "__board__.html");
    await expect
      .poll(
        async () => {
          indexHtml = await fileContent(page, "index.html");
          boardHtml = await fileContent(page, "__board__.html");
          return (
            !hasNode(indexHtml, buttonFrameId) &&
            boardHtml.includes(buttonFrameId)
          );
        },
        {
          timeout: 15_000,
          message: "screen-to-board reparent must persist in both files",
        },
      )
      .toBe(true);
    expect(
      hasNode(indexHtml, buttonFrameId),
      "dragging the button frame out of the screen should remove it from index.html",
    ).toBe(false);
    expect(
      boardHtml.includes(buttonFrameId),
      "dragging out onto open canvas should reparent it into the board",
    ).toBe(true);

    const boardNode = page
      .locator("[data-board-surface-layer] iframe[data-design-preview-iframe]")
      .contentFrame()
      .locator(`[data-agent-native-node-id="${buttonFrameId}"]`)
      .first();
    const boardBox = await boardNode.boundingBox();
    if (!boardBox)
      throw new Error("could not find board node after reparent-out");
    const backX = card.x + card.width * 0.5;
    const backY = card.y + card.height * 0.5;
    await page.mouse.move(
      boardBox.x + boardBox.width / 2,
      boardBox.y + boardBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move((boardBox.x + backX) / 2, (boardBox.y + backY) / 2, {
      steps: 8,
    });
    await page.mouse.move(backX, backY, { steps: 8 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect
      .poll(
        async () => {
          indexHtml = await fileContent(page, "index.html");
          return hasNode(indexHtml, buttonFrameId);
        },
        {
          timeout: 15_000,
          message: "board-to-screen reparent must persist in index.html",
        },
      )
      .toBe(true);
    expect(
      hasNode(indexHtml, buttonFrameId),
      "dragging back onto the screen should reparent it back into index.html",
    ).toBe(true);
  });

  test.afterEach(async ({ request }) => {
    if (currentDesignId) await deleteDesign(request, currentDesignId);
    currentDesignId = "";
  });
});
