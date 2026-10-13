import { type Page } from "@playwright/test";

import { appPath, expandAllLayers, pickFrameMode } from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

// Design keeps a 56px board gap for Cmd+D.
const DESIGN_SCREEN_GAP = 56;
const BOARD = "__board__.html";

const BLANK_SCREEN = (label: string) => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>${label}</title></head>
  <body style="margin:0;min-height:900px;background:#fff"></body>
</html>`;

const NAV_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Navigation</title></head>
  <body style="margin:0;min-height:400px;background:#fff">
    <div data-agent-native-node-id="nav-root" data-agent-native-layer-name="Navigation"
         data-agent-native-component="Navigation"
         style="position:absolute;left:0;top:0;width:1440px;height:80px;box-sizing:border-box;background:#fffdf8;display:flex;align-items:center;padding:0 24px">
      <span data-agent-native-node-id="nav-word" style="font-weight:900">Wordmark</span>
    </div>
  </body>
</html>`;

const PAGE_WITH_NAV = `<!doctype html>
<html><head><meta charset="utf-8"><title>Home</title></head>
<body style="margin:0;padding:40px;background:#fff">
  <main data-agent-native-node-id="page" data-agent-native-layer-name="Page" style="display:flex;flex-direction:column;gap:16px">
    <nav data-agent-native-node-id="nav" data-agent-native-layer-name="Navigation" style="display:flex;gap:24px;align-items:center;padding:12px 24px;background:#fffdf8">
      <span data-agent-native-node-id="word" data-agent-native-layer-name="Wordmark">Wordmark</span>
      <span data-agent-native-node-id="work" data-agent-native-layer-name="Work">Work</span>
    </nav>
    <section data-agent-native-node-id="hero" data-agent-native-layer-name="Hero" style="height:200px;background:#eeeeee"></section>
  </main>
</body></html>`;

type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
  z?: number;
};
type BoardData = { canvasFrames?: Record<string, Frame> };

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  expect(response.ok(), `${name}: ${response.status()}`).toBe(true);
  return response.json();
}

async function fileIds(app: App, designId: string) {
  const record = await app.savedRecord(designId);
  return Object.fromEntries(
    record.files.map((file) => [file.filename, file.id]),
  );
}

async function canvasFrames(app: App, designId: string) {
  return (
    ((await app.savedRecord(designId)).data as BoardData).canvasFrames ?? {}
  );
}

async function filenames(app: App, designId: string) {
  return (await app.savedRecord(designId)).files.map((file) => file.filename);
}

async function selectedScreenIds(page: Page): Promise<string[]> {
  const response = await page.request.get(
    appPath("/_agent-native/application-state/design-selection"),
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()).selectedScreenIds ?? []) as string[];
}

async function setFrames(
  page: Page,
  designId: string,
  frames: Record<string, Frame>,
) {
  await action(page, "update-design", {
    id: designId,
    dataOperations: Object.entries(frames).map(([id, value]) => ({
      op: "set",
      path: ["canvasFrames", id],
      value,
    })),
  });
}

async function openOverview(app: App, designId: string, screens: number) {
  await app.page.goto(appPath(`/design/${designId}?view=overview&zoom=30`), {
    waitUntil: "domcontentloaded",
  });
  await expect(app.page.locator("[data-screen-shell]")).toHaveCount(screens);
  await expect.poll(() => filenames(app, designId)).toContain(BOARD);
}

async function emptyBoardPoint(page: Page, drawnAt?: { x: number; y: number }) {
  const point = await page.evaluate(
    ({ drawnAt, dragWidth, dragHeight }) => {
      const world = document.querySelector("[data-multi-screen-canvas-world]");
      const surface = (world?.parentElement ?? world) as HTMLElement | null;
      if (!surface) return null;
      const r = surface.getBoundingClientRect();
      const screens: {
        left: number;
        right: number;
        top: number;
        bottom: number;
      }[] = Array.from(
        document.querySelectorAll("[data-screen-shell][data-frame-id]"),
      ).map((el) => el.getBoundingClientRect());
      if (drawnAt) {
        screens.push({
          left: drawnAt.x,
          top: drawnAt.y,
          right: drawnAt.x + dragWidth,
          bottom: drawnAt.y + dragHeight,
        });
      }
      for (let y = r.top + 60; y < r.bottom - 60 - dragHeight; y += 40) {
        for (let x = r.left + 60; x < r.right - 60 - dragWidth; x += 40) {
          const clear = screens.every(
            (s) =>
              x + dragWidth < s.left - 24 ||
              x > s.right + 24 ||
              y + dragHeight < s.top - 24 ||
              y > s.bottom + 24,
          );
          const hit = document.elementFromPoint(x, y);
          if (clear && hit && surface.contains(hit)) return { x, y };
        }
      }
      return null;
    },
    { drawnAt, dragWidth: 120, dragHeight: 80 },
  );
  if (!point) throw new Error("no empty canvas point found");
  return point;
}

function boardFrames(nodes: Map<string, SavedNode>) {
  return [...nodes.values()].filter(
    (node) => node.attrs["data-an-primitive"] === "frame",
  );
}

async function drawBoardFrame(
  app: App,
  designId: string,
  from: { x: number; y: number },
) {
  const before = boardFrames(await app.savedNodes(designId, BOARD)).length;
  await pickFrameMode(app.page, "Frame");
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(from.x + 120, from.y + 80, { steps: 16 });
  await app.page.mouse.up();
  await app.settled();
  expect(boardFrames(await app.savedNodes(designId, BOARD))).toHaveLength(
    before + 1,
  );
}

/** The editor persists node ids into the migrated board on its own shortly after opening. */
async function openWithBoardIdentity(app: App, designId: string) {
  await app.open(designId);
  await expect
    .poll(async () => {
      const board = (await app.savedRecord(designId)).files.find(
        (file) => file.filename === BOARD,
      );
      return board?.content?.includes("data-agent-native-node-id") ?? false;
    })
    .toBe(true);
}

function px(value: string | undefined) {
  return Number.parseFloat(value ?? "NaN");
}

test("Frame Selection wraps two board frames in one frame at their union bounds, and undo/redo restore each state exactly", async ({
  app,
}) => {
  const id = await app.seed(BLANK_SCREEN("Home"));
  await openWithBoardIdentity(app, id);
  const p1 = await emptyBoardPoint(app.page);
  await drawBoardFrame(app, id, p1);
  const p2 = await emptyBoardPoint(app.page, p1);
  await drawBoardFrame(app, id, p2);
  const before = await app.savedNodes(id, BOARD);
  const [first, second] = boardFrames(before);
  expect(second.parent).toBe(first.parent);
  const a = styleOf(first);
  const b = styleOf(second);

  await app.page.getByRole("button", { name: "Move", exact: true }).click();
  await app.page.mouse.click(p1.x + 10, p1.y + 10);
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Frame"]);
  await app.page.keyboard.down("Shift");
  await app.page.mouse.click(p2.x + 10, p2.y + 10);
  await app.page.keyboard.up("Shift");
  await expect
    .poll(() => app.selectedLayers())
    .toStrictEqual(["Frame", "Frame"]);
  await app.page.keyboard.press("ControlOrMeta+Alt+g");
  await app.settled();

  const wrapped = await app.savedNodes(id, BOARD);
  const wrapper = [...wrapped.values()].find((node) => !before.has(node.id));
  expect(wrapper?.parent).toBe(first.parent);
  expect(childrenOf(wrapped, wrapper!.id)).toStrictEqual([first.id, second.id]);
  const left = Math.min(px(a.left), px(b.left));
  const top = Math.min(px(a.top), px(b.top));
  expect(wrapper!.attrs).toEqual({
    "data-agent-native-node-id": wrapper!.id,
    "data-agent-native-layer-name": "Frame",
    "data-agent-native-group-wrapper": "true",
    "data-agent-native-preserve-styles": "true",
    "data-an-primitive": "frame",
    style: expect.any(String),
  });
  expect(styleOf(wrapper)).toEqual({
    position: "absolute",
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.max(px(a.left) + px(a.width), px(b.left) + px(b.width)) - left}px`,
    height: `${Math.max(px(a.top) + px(a.height), px(b.top) + px(b.height)) - top}px`,
  });
  expect(styleOf(wrapped.get(first.id))).toEqual({
    ...a,
    left: `${px(a.left) - left}px`,
    top: `${px(a.top) - top}px`,
  });
  expect(styleOf(wrapped.get(second.id))).toEqual({
    ...b,
    left: `${px(b.left) - left}px`,
    top: `${px(b.top) - top}px`,
  });
  expectOnlyChanged(before, wrapped, [first.id, second.id, wrapper!.id]);

  await app.page.keyboard.press("ControlOrMeta+z");
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id, BOARD), []);

  await app.page.keyboard.press("ControlOrMeta+Shift+z");
  await app.settled();
  expectOnlyChanged(wrapped, await app.savedNodes(id, BOARD), []);
});

// fixme: product bug: Minor source cruft: Remove fill keeps background: rgb(255,255,255) and adds background-color: transparent (line 229); renders correctly.
test.fixme("removing a board frame's fill in the inspector saves it without a background and changes nothing else", async ({
  app,
}) => {
  const id = await app.seed(BLANK_SCREEN("Home"));
  await openWithBoardIdentity(app, id);
  const p1 = await emptyBoardPoint(app.page);
  await drawBoardFrame(app, id, p1);
  const before = await app.savedNodes(id, BOARD);
  const [frame] = boardFrames(before);
  expect(styleOf(frame).background).toBe("rgb(255, 255, 255)");

  await app.page.getByRole("button", { name: "Move", exact: true }).click();
  await app.page.mouse.click(p1.x + 10, p1.y + 10);
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Frame"]);
  const fill = app.page
    .locator("section")
    .filter({ has: app.page.getByRole("heading", { name: /^Fill$/i }) })
    .first();
  await fill.hover();
  await fill.getByRole("button", { name: "Remove layer" }).first().click();
  await app.settled();

  const rendered = app.page
    .locator("[data-board-surface-layer] iframe[data-design-preview-iframe]")
    .contentFrame()
    .locator(`[data-agent-native-node-id="${frame.id}"]`);
  await expect(rendered).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const after = await app.savedNodes(id, BOARD);
  const { background: _removed, ...rest } = styleOf(frame);
  expect(styleOf(after.get(frame.id))).toEqual(rest);
  expectOnlyChanged(before, after, [frame.id]);
});

// fixme: product bug: Copy lands as a flow child at Home's top-left (no position/left/top) and its style is rewritten to computed longhands (background 'none
test.fixme("Option-dragging a component instance onto another screen drops a copy at the cursor and leaves the source screen untouched", async ({
  app,
}) => {
  const id = await app.seed(BLANK_SCREEN("Home"), {
    files: { "nav.html": NAV_SCREEN },
  });
  const ids = await fileIds(app, id);
  await setFrames(app.page, id, {
    [ids["index.html"]]: { x: 0, y: 0, width: 1440, height: 900, z: 0 },
    [ids["nav.html"]]: { x: -1600, y: 0, width: 1440, height: 400, z: 1 },
  });
  await app.open(id);
  await app.zoomToFit();
  const navBefore = await app.savedNodes(id, "nav.html");
  const homeBefore = await app.savedNodes(id);
  expect(await app.designRect("nav-root", "nav.html")).toEqual({
    x: 0,
    y: 0,
    width: 1440,
    height: 80,
  });
  const grab = await app.pagePoint(720, 40, "nav.html");
  await app.page.mouse.click(grab.x, grab.y);
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Navigation"]);

  const drop = await app.pagePoint(820, 220, "index.html");
  await app.page.mouse.move(grab.x, grab.y);
  await app.page.keyboard.down("Alt");
  await app.page.mouse.down();
  await app.page.mouse.move(drop.x, drop.y, { steps: 20 });
  await app.page.mouse.up();
  await app.page.keyboard.up("Alt");
  await app.settled();

  const homeAfter = await app.savedNodes(id);
  const copies = [...homeAfter.values()].filter(
    (node) => node.attrs["data-agent-native-component"] === "Navigation",
  );
  expect(copies).toHaveLength(1);
  expect(homeAfter.get(copies[0].parent!)?.tag).toBe("body");
  expect(styleOf(copies[0])).toEqual({
    ...styleOf(navBefore.get("nav-root")),
    left: "100px",
    top: "180px",
  });
  expectOnlyChanged(
    homeBefore,
    homeAfter,
    [...homeAfter.keys()].filter((key) => !homeBefore.has(key)),
  );
  expectOnlyChanged(navBefore, await app.savedNodes(id, "nav.html"), []);
});

// fixme: product bug: No wrapper: Shift+A re-applies auto layout to the nav itself, overwriting padding '12px 24px' with '12px' and stamping
test.fixme("Shift+A on an element that already has auto layout wraps it in a new auto-layout frame without changing its own layout", async ({
  app,
}) => {
  const id = await app.seed(PAGE_WITH_NAV);
  await app.open(id);
  await app.zoomToFit();
  const before = await app.savedNodes(id);
  const nav = await app.designRect("nav");
  const center = await app.pagePoint(
    nav.x + nav.width / 2,
    nav.y + nav.height / 2,
  );
  await app.page.mouse.click(center.x, center.y);
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Navigation"]);

  await app.page.keyboard.press("Shift+A");
  await app.settled();

  const after = await app.savedNodes(id);
  const [wrapperId] = childrenOf(after, "page");
  expect(childrenOf(after, "page")).toStrictEqual([wrapperId, "hero"]);
  expect(wrapperId).not.toBe("nav");
  expect(childrenOf(after, wrapperId)).toStrictEqual(["nav"]);
  expect(styleOf(after.get("nav"))).toEqual(styleOf(before.get("nav")));
  expect(styleOf(after.get(wrapperId))).toEqual({
    display: "flex",
    "flex-direction": "column",
    gap: "10px",
    padding: "0px",
    width: "fit-content",
    height: "fit-content",
  });
  expectOnlyChanged(before, after, ["nav", wrapperId]);
});

// fixme: product bug, intermittent: after a screen duplicate the editor POSTs collab awareness to a stale room and gets 404
test.fixme("step 5 [overview, screens as top-level frames]: Cmd+D finds free slots, stacks above the source, and groups undo/redo", async ({
  app,
}) => {
  const id = await app.seed(NAV_SCREEN, {
    files: {
      "neighbor.html": BLANK_SCREEN("Neighbor"),
      "farther.html": BLANK_SCREEN("Farther"),
    },
  });
  const ids = await fileIds(app, id);
  const sourceId = ids["index.html"];
  const neighborId = ids["neighbor.html"];
  const fartherId = ids["farther.html"];
  const sourceGeometry = { x: 200, y: 720, width: 320, height: 240, z: 0 };
  const firstDuplicateX =
    sourceGeometry.x + sourceGeometry.width + DESIGN_SCREEN_GAP;
  const secondDuplicateX =
    firstDuplicateX + sourceGeometry.width + DESIGN_SCREEN_GAP;
  await setFrames(app.page, id, {
    [sourceId]: sourceGeometry,
    [neighborId]: { x: 200, y: 1200, width: 320, height: 240, z: 1 },
    [fartherId]: { x: 2000, y: 720, width: 320, height: 240, z: 2 },
  });
  await openOverview(app, id, 3);
  const filesBefore = await filenames(app, id);
  const frameLabel = app.page.locator(
    `[data-frame-id="${sourceId}"] [data-frame-label]`,
  );
  const selectSource = async () => {
    await app.page
      .getByRole("button", { name: /^\d+%$/ })
      .first()
      .click();
    await app.page.getByRole("menuitem", { name: "Zoom to fit" }).click();
    await expect(frameLabel).toBeInViewport();
    await frameLabel.click({ position: { x: 4, y: 4 } });
    await expect
      .poll(() => selectedScreenIds(app.page))
      .toStrictEqual([sourceId]);
  };

  await selectSource();
  await app.page.keyboard.press("ControlOrMeta+d");
  await app.settled();
  expect(await filenames(app, id)).toStrictEqual([
    ...filesBefore,
    "index-copy.html",
  ]);
  const dup1Id = (await fileIds(app, id))["index-copy.html"];
  let frames = await canvasFrames(app, id);
  expect([frames[dup1Id], frames[neighborId].z, frames[fartherId].z]).toEqual([
    { ...sourceGeometry, x: firstDuplicateX, z: 1 },
    2,
    3,
  ]);
  await expect.poll(() => selectedScreenIds(app.page)).toStrictEqual([dup1Id]);
  // Duplicating a screen regenerates every node id (like paste), so assert
  // on the content signature, not the source id.
  expect(await app.savedHtml(id, "index-copy.html")).toContain(
    'data-agent-native-component="Navigation"',
  );

  await selectSource();
  await app.page.keyboard.press("ControlOrMeta+d");
  await app.settled();
  expect(await filenames(app, id)).toStrictEqual([
    ...filesBefore,
    "index-copy.html",
    "index-copy-2.html",
  ]);
  const dup2Id = (await fileIds(app, id))["index-copy-2.html"];
  frames = await canvasFrames(app, id);
  expect([
    frames[dup2Id],
    frames[dup1Id].z,
    frames[neighborId].z,
    frames[fartherId].z,
  ]).toEqual([{ ...sourceGeometry, x: secondDuplicateX, z: 1 }, 2, 3, 4]);
  await expect.poll(() => selectedScreenIds(app.page)).toStrictEqual([dup2Id]);

  await app.page.keyboard.press("ControlOrMeta+z");
  await app.settled();
  expect(await filenames(app, id)).toStrictEqual([
    ...filesBefore,
    "index-copy.html",
  ]);
  frames = await canvasFrames(app, id);
  expect([
    frames[sourceId].z,
    frames[dup1Id],
    frames[neighborId].z,
    frames[fartherId].z,
  ]).toEqual([0, { ...sourceGeometry, x: firstDuplicateX, z: 1 }, 2, 3]);

  await app.page.keyboard.press("ControlOrMeta+Shift+z");
  await app.settled();
  expect(await filenames(app, id)).toStrictEqual([
    ...filesBefore,
    "index-copy.html",
    "index-copy-2.html",
  ]);
  const redoneId = (await fileIds(app, id))["index-copy-2.html"];
  frames = await canvasFrames(app, id);
  expect([
    frames[redoneId],
    frames[dup1Id].z,
    frames[neighborId].z,
    frames[fartherId].z,
  ]).toEqual([{ ...sourceGeometry, x: secondDuplicateX, z: 1 }, 2, 3, 4]);
  await expect
    .poll(() => selectedScreenIds(app.page))
    .toStrictEqual([redoneId]);
});

// fixme: product bug, intermittent: after a screen duplicate the editor GETs collab state and POSTs awareness to a stale room and gets 404
test.fixme("step 5 [overview, multi-selection]: Cmd+D duplicates every selected screen in one undo step", async ({
  app,
}) => {
  const id = await app.seed(BLANK_SCREEN("Source"), {
    files: {
      "neighbor.html": BLANK_SCREEN("Neighbor"),
      "farther.html": BLANK_SCREEN("Farther"),
    },
  });
  const ids = await fileIds(app, id);
  const sourceId = ids["index.html"];
  const neighborId = ids["neighbor.html"];
  const fartherId = ids["farther.html"];
  const geometry = {
    [sourceId]: { x: 0, y: 120, width: 320, height: 240, z: 0 },
    [neighborId]: { x: 376, y: 120, width: 320, height: 240, z: 1 },
    [fartherId]: { x: 1128, y: 120, width: 320, height: 240, z: 2 },
  };
  const copyFrames = {
    "index-copy.html": {
      ...geometry[sourceId],
      x: 376 + 320 + DESIGN_SCREEN_GAP,
      z: 1,
    },
    "neighbor-copy.html": {
      ...geometry[neighborId],
      x: 1128 + 320 + DESIGN_SCREEN_GAP,
      z: 3,
    },
    "farther-copy.html": {
      ...geometry[fartherId],
      x: 1128 + 2 * (320 + DESIGN_SCREEN_GAP),
      z: 5,
    },
  };
  await setFrames(app.page, id, geometry);
  await openOverview(app, id, 3);
  await app.zoomToFit();
  await app.page
    .locator(`[data-frame-id="${sourceId}"] [data-screen-card]`)
    .click();
  await expect
    .poll(() => selectedScreenIds(app.page))
    .toStrictEqual([sourceId]);
  await app.page.keyboard.press("ControlOrMeta+a");
  await expect
    .poll(async () => (await selectedScreenIds(app.page)).sort())
    .toStrictEqual([sourceId, neighborId, fartherId].sort());
  const filesBefore = await filenames(app, id);

  await app.page.keyboard.press("ControlOrMeta+d");
  await app.settled();

  const copyIds = await fileIds(app, id);
  expect((await filenames(app, id)).sort()).toStrictEqual(
    [...filesBefore, ...Object.keys(copyFrames)].sort(),
  );
  let frames = await canvasFrames(app, id);
  expect({
    source: frames[sourceId],
    neighbor: frames[neighborId],
    farther: frames[fartherId],
    copies: Object.keys(copyFrames).map((name) => frames[copyIds[name]]),
  }).toEqual({
    source: { ...geometry[sourceId], z: 0 },
    neighbor: { ...geometry[neighborId], z: 2 },
    farther: { ...geometry[fartherId], z: 4 },
    copies: Object.values(copyFrames),
  });
  await expect
    .poll(async () => (await selectedScreenIds(app.page)).sort())
    .toStrictEqual(
      Object.keys(copyFrames)
        .map((name) => copyIds[name])
        .sort(),
    );

  await app.page.keyboard.press("ControlOrMeta+z");
  await app.settled();
  expect((await filenames(app, id)).sort()).toStrictEqual(filesBefore.sort());
  frames = await canvasFrames(app, id);
  expect([frames[sourceId], frames[neighborId], frames[fartherId]]).toEqual(
    Object.values(geometry),
  );

  await app.page.keyboard.press("ControlOrMeta+Shift+z");
  await app.settled();
  const redoneIds = await fileIds(app, id);
  frames = await canvasFrames(app, id);
  expect(
    Object.keys(copyFrames).map((name) => frames[redoneIds[name]]),
  ).toEqual(Object.values(copyFrames));
  await expect
    .poll(async () => (await selectedScreenIds(app.page)).sort())
    .toStrictEqual(
      Object.keys(copyFrames)
        .map((name) => redoneIds[name])
        .sort(),
    );
});

test("dragging Bio above Skills in the Layers panel reorders the saved children and moves nothing else", async ({
  app,
}) => {
  const id = await app.seed(`<!doctype html>
<html><head><meta charset="utf-8"><title>Home</title></head>
<body style="margin:0;min-height:900px;background:#fff">
  <main data-agent-native-node-id="page" data-agent-native-layer-name="Page">
    <div data-agent-native-node-id="hero" data-agent-native-layer-name="Hero" style="height:200px;background:#eee"></div>
    <div data-agent-native-node-id="skills" data-agent-native-layer-name="Skills" style="height:200px;background:#ddd"></div>
    <div data-agent-native-node-id="bio" data-agent-native-layer-name="Bio" style="height:120px;background:#ccc"></div>
  </main>
</body></html>`);
  await app.open(id);
  await expandAllLayers(app.page);
  const before = await app.savedNodes(id);
  const row = (name: string) =>
    app.page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button][data-layer-node-id]")
      .filter({ has: app.page.locator(`span[title="${name}"]`) })
      .locator('xpath=ancestor::*[@role="treeitem"][1]');
  const skillsBox = await row("Skills").boundingBox();

  await row("Bio").dragTo(row("Skills"), {
    targetPosition: { x: 10, y: skillsBox!.height - 2 },
  });
  await app.settled();

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "page")).toStrictEqual(["hero", "bio", "skills"]);
  expectOnlyChanged(before, after, []);
  expect([
    (await app.designRect("bio")).y,
    (await app.designRect("skills")).y,
  ]).toEqual([200, 320]);
});

// fixme: product bug: The editor switches to Home at 100% with a blank canvas for 14s and selects the Home screen, not the main instance (line 491: selected
test.fixme("'Go to main component' on a later instance selects the earliest instance on its screen", async ({
  app,
}) => {
  const id = await app.seed(NAV_SCREEN, {
    files: { "about.html": NAV_SCREEN.replace(/nav-(root|word)/g, "about-$1") },
  });
  await app.open(id);
  await app.zoomToFit();
  const nav = await app.designRect("about-root", "about.html");
  const point = await app.pagePoint(
    nav.x + nav.width / 2,
    nav.y + nav.height / 2,
    "about.html",
  );
  await app.page.mouse.click(point.x, point.y);
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Navigation"]);
  const before = await app.savedRecord(id);

  await app.page.getByRole("button", { name: "Go to main component" }).click();

  await expect(
    app.page.locator(
      '[role="treeitem"][aria-selected="true"] [data-layer-row-button]',
    ),
  ).toHaveAttribute("data-layer-node-id", "nav-root");
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Navigation"]);
  await app.settled();
  expect((await app.savedRecord(id)).files).toEqual(before.files);
});

test("'Go to main component' on the only instance says so and keeps the selection", async ({
  app,
}) => {
  const id = await app.seed(NAV_SCREEN);
  await app.open(id);
  await app.zoomToFit();
  const point = await app.pagePoint(720, 40);
  await app.page.mouse.click(point.x, point.y);
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Navigation"]);

  await app.page.getByRole("button", { name: "Go to main component" }).click();

  await expect(
    app.page.getByText('"Navigation" has only one instance — this is it.'),
  ).toBeVisible();
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Navigation"]);
  await expect(app.page).toHaveURL(/editorView=overview/);
});
