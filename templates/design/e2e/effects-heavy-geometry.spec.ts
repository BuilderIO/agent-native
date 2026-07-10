import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { enterDirectMode, gotoEditor } from "./helpers";

/**
 * Regression coverage for a field report (W3 torture campaign): an
 * effects-heavy screen (absolutely-positioned elements, rotation,
 * backdrop-filter, mix-blend-mode, deep nesting, object-fit) allegedly
 * rendered severely degraded in the live single-screen canvas — absolutely
 * positioned elements collapsing into stacked flow layout — reproduced
 * identically in the export pipeline, which pointed at a shared
 * canvas/embedded-frame rendering path rather than export-specific code.
 *
 * The original repro fixture lived on a throwaway dev DB and was not
 * recoverable. This spec rebuilds an equivalent effects-heavy fixture and
 * asserts, node by node, that the SAME persisted HTML renders with identical
 * geometry (position, size, rotation, backdrop-filter, mix-blend-mode)
 * whether it's:
 *   (a) embedded live in the single-screen design canvas, or
 *   (b) rendered completely standalone (a bare page with no app chrome).
 * A future regression in the canvas/embedded-frame document construction
 * (missing wrapper style, a CSS reset difference, a stripped script) would
 * show up here as a geometry mismatch between (a) and (b).
 */

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

// Nodes checked for geometry parity. Includes top-level, rotated, blended,
// and deeply-nested absolutely-positioned elements.
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

/** Reads geometry/computed-style for every checked node inside `doc`. */
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
    (workerInfo.project.use.baseURL as string | undefined) ??
    "http://127.0.0.1:9333";
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
  // Let webfont/Tailwind-CDN styling settle before measuring.
  await page.waitForTimeout(500);

  // FrameLocator has no `.evaluate` (only Locator/Frame do) — resolve the
  // underlying element handle to get a real Frame to evaluate script in.
  const canvasIframeHandle = await canvasIframe.elementHandle();
  const canvasFrame = await canvasIframeHandle?.contentFrame();
  if (!canvasFrame)
    throw new Error("design preview iframe has no contentFrame");
  const canvasGeometry = (await canvasFrame.evaluate(
    READ_GEOMETRY_SCRIPT,
    CHECKED_NODE_IDS,
  )) as Record<string, NodeGeometry | null>;

  // Render the exact same persisted HTML with zero app chrome, in a fresh
  // browser context so there is no shared state with the editor at all.
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

      // The canvas wraps content in its own document at a possibly different
      // zoom/scale, but this fixture is always measured at 100% (see
      // enterDirectMode), so absolute geometry should match closely.
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

    // Relative geometry check: every checked node's position/size RELATIVE
    // to the hero root must match between canvas and standalone, which is
    // robust to any outer iframe offset while still catching a layout
    // collapse (a flow-layout regression changes relative deltas, not just
    // absolute viewport coordinates).
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
