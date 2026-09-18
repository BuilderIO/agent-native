import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, canvasZoom, designFrame, gotoEditor } from "./helpers";

/**
 * Figma-parity check for §2 Move / auto-nesting (Part 3 resolutions): drag an
 * element into a container to nest it, drag it back out to the screen root,
 * cross the screen<->board boundary, Space suppresses reparenting, and one
 * undo restores both parent and position after any reparent.
 *
 * Fixture: screen "index.html" has header/main/footer landmark containers
 * with root gaps between them (so a drop point can hit document.body
 * directly, not any container) plus a movable Widget inside main and a
 * FooterItem already inside footer. Screen "page-two.html" is a second,
 * mostly-empty screen for cross-screen drops.
 */

const SCREEN_ONE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen One</title></head>
  <body style="margin:0;position:relative;min-height:1000px;width:900px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <header data-agent-native-node-id="header" data-agent-native-layer-name="Header"
            style="position:absolute;left:0;top:0;width:900px;height:80px;background:#1f2937"></header>
    <span data-agent-native-node-id="root-gap-1" data-agent-native-layer-name="RootGap1"
          style="position:absolute;left:400px;top:150px;width:60px;height:20px"></span>
    <main data-agent-native-node-id="main" data-agent-native-layer-name="Main"
          style="position:absolute;left:0;top:260px;width:900px;height:360px;background:#111827">
      <div data-agent-native-node-id="widget" data-agent-native-layer-name="Widget"
           style="position:absolute;left:40px;top:40px;width:140px;height:90px;background:#3b82f6"></div>
    </main>
    <span data-agent-native-node-id="root-gap-2" data-agent-native-layer-name="RootGap2"
          style="position:absolute;left:400px;top:200px;width:60px;height:20px"></span>
    <footer data-agent-native-node-id="footer" data-agent-native-layer-name="Footer"
            style="position:absolute;left:0;top:780px;width:900px;height:180px;background:#1f2937">
      <div data-agent-native-node-id="footer-item" data-agent-native-layer-name="FooterItem"
           style="position:absolute;left:30px;top:30px;width:120px;height:70px;background:#f59e0b"></div>
    </footer>
    <div data-agent-native-node-id="later-overlay" data-agent-native-layer-name="LaterOverlay"
         style="position:absolute;left:380px;top:190px;width:220px;height:90px;background:#dc2626;pointer-events:none"></div>
  </body>
</html>`;

const SCREEN_TWO = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen Two</title></head>
  <body style="margin:0;position:relative;min-height:900px;width:900px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="page2-target" data-agent-native-layer-name="Page2Target"
             style="position:absolute;left:60px;top:60px;width:400px;height:300px;background:#312e81"></section>
  </body>
</html>`;

// The source class rules are deliberately absent from the destination.
const STYLE_CARRY_SOURCE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Style Carry Source</title>
    <style>.card{color:teal;background-color:#123456;width:320px}</style>
  </head>
  <body style="margin:0;position:relative;min-height:900px;width:900px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div class="card" data-agent-native-node-id="style-card" data-agent-native-layer-name="StyleCard"
         style="position:absolute;left:60px;top:60px;height:80px">Style Card</div>
  </body>
</html>`;

const STYLE_CARRY_DEST = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Style Carry Dest</title></head>
  <body style="margin:0;position:relative;min-height:900px;width:900px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="style-dest-target" data-agent-native-layer-name="StyleDestTarget"
             style="position:absolute;left:60px;top:60px;width:400px;height:300px;background:#312e81"></section>
  </body>
</html>`;

let baseURL = "";

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok()) {
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 300)}`,
    );
  }
  return res.json();
}

async function newTwoScreenDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "parity drag reparent",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: SCREEN_ONE,
    fileType: "html",
  });
  await postAction(page, "create-file", {
    designId: id,
    filename: "page-two.html",
    content: SCREEN_TWO,
    fileType: "html",
  });
  return id;
}

async function newStyleCarryTwoScreenDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "parity style carry",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: STYLE_CARRY_SOURCE,
    fileType: "html",
  });
  await postAction(page, "create-file", {
    designId: id,
    filename: "page-two.html",
    content: STYLE_CARRY_DEST,
    fileType: "html",
  });
  return id;
}

async function getDesign(page: Page, id: string): Promise<any> {
  return page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${id}`)
    .then((r) => r.json());
}

async function fileContent(
  page: Page,
  id: string,
  filename: string,
): Promise<string> {
  const record = await getDesign(page, id);
  return (
    (record.files ?? []).find((f: any) => f.filename === filename)?.content ??
    ""
  );
}

async function fileIdFor(
  page: Page,
  id: string,
  filename: string,
): Promise<string> {
  const record = await getDesign(page, id);
  const file = (record.files ?? []).find((f: any) => f.filename === filename);
  if (!file) throw new Error(`no file ${filename} in design ${id}`);
  return file.id;
}

async function selectionContext(page: Page) {
  const response = await page.request.get(
    appPath("/_agent-native/application-state/design-selection"),
  );
  if (!response.ok()) {
    throw new Error(
      `could not read design selection: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

/**
 * Immediate-parent node id of `nodeId` inside `html`, using a real tag-depth
 * walk (not a non-greedy regex, which stops at the wrong closing tag as soon
 * as a candidate container has a same-named-tag child of its own — e.g. a
 * `<div>` child closing before the container's real close). Only looks at
 * the small set of tags this fixture actually uses.
 */
function parentOf(html: string, nodeId: string): string | null {
  const tagRe =
    /<(header|main|footer|section|div)\b([^>]*)>|<\/(header|main|footer|section|div)>/gi;
  const stack: Array<{ id: string | null }> = [];
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    if (match[1]) {
      const attrs = match[2] ?? "";
      const idMatch = /data-agent-native-node-id="([^"]+)"/.exec(attrs);
      const id = idMatch ? idMatch[1] : null;
      if (id === nodeId) {
        const parent = [...stack].reverse().find((f) => f.id !== null);
        return parent ? parent.id : null;
      }
      stack.push({ id });
    } else if (match[3]) {
      stack.pop();
    }
  }
  return null;
}

function styleOf(html: string, id: string): string {
  return (
    new RegExp(
      `data-agent-native-node-id="${id}"[^>]*?style="([^"]*)"`,
      "i",
    ).exec(html)?.[1] ?? ""
  );
}

function styleNum(style: string, prop: string): number {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`, "i").exec(
    style,
  );
  return m ? Number(m[1]) : NaN;
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
        ) {
          continue;
        }
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty canvas point found at this viewport");
  return point;
}

async function boxFor(page: Page, screenId: string, nodeId: string) {
  const box = await designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .boundingBox();
  if (!box) throw new Error(`no boundingBox for ${nodeId} on ${screenId}`);
  return box;
}

async function dumpTrace(page: Page): Promise<string> {
  return page
    .evaluate(() => (window as any).__designTrace?.dump?.() ?? "(no trace)")
    .catch(() => "(trace unavailable)");
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeAll(async ({}, testInfo) => {
  baseURL =
    (testInfo.project.use as { baseURL?: string }).baseURL ??
    process.env.E2E_BASE_URL ??
    e2eBaseURL();
});

test.describe("drag reparent parity", () => {
  test("dragging an element over the footer highlights it, and drop nests the element into it", async ({
    page,
  }) => {
    const id = await newTwoScreenDesign(page);
    await gotoEditor(page, id);
    const screenId = await fileIdFor(page, id, "index.html");

    const widget = await boxFor(page, screenId, "widget");
    const footer = await boxFor(page, screenId, "footer");

    await page.mouse.move(
      widget.x + widget.width / 2,
      widget.y + widget.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      widget.x + widget.width / 2 + 20,
      widget.y + widget.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(
      footer.x + footer.width / 2,
      footer.y + footer.height / 2,
      { steps: 20 },
    );
    await page.waitForTimeout(400);

    // Highlight assertion BEFORE mouseup: the insertion guide should be
    // visible and roughly cover the footer container.
    const guide = designFrame(page, screenId).locator(
      "[data-agent-native-insertion-guide]",
    );
    const guideBox = await guide.boundingBox().catch(() => null);
    const trace1 = await dumpTrace(page);

    await page.mouse.up();

    expect(
      guideBox && guideBox.width > footer.width * 0.5,
      `expected the footer to visibly highlight while hovering before drop; got guideBox=${JSON.stringify(guideBox)}. Trace: ${trace1.slice(-800)}`,
    ).toBe(true);

    await expect
      .poll(
        async () => {
          const html = await fileContent(page, id, "index.html");
          return parentOf(html, "widget");
        },
        {
          timeout: 10_000,
          message: `dragging Widget onto Footer must nest it into the footer (Steve: "could not drop into a footer")`,
        },
      )
      .toBe("footer");
  });

  test("dragging an element out of the footer to the screen root reparents it to the root", async ({
    page,
  }) => {
    const id = await newTwoScreenDesign(page);
    await gotoEditor(page, id);
    const screenId = await fileIdFor(page, id, "index.html");

    const footerItem = await boxFor(page, screenId, "footer-item");
    const target = await boxFor(page, screenId, "root-gap-2");

    await page.mouse.move(
      footerItem.x + footerItem.width / 2,
      footerItem.y + footerItem.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      footerItem.x + footerItem.width / 2 + 20,
      footerItem.y + footerItem.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 24 },
    );
    await page.waitForTimeout(400);
    await page.mouse.up();

    await expect
      .poll(
        async () => {
          const html = await fileContent(page, id, "index.html");
          const parent = parentOf(html, "footer-item");
          const stillInFooter =
            /<footer[\s\S]*?footer-item[\s\S]*?<\/footer>/i.test(html);
          return parent === null && !stillInFooter;
        },
        {
          timeout: 10_000,
          message:
            "dragging FooterItem to the root gap must reparent it to the screen root, not leave it in footer",
        },
      )
      .toBe(true);

    const moved = designFrame(page, screenId).locator(
      '[data-agent-native-node-id="footer-item"]',
    );
    await expect(moved).toBeVisible();
    const renderedState = await moved.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const laterOverlay = document.querySelector<HTMLElement>(
        '[data-agent-native-node-id="later-overlay"]',
      );
      const rootGap = document.querySelector<HTMLElement>(
        '[data-agent-native-node-id="root-gap-2"]',
      );
      const overlayRect = laterOverlay?.getBoundingClientRect();
      return {
        overlapsLaterOverlay: Boolean(
          overlayRect &&
          rect.left < overlayRect.right &&
          rect.right > overlayRect.left &&
          rect.top < overlayRect.bottom &&
          rect.bottom > overlayRect.top,
        ),
        paintsAfterDropTarget: Boolean(
          rootGap &&
          rootGap.compareDocumentPosition(element) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        remainsBelowLaterSibling: Boolean(
          laterOverlay &&
          element.compareDocumentPosition(laterOverlay) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      };
    });
    expect(renderedState, JSON.stringify(renderedState)).toEqual({
      overlapsLaterOverlay: true,
      paintsAfterDropTarget: true,
      remainsBelowLaterSibling: true,
    });
  });

  test("dragging an element from inside a screen onto the empty board turns it into a board object", async ({
    page,
  }) => {
    const id = await newTwoScreenDesign(page);
    await gotoEditor(page, id);
    const screenId = await fileIdFor(page, id, "index.html");

    const widget = await boxFor(page, screenId, "widget");
    const boardPoint = await emptyBoardPoint(page);

    const deepSelectModifier =
      process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(deepSelectModifier);
    await page.mouse.click(
      widget.x + widget.width / 2,
      widget.y + widget.height / 2,
    );
    await page.keyboard.up(deepSelectModifier);
    await expect
      .poll(
        async () =>
          (await selectionContext(page)).selectedElement?.sourceId ?? null,
      )
      .toBe("widget");

    await page.mouse.move(
      widget.x + widget.width / 2,
      widget.y + widget.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      widget.x + widget.width / 2 + 20,
      widget.y + widget.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(boardPoint.x, boardPoint.y, { steps: 30 });
    await page.waitForTimeout(500);
    const trace = await dumpTrace(page);
    const ghost = page.locator("[data-cross-screen-drag-ghost]");
    await expect(ghost).toBeVisible({ timeout: 5_000 });
    const ghostAtBoard = await ghost.boundingBox();
    expect(
      ghostAtBoard,
      `drag ghost geometry missing. Trace: ${trace.slice(-800)}`,
    ).not.toBeNull();
    expect(ghostAtBoard!.width).toBeGreaterThan(widget.width * 0.8);
    expect(ghostAtBoard!.height).toBeGreaterThan(widget.height * 0.8);
    expect(ghostAtBoard!.x + ghostAtBoard!.width / 2).toBeCloseTo(
      boardPoint.x,
      0,
    );
    expect(ghostAtBoard!.y + ghostAtBoard!.height / 2).toBeCloseTo(
      boardPoint.y,
      0,
    );
    await page.mouse.move(boardPoint.x + 40, boardPoint.y + 24, { steps: 8 });
    await page.waitForTimeout(250);
    const ghostAtSecondPoint = await ghost.boundingBox();
    expect(
      ghostAtSecondPoint,
      `the cross-screen drag ghost must remain rendered as the pointer moves. ` +
        `Trace: ${trace.slice(-800)}`,
    ).not.toBeNull();
    expect(
      Math.hypot(
        ghostAtSecondPoint!.x - ghostAtBoard!.x,
        ghostAtSecondPoint!.y - ghostAtBoard!.y,
      ),
      `the cross-screen drag ghost must follow the held pointer. Trace: ${trace.slice(-800)}`,
    ).toBeGreaterThan(1);
    await page.mouse.up();

    let indexHtml = "";
    let boardHtml = "";
    await expect
      .poll(
        async () => {
          indexHtml = await fileContent(page, id, "index.html");
          boardHtml = await fileContent(page, id, "__board__.html").catch(
            () => "",
          );
          return (
            !indexHtml.includes('data-agent-native-node-id="widget"') &&
            boardHtml.length > 0
          );
        },
        {
          timeout: 10_000,
          message: `Widget dropped on the empty board must leave the screen document and become a board object. Trace: ${trace.slice(-800)}`,
        },
      )
      .toBe(true);
    expect(
      indexHtml.includes('data-agent-native-node-id="widget"'),
      `Widget must leave the screen document once dropped outside it on the board. Trace: ${trace.slice(-800)}`,
    ).toBe(false);
    expect(
      boardHtml.includes('data-agent-native-node-id="widget"'),
      `Widget dropped on the empty board must become a board object (checked __board__.html). Got boardHtml length=${boardHtml.length}`,
    ).toBe(true);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => {
        const reloadedIndexHtml = await fileContent(page, id, "index.html");
        const reloadedBoardHtml = await fileContent(page, id, "__board__.html");
        return (
          !reloadedIndexHtml.includes('data-agent-native-node-id="widget"') &&
          reloadedBoardHtml.includes("widget")
        );
      })
      .toBe(true);
  });

  test("dragging a board rectangle into a screen inserts it into that screen at the drop position", async ({
    page,
  }) => {
    const id = await newTwoScreenDesign(page);
    await gotoEditor(page, id);
    const screenId = await fileIdFor(page, id, "index.html");

    // Draw a rectangle on the empty board first (Rectangle tool).
    const boardPoint = await emptyBoardPoint(page);
    await page
      .locator('[data-design-bottom-toolbar] button[aria-label="Rectangle"]')
      .click();
    await page.waitForTimeout(300);
    await page.mouse.move(boardPoint.x, boardPoint.y);
    await page.mouse.down();
    await page.mouse.move(boardPoint.x + 100, boardPoint.y + 80, {
      steps: 12,
    });
    await page.mouse.up();

    await expect
      .poll(
        async () => fileContent(page, id, "__board__.html").catch(() => ""),
        {
          timeout: 10_000,
          message:
            "precondition: the rectangle tool must place a rectangle on the board",
        },
      )
      .toContain('data-an-primitive="rectangle"');

    const rectLocator = page
      .locator("[data-board-surface-layer] iframe")
      .first()
      .contentFrame()
      .locator('[data-an-primitive="rectangle"]')
      .first();
    const rectBox = (await rectLocator.boundingBox())!;
    const main = await boxFor(page, screenId, "main");

    await page
      .locator('[data-design-bottom-toolbar] button[aria-label="Move"]')
      .click();
    await page.waitForTimeout(300);
    await page.mouse.move(
      rectBox.x + rectBox.width / 2,
      rectBox.y + rectBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      rectBox.x + rectBox.width / 2 - 12,
      rectBox.y + rectBox.height / 2,
      { steps: 4 },
    );
    await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2, {
      steps: 24,
    });
    await page.waitForTimeout(400);
    await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible({
      timeout: 5_000,
    });
    const trace = await dumpTrace(page);
    await page.mouse.up();

    let indexHtmlAfter = "";
    let boardHtmlAfter = "";
    await expect
      .poll(
        async () => {
          indexHtmlAfter = await fileContent(page, id, "index.html");
          boardHtmlAfter = await fileContent(page, id, "__board__.html").catch(
            () => "",
          );
          return (
            indexHtmlAfter.includes('data-an-primitive="rectangle"') &&
            !boardHtmlAfter.includes('data-an-primitive="rectangle"')
          );
        },
        {
          timeout: 10_000,
          message:
            "dragging the board rectangle into the screen's Main must insert it into that screen and remove it from the board",
        },
      )
      .toBe(true);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const reloadedIndexHtml = await fileContent(page, id, "index.html");
          const reloadedBoardHtml = await fileContent(
            page,
            id,
            "__board__.html",
          );
          return (
            reloadedIndexHtml.includes('data-an-primitive="rectangle"') &&
            !reloadedBoardHtml.includes('data-an-primitive="rectangle"')
          );
        },
        {
          message: `board-to-screen persistence did not survive reload. Trace: ${trace.slice(-800)}`,
        },
      )
      .toBe(true);
  });

  test("holding Space while dragging into the footer keeps the element in its current parent", async ({
    page,
  }) => {
    const id = await newTwoScreenDesign(page);
    await gotoEditor(page, id);
    const screenId = await fileIdFor(page, id, "index.html");

    const widget = await boxFor(page, screenId, "widget");
    const footer = await boxFor(page, screenId, "footer");
    const previewBody = designFrame(page, screenId).locator("body");
    const spaceKey = (type: "keydown" | "keyup") =>
      previewBody.evaluate((_b, t) => {
        document.dispatchEvent(
          new KeyboardEvent(t, {
            key: " ",
            code: "Space",
            bubbles: true,
            cancelable: true,
          }),
        );
      }, type);

    await page.mouse.move(
      widget.x + widget.width / 2,
      widget.y + widget.height / 2,
    );
    await page.mouse.down();
    await spaceKey("keydown");
    await page.mouse.move(
      widget.x + widget.width / 2 + 20,
      widget.y + widget.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(
      footer.x + footer.width / 2,
      footer.y + footer.height / 2,
      { steps: 24 },
    );
    await page.waitForTimeout(400);
    await page.mouse.up();
    await spaceKey("keyup");

    await expect
      .poll(
        async () => {
          const html = await fileContent(page, id, "index.html");
          return parentOf(html, "widget");
        },
        {
          timeout: 10_000,
          message:
            "Figma: holding Space while dragging must keep the object in its current parent even while hovering a frame",
        },
      )
      .toBe("main");
  });

  test("one undo after nesting an element into the footer restores both its parent and its position", async ({
    page,
  }) => {
    const id = await newTwoScreenDesign(page);
    await gotoEditor(page, id);
    const screenId = await fileIdFor(page, id, "index.html");

    const beforeHtml = await fileContent(page, id, "index.html");
    const beforeStyle = styleOf(beforeHtml, "widget");
    const beforeLeft = styleNum(beforeStyle, "left");
    const beforeTop = styleNum(beforeStyle, "top");

    const widget = await boxFor(page, screenId, "widget");
    const footer = await boxFor(page, screenId, "footer");

    await page.mouse.move(
      widget.x + widget.width / 2,
      widget.y + widget.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      widget.x + widget.width / 2 + 20,
      widget.y + widget.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(
      footer.x + footer.width / 2,
      footer.y + footer.height / 2,
      { steps: 24 },
    );
    await page.waitForTimeout(400);
    await page.mouse.up();

    await expect
      .poll(
        async () => {
          const afterDragHtml = await fileContent(page, id, "index.html");
          return parentOf(afterDragHtml, "widget");
        },
        {
          timeout: 10_000,
          message:
            "precondition: the drag must actually nest Widget into Footer before testing undo",
        },
      )
      .toBe("footer");

    await page.keyboard.press("ControlOrMeta+z");

    let leftAfterUndo = NaN;
    let topAfterUndo = NaN;
    await expect
      .poll(
        async () => {
          const afterUndoHtml = await fileContent(page, id, "index.html");
          const styleAfterUndo = styleOf(afterUndoHtml, "widget");
          leftAfterUndo = styleNum(styleAfterUndo, "left");
          topAfterUndo = styleNum(styleAfterUndo, "top");
          return parentOf(afterUndoHtml, "widget");
        },
        {
          timeout: 10_000,
          message:
            "ONE undo after a reparent drag must restore the original parent (Widget started inside Main)",
        },
      )
      .toBe("main");
    expect(
      leftAfterUndo === beforeLeft && topAfterUndo === beforeTop,
      'Steve: "currently only half reverts" — ONE undo must also restore the ' +
        `original position, not just the parent. before=(${beforeLeft},${beforeTop}) after-undo=(${leftAfterUndo},${topAfterUndo})`,
    ).toBe(true);
  });

  test("one undo after dragging an element from a screen onto the board restores it inside the screen at its original position", async ({
    page,
  }) => {
    const id = await newTwoScreenDesign(page);
    await gotoEditor(page, id);
    const screenId = await fileIdFor(page, id, "index.html");

    const beforeHtml = await fileContent(page, id, "index.html");
    const beforeStyle = styleOf(beforeHtml, "widget");
    const beforeLeft = styleNum(beforeStyle, "left");
    const beforeTop = styleNum(beforeStyle, "top");

    const widget = await boxFor(page, screenId, "widget");
    const boardPoint = await emptyBoardPoint(page);

    const deepSelectModifier =
      process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(deepSelectModifier);
    await page.mouse.click(
      widget.x + widget.width / 2,
      widget.y + widget.height / 2,
    );
    await page.keyboard.up(deepSelectModifier);
    await expect
      .poll(
        async () =>
          (await selectionContext(page)).selectedElement?.sourceId ?? null,
      )
      .toBe("widget");

    await page.mouse.move(
      widget.x + widget.width / 2,
      widget.y + widget.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      widget.x + widget.width / 2 + 20,
      widget.y + widget.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(boardPoint.x, boardPoint.y, { steps: 30 });
    await page.waitForTimeout(400);
    await page.mouse.up();

    // Precondition is the same screen-to-board drag exercised (and asserted)
    // by "dragging an element from inside a screen onto the empty board..."
    // above; not skipped here — if that drag is broken this fails for the
    // real reason instead of silently passing an untested undo.
    await expect
      .poll(
        async () => {
          const afterDragHtml = await fileContent(page, id, "index.html");
          return afterDragHtml.includes('data-agent-native-node-id="widget"');
        },
        {
          timeout: 10_000,
          message:
            "precondition: Widget must leave the screen once dropped on the board before testing undo",
        },
      )
      .toBe(false);

    await page.keyboard.press("ControlOrMeta+z");

    let leftAfterUndo = NaN;
    let topAfterUndo = NaN;
    await expect
      .poll(
        async () => {
          const afterUndoHtml = await fileContent(page, id, "index.html");
          const styleAfterUndo = styleOf(afterUndoHtml, "widget");
          leftAfterUndo = styleNum(styleAfterUndo, "left");
          topAfterUndo = styleNum(styleAfterUndo, "top");
          return afterUndoHtml.includes('data-agent-native-node-id="widget"');
        },
        {
          timeout: 10_000,
          message:
            "ONE undo after a screen-to-board drag must restore Widget back inside the screen",
        },
      )
      .toBe(true);
    expect(
      leftAfterUndo === beforeLeft && topAfterUndo === beforeTop,
      `ONE undo must restore the exact original position too. before=(${beforeLeft},${beforeTop}) after-undo=(${leftAfterUndo},${topAfterUndo})`,
    ).toBe(true);
  });

  test("dragging an element across the screen boundary into a second screen inserts it into that screen", async ({
    page,
  }) => {
    const id = await newTwoScreenDesign(page);
    await gotoEditor(page, id);
    // Both screens must be on-screen at once for a real cross-screen drag —
    // the second screen is placed well below the first by default. Zoom-fit
    // needs canvas focus, not e.g. a panel that swallows the keystroke.
    await page.keyboard.press("Shift+1");
    const screenOneId = await fileIdFor(page, id, "index.html");
    const screenTwoId = await fileIdFor(page, id, "page-two.html");

    // Shift+1 (zoom-to-fit) is a CSS transition with no completion event —
    // poll the target's own box until two consecutive reads agree, so the
    // drag below computes coordinates against the settled layout.
    let lastTargetBox: { x: number; y: number } | null = null;
    await expect
      .poll(
        async () => {
          const box = await boxFor(page, screenTwoId, "page2-target");
          const stable =
            lastTargetBox !== null &&
            Math.abs(box.x - lastTargetBox.x) < 1 &&
            Math.abs(box.y - lastTargetBox.y) < 1;
          lastTargetBox = box;
          return stable;
        },
        { timeout: 5_000, message: "zoom-to-fit never settled" },
      )
      .toBe(true);

    const widget = await boxFor(page, screenOneId, "widget");
    const target = await boxFor(page, screenTwoId, "page2-target");

    const deepSelectModifier =
      process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(deepSelectModifier);
    await page.mouse.click(
      widget.x + widget.width / 2,
      widget.y + widget.height / 2,
    );
    await page.keyboard.up(deepSelectModifier);
    await expect
      .poll(
        async () =>
          (await selectionContext(page)).selectedElement?.sourceId ?? null,
      )
      .toBe("widget");

    await page.mouse.move(
      widget.x + widget.width / 2,
      widget.y + widget.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      widget.x + widget.width / 2 + 20,
      widget.y + widget.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 30 },
    );
    await page.waitForTimeout(500);
    const trace = await dumpTrace(page);
    await page.mouse.up();

    let screenOneHtml = "";
    let screenTwoHtml = "";
    await expect
      .poll(
        async () => {
          screenOneHtml = await fileContent(page, id, "index.html");
          screenTwoHtml = await fileContent(page, id, "page-two.html");
          return (
            !screenOneHtml.includes('data-agent-native-node-id="widget"') &&
            screenTwoHtml.includes('data-agent-native-node-id="widget"')
          );
        },
        {
          timeout: 10_000,
          message: `Widget must leave screen one and land inside screen two after the cross-screen drop. Trace: ${trace.slice(-800)}`,
        },
      )
      .toBe(true);

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => {
        const selection = await selectionContext(page);
        return (
          selection.activeFileId === screenOneId &&
          selection.selectedElement?.sourceId === "widget"
        );
      })
      .toBe(true);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(async () => {
        const selection = await selectionContext(page);
        return (
          selection.activeFileId === screenTwoId &&
          selection.selectedElement?.sourceId === "widget"
        );
      })
      .toBe(true);
  });

  test("a cross-screen drag carries a class-authored appearance the destination screen doesn't have", async ({
    page,
  }) => {
    const id = await newStyleCarryTwoScreenDesign(page);
    await gotoEditor(page, id);
    await page.keyboard.press("Shift+1");
    const screenOneId = await fileIdFor(page, id, "index.html");
    const screenTwoId = await fileIdFor(page, id, "page-two.html");

    let lastTargetBox: { x: number; y: number } | null = null;
    await expect
      .poll(
        async () => {
          const box = await boxFor(page, screenTwoId, "style-dest-target");
          const stable =
            lastTargetBox !== null &&
            Math.abs(box.x - lastTargetBox.x) < 1 &&
            Math.abs(box.y - lastTargetBox.y) < 1;
          lastTargetBox = box;
          return stable;
        },
        { timeout: 5_000, message: "zoom-to-fit never settled" },
      )
      .toBe(true);

    const sourceNode = designFrame(page, screenOneId).locator(
      '[data-agent-native-node-id="style-card"]',
    );
    // Read the class-authored appearance directly off the live source node
    // rather than hardcoding the browser's keyword/hex-to-rgb() conversion.
    const [colorBefore, backgroundBefore] = await sourceNode.evaluate((el) => {
      const cs = getComputedStyle(el);
      return [cs.color, cs.backgroundColor];
    });

    const card = await boxFor(page, screenOneId, "style-card");
    const target = await boxFor(page, screenTwoId, "style-dest-target");

    const deepSelectModifier =
      process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(deepSelectModifier);
    await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
    await page.keyboard.up(deepSelectModifier);
    await expect
      .poll(
        async () =>
          (await selectionContext(page)).selectedElement?.sourceId ?? null,
      )
      .toBe("style-card");

    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      card.x + card.width / 2 + 20,
      card.y + card.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 30 },
    );
    await page.waitForTimeout(500);
    const trace = await dumpTrace(page);
    await page.mouse.up();

    // Source and destination files save independently, so poll both to confirm
    // the move has settled in each.
    let screenTwoHtml = "";
    let screenOneHtmlAfter = "";
    await expect
      .poll(
        async () => {
          [screenOneHtmlAfter, screenTwoHtml] = await Promise.all([
            fileContent(page, id, "index.html"),
            fileContent(page, id, "page-two.html"),
          ]);
          const style = styleOf(screenTwoHtml, "style-card");
          return (
            !screenOneHtmlAfter.includes(
              'data-agent-native-node-id="style-card"',
            ) &&
            screenTwoHtml.includes('data-agent-native-node-id="style-card"') &&
            style.includes(colorBefore) &&
            style.includes(backgroundBefore)
          );
        },
        {
          timeout: 10_000,
          message: `Style Card must leave screen one and land inside screen two with its class-authored color/background carried as inline style. Trace: ${trace.slice(-800)}`,
        },
      )
      .toBe(true);

    // The destination has no `.card` rule; carried styles must render inline.
    const destNode = designFrame(page, screenTwoId).locator(
      '[data-agent-native-node-id="style-card"]',
    );
    await expect
      .poll(async () =>
        destNode.evaluate((el) => {
          const cs = getComputedStyle(el);
          return [cs.color, cs.backgroundColor];
        }),
      )
      .toEqual([colorBefore, backgroundBefore]);

    // Read computed width inside the iframe; overview zoom affects canvas
    // coordinates, not this layout value.
    expect(
      styleOf(screenTwoHtml, "style-card"),
      "Style Card must persist width:320px as inline style after landing in screen two",
    ).toMatch(/width\s*:\s*320px/);
    // computed style inside the frame, not an on-screen boundingBox() — the
    // overview canvas can render screen two below 1:1 zoom, which would
    // shrink a raw pixel bounding box without the carried width being wrong.
    expect(await destNode.evaluate((el) => getComputedStyle(el).width)).toBe(
      "320px",
    );
  });
});
