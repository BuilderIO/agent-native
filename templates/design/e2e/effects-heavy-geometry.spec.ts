import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { enterDirectMode, gotoEditor } from "./helpers";

const EFFECTS_FIXTURE_HTML = `<!doctype html>
<html data-agent-native-node-id="an-root">
<head><meta charset="utf-8"/><title>Effects Torture TW</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>html,body{margin:0;padding:0;width:1280px;height:800px;background:#0f172a;}</style>
</head>
<body data-agent-native-node-id="an-body" class="relative">
  <div data-agent-native-node-id="an-hero" class="absolute left-0 top-0 w-[1280px] h-[400px] overflow-hidden">
    <div data-agent-native-node-id="an-hero-overlay" class="absolute left-0 top-0 w-[1280px] h-[400px] bg-slate-900/35 backdrop-blur-md"></div>
    <div data-agent-native-node-id="an-hero-title" class="absolute left-16 top-[150px] w-[600px] h-[100px] text-white text-4xl font-bold mix-blend-difference">Effects Torture Screen</div>
  </div>
  <div data-agent-native-node-id="an-card-row" class="absolute left-16 top-[440px] w-[1152px] h-[280px]">
    <div data-agent-native-node-id="an-card-1" class="absolute left-0 top-0 w-[340px] h-[220px] bg-slate-800 rounded-2xl -rotate-6 shadow-2xl">
      <div data-agent-native-node-id="an-card-1-inner" class="absolute left-5 top-5 w-[300px] h-[80px]">
        <div data-agent-native-node-id="an-card-1-deep" class="absolute left-0 top-10 w-[300px] h-[40px]">
          <div data-agent-native-node-id="an-card-1-deeper" class="absolute left-0 top-0 w-[150px] h-[40px] bg-blue-600 rounded-lg">
            <span data-agent-native-node-id="an-card-1-deepest" class="absolute left-2.5 top-2.5 text-white text-xs">Deep nested</span>
          </div>
        </div>
      </div>
    </div>
    <div data-agent-native-node-id="an-card-2" class="absolute left-[380px] top-[30px] w-[340px] h-[220px] bg-violet-600 rounded-2xl rotate-3 mix-blend-screen"></div>
    <div data-agent-native-node-id="an-card-3" class="absolute left-[760px] top-[10px] w-[340px] h-[220px] bg-emerald-600 rounded-2xl -rotate-2 scale-95"></div>
  </div>
  <div data-agent-native-node-id="an-footer-badge" class="absolute left-[1080px] top-[740px] w-[160px] h-[40px] bg-amber-500 rounded-full -rotate-6 flex items-center justify-center text-black font-semibold">Badge</div>
</body>
</html>`;

const CHECKED_NODE_IDS = [
  "an-hero",
  "an-hero-overlay",
  "an-hero-title",
  "an-card-row",
  "an-card-1",
  "an-card-1-inner",
  "an-card-1-deep",
  "an-card-1-deeper",
  "an-card-1-deepest",
  "an-card-2",
  "an-card-3",
  "an-footer-badge",
] as const;

interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  position: string;
  transform: string;
  backdropFilter: string;
  mixBlendMode: string;
}

const READ_GEOMETRY_SCRIPT = (nodeIds: readonly string[]) => {
  const out: Record<string, NodeGeometry | null> = {};
  for (const id of nodeIds) {
    const el = document.querySelector(`[data-agent-native-node-id="${id}"]`);
    if (!el) {
      out[id] = null;
      continue;
    }
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[id] = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      position: cs.position,
      transform: cs.transform,
      backdropFilter: cs.backdropFilter,
      mixBlendMode: cs.mixBlendMode,
    };
  }
  return out;
};

async function postAction(
  request: APIRequestContext,
  baseURL: string,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
      timeout: 60_000,
    },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function createEffectsFixtureDesign(
  page: Page,
  baseURL: string,
): Promise<{ designId: string; fileId: string }> {
  const created = await postAction(page.request, baseURL, "create-design", {
    title: "E2E Effects-Heavy Geometry",
    projectType: "prototype",
  });
  const designId = String(
    created?.id ?? created?.data?.id ?? created?.design?.id ?? "",
  );
  if (!designId) throw new Error("create-design did not return an id");
  const file = await postAction(page.request, baseURL, "create-file", {
    designId,
    filename: "effects-fixture.html",
    content: EFFECTS_FIXTURE_HTML,
    fileType: "html",
  });
  const fileId = String(file?.id ?? "");
  if (!fileId) throw new Error("create-file did not return an id");
  return { designId, fileId };
}

test("effects-heavy screen renders identical geometry in the single-screen canvas and standalone", async ({
  page,
  browser,
}, workerInfo) => {
  test.setTimeout(120_000);
  const baseURL =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
  const { designId, fileId } = await createEffectsFixtureDesign(page, baseURL);

  await gotoEditor(page, designId);
  await enterDirectMode(page, { screenId: fileId });

  const canvasIframe = page
    .locator("iframe[data-design-preview-iframe]")
    .last();
  await expect(canvasIframe).toBeVisible({ timeout: 15_000 });
  const canvasFrameLocator = canvasIframe.contentFrame();
  await expect(
    canvasFrameLocator.locator('[data-agent-native-node-id="an-card-1"]'),
  ).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);

  const canvasIframeHandle = await canvasIframe.elementHandle();
  const canvasFrame = await canvasIframeHandle?.contentFrame();
  if (!canvasFrame)
    throw new Error("design preview iframe has no contentFrame");
  const canvasGeometry = (await canvasFrame.evaluate(
    READ_GEOMETRY_SCRIPT,
    CHECKED_NODE_IDS,
  )) as Record<string, NodeGeometry | null>;

  const standaloneContext = await browser.newContext();
  const standalonePage = await standaloneContext.newPage();
  try {
    await standalonePage.setContent(EFFECTS_FIXTURE_HTML, {
      waitUntil: "networkidle",
    });
    await standalonePage.waitForTimeout(500);
    const standaloneGeometry = (await standalonePage.evaluate(
      READ_GEOMETRY_SCRIPT,
      CHECKED_NODE_IDS,
    )) as Record<string, NodeGeometry | null>;

    for (const id of CHECKED_NODE_IDS) {
      const canvasNode = canvasGeometry[id];
      const standaloneNode = standaloneGeometry[id];
      expect(canvasNode, `${id} missing in canvas render`).not.toBeNull();
      expect(
        standaloneNode,
        `${id} missing in standalone render`,
      ).not.toBeNull();
      if (!canvasNode || !standaloneNode) continue;

      expect(canvasNode.position, `${id} position`).toBe(
        standaloneNode.position,
      );
      expect(
        canvasNode.position,
        `${id} must stay out-of-flow (absolute), not collapse to static/relative`,
      ).toBe("absolute");
      expect(canvasNode.transform, `${id} transform (rotation)`).toBe(
        standaloneNode.transform,
      );
      expect(canvasNode.backdropFilter, `${id} backdrop-filter`).toBe(
        standaloneNode.backdropFilter,
      );
      expect(canvasNode.mixBlendMode, `${id} mix-blend-mode`).toBe(
        standaloneNode.mixBlendMode,
      );
      expect(canvasNode.width, `${id} width`).toBeCloseTo(
        standaloneNode.width,
        0,
      );
      expect(canvasNode.height, `${id} height`).toBeCloseTo(
        standaloneNode.height,
        0,
      );
      // x/y are compared relative to the fixture's own root, not viewport
      // absolute — the canvas iframe may be offset within the app chrome.
    }

    const rootIdCanvas = canvasGeometry["an-hero"];
    const rootIdStandalone = standaloneGeometry["an-hero"];
    expect(rootIdCanvas).not.toBeNull();
    expect(rootIdStandalone).not.toBeNull();
    if (rootIdCanvas && rootIdStandalone) {
      for (const id of CHECKED_NODE_IDS) {
        const canvasNode = canvasGeometry[id];
        const standaloneNode = standaloneGeometry[id];
        if (!canvasNode || !standaloneNode) continue;
        expect(
          canvasNode.x - rootIdCanvas.x,
          `${id} x relative to an-hero`,
        ).toBeCloseTo(standaloneNode.x - rootIdStandalone.x, 0);
        expect(
          canvasNode.y - rootIdCanvas.y,
          `${id} y relative to an-hero`,
        ).toBeCloseTo(standaloneNode.y - rootIdStandalone.y, 0);
      }
    }
  } finally {
    await standaloneContext.close();
  }
});
