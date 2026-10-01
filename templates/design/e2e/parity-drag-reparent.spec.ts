import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  canvasZoom,
  designFrame,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

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

const SCREEN_DEEP_CLIPPED = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Deep clipped reparent</title></head>
  <body style="margin:0;position:relative;min-height:1000px;width:900px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <main data-agent-native-node-id="clip-outer" data-agent-native-layer-name="Outer clip" data-an-primitive="frame"
          style="position:absolute;left:40px;top:60px;width:360px;height:300px;overflow:hidden;background:#1f2937">
      <section data-agent-native-node-id="clip-middle" data-agent-native-layer-name="Middle clip" data-an-primitive="frame"
               style="position:absolute;left:20px;top:20px;width:300px;height:240px;overflow:hidden;background:#374151">
        <div data-agent-native-node-id="clip-inner" data-agent-native-layer-name="Inner auto layout" data-an-primitive="frame"
             style="position:absolute;left:20px;top:20px;width:240px;height:180px;display:flex;flex-direction:column;gap:12px;overflow:hidden;background:#4b5563">
          <div data-agent-native-node-id="deep-item" data-agent-native-layer-name="Deep item"
               style="flex:0 0 auto;width:120px;height:48px;background:#3b82f6"></div>
          <div data-agent-native-node-id="deep-sibling" data-agent-native-layer-name="Deep sibling"
               style="flex:0 0 auto;width:120px;height:48px;background:#7c3aed"></div>
        </div>
      </section>
    </main>
    <span data-agent-native-node-id="root-drop-point" data-agent-native-layer-name="Root drop point"
          style="position:absolute;left:600px;top:600px;width:80px;height:60px;pointer-events:none"></span>
  </body>
</html>`;

const SCREEN_DEEP_ROOT_FLEX = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Deep root auto layout</title></head>
  <body style="margin:0;box-sizing:border-box;min-height:1000px;width:900px;padding:40px;display:flex;flex-direction:row;align-items:flex-start;gap:80px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="root-before" data-agent-native-layer-name="Root before"
         style="flex:0 0 auto;width:80px;height:60px;background:#1f2937"></div>
    <main data-agent-native-node-id="clip-outer" data-agent-native-layer-name="Outer clip" data-an-primitive="frame"
          style="position:relative;flex:0 0 auto;width:360px;height:300px;overflow:hidden;background:#1f2937">
      <section data-agent-native-node-id="clip-middle" data-agent-native-layer-name="Middle clip" data-an-primitive="frame"
               style="position:absolute;left:20px;top:20px;width:300px;height:240px;overflow:hidden;background:#374151">
        <div data-agent-native-node-id="clip-inner" data-agent-native-layer-name="Inner auto layout" data-an-primitive="frame"
             style="position:absolute;left:20px;top:20px;width:240px;height:180px;display:flex;flex-direction:column;gap:12px;overflow:hidden;background:#4b5563">
          <div data-agent-native-node-id="deep-item" data-agent-native-layer-name="Deep item"
               style="flex:0 0 auto;width:120px;height:48px;background:#3b82f6"></div>
          <div data-agent-native-node-id="deep-sibling" data-agent-native-layer-name="Deep sibling"
               style="flex:0 0 auto;width:120px;height:48px;background:#7c3aed"></div>
        </div>
      </section>
    </main>
    <div data-agent-native-node-id="root-after" data-agent-native-layer-name="Root after"
         style="flex:0 0 auto;width:80px;height:60px;background:#374151"></div>
  </body>
</html>`;

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

async function newTwoScreenDesign(
  page: Page,
  screenOneHtml = SCREEN_ONE,
): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "parity drag reparent",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: screenOneHtml,
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

function layerRow(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
}

async function layerParentName(
  page: Page,
  name: string,
): Promise<string | null> {
  return layerRow(page, name).evaluate((row) => {
    const item = row.closest<HTMLElement>('[role="treeitem"]');
    const tree = item?.closest<HTMLElement>('[role="tree"]');
    if (!item || !tree) return null;
    const level = Number(item.getAttribute("aria-level"));
    const items = Array.from(
      tree.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    );
    const index = items.indexOf(item);
    for (let i = index - 1; i >= 0; i -= 1) {
      if (Number(items[i]?.getAttribute("aria-level")) < level) {
        return (
          items[i]?.querySelector<HTMLElement>("span[title]")?.title ?? null
        );
      }
    }
    return null;
  });
}

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

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () =>
        parentOf(await fileContent(page, id, "index.html"), "widget"),
      )
      .toBe("main");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(async () =>
        parentOf(await fileContent(page, id, "index.html"), "widget"),
      )
      .toBe("footer");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-design-editor]")).toBeVisible();
    await expect(
      designFrame(page, screenId).locator(
        'footer [data-agent-native-node-id="widget"]',
      ),
    ).toBeVisible();
    await expect
      .poll(async () =>
        parentOf(await fileContent(page, id, "index.html"), "widget"),
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
    const guide = designFrame(page, screenId).locator(
      "[data-agent-native-insertion-guide]",
    );
    const guideBox = await guide.boundingBox().catch(() => null);
    const trace = await dumpTrace(page);
    await page.mouse.up();

    expect(
      guideBox && guideBox.width > 0 && guideBox.height > 0,
      `expected a visible root insertion guide while hovering before drop; got guideBox=${JSON.stringify(guideBox)}. Trace: ${trace.slice(-800)}`,
    ).toBe(true);

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

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => {
        const html = await fileContent(page, id, "index.html");
        return html.includes('data-agent-native-node-id="footer-item"')
          ? parentOf(html, "footer-item")
          : "missing";
      })
      .toBe("footer");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(async () => {
        const html = await fileContent(page, id, "index.html");
        return html.includes('data-agent-native-node-id="footer-item"')
          ? parentOf(html, "footer-item")
          : "missing";
      })
      .toBeNull();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-design-editor]")).toBeVisible();
    await expect(
      designFrame(page, screenId).locator(
        '[data-agent-native-node-id="footer-item"]',
      ),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const html = await fileContent(page, id, "index.html");
        return html.includes('data-agent-native-node-id="footer-item"')
          ? parentOf(html, "footer-item")
          : "missing";
      })
      .toBeNull();
  });

  test("moving a deeply nested flow child through clipped ancestors preserves root placement and history", async ({
    page,
  }) => {
    const id = await newTwoScreenDesign(page, SCREEN_DEEP_CLIPPED);
    await gotoEditor(page, id);
    const screenId = await fileIdFor(page, id, "index.html");
    const beforeHtml = await fileContent(page, id, "index.html");
    const beforeStyle = styleOf(beforeHtml, "deep-item");
    expect(parentOf(beforeHtml, "deep-item")).toBe("clip-inner");

    const source = await boxFor(page, screenId, "deep-item");
    const dropSurface = await boxFor(page, screenId, "root-drop-point");
    const grabPoint = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const dropPoint = {
      x: dropSurface.x + dropSurface.width / 2,
      y: dropSurface.y + dropSurface.height / 2,
    };
    await page.mouse.move(grabPoint.x, grabPoint.y);
    await page.mouse.down();
    await page.mouse.move(grabPoint.x + 20, grabPoint.y + 4, { steps: 5 });
    await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 24 });
    await page.waitForTimeout(400);
    const trace = await dumpTrace(page);
    const guide = designFrame(page, screenId).locator(
      "[data-agent-native-insertion-guide]",
    );
    const guideBox = await guide.boundingBox().catch(() => null);
    const heldHtml = await fileContent(page, id, "index.html");
    expect(
      heldHtml,
      `held drag must not persist a structure change before release. Trace: ${trace.slice(-800)}`,
    ).toBe(beforeHtml);
    expect(
      guideBox && guideBox.width > 0 && guideBox.height > 0,
      `expected a root insertion preview while the child is held outside both clipped ancestors; got ${JSON.stringify(guideBox)}. Trace: ${trace.slice(-800)}`,
    ).toBe(true);

    await page.mouse.up();
    let movedHtml = "";
    await expect
      .poll(
        async () => {
          movedHtml = await fileContent(page, id, "index.html");
          return (
            movedHtml.includes('data-agent-native-node-id="deep-item"') &&
            parentOf(movedHtml, "deep-item") === null
          );
        },
        {
          timeout: 10_000,
          message: `deep flow child should move to the screen root after release, got parent ${parentOf(movedHtml, "deep-item")}. Trace: ${trace.slice(-800)}`,
        },
      )
      .toBe(true);

    const moved = designFrame(page, screenId).locator(
      '[data-agent-native-node-id="deep-item"]',
    );
    await expect(moved).toBeVisible();
    expect(
      await moved.evaluate(
        (element) => element.parentElement === document.body,
      ),
    ).toBe(true);
    const movedBox = await moved.boundingBox();
    expect(movedBox).not.toBeNull();
    expect(movedBox!.x + movedBox!.width / 2).toBeCloseTo(dropPoint.x, 0);
    expect(movedBox!.y + movedBox!.height / 2).toBeCloseTo(dropPoint.y, 0);

    await page.keyboard.press("ControlOrMeta+z");
    let undoHtml = "";
    await expect
      .poll(async () => {
        undoHtml = await fileContent(page, id, "index.html");
        return parentOf(undoHtml, "deep-item");
      })
      .toBe("clip-inner");
    expect(styleOf(undoHtml, "deep-item")).toBe(beforeStyle);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(async () => {
        const redoHtml = await fileContent(page, id, "index.html");
        return (
          redoHtml.includes('data-agent-native-node-id="deep-item"') &&
          parentOf(redoHtml, "deep-item") === null
        );
      })
      .toBe(true);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-design-editor]")).toBeVisible();
    const reloaded = designFrame(page, screenId).locator(
      '[data-agent-native-node-id="deep-item"]',
    );
    await expect(reloaded).toBeVisible();
    expect(
      await reloaded.evaluate(
        (element) => element.parentElement === document.body,
      ),
    ).toBe(true);
    await expect
      .poll(async () => {
        const html = await fileContent(page, id, "index.html");
        return (
          html.includes('data-agent-native-node-id="deep-item"') &&
          parentOf(html, "deep-item") === null
        );
      })
      .toBe(true);
  });

  test("moving a deeply nested flow child into the root auto-layout uses the pointer slot", async ({
    page,
  }) => {
    const id = await newTwoScreenDesign(page, SCREEN_DEEP_ROOT_FLEX);
    await gotoEditor(page, id);
    const screenId = await fileIdFor(page, id, "index.html");
    const beforeHtml = await fileContent(page, id, "index.html");
    expect(parentOf(beforeHtml, "deep-item")).toBe("clip-inner");

    const [source, before, outer] = await Promise.all([
      boxFor(page, screenId, "deep-item"),
      boxFor(page, screenId, "root-before"),
      boxFor(page, screenId, "clip-outer"),
    ]);
    const grabPoint = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const dropPoint = {
      x: (before.x + before.width + outer.x) / 2,
      y: before.y + before.height / 2,
    };

    await page.mouse.move(grabPoint.x, grabPoint.y);
    await page.mouse.down();
    await page.mouse.move(grabPoint.x + 20, grabPoint.y + 4, { steps: 5 });
    await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 20 });
    await page.waitForTimeout(400);
    const trace = await dumpTrace(page);
    const guideBox = await designFrame(page, screenId)
      .locator("[data-agent-native-insertion-guide]")
      .boundingBox()
      .catch(() => null);
    expect(await fileContent(page, id, "index.html")).toBe(beforeHtml);
    expect(
      guideBox && guideBox.width > 0 && guideBox.height > 0,
      `expected a root auto-layout insertion preview, got ${JSON.stringify(guideBox)}. Trace: ${trace.slice(-800)}`,
    ).toBe(true);
    expect(
      Math.abs(guideBox!.x + guideBox!.width / 2 - (before.x + before.width)),
      `expected the insertion guide after root-before; guide=${JSON.stringify(guideBox)}, root-before=${JSON.stringify(before)}, outer=${JSON.stringify(outer)}, drop=${JSON.stringify(dropPoint)}. Trace: ${trace.slice(-800)}`,
    ).toBeLessThan(4);

    await page.mouse.up();
    const bodyOrder = () =>
      designFrame(page, screenId)
        .locator("body")
        .evaluate((body) =>
          Array.from(body.children)
            .map((child) => child.getAttribute("data-agent-native-node-id"))
            .filter((nodeId): nodeId is string => nodeId !== null),
        );
    await expect
      .poll(async () => {
        const html = await fileContent(page, id, "index.html");
        return parentOf(html, "deep-item") === null ? bodyOrder() : [];
      })
      .toEqual(["root-before", "deep-item", "clip-outer", "root-after"]);

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() =>
        fileContent(page, id, "index.html").then((html) =>
          parentOf(html, "deep-item"),
        ),
      )
      .toBe("clip-inner");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(async () => {
        const html = await fileContent(page, id, "index.html");
        return parentOf(html, "deep-item") === null ? bodyOrder() : [];
      })
      .toEqual(["root-before", "deep-item", "clip-outer", "root-after"]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-design-editor]")).toBeVisible();
    await expect
      .poll(bodyOrder)
      .toEqual(["root-before", "deep-item", "clip-outer", "root-after"]);
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
            boardHtml.includes('data-agent-native-node-id="widget"')
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
      boardHtml,
      `Widget dropped on the empty board must become a board object (checked __board__.html). Got boardHtml length=${boardHtml.length}`,
    ).toContain('data-agent-native-node-id="widget"');

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
          reloadedBoardHtml.includes('data-agent-native-node-id="widget"')
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
    const liveWidgetParent = () =>
      designFrame(page, screenId)
        .locator('[data-agent-native-node-id="widget"]')
        .evaluate((element) =>
          element.parentElement?.getAttribute("data-agent-native-node-id"),
        );

    await page.evaluate(() => {
      document.body.dataset.editorDragStarted = "false";
      window.addEventListener(
        "message",
        (event: MessageEvent) => {
          if (
            event.data?.type === "agent-native:editor-drag-state" &&
            event.data.active === true
          ) {
            document.body.dataset.editorDragStarted = "true";
          }
        },
        true,
      );
    });

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
    await expect(page.locator("body")).toHaveAttribute(
      "data-editor-drag-started",
      "true",
    );
    await page.keyboard.down("Space");
    await page.mouse.move(
      footer.x + footer.width / 2,
      footer.y + footer.height / 2,
      { steps: 24 },
    );
    await expect.poll(liveWidgetParent).toBe("main");
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.keyboard.up("Space");

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

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => {
        const html = await fileContent(page, id, "index.html");
        return parentOf(html, "widget");
      })
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
    await page.keyboard.press("Shift+1");
    const screenOneId = await fileIdFor(page, id, "index.html");
    const screenTwoId = await fileIdFor(page, id, "page-two.html");

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
    await expect
      .poll(() => page.locator("[data-cross-screen-drop-guide]").isVisible(), {
        timeout: 5_000,
        message: `cross-screen target guide must remain visible while the pointer is held. Trace: ${trace.slice(-800)}`,
      })
      .toBe(true);
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

  test("returning a held cross-screen drag to its source keeps the source intact", async ({
    page,
  }) => {
    const id = await newTwoScreenDesign(page);
    await gotoEditor(page, id);
    await expandAllLayers(page);
    await page.keyboard.press("Shift+1");
    const screenOneId = await fileIdFor(page, id, "index.html");
    const screenTwoId = await fileIdFor(page, id, "page-two.html");

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
    const sourceBefore = await fileContent(page, id, "index.html");
    const destinationBefore = await fileContent(page, id, "page-two.html");
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

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
    await expect
      .poll(() => page.locator("[data-cross-screen-drop-guide]").isVisible(), {
        timeout: 5_000,
        message: "cross-screen target guide must appear while held",
      })
      .toBe(true);

    await page.mouse.move(
      widget.x + widget.width / 2,
      widget.y + widget.height / 2,
      { steps: 30 },
    );
    await page.waitForTimeout(300);
    expect(pageErrors).toEqual([]);
    await expect.poll(() => layerParentName(page, "Widget")).toBe("Main");
    expect(await fileContent(page, id, "index.html")).toBe(sourceBefore);
    expect(await fileContent(page, id, "page-two.html")).toBe(
      destinationBefore,
    );
    await page.mouse.up();

    await expect
      .poll(async () => {
        const source = await fileContent(page, id, "index.html");
        const destination = await fileContent(page, id, "page-two.html");
        return (
          source.includes('data-agent-native-node-id="widget"') &&
          !destination.includes('data-agent-native-node-id="widget"')
        );
      })
      .toBe(true);
    expect(pageErrors).toEqual([]);
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

    expect(
      styleOf(screenTwoHtml, "style-card"),
      "Style Card must persist width:320px as inline style after landing in screen two",
    ).toMatch(/width\s*:\s*320px/);
    expect(await destNode.evaluate((el) => getComputedStyle(el).width)).toBe(
      "320px",
    );
  });
});
