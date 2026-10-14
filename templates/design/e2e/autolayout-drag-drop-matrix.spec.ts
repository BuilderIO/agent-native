import { type APIRequestContext, type Page } from "@playwright/test";

import { chromeBounds } from "./drag-and-drop.shared";
import {
  appPath,
  cdpScreenshot,
  designFrame,
  expandAllLayers,
  gotoEditor,
} from "./helpers";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const COMMAND = process.platform === "darwin" ? "Meta" : "Control";
const IGNORE_AUTO_LAYOUT = process.platform === "darwin" ? "Control" : "S";
const LINKED_COMPONENT_OVERRIDES = encodeURIComponent(
  JSON.stringify([
    { sourceNodeId: "play-label", property: "style:background-color" },
  ]),
);

const MATRIX_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Auto layout matrix</title></head>
  <body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif">
    <section id="hrow" data-agent-native-node-id="hrow" data-agent-native-layer-name="Horizontal nowrap" style="position:absolute;left:40px;top:40px;width:560px;height:104px;box-sizing:border-box;display:flex;flex-direction:row;flex-wrap:nowrap;gap:16px;padding:12px 18px;background:#1e293b">
      <div data-agent-native-node-id="h-first" data-agent-native-layer-name="H First" style="box-sizing:border-box;flex:0 0 100px;width:100px;height:56px;background:#38bdf8;color:#082f49">H First</div>
      <div data-agent-native-node-id="h-middle" data-agent-native-layer-name="H Middle" style="box-sizing:border-box;flex:0 0 110px;width:110px;height:56px;background:#a78bfa;color:#2e1065">H Middle</div>
      <div data-agent-native-node-id="h-last" data-agent-native-layer-name="H Last" style="box-sizing:border-box;flex:0 0 90px;width:90px;height:56px;background:#fbbf24;color:#451a03">H Last</div>
    </section>
    <section id="vcol" data-agent-native-node-id="vcol" data-agent-native-layer-name="Vertical" style="position:absolute;left:40px;top:190px;width:260px;height:210px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:10px 20px 30px 40px;background:#1e293b">
      <div data-agent-native-node-id="v-first" data-agent-native-layer-name="V First" style="flex:0 0 42px;height:42px;background:#34d399;color:#052e16">V First</div>
      <div data-agent-native-node-id="v-middle" data-agent-native-layer-name="V Middle" style="flex:0 0 44px;height:44px;background:#fb7185;color:#4c0519">V Middle</div>
      <div data-agent-native-node-id="v-last" data-agent-native-layer-name="V Last" style="flex:0 0 38px;height:38px;background:#f97316;color:#431407">V Last</div>
    </section>
    <section id="nested-outer" data-agent-native-node-id="nested-outer" data-agent-native-layer-name="Nested outer" style="position:absolute;left:350px;top:200px;width:400px;height:190px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:16px;background:#334155">
      <section id="nested-inner" data-agent-native-node-id="nested-inner" data-agent-native-layer-name="Nested inner" style="box-sizing:border-box;display:flex;flex-direction:row;gap:10px;padding:8px;width:360px;height:92px;background:#475569">
        <p data-agent-native-node-id="inner-text" data-agent-native-layer-name="Inner text" style="margin:0;flex:0 0 auto;padding:8px;background:#e2e8f0;color:#0f172a">Inner text</p>
        <button data-agent-native-node-id="inner-component" data-agent-native-layer-name="Inner component" data-agent-native-component="Card" style="flex:0 0 120px;width:120px;height:40px;background:#c4b5fd;color:#2e1065;border:0">Instance</button>
      </section>
      <div data-agent-native-node-id="nested-marker" data-agent-native-layer-name="Nested marker" style="width:100px;height:34px;background:#64748b">Marker</div>
    </section>
    <section id="mixed-target" data-agent-native-node-id="mixed-target" data-agent-native-layer-name="Mixed target" style="position:absolute;left:40px;top:450px;width:520px;height:130px;box-sizing:border-box;display:flex;flex-direction:row;gap:10px;padding:12px;background:#1e293b"></section>
    <section id="size-target" data-agent-native-node-id="size-target" data-agent-native-layer-name="Sizing target" style="position:absolute;left:600px;top:450px;width:320px;height:160px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:12px;background:#1e293b"></section>
    <div data-agent-native-node-id="free-shape" data-agent-native-layer-name="Free shape" style="position:absolute;left:780px;top:60px;width:76px;height:44px;background:#22d3ee;color:#083344">Shape</div>
    <p data-agent-native-node-id="free-text" data-agent-native-layer-name="Free text" style="position:absolute;left:780px;top:140px;margin:0;width:100px;padding:8px;background:#f8fafc;color:#0f172a">Text</p>
    <button data-agent-native-node-id="free-component" data-agent-native-layer-name="Free component" data-agent-native-component="Card" style="position:absolute;left:780px;top:230px;width:110px;height:42px;background:#c4b5fd;color:#2e1065;border:0">Component</button>
    <img data-agent-native-node-id="free-image" data-agent-native-layer-name="Free image" alt="Free image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='48'%3E%3Crect width='80' height='48' fill='%230ea5e9'/%3E%3C/svg%3E" style="position:absolute;left:900px;top:280px;width:80px;height:48px" />
    <div data-agent-native-node-id="fixed-source" data-agent-native-layer-name="Fixed source" style="position:absolute;left:780px;top:330px;width:72px;height:30px;flex:none;background:#f59e0b;color:#431407">Fixed</div>
    <div data-agent-native-node-id="hug-source" data-agent-native-layer-name="Hug source" style="position:absolute;left:780px;top:370px;width:max-content;min-width:0;padding:4px 8px;background:#86efac;color:#14532d">Hug text</div>
    <div data-agent-native-node-id="fill-source" data-agent-native-layer-name="Fill source" style="position:absolute;left:780px;top:420px;flex:1 1 0%;min-width:0;width:auto;height:28px;background:#fda4af;color:#4c0519">Fill</div>
    <section id="ignore-target" data-agent-native-node-id="ignore-target" data-agent-native-layer-name="Ignore target" style="position:absolute;left:600px;top:640px;width:320px;height:100px;box-sizing:border-box;display:flex;flex-direction:row;gap:10px;padding:10px;background:#1e293b">
      <div data-agent-native-node-id="ignore-sibling" data-agent-native-layer-name="Ignore sibling" style="flex:0 0 90px;width:90px;height:40px;background:#94a3b8;color:#0f172a">Sibling</div>
    </section>
    <div data-agent-native-node-id="ignore-source" data-agent-native-layer-name="Ignore source" style="position:absolute;left:40px;top:650px;width:70px;height:34px;background:#fb7185;color:#4c0519">Ignore</div>
  </body>
</html>`;

const SECOND_SCREEN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Second screen</title></head>
<body style="margin:0;position:relative;width:1000px;height:780px;background:#111827;color:#f8fafc;font-family:system-ui,sans-serif">
  <section data-agent-native-node-id="cross-target" data-agent-native-layer-name="Cross target" style="position:absolute;left:80px;top:120px;width:400px;height:140px;box-sizing:border-box;display:flex;flex-direction:row;gap:12px;padding:12px;background:#334155">
    <div data-agent-native-node-id="cross-anchor" data-agent-native-layer-name="Cross anchor" style="flex:0 0 120px;width:120px;height:50px;background:#94a3b8;color:#0f172a">Anchor</div>
  </section>
</body></html>`;

const FLOW_CHILD_FREE_CANVAS_HTML = `<!doctype html><html><body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a;color:#f8fafc">
  <section id="flow-origin" data-agent-native-node-id="flow-origin" data-agent-native-layer-name="Flow origin" style="position:absolute;left:80px;top:100px;width:360px;height:130px;box-sizing:border-box;display:flex;flex-direction:row;gap:20px;padding:16px;background:#334155">
    <div data-agent-native-node-id="flow-child" data-agent-native-layer-name="Flow child" style="box-sizing:border-box;flex:0 0 100px;width:100px;height:56px;background:#38bdf8;color:#082f49">Child</div>
    <div data-agent-native-node-id="flow-peer" data-agent-native-layer-name="Flow peer" style="box-sizing:border-box;flex:0 0 100px;width:100px;height:56px;background:#a78bfa;color:#2e1065">Peer</div>
  </section>
</body></html>`;

const LONE_SHAPE_HTML = `<!doctype html><html><body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a">
  <div data-agent-native-node-id="lone-shape" data-agent-native-layer-name="Lone shape" style="position:absolute;left:120px;top:100px;width:80px;height:50px;background:#22d3ee"></div>
</body></html>`;

const NESTED_GRID_HTML = `<!doctype html><html><body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a;color:#f8fafc">
  <section id="grid-outer" data-agent-native-node-id="grid-outer" data-agent-native-layer-name="Grid outer" style="position:absolute;left:200px;top:150px;width:450px;height:220px;box-sizing:border-box;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr);background:#334155">
    <section id="grid-inner" data-agent-native-node-id="grid-inner" data-agent-native-layer-name="Grid inner" style="grid-column:1;grid-row:1;display:grid;grid-template-columns:120px;grid-template-rows:60px;width:120px;height:60px;background:#475569">
      <p data-agent-native-node-id="grid-child" data-agent-native-layer-name="Grid child" style="grid-column:1;grid-row:1;margin:0;padding:8px;background:#e2e8f0;color:#0f172a">Grid child</p>
    </section>
    <div id="grid-marker" data-agent-native-node-id="grid-marker" data-agent-native-layer-name="Grid marker" style="grid-column:2;grid-row:1;background:#64748b">Marker</div>
  </section>
</body></html>`;

const OVERSIZED_CROSS_SCREEN_PRIMARY_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a">
  <div data-agent-native-node-id="oversized-source" data-agent-native-layer-name="Oversized Source"
    style="position:absolute;left:500px;top:300px;width:500px;height:110px;background:#ea580c">Source</div>
</body></html>`;

const OVERSIZED_CROSS_SCREEN_SECOND_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:1000px;height:780px;background:#111827">
  <section data-agent-native-node-id="plain-target" data-agent-native-layer-name="Empty Flow"
    style="position:absolute;left:80px;top:120px;width:360px;height:180px;display:flex;flex-direction:row;background:#374151"></section>
</body></html>`;

const GRID_CROSS_SCREEN_PRIMARY_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a">
  <section data-agent-native-node-id="source-grid" style="position:absolute;left:500px;top:300px;width:180px;height:120px;display:grid;grid-template-columns:repeat(3,60px);grid-template-rows:repeat(3,40px)">
    <div data-agent-native-node-id="grid-source" data-agent-native-layer-name="Grid source"
      style="grid-column:span 2;grid-row:span 2;background:#ea580c">Source</div>
  </section>
</body></html>`;

const GRID_CROSS_SCREEN_SECOND_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:1000px;height:780px;background:#111827">
  <section data-agent-native-node-id="target-grid" data-agent-native-layer-name="Target grid"
    style="position:absolute;left:80px;top:120px;width:360px;height:180px;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(3,1fr);gap:0;background:#374151">
    <div data-agent-native-node-id="grid-first" style="grid-column:1;grid-row:1;background:#64748b"></div>
    <div data-agent-native-node-id="grid-second" style="grid-column:2;grid-row:1;background:#64748b"></div>
  </section>
</body></html>`;

const META_CROSS_SCREEN_PRIMARY_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a">
  <div data-agent-native-node-id="meta-source" data-agent-native-layer-name="Meta Source"
    style="position:absolute;left:500px;top:300px;width:500px;height:110px;background:#ea580c">Source</div>
</body></html>`;

const META_CROSS_SCREEN_SECOND_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:1000px;height:780px;background:#111827">
  <section data-agent-native-node-id="meta-target" data-agent-native-layer-name="Empty Flow"
    style="position:absolute;left:80px;top:120px;width:360px;height:180px;display:flex;flex-direction:row;background:#374151"></section>
</body></html>`;

const RELEASE_STATE_CROSS_SCREEN_PRIMARY_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a">
  <div data-agent-native-node-id="release-source" data-agent-native-layer-name="Release Source"
    style="position:absolute;left:500px;top:300px;width:120px;height:48px;background:#ea580c">Source</div>
</body></html>`;

const RELEASE_STATE_CROSS_SCREEN_SECOND_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:1000px;height:780px;background:#111827">
  <section data-agent-native-node-id="release-target" data-agent-native-layer-name="Release Flow"
    style="position:absolute;left:80px;top:120px;width:360px;height:180px;display:flex;flex-direction:row;background:#374151"></section>
</body></html>`;

const FREEFORM_CROSS_SCREEN_PRIMARY_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a">
  <div data-agent-native-node-id="freeform-source" data-agent-native-layer-name="Freeform Source"
    style="position:absolute;left:500px;top:300px;width:72px;height:44px;background:#ea580c">Source</div>
</body></html>`;

const FREEFORM_CROSS_SCREEN_SECOND_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:1000px;height:780px;background:#111827">
  <div data-agent-native-node-id="freeform-target" data-agent-native-layer-name="Freeform Target"
    style="position:absolute;left:80px;top:120px;width:360px;height:180px;background:#374151">
    <div data-agent-native-node-id="freeform-anchor" data-agent-native-layer-name="Freeform Anchor"
      style="position:absolute;left:24px;top:24px;width:100px;height:48px;background:#94a3b8">Anchor</div>
  </div>
</body></html>`;

const LINKED_COMPONENT_HTML = `<!doctype html><html><body style="margin:0;width:900px;height:360px;box-sizing:border-box;display:flex;flex-direction:row;align-items:flex-start;gap:32px;padding:40px;background:#111827;color:#f8fafc">
  <section data-agent-native-node-id="play-main" data-agent-native-layer-name="Play main" data-agent-native-component-id="cmp-play" data-agent-native-component="PlayButton" style="box-sizing:border-box;display:flex;flex-direction:row;gap:12px;padding:16px;width:340px;height:120px;background:#1e293b">
    <div data-agent-native-node-id="play-label" data-agent-native-layer-name="Canonical play label" style="flex:0 0 120px;height:56px;background:#38bdf8;color:#082f49"></div>
    <div data-agent-native-node-id="play-badge" data-agent-native-layer-name="Canonical play badge" style="flex:0 0 100px;height:56px;background:#fbbf24;color:#451a03"></div>
  </section>
  <section data-agent-native-node-id="play-instance" data-agent-native-layer-name="Play instance" data-agent-native-component-ref="cmp-play" data-agent-native-component="PlayButton" data-agent-native-component-overrides="${LINKED_COMPONENT_OVERRIDES}" style="box-sizing:border-box;display:flex;flex-direction:row;gap:12px;padding:16px;width:340px;height:120px;background:#334155">
    <div data-agent-native-node-id="play-label-instance" data-agent-native-component-source-node-id="play-label" data-agent-native-layer-name="Play label instance" style="flex:0 0 120px;height:56px;background:#67e8f9;color:#164e63"></div>
    <div data-agent-native-node-id="play-badge-instance" data-agent-native-component-source-node-id="play-badge" data-agent-native-layer-name="Play badge instance" style="flex:0 0 100px;height:56px;background:#fde68a;color:#78350f"></div>
  </section>
</body></html>`;

const ROOT_SCREEN_FIXTURES = {
  horizontal: `<!doctype html><html><body style="margin:0;width:760px;height:360px;box-sizing:border-box;display:flex;flex-direction:row;align-items:center;gap:24px;padding:28px;background:#111827;color:#f8fafc">
  <div data-agent-native-node-id="root-a" data-agent-native-layer-name="Root A" style="flex:0 0 120px;width:120px;height:72px;background:#38bdf8"></div>
  <div data-agent-native-node-id="root-b" data-agent-native-layer-name="Root B" style="flex:0 0 140px;width:140px;height:84px;background:#a78bfa"></div>
  <div data-agent-native-node-id="root-c" data-agent-native-layer-name="Root C" style="flex:0 0 100px;width:100px;height:64px;background:#fbbf24"></div>
</body></html>`,
  vertical: `<!doctype html><html><body style="margin:0;width:520px;height:620px;box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:18px;padding:26px 42px 34px;background:#111827;color:#f8fafc">
  <div data-agent-native-node-id="root-a" data-agent-native-layer-name="Root A" style="flex:0 0 72px;width:180px;height:72px;background:#34d399">A</div>
  <div data-agent-native-node-id="root-b" data-agent-native-layer-name="Root B" style="flex:0 0 86px;width:220px;height:86px;background:#fb7185">B</div>
  <div data-agent-native-node-id="root-c" data-agent-native-layer-name="Root C" style="flex:0 0 64px;width:150px;height:64px;background:#f97316">C</div>
</body></html>`,
  wrap: `<!doctype html><html><body style="margin:0;width:430px;height:430px;box-sizing:border-box;display:flex;flex-direction:row;flex-wrap:wrap;align-content:flex-start;gap:16px 22px;padding:24px 30px;background:#111827;color:#f8fafc">
  <div data-agent-native-node-id="root-a" data-agent-native-layer-name="Root A" style="flex:0 0 150px;width:150px;height:76px;background:#38bdf8">A</div>
  <div data-agent-native-node-id="root-b" data-agent-native-layer-name="Root B" style="flex:0 0 150px;width:150px;height:88px;background:#a78bfa">B</div>
  <div data-agent-native-node-id="root-c" data-agent-native-layer-name="Root C" style="flex:0 0 150px;width:150px;height:68px;background:#fbbf24">C</div>
  <div data-agent-native-node-id="root-d" data-agent-native-layer-name="Root D" style="flex:0 0 150px;width:150px;height:74px;background:#34d399">D</div>
</body></html>`,
  "grid-explicit": `<!doctype html><html><body style="margin:0;width:620px;height:420px;box-sizing:border-box;display:grid;grid-template-columns:repeat(2,180px);grid-template-rows:96px 112px;column-gap:28px;row-gap:22px;align-items:center;justify-content:space-between;padding:30px 44px;background:#111827;color:#f8fafc">
  <div data-agent-native-node-id="root-a" data-agent-native-layer-name="Root A" style="min-height:48px;background:#38bdf8"></div>
  <div data-agent-native-node-id="root-c" data-agent-native-layer-name="Root C" style="min-height:48px;background:#fbbf24"></div>
  <div data-agent-native-node-id="root-b" data-agent-native-layer-name="Root B" style="min-height:48px;grid-column:span 2;background:#a78bfa"></div>
</body></html>`,
  "grid-implicit": `<!doctype html><html><body style="margin:0;width:620px;height:520px;box-sizing:border-box;display:grid;grid-template-columns:repeat(2,180px);grid-auto-rows:82px;column-gap:18px;row-gap:20px;align-items:start;justify-content:center;padding:28px;background:#111827;color:#f8fafc">
  <div data-agent-native-node-id="root-a" data-agent-native-layer-name="Root A" style="min-height:48px;background:#38bdf8"></div>
  <div data-agent-native-node-id="root-b" data-agent-native-layer-name="Root B" style="min-height:48px;background:#a78bfa"></div>
  <div data-agent-native-node-id="root-c" data-agent-native-layer-name="Root C" style="min-height:48px;background:#fbbf24"></div>
  <div data-agent-native-node-id="root-d" data-agent-native-layer-name="Root D" style="min-height:48px;background:#34d399"></div>
  <div data-agent-native-node-id="root-e" data-agent-native-layer-name="Root E" style="min-height:48px;background:#fb7185"></div>
  </body></html>`,
  "grid-authored-column-flow": `<!doctype html><html><body style="margin:0;width:620px;height:420px;box-sizing:border-box;display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));grid-template-rows:repeat(2,minmax(72px,1fr));grid-auto-flow:column;gap:18px;padding:28px;background:#111827;color:#f8fafc">
  <div data-agent-native-node-id="root-a" data-agent-native-layer-name="Root A" style="min-height:48px;background:#38bdf8">A</div>
  <div data-agent-native-node-id="root-b" data-agent-native-layer-name="Root B" style="min-height:48px;background:#a78bfa">B</div>
  <div data-agent-native-node-id="root-c" data-agent-native-layer-name="Root C" style="min-height:48px;grid-row:1;grid-column:2;background:#fbbf24">C</div>
  </body></html>`,
} as const;

type RootFixture = keyof typeof ROOT_SCREEN_FIXTURES;

type FileRecord = { id: string; filename: string; content: string };
type DesignRecord = { files?: FileRecord[]; data?: unknown };

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    {
      data: input,
    },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function readDesign(
  request: APIRequestContext,
  designId: string,
): Promise<DesignRecord> {
  const response = await request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  return response.json() as Promise<DesignRecord>;
}

async function createDesign(
  app: App,
  options: {
    secondScreen?: boolean;
    primaryHtml?: string;
    secondHtml?: string;
  } = {},
): Promise<{ id: string; primaryId: string; secondId?: string }> {
  const secondScreen = options.secondScreen ?? false;
  const id = await app.seed(options.primaryHtml ?? MATRIX_HTML, {
    title: "Auto layout matrix",
    files: secondScreen
      ? { "second.html": options.secondHtml ?? SECOND_SCREEN_HTML }
      : {},
  });
  const request = app.page.request;
  const record = await readDesign(request, id);
  const primaryId = record.files?.find(
    (file) => file.filename === "index.html",
  )?.id;
  const secondId = record.files?.find(
    (file) => file.filename === "second.html",
  )?.id;
  if (!primaryId || (secondScreen && !secondId)) {
    throw new Error("created matrix screens are missing");
  }
  const dataOperations = [
    {
      op: "set",
      path: ["screenMetadata", primaryId],
      value: { sourceType: "inline", width: 1000, height: 780 },
    },
    {
      op: "set",
      path: ["canvasFrames", primaryId],
      value: { x: 0, y: 0, width: 1000, height: 780, z: 0 },
    },
  ];
  if (secondId) {
    dataOperations.push(
      {
        op: "set",
        path: ["screenMetadata", secondId],
        value: { sourceType: "inline", width: 1000, height: 780 },
      },
      {
        op: "set",
        path: ["canvasFrames", secondId],
        value: { x: 1120, y: 0, width: 1000, height: 780, z: 1 },
      },
    );
  }
  await action(request, "update-design", { id, dataOperations });
  return { id, primaryId, secondId };
}

async function fileHtml(
  request: APIRequestContext,
  designId: string,
  fileId: string,
): Promise<string> {
  const record = await readDesign(request, designId);
  const file = record.files?.find((candidate) => candidate.id === fileId);
  if (!file) throw new Error(`design file ${fileId} is missing`);
  return file.content;
}

function hasNode(html: string, nodeId: string): boolean {
  return html.includes(`data-agent-native-node-id="${nodeId}"`);
}

async function selectionSourceId(
  request: APIRequestContext,
): Promise<string | null> {
  const response = await request.get(
    appPath("/_agent-native/application-state/design-selection"),
  );
  if (!response.ok()) return null;
  const state = (await response.json()) as {
    selectedElement?: { sourceId?: string } | null;
  };
  return state.selectedElement?.sourceId ?? null;
}

async function activeSelectionFileId(
  request: APIRequestContext,
): Promise<string | null> {
  const response = await request.get(
    appPath("/_agent-native/application-state/design-selection"),
  );
  if (!response.ok()) return null;
  const state = (await response.json()) as { activeFileId?: string | null };
  return state.activeFileId ?? null;
}

async function settleReload(page: Page, screenId: string): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator(`[data-screen-shell][data-frame-id="${screenId}"]`),
  ).toBeVisible();
  await expect
    .poll(() => designFrame(page, screenId).locator("body").count())
    .toBe(1);
}

async function selectLayer(page: Page, name: string): Promise<void> {
  await expandAllLayers(page);
  const row = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.getByTitle(name, { exact: true }) })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
  await expect(row).toBeVisible();
  await row.locator("[data-layer-row-button]").click();
  await expect.poll(() => chromeBounds(page)).not.toBeNull();
}

async function layerParentName(
  page: Page,
  name: string,
): Promise<string | null> {
  const row = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.getByTitle(name, { exact: true }) })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
  return row.evaluate((item) => {
    const current = item as HTMLElement;
    const tree = current.closest<HTMLElement>('[role="tree"]');
    if (!tree) return null;
    const level = Number(current.getAttribute("aria-level"));
    const items = Array.from(
      tree.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    );
    const index = items.indexOf(current);
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

async function layerNameForNode(
  page: Page,
  screenId: string,
  nodeId: string,
): Promise<string> {
  const name = await designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .getAttribute("data-agent-native-layer-name");
  if (!name) throw new Error(`missing layer name for ${nodeId}`);
  return name;
}

async function boxFor(page: Page, screenId: string, nodeId: string) {
  const box = await designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .boundingBox();
  if (!box) throw new Error(`missing box for ${nodeId}`);
  return box;
}

type ChildSnapshot = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  transform: string;
};

async function rootChildren(
  page: Page,
  screenId: string,
): Promise<ChildSnapshot[]> {
  return designFrame(page, screenId)
    .locator("body > [data-agent-native-node-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        return {
          id: element.getAttribute("data-agent-native-node-id") ?? "",
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          transform: getComputedStyle(element).transform,
        };
      }),
    );
}

async function rootChildIds(page: Page, screenId: string): Promise<string[]> {
  return (await rootChildren(page, screenId)).map((child) => child.id);
}

type HeldSnapshot = {
  stage: string;
  source: {
    parentId: string | null;
    transform: string;
    zIndex: string;
    opacity: string;
    pointerEvents: string;
    lifted: boolean;
  } | null;
  guide: {
    display: string;
    left: number;
    top: number;
    width: number;
    height: number;
    border: string;
    overlapsTarget: boolean;
  } | null;
  children: ChildSnapshot[];
};

async function heldSnapshot(
  page: Page,
  screenId: string,
  sourceId: string,
  targetId: string | null,
  stage: string,
): Promise<HeldSnapshot> {
  return designFrame(page, screenId)
    .locator("body")
    .evaluate(
      (body, ids) => {
        const source = body.querySelector<HTMLElement>(
          `[data-agent-native-node-id="${ids.sourceId}"]`,
        );
        const target = ids.targetId
          ? body.querySelector<HTMLElement>(
              `[data-agent-native-node-id="${ids.targetId}"]`,
            )
          : null;
        const sourceStyle = source ? getComputedStyle(source) : null;
        const guide = Array.from(
          body.ownerDocument.documentElement.querySelectorAll<HTMLElement>(
            "[data-agent-native-insertion-guide]",
          ),
        ).find((candidate) => {
          const style = getComputedStyle(candidate);
          const rect = candidate.getBoundingClientRect();
          return style.display !== "none" && rect.width > 0 && rect.height > 0;
        });
        const guideStyle = guide ? getComputedStyle(guide) : null;
        const guideRect = guide?.getBoundingClientRect();
        const targetRect = target?.getBoundingClientRect();
        const overlapsTarget = Boolean(
          guideRect &&
          targetRect &&
          guideRect.right > targetRect.left &&
          guideRect.left < targetRect.right &&
          guideRect.bottom > targetRect.top &&
          guideRect.top < targetRect.bottom,
        );
        const parent = source?.parentElement;
        const children = parent
          ? Array.from(parent.children)
              .filter((child) =>
                child.hasAttribute("data-agent-native-node-id"),
              )
              .map((child) => {
                const element = child as HTMLElement;
                const rect = element.getBoundingClientRect();
                return {
                  id: element.getAttribute("data-agent-native-node-id") ?? "",
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                  transform: getComputedStyle(element).transform,
                };
              })
          : [];
        const transform = sourceStyle?.transform ?? "none";
        const zIndex = sourceStyle?.zIndex ?? "auto";
        return {
          stage: ids.stage,
          source: source
            ? {
                parentId:
                  source.parentElement?.getAttribute(
                    "data-agent-native-node-id",
                  ) ?? null,
                transform,
                zIndex,
                opacity: sourceStyle?.opacity ?? "1",
                pointerEvents: sourceStyle?.pointerEvents ?? "auto",
                lifted:
                  transform !== "none" &&
                  zIndex === "2147483646" &&
                  sourceStyle?.pointerEvents === "none",
              }
            : null,
          guide:
            guide && guideStyle && guideRect
              ? {
                  display: guideStyle.display,
                  left: guideRect.left,
                  top: guideRect.top,
                  width: guideRect.width,
                  height: guideRect.height,
                  border: guideStyle.border,
                  overlapsTarget,
                }
              : null,
          children,
        };
      },
      { sourceId, targetId, stage },
    );
}

async function settledHeldSnapshot(
  page: Page,
  screenId: string,
  sourceId: string,
  targetId: string | null,
  stage: string,
): Promise<HeldSnapshot> {
  await expect
    .poll(
      async () => {
        const snapshot = await heldSnapshot(
          page,
          screenId,
          sourceId,
          targetId,
          stage,
        );
        return Boolean(
          snapshot.guide &&
          snapshot.guide.display !== "none" &&
          snapshot.guide.width > 0 &&
          snapshot.guide.height > 0 &&
          (targetId === null || snapshot.guide.overlapsTarget),
        );
      },
      {
        timeout: 5_000,
        message: `${stage} insertion guide did not settle while held`,
      },
    )
    .toBe(true);
  return heldSnapshot(page, screenId, sourceId, targetId, stage);
}

function childMoved(
  before: ChildSnapshot[],
  during: ChildSnapshot[],
  excludedId: string,
): boolean {
  const beforeById = new Map(before.map((child) => [child.id, child]));
  return during.some((child) => {
    if (child.id === excludedId) return false;
    const prior = beforeById.get(child.id);
    return Boolean(
      prior &&
      (Math.abs(child.left - prior.left) > 2 ||
        Math.abs(child.top - prior.top) > 2 ||
        child.transform !== prior.transform),
    );
  });
}

async function dragHeldAndSampleState(
  page: Page,
  request: APIRequestContext,
  designId: string,
  screenId: string,
  sourceId: string,
  targetId: string,
  targetEdge: "leading" | "trailing" | "center" = "center",
  axis: "horizontal" | "vertical" = "horizontal",
  sourceLayerName?: string,
): Promise<{
  initialHtml: string;
  beforeReleaseHtml: string;
  before: ChildSnapshot[];
  snapshots: HeldSnapshot[];
  after: HeldSnapshot;
}> {
  await selectLayer(
    page,
    sourceLayerName ?? (await layerNameForNode(page, screenId, sourceId)),
  );
  const source = await boxFor(page, screenId, sourceId);
  const target = await boxFor(page, screenId, targetId);
  const before = await rootChildren(page, screenId);
  const initialHtml = await fileHtml(request, designId, screenId);
  const start = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  const end =
    targetEdge === "leading"
      ? axis === "horizontal"
        ? { x: target.x + 3, y: target.y + target.height / 2 }
        : { x: target.x + target.width / 2, y: target.y + 3 }
      : targetEdge === "trailing"
        ? axis === "horizontal"
          ? {
              x: target.x + target.width - 3,
              y: target.y + target.height / 2,
            }
          : {
              x: target.x + target.width / 2,
              y: target.y + target.height - 3,
            }
        : {
            x: target.x + target.width / 2,
            y: target.y + target.height / 2,
          };
  const snapshots: HeldSnapshot[] = [];
  let beforeReleaseHtml = initialHtml;
  const capture = async (stage: string) => {
    await page.waitForTimeout(16);
    snapshots.push(
      await heldSnapshot(page, screenId, sourceId, targetId, stage),
    );
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await capture("pointerdown");
    await page.mouse.move(start.x + 1, start.y + 1, { steps: 1 });
    await capture("below-threshold");
    await page.mouse.move(start.x + 12, start.y + 8, { steps: 1 });
    await capture("lift-threshold");
    for (let step = 1; step <= 8; step += 1) {
      const progress = step / 8;
      await page.mouse.move(
        start.x + (end.x - start.x) * progress,
        start.y + (end.y - start.y) * progress,
        { steps: 1 },
      );
      await capture(`target-${step}`);
    }
    if (sourceId === "root-d" && targetId === "root-a") {
      for (let repeat = 1; repeat <= 3; repeat += 1) {
        await page.mouse.move(end.x, end.y, { steps: 1 });
        await capture(`target-repeat-${repeat}`);
      }
    }
    beforeReleaseHtml = await fileHtml(request, designId, screenId);
  } finally {
    await page.mouse.up();
  }
  await page.waitForTimeout(100);
  const after = await heldSnapshot(
    page,
    screenId,
    sourceId,
    targetId,
    "after-release",
  );
  return { initialHtml, beforeReleaseHtml, before, snapshots, after };
}

async function dragHeld(
  page: Page,
  screenId: string,
  sourceId: string,
  targetId: string,
  options: {
    modifier?: string;
    releaseModifierBeforeMouse?: boolean;
    sourceLayerName?: string;
    targetEdge?: "leading" | "trailing" | "center";
    axis?: "horizontal" | "vertical";
  } = {},
) {
  await selectLayer(
    page,
    options.sourceLayerName ??
      (await layerNameForNode(page, screenId, sourceId)),
  );
  const source = await boxFor(page, screenId, sourceId);
  const target = await boxFor(page, screenId, targetId);
  const start = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  const edge = options.targetEdge ?? "center";
  const axis = options.axis ?? "vertical";
  const end =
    edge === "leading"
      ? axis === "horizontal"
        ? { x: target.x + 2, y: target.y + target.height / 2 }
        : { x: target.x + target.width / 2, y: target.y + 2 }
      : edge === "trailing"
        ? axis === "horizontal"
          ? {
              x: target.x + target.width - 2,
              y: target.y + target.height / 2,
            }
          : {
              x: target.x + target.width / 2,
              y: target.y + target.height - 2,
            }
        : {
            x: target.x + target.width / 2,
            y: target.y + target.height / 2,
          };
  let mouseHeld = false;
  let modifierHeld = false;
  try {
    if (options.modifier) {
      modifierHeld = true;
      await page.keyboard.down(options.modifier);
    }
    await page.mouse.move(start.x, start.y);
    mouseHeld = true;
    await page.mouse.down();
    await page.mouse.move(start.x + 12, start.y + 8, { steps: 5 });
    if (options.modifier && options.releaseModifierBeforeMouse) {
      await page.keyboard.up(options.modifier);
      modifierHeld = false;
    }
    await page.mouse.move(end.x, end.y, { steps: 24 });
    await page.waitForTimeout(250);
    const during = await designFrame(page, screenId)
      .locator("body")
      .evaluate((body) => {
        const guide = Array.from(
          body.ownerDocument.documentElement.querySelectorAll<HTMLElement>(
            "[data-agent-native-insertion-guide]",
          ),
        ).find((candidate) => {
          const style = getComputedStyle(candidate);
          const rect = candidate.getBoundingClientRect();
          return style.display !== "none" && rect.width > 0 && rect.height > 0;
        });
        const style = guide ? getComputedStyle(guide) : null;
        const rect = guide?.getBoundingClientRect();
        return {
          display: style?.display ?? "none",
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
          border: style?.border ?? "",
        };
      });
    return { source, target, during };
  } finally {
    if (mouseHeld) await page.mouse.up();
    if (modifierHeld) await page.keyboard.up(options.modifier!);
  }
}

async function directChildren(page: Page, screenId: string, parentId: string) {
  return designFrame(page, screenId)
    .locator(
      `[data-agent-native-node-id="${parentId}"] > [data-agent-native-node-id]`,
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-agent-native-node-id")),
    );
}

async function parentId(
  page: Page,
  screenId: string,
  nodeId: string,
): Promise<string | null> {
  return designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate(
      (node) =>
        node.parentElement?.getAttribute("data-agent-native-node-id") ?? null,
    );
}

async function nestedGeometry(page: Page, screenId: string) {
  return designFrame(page, screenId)
    .locator('[data-agent-native-node-id="nested-marker"]')
    .evaluate((node) => {
      const parent = node.parentElement!;
      const nodeStyle = getComputedStyle(node);
      const parentStyle = getComputedStyle(parent);
      const nodeRect = node.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      return {
        position: nodeStyle.position,
        leftInset: nodeRect.left - parentRect.left,
        topInset: nodeRect.top - parentRect.top,
        paddingLeft: Number.parseFloat(parentStyle.paddingLeft),
        paddingTop: Number.parseFloat(parentStyle.paddingTop),
        gap: parentStyle.gap,
      };
    });
}

async function directChildGeometry(
  page: Page,
  screenId: string,
  parentId: string,
): Promise<ChildSnapshot[]> {
  return designFrame(page, screenId)
    .locator(
      `[data-agent-native-node-id="${parentId}"] > [data-agent-native-node-id]`,
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        return {
          id: element.getAttribute("data-agent-native-node-id") ?? "",
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          transform: getComputedStyle(element).transform,
        };
      }),
    );
}

async function flowSpacing(page: Page, screenId: string) {
  return designFrame(page, screenId)
    .locator("#vcol")
    .evaluate((node) => {
      const parent = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const children = Array.from(node.children).map((child) => {
        const rect = child.getBoundingClientRect();
        return {
          id: child.getAttribute("data-agent-native-node-id"),
          leftInset: rect.left - parent.left,
          rightInset: parent.right - rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      });
      return {
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        gap: style.gap,
        children,
      };
    });
}

async function flowStyles(page: Page, screenId: string, nodeId: string) {
  return designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        flex: style.flex,
        authoredWidth: (node as HTMLElement).style.width,
        width: style.width,
        position: style.position,
      };
    });
}

async function assertReloadedOrder(
  page: Page,
  screenId: string,
  parent: string,
  expected: string[],
): Promise<void> {
  await expect
    .poll(() => directChildren(page, screenId, parent))
    .toEqual(expected);
  await settleReload(page, screenId);
  await expect
    .poll(() => directChildren(page, screenId, parent))
    .toEqual(expected);
}

function serializedOrder(html: string, ids: string[]): string[] {
  const positions = ids.map((id) => ({
    id,
    index: html.indexOf(`data-agent-native-node-id="${id}"`),
  }));
  if (positions.some(({ index }) => index < 0)) return [];
  return positions
    .sort((left, right) => left.index - right.index)
    .map(({ id }) => id);
}

function childrenOf(
  nodes: Map<string, { parent: string | null; index: number }>,
  parent: string | null,
) {
  return [...nodes.entries()]
    .filter(([, node]) => node.parent === parent)
    .sort(([, a], [, b]) => a.index - b.index)
    .map(([id]) => id);
}

/** The node id plus every saved descendant id: a moved layer carries its own children. */
function subtree(
  nodes: Map<string, { parent: string | null }>,
  id: string,
): string[] {
  return [
    id,
    ...[...nodes.entries()]
      .filter(([, node]) => node.parent === id)
      .flatMap(([child]) => subtree(nodes, child)),
  ];
}

function bodyOf(nodes: Map<string, { tag: string }>) {
  return [...nodes.entries()].find(([, node]) => node.tag === "body")?.[0];
}

function expectPx(value: string | undefined, expected: number, label: string) {
  expect(value, `${label} is ${value}`).toMatch(/^-?\d+(\.\d+)?px$/);
  expect(
    Math.abs(Number.parseFloat(value!) - expected),
    `${label} is ${value}, expected ${expected}px`,
  ).toBeLessThanOrEqual(1);
}

/** The node's box inside its own screen document, in design pixels. */
async function localRect(page: Page, screenId: string, nodeId: string) {
  return designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });
}

/** Where a grid item renders, in design pixels; its size follows the track sizes. */
async function cellOf(page: Page, screenId: string, nodeId: string) {
  const { x, y } = await localRect(page, screenId, nodeId);
  return { x, y };
}

/** Shift+1 on a multi-Screen canvas, then waits until the Screen stops moving. */
async function zoomToFitScreens(page: Page, screenId: string) {
  const frame = page.locator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
  );
  const before = JSON.stringify(await frame.boundingBox());
  await page.keyboard.press("Shift+1");
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await frame.boundingBox());
        const stable = now === previous && now !== before;
        previous = now;
        return stable;
      },
      {
        intervals: [100],
        timeout: 10_000,
        message: "the canvas never settled after zoom to fit",
      },
    )
    .toBe(true);
}

/** Serializes a style attribute the way the browser does, so authored and rewritten forms compare equal. */
async function normalizedCss(page: Page, css: string | undefined) {
  return page.evaluate((text) => {
    const probe = document.createElement("div");
    probe.style.cssText = text;
    return probe.style.cssText;
  }, css ?? "");
}

function attrsBesidesStyle(node: SavedNode | undefined) {
  const { style: _style, ...attrs } = node?.attrs ?? {};
  return attrs;
}

test.use({ viewport: { width: 1600, height: 1100 } });

test.describe("auto-layout drag/drop matrix", () => {
  test("held drag previews multiple targets without committing until mouseup", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app);
    await gotoEditor(page, design.id);
    await selectLayer(
      page,
      await layerNameForNode(page, design.primaryId, "h-last"),
    );

    const source = await boxFor(page, design.primaryId, "h-last");
    const firstTarget = await boxFor(page, design.primaryId, "h-first");
    const secondTarget = await boxFor(page, design.primaryId, "h-middle");
    const initialChildren = await directChildren(
      page,
      design.primaryId,
      "hrow",
    );
    const initialHtml = await fileHtml(request, design.id, design.primaryId);
    const center = (box: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => ({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
    const start = center(source);
    const first = center(firstTarget);
    const second = center(secondTarget);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    try {
      await page.mouse.move(first.x, first.y, { steps: 12 });
      const firstGuide = await settledHeldSnapshot(
        page,
        design.primaryId,
        "h-last",
        "h-first",
        "first-target",
      );
      await page.mouse.move(second.x, second.y, { steps: 12 });
      const secondGuide = await settledHeldSnapshot(
        page,
        design.primaryId,
        "h-last",
        "h-middle",
        "second-target",
      );

      expect(firstGuide.guide?.display).toBe("block");
      expect(secondGuide.guide?.display).toBe("block");
      expect(firstGuide.guide?.left).not.toBe(secondGuide.guide?.left);
      expect(firstGuide.children.map((child) => child.id)).toEqual(
        initialChildren,
      );
      expect(secondGuide.children.map((child) => child.id)).toEqual(
        initialChildren,
      );
      expect(await directChildren(page, design.primaryId, "hrow")).toEqual(
        initialChildren,
      );
      expect(await fileHtml(request, design.id, design.primaryId)).toBe(
        initialHtml,
      );
      await page.mouse.move(first.x, first.y, { steps: 12 });
      await settledHeldSnapshot(
        page,
        design.primaryId,
        "h-last",
        "h-first",
        "final-first-target",
      );
    } finally {
      await page.mouse.up();
    }

    await expect
      .poll(() => directChildren(page, design.primaryId, "hrow"))
      .toEqual(["h-last", "h-first", "h-middle"]);
    await expect
      .poll(() =>
        fileHtml(request, design.id, design.primaryId).then((html) =>
          serializedOrder(html, ["h-last", "h-first", "h-middle"]),
        ),
      )
      .toEqual(["h-last", "h-first", "h-middle"]);
    await assertReloadedOrder(page, design.primaryId, "hrow", [
      "h-last",
      "h-first",
      "h-middle",
    ]);
  });

  const horizontalSlotCells = [
    {
      slot: "first",
      source: "h-last",
      target: "h-first",
      targetEdge: "leading" as const,
      expected: ["h-last", "h-first", "h-middle"],
    },
    {
      slot: "middle",
      source: "h-first",
      target: "h-middle",
      targetEdge: "center" as const,
      expected: ["h-middle", "h-first", "h-last"],
    },
    {
      slot: "end",
      source: "h-first",
      target: "h-last",
      targetEdge: "trailing" as const,
      expected: ["h-middle", "h-last", "h-first"],
    },
  ];

  for (const cell of horizontalSlotCells) {
    test(`horizontal nowrap ${cell.slot} slot exposes a held marker and persists`, async ({
      app,
      page,
      request,
    }) => {
      const design = await createDesign(app);
      await gotoEditor(page, design.id);
      const result = await dragHeld(
        page,
        design.primaryId,
        cell.source,
        cell.target,
        { axis: "horizontal", targetEdge: cell.targetEdge },
      );
      expect(result.during.display).toBe("block");
      expect(result.during.height).toBeGreaterThan(result.during.width);
      expect(await fileHtml(request, design.id, design.primaryId)).toContain(
        'data-agent-native-node-id="hrow"',
      );
      await assertReloadedOrder(page, design.primaryId, "hrow", cell.expected);
    });
  }

  test("vertical center and trailing insertion keep held guides and exact reload geometry", async ({
    app,
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    const cells = [
      {
        name: "center",
        source: "v-last",
        target: "v-first",
        targetEdge: "center" as const,
        expected: ["v-last", "v-first", "v-middle"],
      },
      {
        name: "trailing",
        source: "v-middle",
        target: "v-last",
        targetEdge: "trailing" as const,
        expected: ["v-first", "v-last", "v-middle"],
      },
    ];
    for (const cell of cells) {
      await test.step(cell.name, async () => {
        const design = await createDesign(app);
        await gotoEditor(page, design.id);
        const evidence = await dragHeldAndSampleState(
          page,
          request,
          design.id,
          design.primaryId,
          cell.source,
          cell.target,
          cell.targetEdge,
          "vertical",
        );
        const lifted = evidence.snapshots.find(
          (snapshot) => snapshot.source?.lifted,
        );
        expect(lifted?.source?.lifted).toBe(true);
        expect(
          evidence.snapshots.some(
            (snapshot) =>
              snapshot.guide?.display === "block" &&
              snapshot.guide.width > snapshot.guide.height,
          ),
        ).toBe(true);
        expect(evidence.beforeReleaseHtml).toBe(evidence.initialHtml);
        expect(evidence.after.source?.lifted).toBe(false);

        const geometry = await directChildGeometry(
          page,
          design.primaryId,
          "vcol",
        );
        expect(geometry.map((child) => child.id)).toEqual(cell.expected);
        const spacing = await flowSpacing(page, design.primaryId);
        expect(spacing).toMatchObject({
          paddingTop: "10px",
          paddingRight: "20px",
          paddingBottom: "30px",
          paddingLeft: "40px",
          gap: "12px",
        });
        expect(spacing.children[0]?.leftInset).toBeCloseTo(40, 0);
        expect(spacing.children[0]?.rightInset).toBeCloseTo(20, 0);
        expect(spacing.children[1]!.top - spacing.children[0]!.bottom).toBe(12);

        await settleReload(page, design.primaryId);
        const reloadedGeometry = await directChildGeometry(
          page,
          design.primaryId,
          "vcol",
        );
        expect(reloadedGeometry.map((child) => child.id)).toEqual(
          cell.expected,
        );
        expect(reloadedGeometry).toHaveLength(geometry.length);
        for (const [index, child] of geometry.entries()) {
          expect(reloadedGeometry[index]).toMatchObject({
            id: child.id,
            width: child.width,
            height: child.height,
            transform: child.transform,
          });
          expect(reloadedGeometry[index]?.left).toBeCloseTo(child.left, 0);
          expect(reloadedGeometry[index]?.top).toBeCloseTo(child.top, 0);
        }
      });
    }
  });

  test("nested two-level drop preserves gap/padding and flow participation", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app);
    await gotoEditor(page, design.id);
    const primaryModifier = COMMAND;
    const result = await dragHeld(
      page,
      design.primaryId,
      "nested-marker",
      "nested-inner",
      { modifier: primaryModifier },
    );
    expect(result.during.display).toBe("block");
    await expect
      .poll(() => parentId(page, design.primaryId, "nested-marker"))
      .toBe("nested-inner");
    const geometry = await nestedGeometry(page, design.primaryId);
    expect(geometry.position).not.toBe("absolute");
    expect(geometry.leftInset).toBeGreaterThanOrEqual(geometry.paddingLeft - 1);
    expect(geometry.topInset).toBeGreaterThanOrEqual(geometry.paddingTop - 1);
    expect(geometry.gap).toBe("10px");
    await settleReload(page, design.primaryId);
    await expect
      .poll(() => parentId(page, design.primaryId, "nested-marker"))
      .toBe("nested-inner");
    const reloadedGeometry = await nestedGeometry(page, design.primaryId);
    expect(reloadedGeometry).toMatchObject({
      position: geometry.position,
      paddingLeft: geometry.paddingLeft,
      paddingTop: geometry.paddingTop,
      gap: geometry.gap,
    });
    expect(reloadedGeometry.leftInset).toBeGreaterThanOrEqual(
      reloadedGeometry.paddingLeft - 1,
    );
    expect(reloadedGeometry.topInset).toBeGreaterThanOrEqual(
      reloadedGeometry.paddingTop - 1,
    );
    const html = await fileHtml(request, design.id, design.primaryId);
    expect(html).toMatch(/id="nested-inner"[^>]*display:flex/);
  });

  const assertFlowInsertCell = async (
    app: App,
    page: Page,
    cell: {
      source: string;
      tag: string;
      savedStyle: Record<string, string>;
      rendered: { x: number; y: number; width: number; height: number };
      image: {
        complete: boolean;
        naturalWidth: number;
        naturalHeight: number;
      } | null;
    },
  ) => {
    test.setTimeout(150_000);
    const design = await createDesign(app);
    await gotoEditor(page, design.id);
    await app.zoomToFit();
    const before = await app.savedNodes(design.id);
    expect(childrenOf(before, "mixed-target")).toEqual([]);
    const source = await app.designRect(cell.source);
    const target = await app.designRect("mixed-target");
    const grab = await app.pagePoint(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    const lift = await app.pagePoint(
      source.x + source.width / 2 + 12,
      source.y + source.height / 2 + 8,
    );
    const drop = await app.pagePoint(
      target.x + target.width / 2,
      target.y + target.height / 2,
    );
    await page.mouse.click(grab.x, grab.y);
    await expect.poll(() => selectionSourceId(page.request)).toBe(cell.source);

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(lift.x, lift.y, { steps: 5 });
    await page.mouse.move(drop.x, drop.y, { steps: 24 });
    await expect(
      designFrame(page, design.primaryId).locator(
        "[data-agent-native-insertion-guide]:visible",
      ),
    ).not.toHaveCount(0);
    expect(await app.savedNodes(design.id)).toEqual(before);
    await page.mouse.up();
    await app.settled();

    const after = await app.savedNodes(design.id);
    expect(childrenOf(after, "mixed-target")).toEqual([cell.source]);
    const inserted = after.get(cell.source)!;
    expect(inserted.tag.toUpperCase()).toBe(cell.tag);
    expect(styleOf(inserted)).toEqual(cell.savedStyle);
    expect(
      { ...inserted.attrs, style: "" },
      "only the style attribute changes; no editor markers leak",
    ).toEqual({ ...before.get(cell.source)!.attrs, style: "" });
    expectOnlyChanged(before, after, [cell.source]);
    expect(await localRect(page, design.primaryId, cell.source)).toEqual(
      cell.rendered,
    );
    expect(
      await designFrame(page, design.primaryId)
        .locator(`[data-agent-native-node-id="${cell.source}"]`)
        .evaluate((node) =>
          node instanceof HTMLImageElement
            ? {
                complete: node.complete,
                naturalWidth: node.naturalWidth,
                naturalHeight: node.naturalHeight,
              }
            : null,
        ),
    ).toEqual(cell.image);

    await settleReload(page, design.primaryId);
    await expect
      .poll(() => parentId(page, design.primaryId, cell.source))
      .toBe("mixed-target");
    expect(await localRect(page, design.primaryId, cell.source)).toEqual(
      cell.rendered,
    );
  };

  test("free text children flow-insert into the same container", async ({
    app,
    page,
  }) => {
    await assertFlowInsertCell(app, page, {
      source: "free-text",
      tag: "P",
      savedStyle: {
        margin: "0",
        width: "100px",
        padding: "8px",
        background: "#f8fafc",
        color: "#0f172a",
      },
      rendered: { x: 52, y: 462, width: 116, height: 106 },
      image: null,
    });
  });

  test("free shape children flow-insert into the same container", async ({
    app,
    page,
  }) => {
    await assertFlowInsertCell(app, page, {
      source: "free-shape",
      tag: "DIV",
      savedStyle: {
        width: "76px",
        height: "44px",
        background: "#22d3ee",
        color: "#083344",
      },
      rendered: { x: 52, y: 462, width: 76, height: 44 },
      image: null,
    });
  });

  test("free image children flow-insert into the same container", async ({
    app,
    page,
  }) => {
    await assertFlowInsertCell(app, page, {
      source: "free-image",
      tag: "IMG",
      savedStyle: { width: "80px", height: "48px" },
      rendered: { x: 52, y: 462, width: 80, height: 48 },
      image: { complete: true, naturalWidth: 80, naturalHeight: 48 },
    });
  });

  test("free component children flow-insert into the same container", async ({
    app,
    page,
  }) => {
    await assertFlowInsertCell(app, page, {
      source: "free-component",
      tag: "BUTTON",
      savedStyle: {
        width: "110px",
        height: "42px",
        background: "#c4b5fd",
        color: "#2e1065",
        border: "0",
      },
      rendered: { x: 52, y: 462, width: 110, height: 42 },
      image: null,
    });
  });

  test("cross-container flow preview keeps the source in the held Layers tree", async ({
    app,
    page,
  }) => {
    const design = await createDesign(app);
    await gotoEditor(page, design.id);
    await app.zoomToFit();
    await expect(async () => {
      await expandAllLayers(page);
      await expect(
        page
          .getByRole("tree", { name: "Layers" })
          .locator("[data-layer-row-button][data-layer-node-id]")
          .filter({ has: page.getByTitle("Inner text", { exact: true }) }),
      ).not.toHaveCount(0, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await selectLayer(page, "Inner text");
    const before = await app.savedNodes(design.id);
    expect(childrenOf(before, "nested-outer")).toEqual([
      "nested-inner",
      "nested-marker",
    ]);
    const source = await app.designRect("inner-text");
    const marker = await app.designRect("nested-marker");
    const grab = await app.pagePoint(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    const lift = await app.pagePoint(
      source.x + source.width / 2 + 12,
      source.y + 8,
    );
    const drop = await app.pagePoint(marker.x + marker.width / 2, marker.y + 4);

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(lift.x, lift.y, { steps: 2 });
    await page.mouse.move(drop.x, drop.y, { steps: 12 });
    await expect
      .poll(() => layerParentName(page, "Inner text"), { timeout: 5_000 })
      .toBe("Nested outer");
    expect(await app.savedNodes(design.id)).toEqual(before);
    await page.mouse.up();
    await app.settled();

    const after = await app.savedNodes(design.id);
    expect(childrenOf(after, "nested-outer")).toEqual([
      "nested-inner",
      "inner-text",
      "nested-marker",
    ]);
    expect(childrenOf(after, "nested-inner")).toEqual(["inner-component"]);
    expect(styleOf(after.get("inner-text"))).toEqual(
      styleOf(before.get("inner-text")),
    );
    expectOnlyChanged(before, after, ["inner-text"]);
    const landed = await app.designRect("inner-text");
    expect({ x: landed.x, width: landed.width }).toEqual({
      x: 366,
      width: 368,
    });
    expect(
      Math.abs(landed.y - 302),
      `rendered y ${landed.y}`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(landed.height - 34),
      `rendered height ${landed.height}`,
    ).toBeLessThanOrEqual(2);
  });

  test("flow child dragged into empty auto-layout space keeps the pointer slot", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app);
    await gotoEditor(page, design.id);
    await expandAllLayers(page);
    await selectLayer(page, "Inner text");
    const source = await boxFor(page, design.primaryId, "inner-text");
    const marker = await boxFor(page, design.primaryId, "nested-marker");
    const outer = await boxFor(page, design.primaryId, "nested-outer");
    const release = {
      x: marker.x + marker.width + 80,
      y: marker.y + marker.height - 1,
    };
    expect(release.x).toBeLessThan(outer.x + outer.width);

    await page.evaluate(() => {
      const host = window as Window & {
        __g4AutoLayoutDragStates?: Array<{
          active?: boolean;
          preview?: {
            phase?: string;
            sourceId?: string;
            anchorId?: string;
            placement?: string;
            insert?: boolean;
          };
        }>;
        __g4AutoLayoutStructureChanges?: Array<Record<string, unknown>>;
      };
      host.__g4AutoLayoutDragStates = [];
      host.__g4AutoLayoutStructureChanges = [];
      window.addEventListener(
        "message",
        (event: MessageEvent) => {
          if (event.data?.type === "agent-native:editor-drag-state") {
            host.__g4AutoLayoutDragStates?.push(event.data);
          } else if (event.data?.type === "visual-structure-change") {
            host.__g4AutoLayoutStructureChanges?.push(event.data);
          }
        },
        true,
      );
    });

    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 12, source.y + 8, {
      steps: 2,
    });
    await page.mouse.move(release.x, release.y, { steps: 16 });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const host = window as Window & {
            __g4AutoLayoutDragStates?: Array<{
              active?: boolean;
              preview?: {
                phase?: string;
                sourceId?: string;
                anchorId?: string;
                placement?: string;
                insert?: boolean;
              };
            }>;
          };
          const previews = host.__g4AutoLayoutDragStates?.filter(
            (state) => state.preview?.phase === "preview",
          );
          return previews?.[previews.length - 1] ?? null;
        }),
      )
      .toMatchObject({
        active: true,
        preview: {
          phase: "preview",
          sourceId: "inner-text",
          anchorId: "nested-marker",
          placement: "after",
          insert: true,
        },
      });
    await expect
      .poll(() => parentId(page, design.primaryId, "inner-text"))
      .toBe("nested-inner");
    await page.mouse.up();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const host = window as Window & {
            __g4AutoLayoutStructureChanges?: Array<{
              sourceId?: string;
              anchorSourceId?: string;
              placement?: string;
              persistenceAnchorSourceId?: string;
              persistencePlacement?: string;
            }>;
          };
          const changes = host.__g4AutoLayoutStructureChanges;
          return changes?.[changes.length - 1] ?? null;
        }),
      )
      .toMatchObject({
        sourceId: "inner-text",
        anchorSourceId: "nested-marker",
        placement: "after",
        persistenceAnchorSourceId: "nested-marker",
        persistencePlacement: "after",
      });

    await expect
      .poll(() => parentId(page, design.primaryId, "inner-text"))
      .toBe("nested-outer");
    await expect
      .poll(() => directChildren(page, design.primaryId, "nested-outer"))
      .toEqual(["nested-inner", "nested-marker", "inner-text"]);
    await settleReload(page, design.primaryId);
    await expect
      .poll(() => parentId(page, design.primaryId, "inner-text"))
      .toBe("nested-outer");
    await expect
      .poll(() => directChildren(page, design.primaryId, "nested-outer"))
      .toEqual(["nested-inner", "nested-marker", "inner-text"]);
    await cdpScreenshot(
      page,
      "../../.tmp/design-g4-auto-layout-direct-child.png",
    );
    await test.info().attach("design-g4-auto-layout-direct-child.png", {
      path: "../../.tmp/design-g4-auto-layout-direct-child.png",
      contentType: "image/png",
    });
  });

  test("flow child dragged into an empty grid cell keeps that cell", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app, {
      primaryHtml: NESTED_GRID_HTML,
    });
    await gotoEditor(page, design.id);
    await expandAllLayers(page);
    await selectLayer(page, "Grid child");
    const source = await boxFor(page, design.primaryId, "grid-child");
    const grid = await boxFor(page, design.primaryId, "grid-outer");
    const release = {
      x: grid.x + (grid.width * 5) / 6,
      y: grid.y + grid.height / 4,
    };

    await page.evaluate(() => {
      const host = window as Window & {
        __g4GridStructureChanges?: Array<Record<string, unknown>>;
      };
      host.__g4GridStructureChanges = [];
      window.addEventListener(
        "message",
        (event: MessageEvent) => {
          if (
            event.data?.type === "visual-structure-change" &&
            event.data?.sourceId === "grid-child"
          ) {
            host.__g4GridStructureChanges?.push(event.data);
          }
        },
        true,
      );
    });

    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 12, source.y + 8, {
      steps: 2,
    });
    await page.mouse.move(release.x, release.y, { steps: 16 });
    await expect
      .poll(() => parentId(page, design.primaryId, "grid-child"))
      .toBe("grid-inner");
    await page.mouse.up();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const host = window as Window & {
            __g4GridStructureChanges?: Array<Record<string, unknown>>;
          };
          const changes = host.__g4GridStructureChanges;
          return changes?.[changes.length - 1] ?? null;
        }),
      )
      .toMatchObject({
        sourceId: "grid-child",
        anchorSourceId: "grid-outer",
        placement: "inside",
        gridPlacement: { column: 3, row: 1 },
      });
    await expect
      .poll(() => parentId(page, design.primaryId, "grid-child"))
      .toBe("grid-outer");
    const placement = () =>
      designFrame(page, design.primaryId)
        .locator('[data-agent-native-node-id="grid-child"]')
        .evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            column: style.gridColumnStart,
            row: style.gridRowStart,
          };
        });
    await expect.poll(placement).toEqual({ column: "3", row: "1" });

    await settleReload(page, design.primaryId);
    await expect
      .poll(() => parentId(page, design.primaryId, "grid-child"))
      .toBe("grid-outer");
    await expect.poll(placement).toEqual({ column: "3", row: "1" });
  });

  test("fixed, Hug, and Fill sizing survive flow insertion", async ({
    app,
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    const cells = [
      {
        source: "fixed-source",
        expectedFlex: "0 0 auto",
        expectedWidth: "72px",
        expectedAuthoredWidth: "72px",
      },
      {
        source: "hug-source",
        expectedFlex: "0 1 auto",
        expectedWidth: "auto",
        expectedAuthoredWidth: "max-content",
      },
      {
        source: "fill-source",
        expectedFlex: "1 1 0%",
        expectedWidth: "auto",
        expectedAuthoredWidth: "auto",
      },
    ];
    for (const cell of cells) {
      await test.step(cell.source, async () => {
        const design = await createDesign(app);
        await gotoEditor(page, design.id);
        const result = await dragHeld(
          page,
          design.primaryId,
          cell.source,
          "size-target",
        );
        expect(result.during.display).toBe("block");
        const styles = await flowStyles(page, design.primaryId, cell.source);
        expect(styles.flex).toBe(cell.expectedFlex);
        expect(styles.position).not.toBe("absolute");
        if (cell.source === "fixed-source")
          expect(styles.width).toBe(cell.expectedWidth);
        expect(styles.authoredWidth).toBe(cell.expectedAuthoredWidth);
        await settleReload(page, design.primaryId);
        await expect
          .poll(() => parentId(page, design.primaryId, cell.source))
          .toBe("size-target");
        const reloadedStyles = await flowStyles(
          page,
          design.primaryId,
          cell.source,
        );
        expect(reloadedStyles.flex).toBe(cell.expectedFlex);
        expect(reloadedStyles.position).not.toBe("absolute");
        if (cell.source === "fixed-source")
          expect(reloadedStyles.width).toBe(cell.expectedWidth);
        expect(reloadedStyles.authoredWidth).toBe(cell.expectedAuthoredWidth);
      });
    }
  });

  // fixme: product bug: Two defects: (1) saved left:128px top:34px instead of 125/33, the same drag-start lag as 3228; (2) on macOS Ctrl+pointerdown opens the
  test.fixme("Ignore Auto Layout held before pointerdown drops an absolute child at the drop point inside the auto-layout target, with no context menu", async ({
    app,
    page,
  }) => {
    const design = await createDesign(app);
    await app.open(design.id);
    await selectLayer(page, "Ignore source");
    const before = await app.savedNodes(design.id);
    expect(childrenOf(before, "ignore-target")).toEqual(["ignore-sibling"]);
    const source = await boxFor(page, design.primaryId, "ignore-source");
    const target = await boxFor(page, design.primaryId, "ignore-target");

    await page.keyboard.down(IGNORE_AUTO_LAYOUT);
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + 12, source.y + 8, { steps: 5 });
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 24 },
    );
    await expect(
      designFrame(page, design.primaryId).locator(
        "[data-agent-native-insertion-guide]",
      ),
    ).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up(IGNORE_AUTO_LAYOUT);
    await app.settled();

    const after = await app.savedNodes(design.id);
    expect(childrenOf(after, "ignore-target")).toEqual([
      "ignore-sibling",
      "ignore-source",
    ]);
    const style = styleOf(after.get("ignore-source"));
    expect(style.position).toBe("absolute");
    expectPx(style.left, 125, "saved left");
    expectPx(style.top, 33, "saved top");
    expectOnlyChanged(before, after, ["ignore-source"]);
    expect(await localRect(page, design.primaryId, "ignore-source")).toEqual({
      x: 725,
      y: 673,
      width: 70,
      height: 34,
    });
    await expect(
      page.getByRole("menu"),
      "pressing the modifier before pointerdown must not leave a context menu open",
    ).toHaveCount(0);
  });

  test("Ignore Auto Layout pressed after pointerdown drops an absolute child at the drop point inside the auto-layout target", async ({
    app,
    page,
  }) => {
    const design = await createDesign(app);
    await app.open(design.id);
    await selectLayer(page, "Ignore source");
    const before = await app.savedNodes(design.id);
    expect(childrenOf(before, "ignore-target")).toEqual(["ignore-sibling"]);
    const source = await boxFor(page, design.primaryId, "ignore-source");
    const target = await boxFor(page, design.primaryId, "ignore-target");

    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + 12, source.y + 8, { steps: 5 });
    await page.keyboard.down(IGNORE_AUTO_LAYOUT);
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 24 },
    );
    await expect(
      designFrame(page, design.primaryId).locator(
        "[data-agent-native-insertion-guide]",
      ),
    ).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up(IGNORE_AUTO_LAYOUT);
    await app.settled();

    const after = await app.savedNodes(design.id);
    expect(childrenOf(after, "ignore-target")).toEqual([
      "ignore-sibling",
      "ignore-source",
    ]);
    const style = styleOf(after.get("ignore-source"));
    expect(style.position).toBe("absolute");
    expectPx(style.left, 125, "saved left");
    expectPx(style.top, 33, "saved top");
    expectOnlyChanged(before, after, ["ignore-source"]);
    expect(await localRect(page, design.primaryId, "ignore-source")).toEqual({
      x: 725,
      y: 673,
      width: 70,
      height: 34,
    });
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("Option-drag onto the near half of the first flow child drops a copy at the start of the row and leaves the original in place", async ({
    app,
    page,
  }) => {
    const design = await createDesign(app);
    await app.open(design.id);
    await selectLayer(page, "H Middle");
    const before = await app.savedNodes(design.id);
    expect(childrenOf(before, "hrow")).toEqual([
      "h-first",
      "h-middle",
      "h-last",
    ]);
    const source = await boxFor(page, design.primaryId, "h-middle");
    const target = await boxFor(page, design.primaryId, "h-first");

    await page.keyboard.down("Alt");
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + 12, source.y + 8, { steps: 5 });
    await page.mouse.move(
      target.x + target.width * 0.25,
      target.y + target.height / 2,
      { steps: 24 },
    );
    await expect(
      designFrame(page, design.primaryId).locator(
        "#hrow > [data-agent-native-node-id]",
      ),
    ).toHaveCount(4);
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await app.settled();

    const after = await app.savedNodes(design.id);
    const row = childrenOf(after, "hrow");
    const copies = row.filter((id) => !before.has(id));
    expect(copies).toHaveLength(1);
    const copy = copies[0]!;
    expect(row).toEqual([copy, "h-first", "h-middle", "h-last"]);
    const original = before.get("h-middle")!;
    const copied = after.get(copy)!;
    expect({
      tag: copied.tag,
      name: copied.attrs["data-agent-native-layer-name"],
    }).toEqual({ tag: "div", name: "H Middle" });
    expect(await normalizedCss(page, copied.attrs.style)).toBe(
      await normalizedCss(page, original.attrs.style),
    );
    expectOnlyChanged(before, after, subtree(after, copy));
    await settleReload(page, design.primaryId);
    await expect
      .poll(() => directChildren(page, design.primaryId, "hrow"))
      .toEqual([copy, "h-first", "h-middle", "h-last"]);
    await expect(
      designFrame(page, design.primaryId).locator(
        `[data-agent-native-node-id="${copy}"]`,
      ),
    ).toHaveText("H Middle");
    expect(attrsBesidesStyle(copied)).toEqual({
      "data-agent-native-node-id": copy,
      "data-agent-native-layer-name": "H Middle",
      "data-agent-native-clone-root": "true",
    });
  });

  test("Option-drag into an occupied explicit grid cell preserves the clone anchor", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app, {
      primaryHtml: ROOT_SCREEN_FIXTURES["grid-explicit"],
    });
    const childNames = () =>
      designFrame(page, design.primaryId)
        .locator("body > [data-agent-native-node-id]")
        .evaluateAll((nodes) =>
          nodes.map((node) =>
            node.getAttribute("data-agent-native-layer-name"),
          ),
        );
    await gotoEditor(page, design.id);
    await selectLayer(page, "Root C");
    const source = await boxFor(page, design.primaryId, "root-c");
    const target = await boxFor(page, design.primaryId, "root-a");
    await page.keyboard.down("Alt");
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    try {
      await page.mouse.move(source.x + 12, source.y + 8, { steps: 5 });
      await page.mouse.move(
        target.x + target.width / 2,
        target.y + target.height / 2,
        {
          steps: 24,
        },
      );
      await page.waitForTimeout(250);
      await expect(
        designFrame(page, design.primaryId).locator(
          "body > [data-agent-native-node-id]",
        ),
      ).toHaveCount(4);
      await expect(
        designFrame(page, design.primaryId).locator(
          "[data-agent-native-insertion-guide]",
        ),
      ).toBeVisible();
    } finally {
      await page.mouse.up();
      await page.keyboard.up("Alt");
    }
    await expect
      .poll(childNames)
      .toEqual(["Root C", "Root A", "Root C", "Root B"]);
    await settleReload(page, design.primaryId);
    await expect
      .poll(childNames)
      .toEqual(["Root C", "Root A", "Root C", "Root B"]);
    const html = await fileHtml(request, design.id, design.primaryId);
    expect(
      html.match(/data-agent-native-layer-name="Root C"/g) ?? [],
    ).toHaveLength(2);
  });

  test("linked component drag propagates to its instance and keeps overrides through duplicate, undo, redo, and reload", async ({
    app,
    page,
    request,
  }) => {
    const reorderedSourceNodeIds = ["play-badge", "play-label"];
    const design = await createDesign(app, {
      primaryHtml: LINKED_COMPONENT_HTML,
    });
    await gotoEditor(page, design.id);
    const linkedState = () =>
      designFrame(page, design.primaryId)
        .locator("body")
        .evaluate((body) => {
          const readRoot = (root: Element) => ({
            nodeId: root.getAttribute("data-agent-native-node-id"),
            componentId: root.getAttribute("data-agent-native-component-id"),
            componentRef: root.getAttribute("data-agent-native-component-ref"),
            cloneRoot: root.getAttribute("data-agent-native-clone-root"),
            overrides: root.getAttribute(
              "data-agent-native-component-overrides",
            ),
            children: Array.from(root.children).map(
              (child) => child.getAttribute("data-agent-native-node-id") ?? "",
            ),
            sourceNodeIds: Array.from(root.children).map(
              (child) =>
                child.getAttribute(
                  "data-agent-native-component-source-node-id",
                ) ?? "",
            ),
          });
          return {
            main: readRoot(
              body.querySelector(
                '[data-agent-native-component-id="cmp-play"]',
              )!,
            ),
            instances: Array.from(
              body.querySelectorAll(
                '[data-agent-native-component-ref="cmp-play"]',
              ),
            ).map(readRoot),
          };
        });

    const initial = await linkedState();
    expect(initial.main).toMatchObject({
      nodeId: "play-main",
      componentId: "cmp-play",
      children: ["play-label", "play-badge"],
    });
    expect(initial.instances).toEqual([
      expect.objectContaining({
        nodeId: "play-instance",
        componentRef: "cmp-play",
        overrides: LINKED_COMPONENT_OVERRIDES,
        children: ["play-label-instance", "play-badge-instance"],
        sourceNodeIds: ["play-label", "play-badge"],
      }),
    ]);

    const result = await dragHeldAndSampleState(
      page,
      request,
      design.id,
      design.primaryId,
      "play-badge",
      "play-label",
      "leading",
      "horizontal",
      "Canonical play badge",
    );
    const belowThreshold = result.snapshots.find(
      (snapshot) => snapshot.stage === "below-threshold",
    );
    const lifted = result.snapshots.find((snapshot) => snapshot.source?.lifted);
    expect(belowThreshold?.source?.lifted).toBe(false);
    expect(lifted?.source?.lifted).toBe(true);
    expect(lifted?.source?.parentId).toBe("play-main");
    expect(lifted?.guide?.display).toBe("block");
    expect(result.beforeReleaseHtml).toBe(result.initialHtml);
    expect(result.after.source?.lifted).toBe(false);
    await expect
      .poll(async () => (await linkedState()).main.children)
      .toEqual(["play-badge", "play-label"]);
    await expect
      .poll(async () => (await linkedState()).instances[0]?.children)
      .toEqual(["play-badge-instance", "play-label-instance"]);
    expect((await linkedState()).instances[0]).toMatchObject({
      componentRef: "cmp-play",
      overrides: LINKED_COMPONENT_OVERRIDES,
      sourceNodeIds: ["play-badge", "play-label"],
    });

    await page.keyboard.press(`${COMMAND}+z`);
    await expect
      .poll(async () => (await linkedState()).main.children)
      .toEqual(["play-label", "play-badge"]);
    await expect
      .poll(async () => (await linkedState()).instances[0]?.children)
      .toEqual(["play-label-instance", "play-badge-instance"]);
    await page.keyboard.press(`${COMMAND}+Shift+z`);
    await expect
      .poll(async () => (await linkedState()).main.children)
      .toEqual(["play-badge", "play-label"]);
    await expect
      .poll(async () => (await linkedState()).instances[0]?.children)
      .toEqual(["play-badge-instance", "play-label-instance"]);

    await selectLayer(page, "Play instance");
    const originalInstance = (await linkedState()).instances.find(
      (instance) => instance.nodeId === "play-instance",
    );
    const source = await boxFor(page, design.primaryId, "play-instance");
    const target = await boxFor(page, design.primaryId, "play-main");
    let mouseHeld = false;
    let modifierHeld = false;
    try {
      modifierHeld = true;
      await page.keyboard.down("Alt");
      await page.mouse.move(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      mouseHeld = true;
      await page.mouse.down();
      await page.mouse.move(source.x + 12, source.y + 8, { steps: 5 });
      await page.mouse.move(
        target.x + target.width - 3,
        target.y + target.height / 2,
        { steps: 24 },
      );
      await page.waitForTimeout(250);
      const held = await linkedState();
      expect(held.instances).toHaveLength(2);
      expect(
        held.instances.filter((instance) => instance.cloneRoot === "true"),
      ).toHaveLength(1);
      expect(
        held.instances.find((instance) => instance.nodeId === "play-instance"),
      ).toEqual(originalInstance);
      expect(
        held.instances.every(
          (instance) =>
            instance.componentRef === "cmp-play" &&
            instance.overrides === LINKED_COMPONENT_OVERRIDES &&
            instance.sourceNodeIds.length === 2,
        ),
      ).toBe(true);
      for (const instance of held.instances)
        expect(instance.sourceNodeIds).toEqual(reorderedSourceNodeIds);
    } finally {
      if (mouseHeld) await page.mouse.up();
      if (modifierHeld) await page.keyboard.up("Alt");
    }

    await expect
      .poll(async () => (await linkedState()).instances.length)
      .toBe(2);
    const duplicated = await linkedState();
    expect(
      new Set(duplicated.instances.map((instance) => instance.nodeId)).size,
    ).toBe(2);
    expect(
      duplicated.instances.every(
        (instance) =>
          instance.componentRef === "cmp-play" &&
          instance.overrides === LINKED_COMPONENT_OVERRIDES &&
          instance.sourceNodeIds.length === 2,
      ),
    ).toBe(true);
    for (const instance of duplicated.instances)
      expect(instance.sourceNodeIds).toEqual(reorderedSourceNodeIds);
    const duplicatedClone = duplicated.instances.find(
      (instance) => instance.cloneRoot === "true",
    );
    if (!duplicatedClone?.nodeId)
      throw new Error("linked component clone has no node id");
    const duplicatedCloneId = duplicatedClone.nodeId;
    let duplicatedHtml = "";
    await expect
      .poll(
        async () => {
          duplicatedHtml = await fileHtml(request, design.id, design.primaryId);
          return hasNode(duplicatedHtml, duplicatedCloneId);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.keyboard.press(`${COMMAND}+z`);
    await expect
      .poll(async () => (await linkedState()).instances.length)
      .toBe(1);
    const cloneUndone = await linkedState();
    expect(cloneUndone.instances[0]?.nodeId).toBe("play-instance");
    expect(cloneUndone.instances[0]?.sourceNodeIds).toEqual(
      reorderedSourceNodeIds,
    );
    let undoneHtml = "";
    await expect
      .poll(
        async () => {
          undoneHtml = await fileHtml(request, design.id, design.primaryId);
          return (
            undoneHtml !== duplicatedHtml &&
            !hasNode(undoneHtml, duplicatedCloneId) &&
            hasNode(undoneHtml, "play-instance")
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.keyboard.press(`${COMMAND}+Shift+z`);
    await expect
      .poll(async () => (await linkedState()).instances.length)
      .toBe(2);
    const cloneRedone = await linkedState();
    for (const instance of cloneRedone.instances)
      expect(instance.sourceNodeIds).toEqual(reorderedSourceNodeIds);
    let redoneHtml = "";
    await expect
      .poll(
        async () => {
          redoneHtml = await fileHtml(request, design.id, design.primaryId);
          return (
            hasNode(redoneHtml, duplicatedCloneId) &&
            hasNode(redoneHtml, "play-instance")
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    expect(redoneHtml).toContain(`data-agent-native-component-ref="cmp-play"`);
    await settleReload(page, design.primaryId);
    const reloaded = await linkedState();
    expect(reloaded.main.children).toEqual(["play-badge", "play-label"]);
    expect(reloaded.instances).toHaveLength(2);
    expect(
      reloaded.instances.every(
        (instance) =>
          instance.componentRef === "cmp-play" &&
          instance.overrides === LINKED_COMPONENT_OVERRIDES &&
          instance.sourceNodeIds.length === 2,
      ),
    ).toBe(true);
    for (const instance of reloaded.instances)
      expect(instance.sourceNodeIds).toEqual(reorderedSourceNodeIds);
  });

  const screenRootCells: Array<{
    fixture: RootFixture;
    source: string;
    target: string;
    axis: "horizontal" | "vertical";
    expected: string[];
    expectsSiblingReflow: boolean;
  }> = [
    {
      fixture: "horizontal",
      source: "root-c",
      target: "root-a",
      axis: "horizontal",
      expected: ["root-c", "root-a", "root-b"],
      expectsSiblingReflow: true,
    },
    {
      fixture: "vertical",
      source: "root-c",
      target: "root-a",
      axis: "vertical",
      expected: ["root-c", "root-a", "root-b"],
      expectsSiblingReflow: true,
    },
    {
      fixture: "wrap",
      source: "root-d",
      target: "root-a",
      axis: "horizontal",
      expected: ["root-d", "root-a", "root-b", "root-c"],
      expectsSiblingReflow: false,
    },
    {
      fixture: "grid-explicit",
      source: "root-c",
      target: "root-a",
      axis: "horizontal",
      expected: ["root-c", "root-a", "root-b"],
      expectsSiblingReflow: false,
    },
    {
      fixture: "grid-implicit",
      source: "root-e",
      target: "root-b",
      axis: "horizontal",
      expected: ["root-a", "root-e", "root-b", "root-c", "root-d"],
      expectsSiblingReflow: false,
    },
  ];

  for (const cell of screenRootCells) {
    test(`SCREEN-ROOT ${cell.fixture} keeps sampled held state`, async ({
      app,
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      const design = await createDesign(app, {
        primaryHtml: ROOT_SCREEN_FIXTURES[cell.fixture],
      });
      await gotoEditor(page, design.id);
      const savedBefore = await app.savedNodes(design.id);
      const evidence = await dragHeldAndSampleState(
        page,
        request,
        design.id,
        design.primaryId,
        cell.source,
        cell.target,
        "leading",
        cell.axis,
      );
      const belowThreshold = evidence.snapshots.find(
        (snapshot) => snapshot.stage === "below-threshold",
      );
      const lifted = evidence.snapshots.find(
        (snapshot) => snapshot.source?.lifted,
      );
      const targetSnapshots = evidence.snapshots.filter((snapshot) =>
        snapshot.stage.startsWith("target-"),
      );
      expect(belowThreshold?.source?.lifted).toBe(false);
      expect(lifted?.source?.lifted).toBe(true);
      expect(lifted?.source?.zIndex).toBe("2147483646");
      expect(lifted?.source?.pointerEvents).toBe("none");
      expect(targetSnapshots.length).toBe(cell.fixture === "wrap" ? 11 : 8);
      const targetGuideSamples = targetSnapshots.filter(
        (snapshot) =>
          snapshot.guide?.display === "block" &&
          (snapshot.guide.overlapsTarget ||
            cell.fixture === "wrap" ||
            cell.fixture.startsWith("grid-")),
      );
      expect(targetGuideSamples.length).toBeGreaterThan(0);
      if (cell.fixture === "wrap") {
        expect(
          targetSnapshots.map((snapshot) =>
            snapshot.children.map((child) => child.id).join(","),
          ),
        ).toContain(cell.expected.join(","));
        const expectedOrder = cell.expected.join(",");
        const firstExpected = targetSnapshots.findIndex(
          (snapshot) =>
            snapshot.children.map((child) => child.id).join(",") ===
            expectedOrder,
        );
        expect(firstExpected).toBeGreaterThanOrEqual(0);
        expect(
          targetSnapshots
            .slice(firstExpected)
            .every(
              (snapshot) =>
                snapshot.children.map((child) => child.id).join(",") ===
                expectedOrder,
            ),
        ).toBe(true);
        expect(
          targetSnapshots
            .slice(-3)
            .every((snapshot) => snapshot.guide?.display === "block"),
        ).toBe(true);
        expect(
          targetSnapshots.some((snapshot) =>
            childMoved(evidence.before, snapshot.children, cell.source),
          ),
        ).toBe(true);
        const beforeById = new Map(
          evidence.before.map((child) => [child.id, child]),
        );
        const firstRowTop = beforeById.get("root-a")?.top ?? 0;
        const wrappedRowTop =
          firstRowTop +
          Math.max(
            beforeById.get("root-a")?.height ?? 0,
            beforeById.get("root-d")?.height ?? 0,
          ) +
          16;
        const expectedWrapGeometry = {
          "root-a": {
            left: beforeById.get("root-b")?.left ?? 0,
            top: firstRowTop,
          },
          "root-b": {
            left: beforeById.get("root-a")?.left ?? 0,
            top: wrappedRowTop,
          },
          "root-c": {
            left: beforeById.get("root-b")?.left ?? 0,
            top: wrappedRowTop,
          },
        };
        expect(
          targetSnapshots.some((snapshot) =>
            Object.entries(expectedWrapGeometry).every(([id, expected]) => {
              const actual = snapshot.children.find((child) => child.id === id);
              return Boolean(
                actual &&
                expected &&
                Math.abs(actual.left - expected.left) < 1 &&
                Math.abs(actual.top - expected.top) < 1,
              );
            }),
          ),
        ).toBe(true);
        expect(
          targetSnapshots.some(
            (snapshot) =>
              snapshot.guide?.display === "block" &&
              snapshot.guide.height > snapshot.guide.width,
          ),
        ).toBe(true);
      }
      if (cell.expectsSiblingReflow) {
        expect(
          targetSnapshots.some((snapshot) =>
            childMoved(evidence.before, snapshot.children, cell.source),
          ),
        ).toBe(true);
      }
      expect(evidence.beforeReleaseHtml).toBe(evidence.initialHtml);
      expect(evidence.after.source?.lifted).toBe(false);
      expect(evidence.after.source?.zIndex).not.toBe("2147483646");
      await expect
        .poll(() => rootChildIds(page, design.primaryId))
        .toEqual(cell.expected);
      await app.settled();
      const savedAfter = await app.savedNodes(design.id);
      expect(childrenOf(savedAfter, bodyOf(savedAfter)!)).toEqual(
        cell.expected,
      );
      expectOnlyChanged(savedBefore, savedAfter, []);
      const droppedGeometry = await rootChildren(page, design.primaryId);
      await settleReload(page, design.primaryId);
      await expect
        .poll(() => rootChildIds(page, design.primaryId))
        .toEqual(cell.expected);
      const reloadedGeometry = await rootChildren(page, design.primaryId);
      expect(reloadedGeometry).toHaveLength(droppedGeometry.length);
      for (const [index, child] of droppedGeometry.entries()) {
        expect(reloadedGeometry[index]).toMatchObject({
          id: child.id,
          width: child.width,
          height: child.height,
          transform: child.transform,
        });
        expect(reloadedGeometry[index]?.left).toBeCloseTo(child.left, 0);
        expect(reloadedGeometry[index]?.top).toBeCloseTo(child.top, 0);
      }
    });
  }

  // fixme: product bug: Visual no-op: saved order changes but Root C keeps grid-row:1;grid-column:2, so a/b/c render in exactly their old cells (c at 319,28; a
  test.fixme("dropping an authored-placement grid item before the first item moves it into the first cell", async ({
    app,
    page,
  }) => {
    const design = await createDesign(app, {
      primaryHtml: ROOT_SCREEN_FIXTURES["grid-authored-column-flow"],
    });
    await app.open(design.id);
    const before = await app.savedNodes(design.id);
    expect(childrenOf(before, bodyOf(before)!)).toEqual([
      "root-a",
      "root-b",
      "root-c",
    ]);
    const firstCell = { x: 28, y: 28 };
    const secondCell = { x: 28, y: 521 };
    const thirdCell = { x: 319, y: 28 };
    expect({
      a: await cellOf(page, design.primaryId, "root-a"),
      b: await cellOf(page, design.primaryId, "root-b"),
      c: await cellOf(page, design.primaryId, "root-c"),
    }).toEqual({ a: firstCell, b: secondCell, c: thirdCell });

    const result = await dragHeld(page, design.primaryId, "root-c", "root-a", {
      targetEdge: "leading",
      axis: "vertical",
    });
    expect(result.during.display).toBe("block");
    expect(result.during.width).toBeGreaterThan(result.during.height);
    await app.settled();

    const after = await app.savedNodes(design.id);
    expect(childrenOf(after, bodyOf(after)!)).toEqual([
      "root-c",
      "root-a",
      "root-b",
    ]);
    expectOnlyChanged(before, after, ["root-c"]);
    expect({
      c: await cellOf(page, design.primaryId, "root-c"),
      a: await cellOf(page, design.primaryId, "root-a"),
      b: await cellOf(page, design.primaryId, "root-b"),
    }).toEqual({ c: firstCell, a: secondCell, b: thirdCell });
  });

  test("GRID-TRACK explicit and implicit root Screens expose track controls with source evidence", async ({
    app,
    page,
    request,
  }) => {
    for (const fixture of ["grid-explicit", "grid-implicit"] as const) {
      await test.step(`GRID-TRACK/${fixture}`, async () => {
        const design = await createDesign(app, {
          primaryHtml: ROOT_SCREEN_FIXTURES[fixture],
        });
        await gotoEditor(page, design.id);
        const shell = page.locator(
          `[data-screen-shell][data-frame-id="${design.primaryId}"]`,
        );
        await shell.locator("[data-frame-title]").click();
        await expect(page.locator('[data-flow-value="grid"]')).toBeVisible();
        const readout = page.locator("[data-grid-track-readout]");
        await expect(readout).toBeVisible();
        const trackReadout = await readout.textContent();
        expect(trackReadout).toBe(
          fixture === "grid-explicit" ? "2 × 2" : "2 × 3",
        );
        await page.getByRole("button", { name: "Grid settings" }).click();
        const columns = page.getByRole("textbox", { name: "Columns" });
        const rows = page.getByRole("textbox", { name: "Rows" });
        await expect(columns).toBeVisible();
        await expect(rows).toBeVisible();
        await expect(columns).toHaveValue("2");
        await expect(rows).toHaveValue(fixture === "grid-explicit" ? "2" : "3");
        const values = {
          columns: await columns.inputValue(),
          rows: await rows.inputValue(),
          html: await fileHtml(request, design.id, design.primaryId),
        };
        expect(values.html).toMatch(/display:\s*grid/i);
        expect(values.html).toMatch(/grid-template-columns:/i);
        if (fixture === "grid-explicit") {
          expect(values.html).toMatch(/grid-template-rows:/i);
          expect(values.html).toMatch(/grid-column:\s*span 2/i);
        }
        await page.keyboard.press("Escape");
      });
    }
  });

  test("SCREEN-ROOT reorder is undoable and reload preserves the undo result", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app, {
      primaryHtml: ROOT_SCREEN_FIXTURES.horizontal,
    });
    await gotoEditor(page, design.id);
    await dragHeldAndSampleState(
      page,
      request,
      design.id,
      design.primaryId,
      "root-c",
      "root-a",
      "leading",
      "horizontal",
    );
    await expect
      .poll(() => rootChildIds(page, design.primaryId))
      .toEqual(["root-c", "root-a", "root-b"]);
    await page.keyboard.press(`${COMMAND}+z`);
    await expect
      .poll(() => rootChildIds(page, design.primaryId))
      .toEqual(["root-a", "root-b", "root-c"]);
    const undoneHtml = await fileHtml(request, design.id, design.primaryId);
    expect(undoneHtml).toContain('data-agent-native-node-id="root-a"');
    expect(undoneHtml).toContain('data-agent-native-node-id="root-c"');
    await settleReload(page, design.primaryId);
    await expect
      .poll(() => rootChildIds(page, design.primaryId))
      .toEqual(["root-a", "root-b", "root-c"]);
  });

  test("cross-container and cross-Screen flow drops keep held target evidence and persist after reload", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app, { secondScreen: true });
    await gotoEditor(page, design.id);
    await page.keyboard.press("Shift+1");
    let lastTargetBox: { x: number; y: number } | null = null;
    await expect
      .poll(
        async () => {
          const box = await boxFor(page, design.secondId!, "cross-target");
          const stable =
            lastTargetBox !== null &&
            Math.abs(box.x - lastTargetBox.x) < 1 &&
            Math.abs(box.y - lastTargetBox.y) < 1;
          lastTargetBox = box;
          return stable;
        },
        { timeout: 5_000 },
      )
      .toBe(true);
    const settledSource = await boxFor(page, design.primaryId, "free-shape");
    const settledTarget = await boxFor(page, design.secondId!, "cross-target");
    let commandHeld = false;
    try {
      commandHeld = true;
      await page.keyboard.down(COMMAND);
      await page.mouse.click(
        settledSource.x + settledSource.width / 2,
        settledSource.y + settledSource.height / 2,
      );
    } finally {
      if (commandHeld) await page.keyboard.up(COMMAND);
    }
    await expect.poll(() => selectionSourceId(request)).toBe("free-shape");
    await page.mouse.move(
      settledSource.x + settledSource.width / 2,
      settledSource.y + settledSource.height / 2,
    );
    let mouseHeld = false;
    try {
      mouseHeld = true;
      await page.mouse.down();
      await page.mouse.move(settledSource.x + 12, settledSource.y + 8, {
        steps: 5,
      });
      await page.mouse.move(
        settledTarget.x + settledTarget.width / 2,
        settledTarget.y + settledTarget.height / 2,
        { steps: 30 },
      );
      await page.waitForTimeout(400);
      const guide = page.locator("[data-cross-screen-drop-guide]");
      let guideCount = await guide.count();
      for (let attempt = 0; attempt < 10 && guideCount === 0; attempt += 1) {
        await page.waitForTimeout(200);
        guideCount = await guide.count();
      }
      const heldEvidence = {
        guide: guideCount,
        ghost: await page.locator("[data-cross-screen-drag-ghost]").count(),
        sourceBox: settledSource,
        targetBox: settledTarget,
        screenShells: await page.locator("[data-screen-shell]").count(),
        iframes: await page
          .locator("[data-design-preview-iframe]")
          .evaluateAll((frames) =>
            frames.map((frame) => ({
              id: frame.getAttribute("data-screen-id"),
              pointerEvents: getComputedStyle(frame).pointerEvents,
            })),
          ),
      };
      expect(heldEvidence.ghost).toBeGreaterThan(0);
      expect(heldEvidence.screenShells).toBe(2);
      const sourceBeforeRelease = await fileHtml(
        request,
        design.id,
        design.primaryId,
      );
      expect(sourceBeforeRelease).toContain(
        'data-agent-native-node-id="free-shape"',
      );
    } finally {
      if (mouseHeld) await page.mouse.up();
    }
    await expect
      .poll(async () => {
        const [from, to] = await Promise.all([
          fileHtml(request, design.id, design.primaryId),
          fileHtml(request, design.id, design.secondId!),
        ]);
        return {
          from: from.includes('data-agent-native-node-id="free-shape"'),
          to: to.includes('data-agent-native-node-id="free-shape"'),
        };
      })
      .toEqual({ from: false, to: true });
    await settleReload(page, design.secondId!);
    await expect
      .poll(() => parentId(page, design.secondId!, "free-shape"))
      .toBe("cross-target");
  });

  // fixme: product bug: Teleport: the dropped layer is saved with no position/left/top, so it is a static body child rendered at the Screen's top-left (0,0)
  test.fixme("cross-Screen oversized drop beside an empty auto-layout target lands at the drop point in the destination Screen", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app, {
      secondScreen: true,
      primaryHtml: OVERSIZED_CROSS_SCREEN_PRIMARY_HTML,
      secondHtml: OVERSIZED_CROSS_SCREEN_SECOND_HTML,
    });
    await app.open(design.id);
    await zoomToFitScreens(page, design.secondId!);
    const source = await boxFor(page, design.primaryId, "oversized-source");
    const target = await boxFor(page, design.secondId!, "plain-target");
    await page.mouse.click(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await expect
      .poll(() => selectionSourceId(request))
      .toBe("oversized-source");
    const sourceBefore = await app.savedNodes(design.id);
    const destinationBefore = await app.savedNodes(design.id, "second.html");

    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + 12, source.y + 8, { steps: 5 });
    await page.mouse.move(
      target.x + target.width * 0.75,
      target.y + target.height / 2,
      {
        steps: 30,
      },
    );
    await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible();
    await page.mouse.up();
    await app.settled();

    const destinationAfter = await app.savedNodes(design.id, "second.html");
    const dropped = destinationAfter.get("oversized-source");
    expect(dropped?.parent, "dropped beside the target, on the Screen").toBe(
      bodyOf(destinationAfter),
    );
    expect(attrsBesidesStyle(dropped)).toEqual({
      "data-agent-native-node-id": "oversized-source",
      "data-agent-native-layer-name": "Oversized Source",
      "data-agent-native-clone-root": "true",
      "data-agent-native-preserve-styles": "true",
    });
    const style = styleOf(dropped);
    expect(style.position).toBe("absolute");
    expectPx(style.left, 100, "saved left");
    expectPx(style.top, 155, "saved top");
    expectOnlyChanged(
      destinationBefore,
      destinationAfter,
      subtree(destinationAfter, "oversized-source"),
    );
    expectOnlyChanged(
      sourceBefore,
      await app.savedNodes(design.id),
      subtree(sourceBefore, "oversized-source"),
    );
    expect((await app.savedNodes(design.id)).has("oversized-source")).toBe(
      false,
    );
    expect(await localRect(page, design.secondId!, "oversized-source")).toEqual(
      {
        x: 100,
        y: 155,
        width: 500,
        height: 110,
      },
    );
  });

  test("cross-Screen drop preserves a spanning grid item through preview, undo, redo, and reload", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app, {
      secondScreen: true,
      primaryHtml: GRID_CROSS_SCREEN_PRIMARY_HTML,
      secondHtml: GRID_CROSS_SCREEN_SECOND_HTML,
    });
    await gotoEditor(page, design.id);
    await page.keyboard.press("Shift+1");
    const source = await boxFor(page, design.primaryId, "grid-source");
    const grid = await boxFor(page, design.secondId!, "target-grid");
    const release = {
      x: grid.x + (grid.width * 3) / 8,
      y: grid.y + grid.height / 2,
    };
    await page.mouse.click(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await expect.poll(() => selectionSourceId(request)).toBe("grid-source");
    const sourceBefore = await fileHtml(request, design.id, design.primaryId);
    const destinationBefore = await fileHtml(
      request,
      design.id,
      design.secondId!,
    );

    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + 12, source.y + 8, { steps: 5 });
    await page.mouse.move(release.x, release.y, { steps: 30 });
    const guide = page.locator("[data-cross-screen-drop-guide]");
    await expect(guide).toBeVisible();
    const guideBox = await guide.boundingBox();
    expect(guideBox).not.toBeNull();
    expect(guideBox!.x).toBeCloseTo(grid.x + grid.width / 4, 0);
    expect(guideBox!.y).toBeCloseTo(grid.y + grid.height / 3, 0);
    expect(guideBox!.width).toBeCloseTo(grid.width / 2, 0);
    expect(guideBox!.height).toBeCloseTo((grid.height * 2) / 3, 0);
    expect(release.x).toBeGreaterThan(guideBox!.x);
    expect(release.x).toBeLessThan(guideBox!.x + guideBox!.width);
    expect(release.y).toBeGreaterThan(guideBox!.y);
    expect(release.y).toBeLessThan(guideBox!.y + guideBox!.height);
    await expect(page.locator("[data-cross-screen-drag-ghost]")).toHaveCount(1);
    expect(await fileHtml(request, design.id, design.primaryId)).toBe(
      sourceBefore,
    );
    expect(await fileHtml(request, design.id, design.secondId!)).toBe(
      destinationBefore,
    );
    await page.mouse.up();

    await expect
      .poll(async () => {
        const [from, to] = await Promise.all([
          fileHtml(request, design.id, design.primaryId),
          fileHtml(request, design.id, design.secondId!),
        ]);
        return {
          source: hasNode(from, "grid-source"),
          destination: hasNode(to, "grid-source"),
        };
      })
      .toEqual({ source: false, destination: true });
    const persistedPlacement = () =>
      designFrame(page, design.secondId!)
        .locator('[data-agent-native-node-id="grid-source"]')
        .evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            parent: node.parentElement?.getAttribute(
              "data-agent-native-node-id",
            ),
            column: style.gridColumnStart,
            columnEnd: style.gridColumnEnd,
            row: style.gridRowStart,
            rowEnd: style.gridRowEnd,
          };
        });
    await expect.poll(persistedPlacement).toEqual({
      parent: "target-grid",
      column: "2",
      columnEnd: "4",
      row: "2",
      rowEnd: "4",
    });

    await page.keyboard.press(`${COMMAND}+z`);
    await expect
      .poll(async () => ({
        source: hasNode(
          await fileHtml(request, design.id, design.primaryId),
          "grid-source",
        ),
        destination: hasNode(
          await fileHtml(request, design.id, design.secondId!),
          "grid-source",
        ),
      }))
      .toEqual({ source: true, destination: false });
    await page.keyboard.press(`${COMMAND}+Shift+z`);
    await expect
      .poll(async () => ({
        source: hasNode(
          await fileHtml(request, design.id, design.primaryId),
          "grid-source",
        ),
        destination: hasNode(
          await fileHtml(request, design.id, design.secondId!),
          "grid-source",
        ),
      }))
      .toEqual({ source: false, destination: true });
    await settleReload(page, design.secondId!);
    await expect.poll(persistedPlacement).toEqual({
      parent: "target-grid",
      column: "2",
      columnEnd: "4",
      row: "2",
      rowEnd: "4",
    });
  });

  test("cross-Screen Ignore Auto Layout oversized drops keep absolute inside placement", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app, {
      secondScreen: true,
      primaryHtml: META_CROSS_SCREEN_PRIMARY_HTML,
      secondHtml: META_CROSS_SCREEN_SECOND_HTML,
    });
    await app.open(design.id);
    await zoomToFitScreens(page, design.secondId!);
    const grab = await app.pagePoint(750, 355, "index.html");
    const release = await app.pagePoint(260, 210, "second.html");
    const nudge = await app.pagePoint(264, 214, "second.html");
    await page.mouse.click(grab.x, grab.y);
    await expect.poll(() => selectionSourceId(request)).toBe("meta-source");
    const sourceBefore = await app.savedNodes(design.id);
    const destinationBefore = await app.savedNodes(design.id, "second.html");
    expect(childrenOf(destinationBefore, "meta-target")).toEqual([]);

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(release.x, release.y, { steps: 30 });
    await expect(
      page.locator("[data-cross-screen-drag-ghost]"),
    ).not.toHaveCount(0);
    await page.keyboard.down(IGNORE_AUTO_LAYOUT);
    await page.mouse.move(nudge.x, nudge.y, { steps: 3 });
    await page.mouse.move(release.x, release.y, { steps: 3 });
    await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible();
    await expect(
      page.locator("[data-cross-screen-drag-ghost]"),
    ).not.toHaveCount(0);
    await page.mouse.up();
    await page.keyboard.up(IGNORE_AUTO_LAYOUT);
    await app.settled();

    const destinationAfter = await app.savedNodes(design.id, "second.html");
    const dropped = destinationAfter.get("meta-source");
    expect(childrenOf(destinationAfter, "meta-target")).toEqual([
      "meta-source",
    ]);
    const { background, left, top, ...size } = styleOf(dropped);
    expect(size).toEqual({
      position: "absolute",
      width: "500px",
      height: "110px",
    });
    expect(background, "the fill is saved inline").toBeDefined();
    expectPx(left, -70, "saved left inside the target");
    expectPx(top, 35, "saved top inside the target");
    expectOnlyChanged(
      destinationBefore,
      destinationAfter,
      subtree(destinationAfter, "meta-source"),
    );
    const sourceAfter = await app.savedNodes(design.id);
    expect(sourceAfter.has("meta-source")).toBe(false);
    expectOnlyChanged(
      sourceBefore,
      sourceAfter,
      subtree(sourceBefore, "meta-source"),
    );
    const landed = { x: 10, y: 155, width: 500, height: 110 };
    expect(await localRect(page, design.secondId!, "meta-source")).toEqual(
      landed,
    );
    await expect.poll(() => selectionSourceId(request)).toBe("meta-source");
    await expect
      .poll(() => activeSelectionFileId(request))
      .toBe(design.secondId);

    await page.keyboard.press(`${COMMAND}+z`);
    await expect.poll(() => app.savedNodes(design.id)).toEqual(sourceBefore);
    await expect
      .poll(() => app.savedNodes(design.id, "second.html"))
      .toEqual(destinationBefore);

    await page.keyboard.press(`${COMMAND}+Shift+z`);
    await expect
      .poll(() => app.savedNodes(design.id, "second.html"))
      .toEqual(destinationAfter);
    await expect.poll(() => app.savedNodes(design.id)).toEqual(sourceAfter);

    await settleReload(page, design.secondId!);
    expect(await localRect(page, design.secondId!, "meta-source")).toEqual(
      landed,
    );
    await expect(app.node("meta-source", "second.html")).toHaveCSS(
      "background-color",
      "rgb(234, 88, 12)",
    );
    expect(attrsBesidesStyle(dropped)).toEqual({
      "data-agent-native-node-id": "meta-source",
      "data-agent-native-layer-name": "Meta Source",
      "data-agent-native-clone-root": "true",
      "data-agent-native-preserve-styles": "true",
    });
  });

  // fixme: product bug: Modifier state at release is honoured (parent is the body), but the element is saved without position, so it renders at (0,0); same
  test.fixme("cross-Screen drop released after letting go of Ignore Auto Layout lands like a plain oversized drop, at the drop point", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app, {
      secondScreen: true,
      primaryHtml: META_CROSS_SCREEN_PRIMARY_HTML,
      secondHtml: META_CROSS_SCREEN_SECOND_HTML,
    });
    await app.open(design.id);
    await zoomToFitScreens(page, design.secondId!);
    const source = await boxFor(page, design.primaryId, "meta-source");
    const target = await boxFor(page, design.secondId!, "meta-target");
    const release = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    };
    await page.mouse.click(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await expect.poll(() => selectionSourceId(request)).toBe("meta-source");
    const destinationBefore = await app.savedNodes(design.id, "second.html");

    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(release.x, release.y, { steps: 30 });
    await expect(
      page.locator("[data-cross-screen-drag-ghost]"),
    ).not.toHaveCount(0);
    await page.keyboard.down(IGNORE_AUTO_LAYOUT);
    await page.mouse.move(release.x + 1, release.y + 1, { steps: 3 });
    await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible();
    await page.keyboard.up(IGNORE_AUTO_LAYOUT);
    await page.mouse.move(release.x, release.y, { steps: 3 });
    await page.mouse.up();
    await app.settled();

    const destinationAfter = await app.savedNodes(design.id, "second.html");
    const dropped = destinationAfter.get("meta-source");
    expect(dropped?.parent, "dropped beside the target, on the Screen").toBe(
      bodyOf(destinationAfter),
    );
    const style = styleOf(dropped);
    expect(style.position).toBe("absolute");
    expectPx(style.left, 10, "saved left");
    expectPx(style.top, 155, "saved top");
    expectOnlyChanged(
      destinationBefore,
      destinationAfter,
      subtree(destinationAfter, "meta-source"),
    );
    expect((await app.savedNodes(design.id)).has("meta-source")).toBe(false);
  });

  test("source-frame Ignore Auto Layout keyup is honored before host mouseup", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app, {
      secondScreen: true,
      primaryHtml: RELEASE_STATE_CROSS_SCREEN_PRIMARY_HTML,
      secondHtml: RELEASE_STATE_CROSS_SCREEN_SECOND_HTML,
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        value: "Linux x86_64",
      });
      if (window !== window.top) return;
      const modifierStates: boolean[] = [];
      window.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type !== "agent-native:cross-screen-modifiers") {
          return;
        }
        modifierStates.push(event.data.ignoreAutoLayout === true);
        document.documentElement.dataset.crossScreenModifierStates =
          JSON.stringify(modifierStates);
      });
    });
    await gotoEditor(page, design.id);
    await page.keyboard.press("Shift+1");
    const source = await boxFor(page, design.primaryId, "release-source");
    const target = await boxFor(page, design.secondId!, "release-target");
    await page.mouse.click(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await expect.poll(() => selectionSourceId(request)).toBe("release-source");
    const sourceIframe = page.locator(
      `iframe[data-screen-iframe-id="${design.primaryId}"]`,
    );
    await sourceIframe.focus();
    await expect
      .poll(() =>
        sourceIframe.evaluate((iframe) => document.activeElement === iframe),
      )
      .toBe(true);
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + 12, source.y + 8, { steps: 5 });
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 30 },
    );
    await expect
      .poll(() => page.locator("[data-cross-screen-drag-ghost]").count())
      .toBeGreaterThan(0);
    await sourceIframe.focus();
    await expect
      .poll(() =>
        sourceIframe.evaluate((iframe) => document.activeElement === iframe),
      )
      .toBe(true);

    await page.keyboard.down("s");
    await page.mouse.move(
      target.x + target.width / 2 + 1,
      target.y + target.height / 2 + 1,
      { steps: 3 },
    );
    await expect
      .poll(() => page.locator("[data-cross-screen-drop-guide]").count())
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.locator("html").getAttribute("data-cross-screen-modifier-states"),
      )
      .toBe("[true]");
    await page.keyboard.up("s");
    await expect
      .poll(() =>
        page.locator("html").getAttribute("data-cross-screen-modifier-states"),
      )
      .toBe("[true,false]");
    await page.mouse.up();
    await expect
      .poll(async () => {
        const [from, to] = await Promise.all([
          fileHtml(request, design.id, design.primaryId),
          fileHtml(request, design.id, design.secondId!),
        ]);
        return {
          from: hasNode(from, "release-source"),
          destination: hasNode(to, "release-source"),
        };
      })
      .toEqual({ from: false, destination: true });
    await settleReload(page, design.secondId!);
    await expect
      .poll(() => parentId(page, design.secondId!, "release-source"))
      .toBe("release-target");
    await expect
      .poll(() =>
        designFrame(page, design.secondId!)
          .locator('[data-agent-native-node-id="release-source"]')
          .evaluate((node) => getComputedStyle(node).position),
      )
      .toBe("static");
  });

  test("cross-Screen drop into a freeform frame saves the element absolute at the drop point and survives reload", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app, {
      secondScreen: true,
      primaryHtml: FREEFORM_CROSS_SCREEN_PRIMARY_HTML,
      secondHtml: FREEFORM_CROSS_SCREEN_SECOND_HTML,
    });
    await app.open(design.id);
    await zoomToFitScreens(page, design.secondId!);
    const source = await boxFor(page, design.primaryId, "freeform-source");
    const target = await boxFor(page, design.secondId!, "freeform-target");
    await page.mouse.click(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await expect.poll(() => selectionSourceId(request)).toBe("freeform-source");
    const sourceBefore = await app.savedNodes(design.id);
    const destinationBefore = await app.savedNodes(design.id, "second.html");

    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + 12, source.y + 8, { steps: 5 });
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      {
        steps: 30,
      },
    );
    await expect(
      page.locator("[data-cross-screen-drag-ghost]"),
    ).not.toHaveCount(0);
    await page.mouse.up();
    await app.settled();

    const destinationAfter = await app.savedNodes(design.id, "second.html");
    const dropped = destinationAfter.get("freeform-source");
    expect(dropped?.parent).toBe("freeform-target");
    expect(childrenOf(destinationAfter, "freeform-target")).toEqual([
      "freeform-anchor",
      "freeform-source",
    ]);
    const style = styleOf(dropped);
    expect(style.position).toBe("absolute");
    expectPx(style.left, 144, "saved left");
    expectPx(style.top, 68, "saved top");
    expectOnlyChanged(
      destinationBefore,
      destinationAfter,
      subtree(destinationAfter, "freeform-source"),
    );
    expectOnlyChanged(
      sourceBefore,
      await app.savedNodes(design.id),
      subtree(sourceBefore, "freeform-source"),
    );
    expect((await app.savedNodes(design.id)).has("freeform-source")).toBe(
      false,
    );
    const landed = { x: 224, y: 188, width: 72, height: 44 };
    expect(await localRect(page, design.secondId!, "freeform-source")).toEqual(
      landed,
    );
    await settleReload(page, design.secondId!);
    expect(await localRect(page, design.secondId!, "freeform-source")).toEqual(
      landed,
    );
    expect(attrsBesidesStyle(dropped)).toEqual({
      "data-agent-native-node-id": "freeform-source",
      "data-agent-native-layer-name": "Freeform Source",
      "data-agent-native-clone-root": "true",
      "data-agent-native-preserve-styles": "true",
    });
  });

  test("dragging a lone free shape by 137×91 design px moves it exactly that far and saves only its new left and top", async ({
    app,
    page,
  }) => {
    const design = await createDesign(app, { primaryHtml: LONE_SHAPE_HTML });
    await app.open(design.id);
    await app.zoomToFit();
    const shape = await localRect(page, design.primaryId, "lone-shape");
    expect(shape).toEqual({ x: 120, y: 100, width: 80, height: 50 });
    const grab = await app.pagePoint(160, 125);
    await page.mouse.click(grab.x, grab.y);
    expect(await app.selectedLayers()).toEqual(["Lone shape"]);
    const before = await app.savedNodes(design.id);
    const drop = await app.pagePoint(160 + 137, 125 + 91);

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 20 });
    await page.mouse.up();
    await app.settled();

    const after = await app.savedNodes(design.id);
    expect(styleOf(after.get("lone-shape"))).toEqual({
      ...styleOf(before.get("lone-shape")),
      left: "257px",
      top: "191px",
    });
    expectOnlyChanged(before, after, ["lone-shape"]);
    const moved = { x: 257, y: 191, width: 80, height: 50 };
    expect(await localRect(page, design.primaryId, "lone-shape")).toEqual(
      moved,
    );
    await settleReload(page, design.primaryId);
    expect(await localRect(page, design.primaryId, "lone-shape")).toEqual(
      moved,
    );
  });

  test("flow child dragged to free canvas leaves auto layout and persists exact coordinates", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app, {
      primaryHtml: FLOW_CHILD_FREE_CANVAS_HTML,
    });
    const screenLocalGeometry = () =>
      designFrame(page, design.primaryId)
        .locator('[data-agent-native-node-id="flow-child"]')
        .evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            left: style.left,
            top: style.top,
          };
        });
    await gotoEditor(page, design.id);
    await selectLayer(page, "Flow child");
    const source = await boxFor(page, design.primaryId, "flow-child");
    const previewLocator = page.locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${design.primaryId}"]`,
    );
    const preview = await previewLocator.boundingBox();
    if (!preview) throw new Error("missing primary screen preview box");
    const previewBoxes = await page
      .locator("iframe[data-design-preview-iframe]")
      .evaluateAll((iframes) =>
        iframes.map((iframe) => {
          const rect = iframe.getBoundingClientRect();
          return {
            id: iframe.getAttribute("data-screen-iframe-id"),
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          };
        }),
      );
    const candidates = [
      {
        x: preview.x + preview.width - 80,
        y: preview.y + preview.height / 2,
      },
      {
        x: preview.x + preview.width / 2,
        y: preview.y + preview.height - 80,
      },
      {
        x: preview.x + preview.width - 80,
        y: preview.y + preview.height - 80,
      },
    ];
    const sourceRect = {
      left: source.x,
      top: source.y,
      right: source.x + source.width,
      bottom: source.y + source.height,
    };
    const contains = (
      rect: { left: number; top: number; right: number; bottom: number },
      point: { x: number; y: number },
    ) =>
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom;
    const destination = candidates.find(
      (point) =>
        !contains(sourceRect, point) &&
        previewBoxes
          .filter((box) => box.id !== design.primaryId)
          .every((box) => !contains(box, point)),
    );
    if (!destination) {
      throw new Error("missing in-screen free-canvas destination");
    }
    const initialHtml = await fileHtml(request, design.id, design.primaryId);
    const start = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    let beforeReleaseHtml = initialHtml;
    const snapshots: HeldSnapshot[] = [];
    try {
      await page.waitForTimeout(16);
      snapshots.push(
        await heldSnapshot(
          page,
          design.primaryId,
          "flow-child",
          "flow-origin",
          "pointerdown",
        ),
      );
      await page.mouse.move(start.x + 1, start.y + 1, { steps: 1 });
      await page.mouse.move(start.x + 12, start.y + 8, { steps: 1 });
      await page.mouse.move(destination.x, destination.y, { steps: 24 });
      await page.waitForTimeout(16);
      snapshots.push(
        await settledHeldSnapshot(
          page,
          design.primaryId,
          "flow-child",
          null,
          "free-canvas",
        ),
      );
      beforeReleaseHtml = await fileHtml(request, design.id, design.primaryId);
    } finally {
      await page.mouse.up();
    }

    const held = snapshots.find((snapshot) => snapshot.stage === "free-canvas");
    expect(held?.source?.parentId).toBe("flow-origin");
    expect(held?.source?.lifted).toBe(true);
    expect(held?.children.map((child) => child.id)).toEqual([
      "flow-child",
      "flow-peer",
    ]);
    expect(beforeReleaseHtml).toBe(initialHtml);

    const logicalRootOrder = () =>
      designFrame(page, design.primaryId)
        .locator('[data-agent-native-node-id="flow-origin"]')
        .evaluate((origin) =>
          Array.from(origin.parentElement?.children ?? [])
            .map((child) => child.getAttribute("data-agent-native-node-id"))
            .filter((id): id is string => Boolean(id)),
        );
    await expect
      .poll(() => parentId(page, design.primaryId, "flow-child"))
      .not.toBe("flow-origin");
    await expect
      .poll(() => parentId(page, design.primaryId, "flow-peer"))
      .toBe("flow-origin");
    const dropped = await boxFor(page, design.primaryId, "flow-child");
    expect(dropped.x).toBeCloseTo(destination.x - source.width / 2, 0);
    expect(dropped.y).toBeCloseTo(destination.y - source.height / 2, 0);
    await expect.poll(logicalRootOrder).toEqual(["flow-origin", "flow-child"]);
    await expect
      .poll(() =>
        designFrame(page, design.primaryId)
          .locator('[data-agent-native-node-id="flow-child"]')
          .evaluate((node) => getComputedStyle(node).position),
      )
      .toBe("absolute");
    const droppedLocal = await screenLocalGeometry();
    const droppedHtml = await fileHtml(request, design.id, design.primaryId);
    const originEnd = droppedHtml.indexOf("</section>");
    const childIndex = droppedHtml.indexOf(
      'data-agent-native-node-id="flow-child"',
    );
    expect(originEnd).toBeGreaterThan(-1);
    expect(childIndex).toBeGreaterThan(originEnd);

    await settleReload(page, design.primaryId);
    await expect
      .poll(() => parentId(page, design.primaryId, "flow-child"))
      .not.toBe("flow-origin");
    await expect
      .poll(() => parentId(page, design.primaryId, "flow-peer"))
      .toBe("flow-origin");
    const reloadedLocal = await screenLocalGeometry();
    expect(reloadedLocal.x).toBeCloseTo(droppedLocal.x, 0);
    expect(reloadedLocal.y).toBeCloseTo(droppedLocal.y, 0);
    expect(reloadedLocal.width).toBeCloseTo(droppedLocal.width, 0);
    expect(reloadedLocal.height).toBeCloseTo(droppedLocal.height, 0);
    expect(reloadedLocal.left).toBe(droppedLocal.left);
    expect(reloadedLocal.top).toBe(droppedLocal.top);
    expect(await fileHtml(request, design.id, design.primaryId)).toBe(
      droppedHtml,
    );
    await expect.poll(logicalRootOrder).toEqual(["flow-origin", "flow-child"]);
    await expect
      .poll(() =>
        designFrame(page, design.primaryId)
          .locator('[data-agent-native-node-id="flow-child"]')
          .evaluate((node) => getComputedStyle(node).position),
      )
      .toBe("absolute");
  });

  // fixme: product bug: Fixed-size layer squeezed by auto layout: the saved width stays 500px but with no flex-shrink:0 the 360px row renders it 360px wide
  test.fixme("cross-Screen Command drop forces an oversized element into the empty auto-layout target as its only flow child", async ({
    app,
    page,
    request,
  }) => {
    const design = await createDesign(app, {
      secondScreen: true,
      primaryHtml: META_CROSS_SCREEN_PRIMARY_HTML,
      secondHtml: META_CROSS_SCREEN_SECOND_HTML,
    });
    await app.open(design.id);
    await zoomToFitScreens(page, design.secondId!);
    const source = await boxFor(page, design.primaryId, "meta-source");
    const target = await boxFor(page, design.secondId!, "meta-target");
    await page.mouse.click(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await expect.poll(() => selectionSourceId(request)).toBe("meta-source");
    const sourceBefore = await app.savedNodes(design.id);
    const destinationBefore = await app.savedNodes(design.id, "second.html");

    await page.keyboard.down(COMMAND);
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(source.x + 12, source.y + 8, { steps: 5 });
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      {
        steps: 30,
      },
    );
    await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up(COMMAND);
    await app.settled();

    const destinationAfter = await app.savedNodes(design.id, "second.html");
    expect(childrenOf(destinationAfter, "meta-target")).toEqual([
      "meta-source",
    ]);
    const dropped = destinationAfter.get("meta-source");
    const style = styleOf(dropped);
    expect({
      position: style.position,
      left: style.left,
      top: style.top,
    }).toEqual({
      position: undefined,
      left: undefined,
      top: undefined,
    });
    expect({ width: style.width, height: style.height }).toEqual({
      width: "500px",
      height: "110px",
    });
    expectOnlyChanged(
      destinationBefore,
      destinationAfter,
      subtree(destinationAfter, "meta-source"),
    );
    expectOnlyChanged(
      sourceBefore,
      await app.savedNodes(design.id),
      subtree(sourceBefore, "meta-source"),
    );
    expect((await app.savedNodes(design.id)).has("meta-source")).toBe(false);
    await settleReload(page, design.secondId!);
    await expect
      .poll(() => directChildren(page, design.secondId!, "meta-target"))
      .toEqual(["meta-source"]);
    expect(attrsBesidesStyle(dropped)).toEqual({
      "data-agent-native-node-id": "meta-source",
      "data-agent-native-layer-name": "Meta Source",
      "data-agent-native-clone-root": "true",
      "data-agent-native-preserve-styles": "true",
    });
    expect(
      await localRect(page, design.secondId!, "meta-source"),
      "the fixed 500px layer keeps its width as a flow child",
    ).toEqual({ x: 80, y: 120, width: 500, height: 110 });
  });
});
