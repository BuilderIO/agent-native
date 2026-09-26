import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { chromeBounds } from "./drag-and-drop.shared";
import { appPath, designFrame, expandAllLayers, gotoEditor } from "./helpers";

// Oracle: Figma Guide to auto layout (D-AL/D-HV/D-IGNORE/D-COPY) and the
// 2026-09-18 held-drag matrix in .tmp/interaction-parity. These tests assert
// documented structure and marker orientation; marker pixel values remain
// version/zoom dependent. Native Figma runtime telemetry is unavailable in
// this headless lane, so the documented release semantics remain an explicit
// oracle boundary rather than an unverified native-app claim.
const CONTROL = "Control";
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
  request: APIRequestContext,
  secondScreenOrOptions:
    | boolean
    | {
        secondScreen?: boolean;
        primaryHtml?: string;
        secondHtml?: string;
      } = false,
): Promise<{ id: string; primaryId: string; secondId?: string }> {
  const options =
    typeof secondScreenOrOptions === "boolean"
      ? { secondScreen: secondScreenOrOptions }
      : secondScreenOrOptions;
  const secondScreen = options.secondScreen ?? false;
  const created = await action(request, "create-design", {
    title: `Auto layout matrix ${Date.now()}`,
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (typeof id !== "string") throw new Error("create-design returned no id");
  try {
    await action(request, "create-file", {
      designId: id,
      filename: "index.html",
      content: options.primaryHtml ?? MATRIX_HTML,
      fileType: "html",
    });
    if (secondScreen) {
      await action(request, "create-file", {
        designId: id,
        filename: "second.html",
        content: options.secondHtml ?? SECOND_SCREEN_HTML,
        fileType: "html",
      });
    }
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
  } catch (error) {
    await deleteDesign(request, id);
    throw error;
  }
}

async function deleteDesign(
  request: APIRequestContext,
  id: string,
): Promise<void> {
  await action(request, "delete-design", { id });
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

async function dragHeldWithOracle(
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
  // A missing marker must fail the caller's expected-order assertion rather
  // than sorting ahead of every present marker as if it were valid HTML.
  if (positions.some(({ index }) => index < 0)) return [];
  return positions
    .sort((left, right) => left.index - right.index)
    .map(({ id }) => id);
}

test.use({ viewport: { width: 1600, height: 1100 } });

test.describe("physical Figma auto-layout drag/drop matrix", () => {
  test("held drag previews multiple targets without committing until mouseup", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request);
    try {
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
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("horizontal nowrap first, middle, and end slots expose a held marker and persist", async ({
    page,
    request,
  }) => {
    // Three full editor round-trips (create, drag, reload) per cell — 66s
    // measured locally on an idle host, with no assertion failure; CI's
    // slower runner pushed the same work past the default 90s budget. Give
    // this and its three siblings below the same generous margin.
    test.setTimeout(150_000);
    const cells = [
      {
        name: "H-1 first",
        source: "h-last",
        target: "h-first",
        targetEdge: "leading" as const,
        expected: ["h-last", "h-first", "h-middle"],
      },
      {
        name: "H-2 middle",
        source: "h-first",
        target: "h-middle",
        targetEdge: "center" as const,
        expected: ["h-middle", "h-first", "h-last"],
      },
      {
        name: "H-3 end",
        source: "h-first",
        target: "h-last",
        targetEdge: "trailing" as const,
        expected: ["h-middle", "h-last", "h-first"],
      },
    ];
    for (const cell of cells) {
      await test.step(cell.name, async () => {
        const design = await createDesign(request);
        try {
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
          expect(
            await fileHtml(request, design.id, design.primaryId),
          ).toContain('data-agent-native-node-id="hrow"');
          await assertReloadedOrder(
            page,
            design.primaryId,
            "hrow",
            cell.expected,
          );
        } finally {
          await deleteDesign(request, design.id);
        }
      });
    }
  });

  test("vertical center and trailing insertion keep held guides and exact reload geometry", async ({
    page,
    request,
  }) => {
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
        const design = await createDesign(request);
        try {
          await gotoEditor(page, design.id);
          const evidence = await dragHeldWithOracle(
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
          expect(spacing.children[1]!.top - spacing.children[0]!.bottom).toBe(
            12,
          );

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
        } finally {
          await deleteDesign(request, design.id);
        }
      });
    }
  });

  test("nested two-level drop preserves gap/padding and flow participation", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request);
    try {
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
      expect(geometry.leftInset).toBeGreaterThanOrEqual(
        geometry.paddingLeft - 1,
      );
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
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("text, shape, and component children all flow-insert into the same container", async ({
    page,
    request,
  }) => {
    // Three full editor round-trips per cell (46s measured locally) — see
    // the timeout note on "horizontal nowrap ... expose a held marker and
    // persist" above.
    test.setTimeout(150_000);
    const cells = [
      { source: "free-text", name: "Free text", tag: "P" },
      { source: "free-shape", name: "Free shape", tag: "DIV" },
      { source: "free-component", name: "Free component", tag: "BUTTON" },
    ];
    for (const cell of cells) {
      await test.step(cell.name, async () => {
        const design = await createDesign(request);
        try {
          await gotoEditor(page, design.id);
          const result = await dragHeld(
            page,
            design.primaryId,
            cell.source,
            "mixed-target",
          );
          expect(result.during.display).toBe("block");
          await expect
            .poll(() => parentId(page, design.primaryId, cell.source))
            .toBe("mixed-target");
          const details = await designFrame(page, design.primaryId)
            .locator(`[data-agent-native-node-id="${cell.source}"]`)
            .evaluate((node) => ({
              tag: node.tagName,
              position: getComputedStyle(node).position,
              component: node.getAttribute("data-agent-native-component"),
            }));
          expect(details.tag).toBe(cell.tag);
          expect(details.position).not.toBe("absolute");
          if (cell.source === "free-component")
            expect(details.component).toBe("Card");
          await settleReload(page, design.primaryId);
          await expect
            .poll(() => parentId(page, design.primaryId, cell.source))
            .toBe("mixed-target");
        } finally {
          await deleteDesign(request, design.id);
        }
      });
    }
  });

  test("cross-container flow preview keeps the source in the held Layers tree", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request);
    try {
      await gotoEditor(page, design.id);
      await expandAllLayers(page);
      await selectLayer(page, "Inner text");
      const source = await boxFor(page, design.primaryId, "inner-text");
      const target = await boxFor(page, design.primaryId, "nested-marker");

      await page.mouse.move(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(source.x + source.width / 2 + 12, source.y + 8, {
        steps: 2,
      });
      await page.mouse.move(target.x + target.width / 2, target.y + 2, {
        steps: 12,
      });

      await expect
        .poll(() => layerParentName(page, "Inner text"), { timeout: 5_000 })
        .toBe("Nested outer");
      await page.mouse.up();
      await expect
        .poll(() => parentId(page, design.primaryId, "inner-text"))
        .toBe("nested-outer");
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("fixed, Hug, and Fill sizing survive flow insertion", async ({
    page,
    request,
  }) => {
    // Three full editor round-trips per cell (47.5s measured locally) — see
    // the timeout note on "horizontal nowrap ... expose a held marker and
    // persist" above.
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
        const design = await createDesign(request);
        try {
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
        } finally {
          await deleteDesign(request, design.id);
        }
      });
    }
  });

  test("absolute child accepts Control before pointerdown and after pointerdown without consuming a flow slot", async ({
    page,
    request,
  }) => {
    const platform = await page.evaluate(() => {
      const nav = navigator as Navigator & {
        userAgentData?: { platform?: string };
      };
      return nav.userAgentData?.platform || nav.platform || "";
    });
    const modifiers = [/Mac|iPhone|iPad|iPod/i.test(platform) ? CONTROL : "S"];
    for (const modifier of modifiers) {
      for (const timing of [
        "before-pointerdown",
        "after-pointerdown",
      ] as const) {
        await test.step(`${modifier}/${timing}`, async () => {
          const design = await createDesign(request);
          try {
            await gotoEditor(page, design.id);
            if (timing === "before-pointerdown") {
              const result = await dragHeld(
                page,
                design.primaryId,
                "ignore-source",
                "ignore-target",
                {
                  modifier,
                },
              );
              expect(result.during.display).toBe("block");
            } else {
              await selectLayer(page, "Ignore source");
              const source = await boxFor(
                page,
                design.primaryId,
                "ignore-source",
              );
              const target = await boxFor(
                page,
                design.primaryId,
                "ignore-target",
              );
              await page.mouse.move(
                source.x + source.width / 2,
                source.y + source.height / 2,
              );
              let mouseHeld = false;
              let modifierHeld = false;
              try {
                mouseHeld = true;
                await page.mouse.down();
                await page.mouse.move(source.x + 12, source.y + 8, {
                  steps: 5,
                });
                modifierHeld = true;
                await page.keyboard.down(modifier);
                await page.mouse.move(
                  target.x + target.width / 2,
                  target.y + target.height / 2,
                  { steps: 24 },
                );
                await page.waitForTimeout(250);
                const guide = designFrame(page, design.primaryId).locator(
                  "[data-agent-native-insertion-guide]",
                );
                const during = await guide.evaluate((element) => ({
                  display: getComputedStyle(element).display,
                  border: getComputedStyle(element).border,
                }));
                expect(during.display).toBe("block");
              } finally {
                if (mouseHeld) await page.mouse.up();
                if (modifierHeld) await page.keyboard.up(modifier);
              }
            }
            await expect
              .poll(() => parentId(page, design.primaryId, "ignore-source"))
              .toBe("ignore-target");
            const state = await designFrame(page, design.primaryId)
              .locator('[data-agent-native-node-id="ignore-source"]')
              .evaluate((node) => ({
                position: getComputedStyle(node).position,
                parentChildren: Array.from(node.parentElement!.children).map(
                  (child) =>
                    child.getAttribute("data-agent-native-node-id") ?? "",
                ),
              }));
            expect(state.position).toBe("absolute");
            expect(state.parentChildren).toContain("ignore-sibling");
            await settleReload(page, design.primaryId);
            await expect
              .poll(() => parentId(page, design.primaryId, "ignore-source"))
              .toBe("ignore-target");
            await expect
              .poll(() => fileHtml(request, design.id, design.primaryId))
              .toMatch(
                /data-agent-native-node-id="ignore-source"[^>]*position:\s*absolute/,
              );
          } finally {
            await deleteDesign(request, design.id);
          }
        });
      }
    }
  });

  test("Option-drag duplicates a flow child while held and persists source plus clone", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request);
    try {
      await gotoEditor(page, design.id);
      await selectLayer(page, "H Middle");
      const source = await boxFor(page, design.primaryId, "h-middle");
      const target = await boxFor(page, design.primaryId, "h-last");
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
          target.x + target.width / 2,
          target.y + target.height / 2,
          { steps: 24 },
        );
        await page.waitForTimeout(250);
        const heldCount = await designFrame(page, design.primaryId)
          .locator("#hrow > [data-agent-native-node-id]")
          .count();
        expect(heldCount).toBe(4);
      } finally {
        if (mouseHeld) await page.mouse.up();
        if (modifierHeld) await page.keyboard.up("Alt");
      }
      let html = "";
      await expect
        .poll(
          async () => {
            html = await fileHtml(request, design.id, design.primaryId);
            return (
              html.match(/data-agent-native-layer-name="H Middle"/g) ?? []
            ).length;
          },
          { timeout: 15_000 },
        )
        .toBe(2);
      await settleReload(page, design.primaryId);
      await expect(
        designFrame(page, design.primaryId).locator(
          '#hrow > [data-agent-native-layer-name="H Middle"]',
        ),
      ).toHaveCount(2);
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("Option-drag into an occupied explicit grid cell preserves the clone anchor", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, {
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
    try {
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
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("linked component drag propagates to its instance and keeps overrides through duplicate, undo, redo, and reload", async ({
    page,
    request,
  }) => {
    const reorderedSourceNodeIds = ["play-badge", "play-label"];
    const design = await createDesign(request, {
      primaryHtml: LINKED_COMPONENT_HTML,
    });
    try {
      await gotoEditor(page, design.id);
      const linkedState = () =>
        designFrame(page, design.primaryId)
          .locator("body")
          .evaluate((body) => {
            const readRoot = (root: Element) => ({
              nodeId: root.getAttribute("data-agent-native-node-id"),
              componentId: root.getAttribute("data-agent-native-component-id"),
              componentRef: root.getAttribute(
                "data-agent-native-component-ref",
              ),
              cloneRoot: root.getAttribute("data-agent-native-clone-root"),
              overrides: root.getAttribute(
                "data-agent-native-component-overrides",
              ),
              children: Array.from(root.children).map(
                (child) =>
                  child.getAttribute("data-agent-native-node-id") ?? "",
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

      const result = await dragHeldWithOracle(
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
      const lifted = result.snapshots.find(
        (snapshot) => snapshot.source?.lifted,
      );
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
          held.instances.find(
            (instance) => instance.nodeId === "play-instance",
          ),
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
            duplicatedHtml = await fileHtml(
              request,
              design.id,
              design.primaryId,
            );
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
      expect(redoneHtml).toContain(
        `data-agent-native-component-ref="cmp-play"`,
      );
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
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("SCREEN-ROOT horizontal, vertical, wrap, and grid cells keep held oracle evidence", async ({
    page,
    request,
  }) => {
    // Five full editor round-trips (each with a 12-point held-oracle drag,
    // 50s measured locally) — see the timeout note on "horizontal nowrap
    // ... expose a held marker and persist" above.
    test.setTimeout(150_000);
    const cells: Array<{
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

    for (const cell of cells) {
      await test.step(`SCREEN-ROOT/${cell.fixture}`, async () => {
        const design = await createDesign(request, {
          primaryHtml: ROOT_SCREEN_FIXTURES[cell.fixture],
        });
        try {
          await gotoEditor(page, design.id);
          const evidence = await dragHeldWithOracle(
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
                  const actual = snapshot.children.find(
                    (child) => child.id === id,
                  );
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
          const html = await fileHtml(request, design.id, design.primaryId);
          expect(html).toContain(`data-agent-native-node-id="${cell.source}"`);
        } finally {
          await deleteDesign(request, design.id);
        }
      });
    }
  });

  test("authored grid column flow with repeat/minmax keeps held guide and persists insertion", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, {
      primaryHtml: ROOT_SCREEN_FIXTURES["grid-authored-column-flow"],
    });
    try {
      await gotoEditor(page, design.id);
      const result = await dragHeld(
        page,
        design.primaryId,
        "root-c",
        "root-a",
        { targetEdge: "leading", axis: "vertical" },
      );
      expect(result.during.display).toBe("block");
      expect(result.during.width).toBeGreaterThan(result.during.height);
      await expect
        .poll(() => rootChildIds(page, design.primaryId))
        .toEqual(["root-c", "root-a", "root-b"]);
      await settleReload(page, design.primaryId);
      await expect
        .poll(() => rootChildIds(page, design.primaryId))
        .toEqual(["root-c", "root-a", "root-b"]);
      const html = await fileHtml(request, design.id, design.primaryId);
      const authoredStyle = html.match(
        /data-agent-native-node-id="root-c"[^>]*\sstyle="([^"]*)"/,
      )?.[1];
      expect(authoredStyle).toMatch(/grid-(?:column|row)\s*:/);
      const autoFlowStyle = html.match(
        /data-agent-native-node-id="root-a"[^>]*\sstyle="([^"]*)"/,
      )?.[1];
      expect(autoFlowStyle).toBeDefined();
      expect(autoFlowStyle).not.toMatch(/(?:^|;)grid-(?:column|row)\s*:/);
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("GRID-TRACK explicit and implicit root Screens expose track controls with source evidence", async ({
    page,
    request,
  }) => {
    for (const fixture of ["grid-explicit", "grid-implicit"] as const) {
      await test.step(`GRID-TRACK/${fixture}`, async () => {
        const design = await createDesign(request, {
          primaryHtml: ROOT_SCREEN_FIXTURES[fixture],
        });
        try {
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
          await expect(rows).toHaveValue(
            fixture === "grid-explicit" ? "2" : "3",
          );
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
        } finally {
          await deleteDesign(request, design.id);
        }
      });
    }
  });

  test("SCREEN-ROOT reorder is undoable and reload preserves the undo result", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, {
      primaryHtml: ROOT_SCREEN_FIXTURES.horizontal,
    });
    try {
      await gotoEditor(page, design.id);
      await dragHeldWithOracle(
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
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("cross-container and cross-Screen flow drops keep held target evidence and persist after reload", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, true);
    try {
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
      const settledTarget = await boxFor(
        page,
        design.secondId!,
        "cross-target",
      );
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
        // Cross-Screen uses the host drag ghost as its held overlay; the iframe
        // insertion guide is intentionally not mounted during that handoff.
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
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("cross-Screen oversized free drops show a line and persist beside an empty auto-layout target", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, {
      secondScreen: true,
      primaryHtml: OVERSIZED_CROSS_SCREEN_PRIMARY_HTML,
      secondHtml: OVERSIZED_CROSS_SCREEN_SECOND_HTML,
    });
    try {
      await gotoEditor(page, design.id);
      await page.keyboard.press("Shift+1");
      const source = await boxFor(page, design.primaryId, "oversized-source");
      const target = await boxFor(page, design.secondId!, "plain-target");
      expect(source.width).toBeGreaterThan(target.width);
      await page.keyboard.down(COMMAND);
      await page.mouse.click(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.keyboard.up(COMMAND);
      await expect
        .poll(() => selectionSourceId(request))
        .toBe("oversized-source");

      await page.mouse.move(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(source.x + 12, source.y + 8, { steps: 5 });
      await page.mouse.move(
        target.x + target.width * 0.75,
        target.y + target.height / 2,
        { steps: 30 },
      );
      const guide = page.locator("[data-cross-screen-drop-guide]");
      await expect
        .poll(() => guide.count(), {
          timeout: 5_000,
          message: "cross-screen oversized drop did not show a held line",
        })
        .toBeGreaterThan(0);
      const heldGuide = await guide.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          display: style.display,
          width: Number.parseFloat(style.width),
          height: Number.parseFloat(style.height),
        };
      });
      expect(heldGuide.display).not.toBe("none");
      expect(heldGuide.height).toBeLessThan(heldGuide.width);
      expect(
        await page.locator("[data-cross-screen-drag-ghost]").count(),
      ).toBeGreaterThan(0);
      await page.mouse.up();

      await expect
        .poll(async () => {
          const [from, to] = await Promise.all([
            fileHtml(request, design.id, design.primaryId),
            fileHtml(request, design.id, design.secondId!),
          ]);
          return {
            from: hasNode(from, "oversized-source"),
            destination: hasNode(to, "oversized-source"),
          };
        })
        .toMatchObject({ from: false, destination: true });
      await settleReload(page, design.secondId!);
      await expect
        .poll(() => parentId(page, design.secondId!, "oversized-source"))
        .not.toBe("plain-target");
      await expect
        .poll(() =>
          designFrame(page, design.secondId!)
            .locator('[data-agent-native-node-id="oversized-source"]')
            .evaluate((node) => node.parentElement?.tagName),
        )
        .toBe("BODY");
      await expect
        .poll(() =>
          designFrame(page, design.secondId!)
            .locator('[data-agent-native-node-id="plain-target"]')
            .locator('[data-agent-native-node-id="oversized-source"]')
            .count(),
        )
        .toBe(0);
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("cross-Screen Ignore Auto Layout oversized drops keep absolute inside placement", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, {
      secondScreen: true,
      primaryHtml: META_CROSS_SCREEN_PRIMARY_HTML,
      secondHtml: META_CROSS_SCREEN_SECOND_HTML,
    });
    try {
      await gotoEditor(page, design.id);
      await page.keyboard.press("Shift+1");
      const source = await boxFor(page, design.primaryId, "meta-source");
      const target = await boxFor(page, design.secondId!, "meta-target");
      await page.mouse.click(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await expect.poll(() => selectionSourceId(request)).toBe("meta-source");
      await page.mouse.move(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.mouse.down();
      // Cross into the overview host first. It owns focus after this handoff,
      // The overview host owns focus after this handoff, so use the platform
      // Ignore Auto Layout chord there instead of relying on the source iframe.
      await page.mouse.move(
        target.x + target.width / 2,
        target.y + target.height / 2,
        { steps: 30 },
      );
      await expect
        .poll(() => page.locator("[data-cross-screen-drag-ghost]").count())
        .toBeGreaterThan(0);
      await page.keyboard.down(IGNORE_AUTO_LAYOUT);
      await page.mouse.move(
        target.x + target.width / 2 + 1,
        target.y + target.height / 2 + 1,
        { steps: 3 },
      );
      const guide = page.locator("[data-cross-screen-drop-guide]");
      await expect
        .poll(() => guide.count(), {
          timeout: 5_000,
          message:
            "cross-screen Ignore Auto Layout drop did not show a held guide",
        })
        .toBeGreaterThan(0);
      expect(
        await page.locator("[data-cross-screen-drag-ghost]").count(),
      ).toBeGreaterThan(0);
      await page.mouse.up();
      await page.keyboard.up(IGNORE_AUTO_LAYOUT);
      await expect
        .poll(async () => {
          const [from, to] = await Promise.all([
            fileHtml(request, design.id, design.primaryId),
            fileHtml(request, design.id, design.secondId!),
          ]);
          return {
            from: hasNode(from, "meta-source"),
            destination: hasNode(to, "meta-source"),
          };
        })
        .toEqual({ from: false, destination: true });
      await expect.poll(() => selectionSourceId(request)).toBe("meta-source");
      await expect
        .poll(() => activeSelectionFileId(request))
        .toBe(design.secondId);
      await page.keyboard.press(`${COMMAND}+z`);
      await expect
        .poll(async () => {
          const [from, to] = await Promise.all([
            fileHtml(request, design.id, design.primaryId),
            fileHtml(request, design.id, design.secondId!),
          ]);
          return {
            from: hasNode(from, "meta-source"),
            destination: hasNode(to, "meta-source"),
          };
        })
        .toEqual({ from: true, destination: false });

      await page.keyboard.press(`${COMMAND}+Shift+z`);
      await expect
        .poll(async () => {
          const [from, to] = await Promise.all([
            fileHtml(request, design.id, design.primaryId),
            fileHtml(request, design.id, design.secondId!),
          ]);
          return {
            from: hasNode(from, "meta-source"),
            destination: hasNode(to, "meta-source"),
          };
        })
        .toEqual({ from: false, destination: true });

      await settleReload(page, design.secondId!);
      await expect
        .poll(() => parentId(page, design.secondId!, "meta-source"))
        .toBe("meta-target");
      await expect
        .poll(() =>
          designFrame(page, design.secondId!)
            .locator('[data-agent-native-node-id="meta-source"]')
            .evaluate((node) => getComputedStyle(node).position),
        )
        .toBe("absolute");
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("cross-Screen drop uses the modifier state at release", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, {
      secondScreen: true,
      primaryHtml: META_CROSS_SCREEN_PRIMARY_HTML,
      secondHtml: META_CROSS_SCREEN_SECOND_HTML,
    });
    try {
      await gotoEditor(page, design.id);
      await page.keyboard.press("Shift+1");
      const source = await boxFor(page, design.primaryId, "meta-source");
      const target = await boxFor(page, design.secondId!, "meta-target");
      await page.mouse.click(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await expect.poll(() => selectionSourceId(request)).toBe("meta-source");
      await page.mouse.move(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        target.x + target.width / 2,
        target.y + target.height / 2,
        { steps: 30 },
      );
      await expect
        .poll(() => page.locator("[data-cross-screen-drag-ghost]").count())
        .toBeGreaterThan(0);
      await page.keyboard.down(IGNORE_AUTO_LAYOUT);
      await page.mouse.move(
        target.x + target.width / 2 + 1,
        target.y + target.height / 2 + 1,
        { steps: 3 },
      );
      await expect
        .poll(() => page.locator("[data-cross-screen-drop-guide]").count())
        .toBeGreaterThan(0);
      await page.keyboard.up(IGNORE_AUTO_LAYOUT);
      await page.mouse.up();
      await expect
        .poll(async () => {
          const [from, to] = await Promise.all([
            fileHtml(request, design.id, design.primaryId),
            fileHtml(request, design.id, design.secondId!),
          ]);
          return {
            from: hasNode(from, "meta-source"),
            destination: hasNode(to, "meta-source"),
          };
        })
        .toEqual({ from: false, destination: true });
      await settleReload(page, design.secondId!);
      await expect
        .poll(() => parentId(page, design.secondId!, "meta-source"))
        .not.toBe("meta-target");
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("cross-Screen freeform drops persist through reload", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, {
      secondScreen: true,
      primaryHtml: FREEFORM_CROSS_SCREEN_PRIMARY_HTML,
      secondHtml: FREEFORM_CROSS_SCREEN_SECOND_HTML,
    });
    try {
      await gotoEditor(page, design.id);
      await page.keyboard.press("Shift+1");
      const source = await boxFor(page, design.primaryId, "freeform-source");
      const target = await boxFor(page, design.secondId!, "freeform-target");
      await page.mouse.click(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await expect
        .poll(() => selectionSourceId(request))
        .toBe("freeform-source");
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
          { steps: 30 },
        );
        await expect
          .poll(() => page.locator("[data-cross-screen-drag-ghost]").count())
          .toBeGreaterThan(0);
      } finally {
        await page.mouse.up();
      }
      await expect
        .poll(() => parentId(page, design.secondId!, "freeform-source"))
        .toBe("freeform-target");
      await expect
        .poll(() =>
          designFrame(page, design.secondId!)
            .locator('[data-agent-native-node-id="freeform-source"]')
            .evaluate((node) => getComputedStyle(node).position),
        )
        .toBe("absolute");
      await expect
        .poll(async () => {
          const [from, to] = await Promise.all([
            fileHtml(request, design.id, design.primaryId),
            fileHtml(request, design.id, design.secondId!),
          ]);
          return {
            from: hasNode(from, "freeform-source"),
            destination: hasNode(to, "freeform-source"),
          };
        })
        .toEqual({ from: false, destination: true });
      const droppedHtml = await fileHtml(request, design.id, design.secondId!);
      const droppedStyle =
        droppedHtml.match(
          /data-agent-native-node-id="freeform-source"[^>]*style="([^"]*)"/,
        )?.[1] ?? null;
      expect(droppedStyle).not.toBeNull();
      await settleReload(page, design.secondId!);
      await expect
        .poll(() => parentId(page, design.secondId!, "freeform-source"))
        .toBe("freeform-target");
      await expect
        .poll(() =>
          designFrame(page, design.secondId!)
            .locator('[data-agent-native-node-id="freeform-source"]')
            .evaluate((node) => getComputedStyle(node).position),
        )
        .toBe("absolute");
      const reloadedHtml = await fileHtml(request, design.id, design.secondId!);
      const reloadedStyle =
        reloadedHtml.match(
          /data-agent-native-node-id="freeform-source"[^>]*style="([^"]*)"/,
        )?.[1] ?? null;
      expect(reloadedStyle).toBe(droppedStyle);
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("same-Screen freeform drag keeps held geometry and exact position after reload", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, {
      primaryHtml: MATRIX_HTML,
    });
    try {
      await gotoEditor(page, design.id);
      await page.keyboard.press("Shift+1");
      const source = await boxFor(page, design.primaryId, "free-shape");
      const before = { ...source };
      const orderBefore = (await rootChildren(page, design.primaryId)).map(
        (child) => child.id,
      );
      await page.keyboard.down(COMMAND);
      await page.mouse.click(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.keyboard.up(COMMAND);
      await expect.poll(() => selectionSourceId(request)).toBe("free-shape");
      const dx = 96;
      const dy = 64;
      await page.mouse.move(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.mouse.down();
      try {
        await page.mouse.move(
          source.x + source.width / 2 + 1,
          source.y + source.height / 2 + 1,
          { steps: 1 },
        );
        await page.mouse.move(
          source.x + source.width / 2 + 12,
          source.y + source.height / 2 + 8,
          { steps: 1 },
        );
        await page.mouse.move(
          source.x + source.width / 2 + dx,
          source.y + source.height / 2 + dy,
          {
            steps: 20,
          },
        );
        const held = await boxFor(page, design.primaryId, "free-shape");
        expect([held.x, held.y]).not.toEqual([before.x, before.y]);
      } finally {
        await page.mouse.up();
      }
      const dropped = await boxFor(page, design.primaryId, "free-shape");
      expect([dropped.x, dropped.y]).not.toEqual([before.x, before.y]);
      await settleReload(page, design.primaryId);
      const reloaded = await boxFor(page, design.primaryId, "free-shape");
      expect(reloaded.x).toBeCloseTo(dropped.x, 0);
      expect(reloaded.y).toBeCloseTo(dropped.y, 0);
      await expect
        .poll(async () =>
          (await rootChildren(page, design.primaryId)).map((child) => child.id),
        )
        .toEqual(orderBefore);
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("flow child dragged to free canvas leaves auto layout and persists exact coordinates", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, {
      primaryHtml: FLOW_CHILD_FREE_CANVAS_HTML,
    });
    try {
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
        beforeReleaseHtml = await fileHtml(
          request,
          design.id,
          design.primaryId,
        );
      } finally {
        await page.mouse.up();
      }

      const held = snapshots.find(
        (snapshot) => snapshot.stage === "free-canvas",
      );
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
      await expect
        .poll(logicalRootOrder)
        .toEqual(["flow-origin", "flow-child"]);
      await expect
        .poll(() =>
          designFrame(page, design.primaryId)
            .locator('[data-agent-native-node-id="flow-child"]')
            .evaluate((node) => getComputedStyle(node).position),
        )
        .toBe("absolute");
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
      const reloaded = await boxFor(page, design.primaryId, "flow-child");
      expect(reloaded.x).toBeCloseTo(dropped.x, 0);
      expect(reloaded.y).toBeCloseTo(dropped.y, 0);
      await expect
        .poll(logicalRootOrder)
        .toEqual(["flow-origin", "flow-child"]);
      await expect
        .poll(() =>
          designFrame(page, design.primaryId)
            .locator('[data-agent-native-node-id="flow-child"]')
            .evaluate((node) => getComputedStyle(node).position),
        )
        .toBe("absolute");
    } finally {
      await deleteDesign(request, design.id);
    }
  });

  test("cross-Screen Meta oversized drops preserve absolute inside placement", async ({
    page,
    request,
  }) => {
    const design = await createDesign(request, {
      secondScreen: true,
      primaryHtml: META_CROSS_SCREEN_PRIMARY_HTML,
      secondHtml: META_CROSS_SCREEN_SECOND_HTML,
    });
    try {
      await gotoEditor(page, design.id);
      await page.keyboard.press("Shift+1");
      const source = await boxFor(page, design.primaryId, "meta-source");
      const target = await boxFor(page, design.secondId!, "meta-target");
      await page.keyboard.down(COMMAND);
      await page.mouse.click(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.keyboard.up(COMMAND);
      await expect.poll(() => selectionSourceId(request)).toBe("meta-source");

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
        { steps: 30 },
      );
      const guide = page.locator("[data-cross-screen-drop-guide]");
      await expect
        .poll(() => guide.count(), {
          timeout: 5_000,
          message: "cross-screen Meta drop did not show a held guide",
        })
        .toBeGreaterThan(0);
      const heldGuide = await guide.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          display: style.display,
          width: Number.parseFloat(style.width),
          height: Number.parseFloat(style.height),
        };
      });
      expect(heldGuide.display).not.toBe("none");
      expect(heldGuide.width).toBeGreaterThan(2);
      expect(heldGuide.height).toBeGreaterThan(2);
      await page.mouse.up();
      await page.keyboard.up(COMMAND);

      await expect
        .poll(async () => {
          const [from, to] = await Promise.all([
            fileHtml(request, design.id, design.primaryId),
            fileHtml(request, design.id, design.secondId!),
          ]);
          return {
            from: hasNode(from, "meta-source"),
            destination: hasNode(to, "meta-source"),
          };
        })
        .toEqual({ from: false, destination: true });
      await settleReload(page, design.secondId!);
      await expect
        .poll(() => parentId(page, design.secondId!, "meta-source"))
        .toBe("meta-target");
    } finally {
      await deleteDesign(request, design.id);
    }
  });
});
