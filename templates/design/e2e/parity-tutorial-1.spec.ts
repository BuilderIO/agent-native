import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  createFixtureDesign,
  designFrame,
  elementInner,
  gotoEditor,
  installBridge,
  selectByText,
} from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";


let baseURLForActions: string;

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

async function fileContent(page: Page, filename: string): Promise<string> {
  const params = new URLSearchParams({ id: currentDesignId });
  const res = await page.request.get(
    `${baseURLForActions}/_agent-native/actions/get-design?${params}`,
    { headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok()) throw new Error(`get-design failed: ${res.status()}`);
  const payload = await res.json();
  const design = [
    payload,
    payload?.result,
    payload?.design,
    payload?.data,
  ].find((candidate) => Array.isArray(candidate?.files));
  const file = design?.files?.find(
    (candidate: { filename?: string }) => candidate.filename === filename,
  );
  if (typeof file?.content !== "string") {
    throw new Error(`${filename} has no content`);
  }
  return file.content;
}

let currentDesignId = "";

async function boardObjects(page: Page): Promise<Record<string, true>> {
  const html = await fileContent(page, "__board__.html");
  const result: Record<string, true> = {};
  for (const match of html.matchAll(/data-agent-native-node-id="([^"]+)"/g)) {
    result[match[1]!] = true;
  }
  return result;
}

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

async function emptyBoardPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const r = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-iframe-id]"),
    ).map((el) => el.getBoundingClientRect());
    for (let y = r.top + 60; y < r.bottom - 60; y += 40) {
      for (let x = r.left + 60; x < r.right - 60; x += 40) {
        if (
          cards.some(
            (c) =>
              x >= c.left - 24 &&
              x <= c.right + 24 &&
              y >= c.top - 24 &&
              y <= c.bottom + 24,
          )
        )
          continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty canvas point found");
  return point;
}

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
  await page.mouse.click(
    card.x + card.width * 0.5,
    card.y + card.height * 0.85,
  );
  await page.waitForTimeout(200);
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await page.keyboard.press("v");
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
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
  const marker = `data-agent-native-node-id="${nodeId}"`;
  const openIndex = html.indexOf(marker);
  if (openIndex < 0) return null;
  const tagStart = html.lastIndexOf("<", openIndex);
  const tagEnd = html.indexOf(">", openIndex);
  const tag = html.slice(tagStart, tagEnd + 1);
  return /data-agent-native-layer-name="([^"]*)"/.exec(tag)?.[1] ?? null;
}

function hasNode(html: string, nodeId: string): boolean {
  return html.includes(`data-agent-native-node-id="${nodeId}"`);
}

async function nodePlacement(page: Page, html: string, nodeId: string) {
  return page.evaluate(
    ({ html, nodeId }) => {
      const node = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector(`[data-agent-native-node-id="${nodeId}"]`);
      if (!node?.parentElement) return null;
      return {
        parent: node.parentElement.getAttribute("data-agent-native-node-id"),
        siblingIndex: Array.from(node.parentElement.children).indexOf(node),
        left: (node as HTMLElement).style.left,
        top: (node as HTMLElement).style.top,
      };
    },
    { html, nodeId },
  );
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
  const nodeId = await row.getAttribute("data-layer-node-id");
  const stableRow = page
    .getByRole("tree", { name: "Layers" })
    .locator(`[data-layer-row-button][data-layer-node-id="${nodeId}"]`);
  await stableRow.click({ force: true });
  await page.waitForTimeout(300);
  await stableRow.dblclick({ force: true });
  const input = stableRow.locator("input");
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(nextName);
  await input.press("Enter");
  await searchInput.fill("");
}

function inspectorSection(page: Page, title: RegExp | string): Locator {
  const heading =
    typeof title === "string"
      ? page.getByRole("heading", { name: title, exact: true })
      : page.getByRole("heading", { name: title });
  return page.locator("section").filter({ has: heading }).first();
}

async function setScrubInput(
  scope: Page | Locator,
  label: string,
  value: string,
): Promise<void> {
  const input = scope.locator(`input[aria-label="${label}" i]`).first();
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(value);
  await input.press("Enter");
}

test.describe("parity: Figma Tutorial 1 - create a simple button component", () => {
  test("step 1: Text tool click + type creates a text node with the typed content", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(page, "E2E Tutorial 1 Step 1");
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const card = await homeScreenCard(page).boundingBox();
    if (!card) throw new Error("no screen card box");
    await placeText(page, card, "Button");

    const textIds = await textPrimitiveNodeIds(page, "index.html", "Button");
    expect(textIds.length, "expected one text node with content 'Button'").toBe(
      1,
    );

    const html = await fileContent(page, "index.html");
    expect(layerNameOf(html, textIds[0]!)).toBe("Button");
  });

  test("step 2: double-click a layer row in the panel enters rename mode", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(page, "E2E Tutorial 1 Step 2");
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    await renameLayerViaPanel(page, "Alpha Button", "Renamed Alpha");
    await expect
      .poll(async () =>
        layerNameOf(await fileContent(page, "index.html"), "e2e-alpha-button"),
      )
      .toBe("Renamed Alpha");
  });

  test("steps 4-5, 11: Shift+A wraps a text leaf in a hug-contents frame; retyping auto-resizes it", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(page, "E2E Tutorial 1 Step 4");
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const card = await homeScreenCard(page).boundingBox();
    if (!card) throw new Error("no screen card box");
    await placeText(page, card, "Button");

    let textIds = await textPrimitiveNodeIds(page, "index.html", "Button");
    expect(textIds.length, "expected one text node with content 'Button'").toBe(
      1,
    );
    const textId = textIds[0]!;
    const selectPayload = (await selectByText(page, "Button")) as {
      sourceId?: string;
    };
    expect(
      selectPayload?.sourceId,
      "expected the click to resolve straight to the text node, not a container",
    ).toBe(textId);
    await page.keyboard.press("Shift+A");
    await page.waitForTimeout(400);

    let html = await fileContent(page, "index.html");
    const wrapperMatch = new RegExp(
      `data-agent-native-node-id="([^"]+)"[^>]*>(?:(?!data-agent-native-node-id)[\\s\\S])*?data-agent-native-node-id="${textId}"`,
    ).exec(html);
    expect(
      wrapperMatch,
      "expected Shift+A to introduce a wrapping element around the text node",
    ).not.toBeNull();
    const wrapperId = wrapperMatch![1]!;
    expect(wrapperId).not.toBe(textId);

    const wrapperStyleBefore = styleOf(html, wrapperId);
    expect(wrapperStyleBefore["display"]).toBe("flex");

    expect(
      wrapperStyleBefore["width"],
      "Horizontal resizing should default to Hug contents (fit-content)",
    ).toBe("fit-content");
    expect(
      wrapperStyleBefore["height"],
      "Vertical resizing should default to Hug contents (fit-content)",
    ).toBe("fit-content");

    const wrapperNameBefore = layerNameOf(html, wrapperId);
    test.info().annotations.push({
      type: "auto-layout-wrapper-default-name",
      description: `expected "Frame", got "${wrapperNameBefore}"`,
    });
    expect(
      wrapperNameBefore,
      'Figma names a Shift+A single-object auto-layout wrapper "Frame" or the next sequential "Frame N"',
    ).toMatch(/^Frame(?: \d+)?$/);

    const widthBefore = (
      await designFrame(page)
        .getByText("Button", { exact: true })
        .first()
        .boundingBox()
    )?.width;
    await designFrame(page)
      .getByText("Button", { exact: true })
      .first()
      .dblclick({ force: true });
    await page.waitForTimeout(300);
    const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
    await page.keyboard.press(selectAll);
    await page.keyboard.type("Sign up");
    await page.keyboard.press("Escape");

    const widthAfter = (
      await designFrame(page)
        .getByText("Sign up", { exact: true })
        .first()
        .boundingBox()
    )?.width;
    expect(widthBefore).toBeTruthy();
    expect(widthAfter).toBeTruthy();
    expect(widthAfter!).toBeGreaterThan(widthBefore! - 1);

    await expect
      .poll(async () => {
        const polledHtml = await fileContent(page, "index.html");
        return hasNode(polledHtml, textId)
          ? elementInner(polledHtml, textId).trim()
          : null;
      })
      .toBe("Sign up");
  });

  test("steps 6-10: fill, stroke, corner radius, drop shadow, padding via inspector (peer-owned)", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 1 Button Styles",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const card = await homeScreenCard(page).boundingBox();
    if (!card) throw new Error("no screen card box");
    await placeText(page, card, "Button");

    const textIds = await textPrimitiveNodeIds(page, "index.html", "Button");
    const textId = textIds[0]!;

    await selectByText(page, "Button");
    await page.keyboard.press("Shift+A");
    await page.waitForTimeout(400);

    let html = await fileContent(page, "index.html");
    const wrapperMatch = new RegExp(
      `data-agent-native-node-id="([^"]+)"[^>]*>(?:(?!data-agent-native-node-id)[\\s\\S])*?data-agent-native-node-id="${textId}"`,
    ).exec(html);
    if (!wrapperMatch)
      throw new Error(
        "auto layout wrap did not produce a wrapper (see other test)",
      );
    const wrapperId = wrapperMatch[1]!;

    const wrapperName = layerNameOf(html, wrapperId) ?? "Group";
    const searchInput = page.getByPlaceholder("Search layers...");
    if (!(await searchInput.isVisible().catch(() => false))) {
      await page
        .getByRole("button", { name: "Search layers...", exact: true })
        .click();
    }
    await searchInput.fill(wrapperName);
    const row = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button][data-layer-node-id]")
      .filter({ has: page.locator(`span[title="${wrapperName}"]`) })
      .first();
    await expect(row).toBeVisible();
    await row.click({ force: true });
    await searchInput.fill("");

    const fillSection = inspectorSection(page, /^Fill$/i);
    const addFill = fillSection.getByRole("button", { name: "Add fill" });
    if ((await addFill.count()) > 0) {
      await addFill.click();
      const hexInput = fillSection
        .locator('input[aria-label*="hex" i]')
        .first();
      if ((await hexInput.count()) > 0) {
        await hexInput.fill("DEB0FB");
        await hexInput.press("Enter");
      }
    }
    await page.waitForTimeout(200);
    html = await fileContent(page, "index.html");
    const fillStyle = styleOf(html, wrapperId);
    const fillApplied =
      /deb0fb/i.test(fillStyle["background-color"] ?? "") ||
      /deb0fb/i.test(fillStyle["background"] ?? "");

    const strokeSection = inspectorSection(page, /^Stroke$/i);
    const addStroke = strokeSection.getByRole("button", { name: "Add stroke" });
    let strokeApplied = false;
    if ((await addStroke.count()) > 0) {
      await addStroke.click();
      await page.waitForTimeout(150);
      const weightInput = strokeSection
        .locator('input[aria-label="Weight" i]')
        .first();
      if ((await weightInput.count()) > 0) {
        await weightInput.fill("1");
        await weightInput.press("Enter");
      }
      html = await fileContent(page, "index.html");
      const strokeStyle = styleOf(html, wrapperId);
      strokeApplied = Boolean(
        strokeStyle["border"] ||
        strokeStyle["outline"] ||
        strokeStyle["border-width"],
      );
    }

    const appearanceSection = inspectorSection(page, /^Appearance$/i);
    let radiusApplied = false;
    try {
      await setScrubInput(appearanceSection, "Corner radius", "1000");
      html = await fileContent(page, "index.html");
      const radiusStyle = styleOf(html, wrapperId);
      radiusApplied = /1000px/.test(radiusStyle["border-radius"] ?? "");
    } catch {
      radiusApplied = false;
    }

    const effectsSection = inspectorSection(page, /^Effects$/i);
    const addEffect = effectsSection.getByRole("button", {
      name: "Add effect",
    });
    let shadowApplied = false;
    if ((await addEffect.count()) > 0) {
      await addEffect.click();
      const dropShadowItem = page.getByRole("menuitem", {
        name: "Drop shadow",
      });
      if ((await dropShadowItem.count()) > 0) {
        await dropShadowItem.click();
        html = await fileContent(page, "index.html");
        const shadowStyle = styleOf(html, wrapperId);
        shadowApplied = Boolean(shadowStyle["box-shadow"]);
      }
    }

    const autoLayoutSection = inspectorSection(page, /Auto layout/i);
    let paddingApplied = false;
    try {
      await setScrubInput(autoLayoutSection, "Left / Right", "32");
      await setScrubInput(autoLayoutSection, "Top / Bottom", "24");
      html = await fileContent(page, "index.html");
      const paddingStyle = styleOf(html, wrapperId);
      paddingApplied =
        /32px/.test(paddingStyle["padding-left"] ?? "") &&
        /24px/.test(paddingStyle["padding-top"] ?? "");
    } catch {
      paddingApplied = false;
    }

    test
      .info()
      .annotations.push(
        { type: "fill-applied", description: String(fillApplied) },
        { type: "stroke-applied", description: String(strokeApplied) },
        { type: "radius-applied", description: String(radiusApplied) },
        { type: "shadow-applied", description: String(shadowApplied) },
        { type: "padding-applied", description: String(paddingApplied) },
      );

    expect(fillApplied, "fill color #DEB0FB was not applied").toBe(true);
    expect(strokeApplied, "stroke was not applied").toBe(true);
    expect(radiusApplied, "corner radius 1000 was not applied").toBe(true);
    expect(shadowApplied, "drop shadow effect was not applied").toBe(true);
    expect(paddingApplied, "horizontal/vertical padding was not applied").toBe(
      true,
    );
  });

  test("step 12 equivalent: Cmd+Alt+K annotates the selection as a component (no Figma component/instance system exists)", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(
      page,
      "E2E Tutorial 1 Create Component",
    );
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const card = await homeScreenCard(page).boundingBox();
    if (!card) throw new Error("no screen card box");
    await placeText(page, card, "Button");

    await selectByText(page, "Button");
    const textIds = await textPrimitiveNodeIds(page, "index.html", "Button");
    const textId = textIds[0]!;

    const primary = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${primary}+Alt+K`);
    await page.waitForTimeout(600);

    const html = await fileContent(page, "index.html");
    const isAnnotatedComponent = html.includes(
      `data-agent-native-node-id="${textId}"`,
    )
      ? new RegExp(
          `data-agent-native-node-id="${textId}"[^>]*data-agent-native-component=`,
        ).test(html)
      : false;

    expect(
      isAnnotatedComponent,
      "Cmd+Alt+K should annotate the selection with data-agent-native-component (closest equivalent to Figma's Create Component; full component/variant system does not exist)",
    ).toBe(true);
  });

  test.afterEach(async ({ request }) => {
    if (currentDesignId) await deleteDesign(request, currentDesignId);
    currentDesignId = "";
  });
});

test.describe("parity: overview-canvas (outside any screen) and cross-boundary steps", () => {
  test("text tool on empty overview canvas creates a free-floating board object, not a screen child", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(page, "E2E Board Text");
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const shellBox = await screenShell(page).boundingBox();
    if (!shellBox) throw new Error("no screen shell box");
    const outsideX = Math.max(20, shellBox.x - 200);
    const outsideY = shellBox.y + 100;

    await pressToolKey(page, "t");
    await page.mouse.click(outsideX, outsideY);
    await page.keyboard.type("Board Label", { delay: 30 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    await expect
      .poll(
        async () => {
          const params = new URLSearchParams({ id: currentDesignId });
          const res = await page.request.get(
            `${baseURLForActions}/_agent-native/actions/get-design?${params}`,
          );
          const payload = await res.json();
          const design = [
            payload,
            payload?.result,
            payload?.design,
            payload?.data,
          ].find((candidate: any) => Array.isArray(candidate?.files));
          const files: { filename?: string; content?: string }[] =
            design?.files ?? [];
          const board = files.find((f) => f.filename === "__board__.html");
          const index = files.find((f) => f.filename === "index.html");
          return {
            boardHasText: Boolean(board?.content?.includes("Board Label")),
            indexHasText: Boolean(index?.content?.includes("Board Label")),
          };
        },
        { timeout: 15_000 },
      )
      .toMatchObject({ boardHasText: true, indexHasText: false });
  });

  test("board object drag-move on overview canvas moves position without entering any screen", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(page, "E2E Board Drag");
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const { x: outsideX, y: outsideY } = await emptyBoardPoint(page);

    const beforeIds = new Set(Object.keys(await boardObjects(page)));
    await pressToolKey(page, "r");
    await page.mouse.click(outsideX, outsideY);

    const newShapeIds = async () =>
      Object.keys(await boardObjects(page)).filter(
        (id) => !beforeIds.has(id) && !id.startsWith("draft-"),
      );
    await expect
      .poll(newShapeIds, {
        timeout: 10_000,
        message: "one rectangle-tool click must create one board shape",
      })
      .toHaveLength(1);
    const [shapeId] = await newShapeIds();
    if (!shapeId) throw new Error("rectangle click created no board shape");

    const before = await boardObjectBoundingBox(page, shapeId);
    expect(
      before,
      "no bounding box for the created board shape",
    ).not.toBeNull();
    await pressToolKey(page, "v");
    await page.waitForTimeout(200);
    await page.mouse.move(
      before!.x + before!.width / 2,
      before!.y + before!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      before!.x + before!.width / 2 + 80,
      before!.y + before!.height / 2 + 40,
      {
        steps: 10,
      },
    );
    await page.mouse.up();
    await page.waitForTimeout(400);

    const after = await boardObjectBoundingBox(page, shapeId);
    expect(after).not.toBeNull();
    expect(Math.abs(after!.x - before!.x - 80)).toBeLessThan(20);
  });

  test("dragging a screen element out onto the board, then back into a screen, reparents it both ways (one undo each)", async ({
    page,
    request,
  }) => {
    currentDesignId = await createFixtureDesign(page, "E2E Cross Boundary");
    await gotoEditor(page, currentDesignId);
    await installBridge(page);

    const card = await homeScreenCard(page).boundingBox();
    if (!card) throw new Error("no screen card box");
    await placeText(page, card, "Cross Boundary");

    await expect
      .poll(
        async () =>
          (await textPrimitiveNodeIds(page, "index.html", "Cross Boundary"))
            .length,
        {
          timeout: 10_000,
          message: "typed Cross Boundary text did not persist as one node",
        },
      )
      .toBe(1);
    const textIds = await textPrimitiveNodeIds(
      page,
      "index.html",
      "Cross Boundary",
    );
    const textId = textIds[0]!;
    const original = await nodePlacement(
      page,
      await fileContent(page, "index.html"),
      textId,
    );
    if (!original) throw new Error("original node missing");

    const target = designFrame(page).getByText("Cross Boundary").first();
    const box = await target.boundingBox();
    if (!box) throw new Error("no bounding box for element");
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const { x: outsideX, y: outsideY } = await emptyBoardPoint(page);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + outsideX) / 2, (startY + outsideY) / 2, {
      steps: 8,
    });
    await page.mouse.move(outsideX, outsideY, { steps: 8 });
    await page.waitForTimeout(150);
    await page.mouse.up();

    const readBoth = async () => {
      const params = new URLSearchParams({ id: currentDesignId });
      const res = await page.request.get(
        `${baseURLForActions}/_agent-native/actions/get-design?${params}`,
      );
      const payload = await res.json();
      const design = [
        payload,
        payload?.result,
        payload?.design,
        payload?.data,
      ].find((candidate: any) => Array.isArray(candidate?.files));
      const files: { filename?: string; content?: string }[] =
        design?.files ?? [];
      return {
        index: files.find((f) => f.filename === "index.html")?.content ?? "",
        board:
          files.find((f) => f.filename === "__board__.html")?.content ?? "",
      };
    };
    await expect
      .poll(
        async () => {
          const result = await readBoth();
          return (
            !hasNode(result.index, textId) && result.board.includes(textId)
          );
        },
        {
          timeout: 10_000,
          message:
            "cross-screen drop must remove the node from index.html and add it to the board file",
        },
      )
      .toBe(true);

    const { index: indexHtmlAfterOut, board: outResult } = await readBoth();
    const leftScreen = !hasNode(indexHtmlAfterOut, textId);
    const enteredBoard = outResult.includes(textId);

    expect(
      leftScreen,
      "dragging out of the screen should remove it from index.html",
    ).toBe(true);
    expect(
      enteredBoard,
      "dragging out onto open canvas should reparent it into the board",
    ).toBe(true);

    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(async () => fileContent(page, "index.html"))
      .toContain(`data-agent-native-node-id="${textId}"`);
    const afterUndoOut = await nodePlacement(
      page,
      await fileContent(page, "index.html"),
      textId,
    );
    expect(afterUndoOut?.parent).toBe(original.parent);
    expect(afterUndoOut?.siblingIndex).toBe(original.siblingIndex);
    expect({
      left: afterUndoOut?.left,
      top: afterUndoOut?.top,
    }).toEqual({ left: original.left, top: original.top });

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect.poll(async () => (await readBoth()).board).toContain(textId);
    const boardBeforeBack = await nodePlacement(
      page,
      await fileContent(page, "__board__.html"),
      textId,
    );
    if (!boardBeforeBack)
      throw new Error("board node missing before return drag");

    const boardBox = await boardObjectBoundingBox(page, textId);
    if (!boardBox)
      throw new Error("could not find board node after reparent-out");
    const cardNow = await homeScreenCard(page).boundingBox();
    if (!cardNow) throw new Error("no screen card box for the return drag");
    const backX = cardNow.x + cardNow.width * 0.5;
    const backY = cardNow.y + cardNow.height * 0.5;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
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
          const result = await readBoth();
          return (
            hasNode(result.index, textId) && !result.board.includes(textId)
          );
        },
        {
          timeout: 10_000,
          message:
            "dragging back onto the screen should reparent it back into index.html and remove it from the board file",
        },
      )
      .toBe(true);

    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(async () => {
        const result = await readBoth();
        return !hasNode(result.index, textId) && result.board.includes(textId);
      })
      .toBe(true);
    const afterUndoBack = await nodePlacement(
      page,
      await fileContent(page, "__board__.html"),
      textId,
    );
    expect(afterUndoBack).toEqual(boardBeforeBack);
  });

  test.afterEach(async ({ request }) => {
    if (currentDesignId) await deleteDesign(request, currentDesignId);
    currentDesignId = "";
  });
});
