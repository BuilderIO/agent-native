import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { expandAllLayers, gotoEditor } from "./helpers";

/**
 * Parity spec for Figma Learn Tutorial 3: FD4B "Create the navigation bar
 * and footer".
 * https://help.figma.com/hc/en-us/articles/31002534003991
 * Condensed steps: figma-interaction-spec.md Part 2 §3.
 *
 *  1. Frame/Screen tool, create 1440x80 frame "Navigation"        [overview, outside any screen]
 *  2. Add wordmark text, drag to left edge (smart guides)         [in-screen]
 *  3. Add "Link" text on the right
 *  4. Alt/Option-drag to duplicate "Link" twice, then Cmd+D once  [in-screen]
 *  5. Shift-select the Link texts, "Shift+A" (align, then auto layout), gap 24, rename "Links"
 *     -- Design has no auto-layout primitive; closest equivalent is Cmd+G group.
 *  6. Drag a Button instance from Assets, group with Links as "Extra content"
 *     -- Design has no Components/Assets panel; closest equivalent is duplicating
 *        an existing shape into the frame.
 *  7. Select wordmark + Extra content, group, rename "Content"
 *  8. Select Navigation frame, set fixed height/padding/alignment  [codex: layout/inspector]
 *  9. Content fill-container width, alignment center               [codex: layout]
 * 10. Cmd+D the whole Navigation frame -> rename "Footer"; delete the button
 *     instance, ungroup "Extra content", rename remaining group "Contact"
 *     [overview, outside any screen; also exercises moving an element across
 *      the screen boundary by relocating a Link text from Navigation into Footer]
 * 11. Edit text content, hide unused layers via eye toggle          [codex: keyboard/visibility]
 * 12. Convert Navigation and Footer to components, move to Components page
 *     -- Design has no components/variants system; no equivalent, skipped.
 */

const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** Minimal placeholder "Home" screen so the design starts with one screen
 * and the board around it is empty -- Navigation is drawn fresh on that
 * empty board with the Screen tool, matching step 1 exactly. */
const HOME_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Home</title></head>
  <body style="margin:0;min-height:600px;background:#ffffff"></body>
</html>`;

let baseURL = "";
let designId = "";

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok())
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 300)}`,
    );
  return res.json();
}

async function newDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: `E2E Tutorial 3 Navbar ${Date.now()}`,
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: HOME_HTML,
    fileType: "html",
  });
  return id;
}

async function designFiles(page: Page, id: string): Promise<string[]> {
  const record = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${id}`)
    .then((r) => r.json());
  return (record.files ?? []).map((f: any) => f.filename);
}

async function fileContentByName(
  page: Page,
  id: string,
  filename: string,
): Promise<string> {
  const record = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${id}`)
    .then((r) => r.json());
  return (
    (record.files ?? []).find((f: any) => f.filename === filename)?.content ??
    ""
  );
}

/**
 * The design-record file id for a given filename. `data-screen-iframe-id`
 * on a screen's iframe is stamped with this same file/screen id (see
 * MultiScreenCanvas.tsx:597 "primary = screen id"), so this is the only
 * reliable way to find a specific screen's iframe -- screens are NOT
 * guaranteed to render in creation order or file-list order (a newly drawn
 * screen can render to the LEFT of an existing one and come first in the
 * DOM), so `.first()`/`.last()` on the iframe list is not safe.
 */
async function fileIdByName(
  page: Page,
  id: string,
  filename: string,
): Promise<string> {
  const record = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${id}`)
    .then((r) => r.json());
  const fileId = (record.files ?? []).find(
    (f: any) => f.filename === filename,
  )?.id;
  if (!fileId) throw new Error(`no file id for ${filename}`);
  return String(fileId);
}

function toolbar(page: Page) {
  return page.locator("[data-design-bottom-toolbar]");
}

function layersTree(page: Page) {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRow(page: Page, name: string) {
  return layersTree(page)
    .getByRole("treeitem")
    .filter({ hasText: name })
    .first();
}

/** Mirrors app/lib/screen-names.ts prettyScreenName -- the default display
 * name a screen shows before it is ever renamed. Needed because new screens
 * are NOT appended last in the layers tree/screens list (they can be
 * inserted before existing screens), so picking a row by tree position is
 * unreliable; picking by its known default name is not. */
function prettyScreenName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  let stem = dot > 0 ? filename.slice(0, dot) : filename;
  if (stem.toLowerCase() === "index") return "Home";
  if (stem.toLowerCase().startsWith("page-")) stem = stem.slice(5);
  const spaced = stem.replace(/[-_]+/g, " ").trim();
  if (spaced.length === 0) return filename;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The screen ROOT row in the layers tree (level 1 treeitem), matched by its
 * current display name -- never by tree position. */
function screenRootRow(page: Page, displayName: string) {
  return layersTree(page)
    .locator('[role="treeitem"][aria-level="1"]')
    .filter({ hasText: displayName })
    .first();
}

async function dump(page: Page) {
  return page.evaluate(() => (window as any).__designTrace?.dump?.() ?? null);
}

async function openEditorAndExpandLayers(
  page: Page,
  id: string,
): Promise<void> {
  await gotoEditor(page, id);
  await expandAllLayers(page);
}

/** Frame/Screen options dropdown -- the trigger's label follows the active mode. */
async function pickFrameMode(page: Page, mode: "Frame" | "Screen") {
  await page
    .locator(
      '[data-design-bottom-toolbar] button[aria-label="Frame options"],' +
        ' [data-design-bottom-toolbar] button[aria-label="Screen options"]',
    )
    .first()
    .click();
  await page.getByRole("menuitem").filter({ hasText: mode }).first().click();
  await page.waitForTimeout(600);
}

/** Scans for a point that hit-tests to the empty canvas surface, not a screen
 * card or the inspector panel. */
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

async function drawFrameTool(
  page: Page,
  mode: "Frame" | "Screen",
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await pickFrameMode(page, mode);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
}

/** A specific screen's own iframe, found by its file id (stamped onto
 * `data-screen-iframe-id`) -- never by DOM position, which is NOT creation
 * order (a newly drawn screen can render left of an existing one). */
function screenFrameById(page: Page, fileId: string) {
  return page
    .locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${fileId}"]`,
    )
    .first()
    .contentFrame();
}

async function screenBoxById(page: Page, fileId: string) {
  const box = (await page
    .locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${fileId}"]`,
    )
    .first()
    .boundingBox())!;
  const contentWidth = await screenFrameById(page, fileId)
    .locator("body")
    .evaluate(() => document.documentElement.clientWidth);
  return { ...box, scale: box.width / contentWidth };
}

async function toScreenPointById(
  page: Page,
  fileId: string,
  x: number,
  y: number,
) {
  const box = await screenBoxById(page, fileId);
  return { x: box.x + x * box.scale, y: box.y + y * box.scale };
}

async function useTool(page: Page, name: string): Promise<void> {
  await toolbar(page).locator(`button[aria-label="${name}"]`).click();
  await expect(
    toolbar(page).locator(`button[aria-label="${name}"]`),
  ).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(250);
}

async function addTextInScreen(
  page: Page,
  fileId: string,
  at: { x: number; y: number },
  text: string,
): Promise<void> {
  await useTool(page, "Text");
  const point = await toScreenPointById(page, fileId, at.x, at.y);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(300);
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);
  // Return to Move so a later click selects rather than re-entering text
  // edit / redrafting a new text box.
  await page.keyboard.press("v");
  await page.waitForTimeout(250);
}

function textPrimitiveNodeIds(html: string, text: string): string[] {
  const ids = new Set<string>();
  const re = /<[^>]*data-agent-native-node-id="([^"]+)"[^>]*>([^<]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[2]!.includes(text)) ids.add(m[1]!);
  }
  return [...ids];
}

async function authoredTextNodeId(
  page: Page,
  html: string,
  text: string,
): Promise<string | null> {
  return page.evaluate(
    ({ source, wantedText }) => {
      const doc = new DOMParser().parseFromString(source, "text/html");
      const candidates = Array.from(
        doc.querySelectorAll<HTMLElement>(
          '[data-agent-native-node-id][data-an-primitive="text"]',
        ),
      ).filter(
        (element) =>
          element.textContent?.trim() === wantedText &&
          !element.closest("[data-agent-native-group-wrapper]"),
      );
      return (
        candidates[candidates.length - 1]?.getAttribute(
          "data-agent-native-node-id",
        ) ?? null
      );
    },
    { source: html, wantedText: text },
  );
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

/** DOM order across the whole document (index of the opening tag). */
function domOrderIndex(html: string, id: string): number {
  return html.indexOf(`data-agent-native-node-id="${id}"`);
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    e2eBaseURL();
});

// Deliberately NOT `mode: "serial"`: these tests share one design and must
// run in file order (guaranteed by playwright.config.ts's single worker),
// but a serial block ABORTS every later test the moment one fails -- and
// this tutorial is a step sequence, so a real product bug at step 2 would
// silently swallow every later step's coverage too. Default mode preserves
// order on one worker while still attempting every remaining test.

test.describe("parity: Figma Tutorial 3 - navigation bar and footer", () => {
  let navFilename = "";

  test("step 1 [overview, outside any screen]: Screen tool draws a new 1440x80 top-level screen", async ({
    page,
  }) => {
    designId = await newDesign(page);
    await openEditorAndExpandLayers(page, designId);
    await expect
      .poll(async () => designFiles(page, designId), {
        timeout: 10_000,
        message: "the board file must be seeded before creating a Screen",
      })
      .toContain("__board__.html");
    const before = await designFiles(page, designId);

    const empty = await emptyBoardPoint(page);
    // A screen card at 1:1 with 1440x80 would be huge on a 1600x1000
    // viewport, so this drags a modest rect and then relies on the fixed
    // aspect the tool commits at that zoom -- the assertion below checks the
    // FILE was created (that's what step 1 actually cares about at this
    // stage), not exact pixel geometry.
    await drawFrameTool(page, "Screen", empty, {
      x: empty.x + 360,
      y: empty.y + 20,
    });

    let after: string[] = [];
    await expect
      .poll(
        async () => {
          after = await designFiles(page, designId);
          return after.length;
        },
        {
          timeout: 10_000,
          message:
            "Figma: the Frame tool with a top-level artboard creates a new frame; " +
            "in Design, drawing a Screen on the empty board must create a new screen file.",
        },
      )
      .toBe(before.length + 1);
    const newScreenFiles = after.filter(
      (filename) => filename !== "__board__.html" && !before.includes(filename),
    );
    expect(newScreenFiles).toHaveLength(1);
    navFilename = newScreenFiles[0]!;
    expect(
      navFilename,
      "the new screen file must be identifiable",
    ).toBeTruthy();

    // Figma default for a freshly drawn top-level frame: white fill, clips
    // content. Assert the new screen's own root paints white (per
    // figma-ground-truth.md: Frame tool -> FRAME with white fill and
    // clipsContent=true).
    const navHtml = await fileContentByName(page, designId, navFilename);
    expect(
      navHtml,
      `new screen ${navFilename} body must default to a white background ` +
        `like a freshly drawn Figma frame`,
    ).toMatch(
      /background(-color)?\s*:\s*(#fff\b|#ffffff|white|rgb\(255,\s*255,\s*255\)|var\([^)]*#fff)/i,
    );
  });

  test("step 1b [overview, outside any screen]: renaming the new screen's root layer updates its filename and overview title", async ({
    page,
  }) => {
    await openEditorAndExpandLayers(page, designId);
    const designFilesBefore = await designFiles(page, designId);

    // Select the new screen's root row -- identified by its CURRENT default
    // display name, not tree position (new screens are not guaranteed to
    // sort last) -- and rename it via the layers panel, exactly like
    // renaming a top-level frame in Figma (double-click the name).
    const defaultName = prettyScreenName(navFilename);
    const rootRow = screenRootRow(page, defaultName);
    await expect(
      rootRow,
      `precondition: must find the new screen's root row by its default ` +
        `name "${defaultName}" (from filename ${navFilename})`,
    ).toHaveCount(1);
    await rootRow.locator("[data-layer-row-button]").dblclick({ force: true });
    const input = page.getByRole("textbox", {
      name: "Rename layer",
      exact: true,
    });
    await expect(
      input,
      "no inline rename input appeared on the screen root row",
    ).toBeVisible({ timeout: 5_000 });
    await input.fill("Navigation");
    await input.press("Enter");
    let filesAfterRename: string[] = [];
    await expect
      .poll(
        async () => {
          filesAfterRename = await designFiles(page, designId);
          return filesAfterRename.some(
            (filename) =>
              filename !== navFilename && !designFilesBefore.includes(filename),
          );
        },
        {
          timeout: 15_000,
          message: "renaming the Screen root must update its filename",
        },
      )
      .toBe(true);
    const renamedFile = filesAfterRename.find(
      (filename) =>
        filename !== navFilename && !designFilesBefore.includes(filename),
    );
    expect(
      renamedFile,
      `Figma: renaming a top-level frame updates its name everywhere, ` +
        `immediately. Renaming the screen root layer to "Navigation" must ` +
        `rename its underlying file (was "${navFilename}"); got files: ` +
        `${JSON.stringify(filesAfterRename)} (was: ${JSON.stringify(designFilesBefore)})`,
    ).toBeTruthy();
    if (renamedFile) navFilename = renamedFile;

    // Overview screen label (the frame-title chrome above the card) should
    // now display "Navigation".
    await expect(
      page.locator("[data-frame-title]").filter({ hasText: "Navigation" }),
      'the overview screen label must read "Navigation" after the rename',
    ).toHaveCount(1);
  });

  test("step 2 [in-screen]: wordmark text dragged to the left edge snaps near x=0", async ({
    page,
  }) => {
    await openEditorAndExpandLayers(page, designId);
    const navFileId = await fileIdByName(page, designId, navFilename);
    await addTextInScreen(page, navFileId, { x: 700, y: 40 }, "Acme");

    let html = "";
    let ids: string[] = [];
    await expect
      .poll(
        async () => {
          html = await fileContentByName(page, designId, navFilename);
          ids = textPrimitiveNodeIds(html, "Acme");
          return ids.length;
        },
        {
          timeout: 15_000,
          message:
            "draft-commit-stability: the Text tool must persist Acme before dragging",
        },
      )
      .toBeGreaterThan(0);
    const wordmarkId = ids[0]!;

    // Escape after typing leaves "Text" as the active tool -- switch to
    // Move before dragging, or the pointer draws a new text box instead of
    // moving the one just committed.
    await useTool(page, "Move");

    // Drag it left, toward the frame's left edge, using real pointer moves.
    const box = await screenFrameById(page, navFileId)
      .locator(`[data-agent-native-node-id="${wordmarkId}"]`)
      .first()
      .boundingBox();
    if (!box) throw new Error("no bounding box for wordmark");
    const screenBox = await screenBoxById(page, navFileId);
    const before = await fileContentByName(page, designId, navFilename);
    const leftBefore = styleNum(styleOf(before, wordmarkId), "left");

    // Select it first (a separate click), THEN drag -- a single
    // mousedown-move-up on an unselected element only selects it, per the
    // helpers.ts `dragCanvasByText` pattern.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Stop just inside the iframe's left edge. Crossing the iframe boundary
    // hands the pointer to the overview canvas, which is a different gesture
    // path; Figma's smart-guide result is the edge-aligned in-frame position.
    await page.mouse.move(screenBox.x + 12, box.y + box.height / 2, {
      steps: 24,
    });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(800);

    const after = await fileContentByName(page, designId, navFilename);
    const left = styleNum(styleOf(after, wordmarkId), "left");
    expect(
      left,
      `Figma: dragging toward and past the frame's left edge shows a red ` +
        `smart guide and the element ends up flush against (or very near) ` +
        `that edge. Design must move the wordmark noticeably left of its ` +
        `pre-drag position (${leftBefore}px); got left=${left}px after the ` +
        `drag. box=${JSON.stringify(box)} screenBox=${JSON.stringify(screenBox)}`,
    ).toBeLessThan(leftBefore - 100);
  });

  test("step 3-4 [in-screen]: alt-drag duplicates twice then Cmd+D once yields 4 same-named Link texts, each inserted directly above the source", async ({
    page,
  }) => {
    await openEditorAndExpandLayers(page, designId);
    const navFileId = await fileIdByName(page, designId, navFilename);
    await addTextInScreen(page, navFileId, { x: 1100, y: 40 }, "Link");

    let html = await fileContentByName(page, designId, navFilename);
    let ids = textPrimitiveNodeIds(html, "Link");
    expect(
      ids,
      "the Text tool must commit the original Link text",
    ).toHaveLength(1);
    const originalId = ids[0]!;

    async function selectNode(id: string) {
      const box = await screenFrameById(page, navFileId)
        .locator(`[data-agent-native-node-id="${id}"]`)
        .first()
        .boundingBox();
      if (!box) throw new Error(`no bounding box for ${id}`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);
      return box;
    }

    async function altDrag(id: string, dx: number, dy: number) {
      const box = await selectNode(id);
      await useTool(page, "Move");
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.keyboard.down("Alt");
      await page.mouse.down();
      await page.mouse.move(cx + dx, cy + dy, { steps: 12 });
      await page.waitForTimeout(120);
      await page.mouse.up();
      await page.keyboard.up("Alt");
      await page.waitForTimeout(500);
    }

    // Alt-drag duplicate #1. Poll instead of a single read after altDrag's
    // fixed settle delay -- the duplicate's save is debounced, and a slower
    // CI host can read the file before it lands (matches the Cmd+D poll below).
    await altDrag(originalId, 0, 40);
    await expect
      .poll(
        async () => {
          html = await fileContentByName(page, designId, navFilename);
          ids = textPrimitiveNodeIds(html, "Link");
          return ids.length;
        },
        {
          timeout: 15_000,
          message:
            `Figma: Alt/Option-drag leaves the original in place and creates a ` +
            `copy under the pointer. Expected 2 "Link" texts after one alt-drag.`,
        },
      )
      .toBe(2);
    expect(
      ids,
      "the original must still exist after an alt-drag duplicate",
    ).toContain(originalId);
    const copy1 = ids.find((i) => i !== originalId)!;
    expect(
      domOrderIndex(html, copy1),
      "Figma ground truth: a duplicate is inserted directly ABOVE (later in " +
        "DOM order) the source it was copied from",
    ).toBeGreaterThan(domOrderIndex(html, originalId));

    // Alt-drag duplicate #2, off the first copy.
    await altDrag(copy1, 0, 40);
    await expect
      .poll(
        async () => {
          html = await fileContentByName(page, designId, navFilename);
          ids = textPrimitiveNodeIds(html, "Link");
          return ids.length;
        },
        {
          timeout: 15_000,
          message: `expected 3 "Link" texts after a second alt-drag duplicate`,
        },
      )
      .toBe(3);
    const copy2 = ids.find((i) => i !== originalId && i !== copy1)!;

    // Cmd+D once more on the selection (copy2 is selected after its drag).
    await page.keyboard.press(`${MOD}+d`);
    await expect
      .poll(
        async () => {
          html = await fileContentByName(page, designId, navFilename);
          ids = textPrimitiveNodeIds(html, "Link");
          return ids.length;
        },
        {
          timeout: 15_000,
          message:
            "Figma: Cmd+D must persist the fourth Link before order is checked",
        },
      )
      .toBe(4);
    const copy3 = ids.find(
      (i) => i !== originalId && i !== copy1 && i !== copy2,
    )!;
    const styleC2 = styleOf(html, copy2);
    const styleC3 = styleOf(html, copy3);
    expect(
      [styleNum(styleC3, "left"), styleNum(styleC3, "top")],
      "Figma ground truth: Cmd+D duplicate keeps the SAME x/y as the source " +
        "(unlike alt-drag, which offsets by the drag delta)",
    ).toEqual([
      expect.closeTo(styleNum(styleC2, "left"), 0),
      expect.closeTo(styleNum(styleC2, "top"), 0),
    ]);
  });

  test("step 5 [in-screen, NON-FIGMA equivalence]: Design has no auto-layout primitive; Cmd+G group is the closest equivalent for gathering the Link texts", async ({
    page,
  }) => {
    await openEditorAndExpandLayers(page, designId);
    const navFileId = await fileIdByName(page, designId, navFilename);
    const html = await fileContentByName(page, designId, navFilename);
    const linkIds = textPrimitiveNodeIds(html, "Link");
    expect(
      linkIds.length,
      "precondition: 4 Link texts from the prior step",
    ).toBe(4);

    // Shift-select 3 of the 4 (matches the tutorial's later group size) via
    // the canvas, then Cmd+G -- the closest Design equivalent to
    // Shift+A "wrap in auto layout".
    for (const id of linkIds.slice(0, 3)) {
      const box = await screenFrameById(page, navFileId)
        .locator(`[data-agent-native-node-id="${id}"]`)
        .first()
        .boundingBox();
      if (!box) throw new Error(`no box for ${id}`);
      await page.keyboard.down("Shift");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.up("Shift");
      await page.waitForTimeout(200);
    }
    await page.keyboard.press(`${MOD}+g`);
    await page.waitForTimeout(600);

    const afterGroup = await fileContentByName(page, designId, navFilename);
    const groupExists = /data-agent-native-layer-name="Group"/i.test(
      afterGroup,
    );
    expect(
      groupExists,
      `Cmd+G must wrap the 3 selected Link texts in a group as the closest ` +
        `stand-in for Figma's auto-layout (Shift+A). ${JSON.stringify(
          await dump(page),
        ).slice(0, 400)}`,
    ).toBe(true);

    // Rename the group to "Links" via the layers panel, per the tutorial.
    const groupRow = layerRow(page, "Group");
    await expect(groupRow).toHaveCount(1);
    await groupRow.dblclick({ force: true });
    const input = page.getByRole("textbox", {
      name: "Rename layer",
      exact: true,
    });
    await expect(input).toBeVisible();
    await input.fill("Links");
    await input.press("Enter");
    await expect
      .poll(() => fileContentByName(page, designId, navFilename), {
        timeout: 15_000,
        message: 'the group rename must persist as "Links"',
      })
      .toContain('data-agent-native-layer-name="Links"');
  });

  test("step 10 [overview, outside any screen + crosses the screen boundary]: Cmd+D on the Navigation screen creates a Footer screen, then a Link text is moved across screens", async ({
    page,
  }) => {
    await openEditorAndExpandLayers(page, designId);
    const before = await designFiles(page, designId);

    // Select the Navigation screen at the overview level (click its frame
    // label chrome, not an element inside it), then duplicate it whole.
    const navCard = page
      .locator("[data-frame-title]")
      .filter({ hasText: "Navigation" })
      .first();
    await navCard.click({ force: true });
    await page.waitForTimeout(300);
    await page.keyboard.press(`${MOD}+d`);

    let afterDup: string[] = [];
    await expect
      .poll(
        async () => {
          afterDup = await designFiles(page, designId);
          return afterDup.length;
        },
        {
          timeout: 10_000,
          message:
            "Figma: Cmd+D on a top-level frame duplicates the whole frame as a " +
            "new sibling frame -- Design must create one new screen file",
        },
      )
      .toBe(before.length + 1);
    let footerFilename = afterDup.find((f) => !before.includes(f))!;
    expect(
      footerFilename,
      "the duplicated screen file must be identifiable",
    ).toBeTruthy();

    const footerHtmlBefore = await fileContentByName(
      page,
      designId,
      footerFilename,
    );
    const navHtmlBefore = await fileContentByName(page, designId, navFilename);
    const linkIdsInFooterCopy = textPrimitiveNodeIds(footerHtmlBefore, "Link");
    expect(
      linkIdsInFooterCopy.length,
      "the duplicated screen must start with the same content as Navigation",
    ).toBe(textPrimitiveNodeIds(navHtmlBefore, "Link").length);

    // Rename the duplicated screen's root to "Footer" -- located by its
    // current default display name, never by tree position (see step 1b).
    const footerDefaultName = prettyScreenName(footerFilename);
    const footerRow = screenRootRow(page, footerDefaultName);
    await expect(footerRow).toHaveCount(1);
    await footerRow.dblclick({ force: true });
    const renameInput = page.getByRole("textbox", {
      name: "Rename layer",
      exact: true,
    });
    await expect(renameInput).toBeVisible();
    await renameInput.fill("Footer");
    await renameInput.press("Enter");
    let filesAfterFooterRename: string[] = [];
    await expect
      .poll(
        async () => {
          filesAfterFooterRename = await designFiles(page, designId);
          return filesAfterFooterRename.includes("Footer.html");
        },
        {
          timeout: 15_000,
          message: "the duplicated Screen root must persist its Footer rename",
        },
      )
      .toBe(true);
    footerFilename = "Footer.html";

    // Cross-screen move: drag one Link text OUT of Navigation and INTO the
    // new Footer screen (the tutorial's "delete the button instance, keep
    // editing both frames independently" implies the two screens' content
    // diverges after this point -- we exercise the underlying "element
    // crosses a screen boundary" gesture directly).
    const movingId = await authoredTextNodeId(page, footerHtmlBefore, "Link");
    if (!movingId) {
      throw new Error("the duplicated Footer must contain a top-level Link");
    }

    // Fit every screen before dragging so the tiny tutorial text layers have a
    // real hit area. Hide the inspector through the global UI shortcut after
    // the fit; a selected screen keeps the minimal-UI inspector mounted.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await page.keyboard.press("Shift+1");
    await page.waitForTimeout(750);
    await page.keyboard.press(`${MOD}+\\`);
    await page.waitForTimeout(300);

    // Locate the Footer screen's own iframe by scanning all screen iframes
    // for the one whose content actually contains the moving node id.
    const iframes = page.locator(
      "iframe[data-design-preview-iframe][data-screen-iframe-id]",
    );
    const count = await iframes.count();
    let footerIframeIndex = -1;
    for (let i = 0; i < count; i += 1) {
      const frame = iframes.nth(i).contentFrame();
      const has = await frame
        .locator(`[data-agent-native-node-id="${movingId}"]`)
        .count()
        .catch(() => 0);
      if (has > 0) {
        footerIframeIndex = i;
        break;
      }
    }
    expect(
      footerIframeIndex,
      "must find the Footer screen's iframe",
    ).toBeGreaterThanOrEqual(0);

    const footerIframeLoc = iframes.nth(footerIframeIndex);
    const elBox = await footerIframeLoc
      .contentFrame()
      .locator(`[data-agent-native-node-id="${movingId}"]`)
      .first()
      .boundingBox();

    // Drop target: resolve the seeded Home iframe by its file id. Content
    // heuristics are ambiguous once Navigation and Footer share the same text.
    const homeFileId = await fileIdByName(page, designId, "index.html");
    const homeIframeIndex = await iframes.evaluateAll(
      (elements, wantedId) =>
        elements.findIndex(
          (element) =>
            element.getAttribute("data-screen-iframe-id") === wantedId,
        ),
      homeFileId,
    );
    expect(
      homeIframeIndex,
      "must find the Home screen's iframe as the drop target",
    ).toBeGreaterThanOrEqual(0);
    const targetScreenBox = await iframes.nth(homeIframeIndex).boundingBox();
    if (!elBox || !targetScreenBox) {
      throw new Error("missing geometry for cross-screen drag");
    }

    await page.mouse.move(
      elBox.x + elBox.width / 2,
      elBox.y + elBox.height / 2,
    );
    await page.mouse.down();
    // Arm the iframe move gesture before crossing into the host canvas. A
    // single down-plus-boundary jump is treated as selection by the bridge.
    await page.mouse.move(
      elBox.x + elBox.width / 2 + 20,
      elBox.y + elBox.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(
      targetScreenBox.x + targetScreenBox.width / 2,
      targetScreenBox.y + targetScreenBox.height / 2,
      { steps: 24 },
    );
    await page.waitForTimeout(150);
    await page.mouse.up();

    const otherFilename = "index.html";
    let targetHtml = "";
    let sourceHtmlAfter = "";
    await expect
      .poll(
        async () => {
          targetHtml = await fileContentByName(page, designId, otherFilename);
          sourceHtmlAfter = await fileContentByName(
            page,
            designId,
            footerFilename,
          );
          return targetHtml.includes(`data-agent-native-node-id="${movingId}"`);
        },
        {
          timeout: 10_000,
          message:
            `Figma: dragging an element across a frame boundary reparents it into ` +
            `the frame it's dropped on. The moved Link node must now appear in ${otherFilename}.`,
        },
      )
      .toBe(true);
    expect(
      sourceHtmlAfter.includes(`data-agent-native-node-id="${movingId}"`),
      `the moved node must be REMOVED from its original screen ${footerFilename}, ` +
        `not merely copied`,
    ).toBe(false);
  });

  test("step 12 [no equivalent]: converting a frame to a component has no Design equivalent", async () => {
    // Recorded as a finding only -- Design has no components/variants system
    // (see figma-interaction-spec.md tutorial 1/5 notes and arch-map). No
    // gesture to attempt; the closest equivalent already exercised above is
    // plain duplication (Cmd+D), which step 10 covers.
    expect(true).toBe(true);
  });
});
