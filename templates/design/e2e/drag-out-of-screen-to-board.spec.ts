import { appPath } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  savedNodeMap,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const CARD = "drag-out-card";
const SCREEN_HTML = `<!doctype html><html lang="en" data-agent-native-node-id="doc"><head><title>Screen</title></head><body data-agent-native-node-id="page" style="margin:0;background:#0b0b0f"><div data-agent-native-node-id="${CARD}" data-agent-native-layer-name="Card" style="position:absolute;left:80px;top:80px;width:160px;height:100px;background:#e44"></div></body></html>`;
const HUG_OVERFLOW_HTML = `<!doctype html><html lang="en" data-agent-native-node-id="doc"><head><title>Hug overflow</title><meta data-agent-native-screen-height-mode="hug" /></head><body data-agent-native-node-id="page" style="margin:0;width:320px;background:#0b0b0f"><p data-agent-native-node-id="intro" data-agent-native-layer-name="Intro" style="margin:0;height:360px;background:#1f2937;color:#fff">Intro</p><div data-agent-native-node-id="${CARD}" data-agent-native-layer-name="Card" style="width:160px;height:64px;background:#e44"></div><p data-agent-native-node-id="outro" data-agent-native-layer-name="Outro" style="margin:0;height:180px;background:#374151;color:#fff">Outro</p></body></html>`;

test.use({ viewport: { width: 1600, height: 1000 } });

const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

type Frame = { x: number; y: number; width: number; height: number };
type DesignRecord = {
  frames: Record<string, Frame>;
  files: { id: string; filename: string; content: string }[];
};

async function designRecord(app: App, id: string): Promise<DesignRecord> {
  const response = await app.page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${id}`),
  );
  expect(response.ok(), `get-design ${response.status()}`).toBe(true);
  const record = await response.json();
  const data =
    typeof record.data === "string" ? JSON.parse(record.data) : record.data;
  return { frames: data?.canvasFrames ?? {}, files: record.files ?? [] };
}

function savedFile(record: DesignRecord, filename: string) {
  const file = record.files.find(
    (candidate) => candidate.filename === filename,
  );
  if (!file) throw new Error(`saved design has no ${filename}`);
  return file;
}

async function renderedScreenHeight(app: App) {
  const box = await app.page.locator(LIVE_SCREEN).boundingBox();
  const { scale } = await app.pagePoint(0, 0);
  return Math.round(box!.height / scale);
}

async function dragCard(app: App, designX: number, designY: number) {
  const rect = await app.designRect(CARD);
  const grab = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(grab.x, grab.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Card"]);
  const to = await app.pagePoint(designX, designY);
  await app.page.mouse.move(grab.x, grab.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 30 });
  await app.page.mouse.up();
  await app.settled();
}

function childrenOf(nodes: Map<string, SavedNode>, parent: string) {
  return [...nodes.values()]
    .filter((node) => node.parent === parent)
    .sort((a, b) => a.index - b.index)
    .map((node) => node.id);
}

// fixme: product bug: The screen grows while the layer is dragged below it and stays grown after the layer leaves: it renders 1124 design px tall over a saved
test.fixme("a layer dragged below a fixed-height Screen moves to the board at the release point and leaves the Screen's size alone", async ({
  app,
}) => {
  const id = await app.seed(SCREEN_HTML);
  await app.open(id);
  await app.zoomToFit();
  const start = await designRecord(app, id);
  const screen = savedFile(start, "index.html");
  const frame = start.frames[screen.id];
  expect({ width: frame.width, height: frame.height }).toEqual({
    width: 1440,
    height: 1024,
  });
  expect(await renderedScreenHeight(app)).toBe(1024);
  const before = savedNodeMap(screen.content);

  await dragCard(app, 160, 1150);

  const end = await designRecord(app, id);
  const screenAfter = savedNodeMap(savedFile(end, "index.html").content);
  expect([...screenAfter.keys()]).toEqual(["doc", "page"]);
  expectOnlyChanged(before, screenAfter, [CARD]);
  const boardCard = savedNodeMap(savedFile(end, "__board__.html").content).get(
    CARD,
  );
  const style = styleOf(boardCard);
  expect({
    position: style.position,
    width: style.width,
    height: style.height,
  }).toEqual({ position: "absolute", width: "160px", height: "100px" });
  // Below 100% zoom one page pixel spans several design pixels, so the release point rounds.
  expect(Math.abs(parseFloat(style.left) - (frame.x + 80))).toBeLessThanOrEqual(
    3,
  );
  expect(
    Math.abs(parseFloat(style.top) - (frame.y + 1100)),
  ).toBeLessThanOrEqual(3);
  expect(end.frames[screen.id]).toEqual(frame);
  expect(await renderedScreenHeight(app)).toBe(1024);
});

test("a drag released inside a Hug screen's rendered overflow stays in that screen and reorders below the last block", async ({
  app,
}) => {
  const id = await app.seed(HUG_OVERFLOW_HTML);
  const screen = savedFile(await designRecord(app, id), "index.html");
  const setup = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id,
        dataOperations: [
          {
            op: "set",
            path: ["canvasFrames", screen.id],
            value: { x: 0, y: 0, width: 320, height: 200, z: 0 },
          },
          {
            op: "set",
            path: ["screenMetadata", screen.id],
            value: {
              sourceType: "inline",
              width: 320,
              heightMode: "hug",
              heightPinned: false,
            },
          },
        ],
      },
    },
  );
  expect(setup.ok()).toBe(true);
  await app.open(id);
  await app.zoomToFit();
  expect(await renderedScreenHeight(app)).toBe(604);
  const before = await app.savedNodes(id);
  expect(childrenOf(before, "page")).toEqual(["intro", CARD, "outro"]);

  await dragCard(app, 100, 580);

  const end = await designRecord(app, id);
  const after = savedNodeMap(savedFile(end, "index.html").content);
  expect(childrenOf(after, "page")).toEqual(["intro", "outro", CARD]);
  expect(styleOf(after.get(CARD))).toEqual(styleOf(before.get(CARD)));
  expectOnlyChanged(before, after, [CARD]);
  expect(savedNodeMap(savedFile(end, "__board__.html").content).has(CARD)).toBe(
    false,
  );
  expect(end.frames[screen.id]).toEqual({
    x: 0,
    y: 0,
    width: 320,
    height: 200,
    z: 0,
  });
  expect(await app.designRect(CARD)).toEqual({
    x: 0,
    y: 540,
    width: 160,
    height: 64,
  });
});
