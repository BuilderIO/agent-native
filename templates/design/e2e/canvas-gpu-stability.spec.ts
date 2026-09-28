import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, enterInteractView } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const CANVAS_SIZE = 4096;

const LARGE_SCREEN_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: ${CANVAS_SIZE}px; height: ${CANVAS_SIZE}px; background: #0b1020; color: #e2e8f0; }
      body { position: relative; overflow: hidden; font: 16px/1.4 system-ui, sans-serif; }
      .tile { position: absolute; width: 480px; height: 480px; padding: 24px; box-sizing: border-box; border: 1px solid #334155; border-radius: 24px; background: linear-gradient(135deg, #172554, #0f172a); }
      #gl-surface { left: 1792px; top: 1792px; width: 512px; height: 512px; border-radius: 32px; overflow: hidden; }
      #gl-surface canvas { display: block; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div class="tile" style="left:128px;top:128px"><h1>Northwest</h1><p>Large canvas stability fixture</p></div>
    <div class="tile" style="left:3488px;top:128px"><h1>Northeast</h1><p>Large canvas stability fixture</p></div>
    <div class="tile" style="left:128px;top:3488px"><h1>Southwest</h1><p>Large canvas stability fixture</p></div>
    <div class="tile" style="left:3488px;top:3488px"><h1>Southeast</h1><p>Large canvas stability fixture</p></div>
    <div id="gl-surface"><canvas id="gpu-canvas" width="1024" height="1024"></canvas></div>
    <script>
      (() => {
        const canvas = document.getElementById("gpu-canvas");
        const state = { frames: 0, contextLost: 0, errors: [] };
        window.__canvasGpuProfile = state;
        const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
        if (!gl) { state.errors.push("webgl-unavailable"); return; }
        canvas.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          state.contextLost += 1;
        });
        const vertex = gl.createShader(gl.VERTEX_SHADER);
        const fragment = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(vertex, "attribute vec2 p; void main(){ gl_Position=vec4(p,0.0,1.0); }");
        gl.shaderSource(fragment, "precision mediump float; uniform float t; void main(){ vec2 p=gl_FragCoord.xy/1024.0; gl_FragColor=vec4(p.x, p.y, 0.35+0.2*sin(t), 1.0); }");
        gl.compileShader(vertex); gl.compileShader(fragment);
        const program = gl.createProgram();
        gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, "p");
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        const time = gl.getUniformLocation(program, "t");
        const frame = (now) => {
          if (gl.isContextLost()) return;
          gl.uniform1f(time, now / 1000); gl.drawArrays(gl.TRIANGLES, 0, 3);
          state.frames += 1;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      })();
    </script>
  </body>
</html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${BASE_URL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createLargeScreen(request: APIRequestContext) {
  const design = await action(request, "create-design", {
    title: `Canvas GPU stability ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = String(
    design.id ?? design.data?.id ?? design.design?.id ?? "",
  );
  if (!designId) throw new Error("create-design returned no id");
  const file = await action(request, "create-file", {
    designId,
    filename: "large-screen.html",
    content: LARGE_SCREEN_HTML,
    fileType: "html",
  });
  const fileId = String(file.id ?? file.data?.id ?? "");
  if (!fileId) throw new Error("create-file returned no id");
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: {
          sourceType: "inline",
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
        },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: CANVAS_SIZE, height: CANVAS_SIZE, z: 0 },
      },
    ],
  });
  return { designId, fileId };
}

async function installProfile(page: Page) {
  await page.addInitScript(() => {
    const state = {
      longTasks: [] as number[],
    };
    (window as any).__canvasGpuHostProfile = state;
    if (typeof PerformanceObserver !== "undefined") {
      try {
        new PerformanceObserver((list) => {
          state.longTasks.push(
            ...list.getEntries().map((entry) => entry.duration),
          );
        }).observe({ type: "longtask", buffered: true });
      } catch {
        // Long-task entries are optional; the DOM/WebGL sentinels still run.
      }
    }
  });
}

async function sample(page: Page, fileId: string) {
  return page.evaluate((id) => {
    const iframes = [
      ...document.querySelectorAll<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      ),
    ];
    const iframe =
      iframes.find((candidate) => candidate.dataset.screenIframeId === id) ??
      iframes[0];
    const profile = iframe?.contentWindow
      ? (
          iframe.contentWindow as Window & {
            __canvasGpuProfile?: {
              frames: number;
              contextLost: number;
              errors: string[];
            };
          }
        ).__canvasGpuProfile
      : undefined;
    const rect = iframe?.getBoundingClientRect();
    const host = window as Window & {
      __canvasGpuIframeIdentity?: WeakMap<HTMLIFrameElement, string>;
      __canvasGpuIframeIdentityCounter?: number;
    };
    host.__canvasGpuIframeIdentity ??= new WeakMap();
    let iframeIdentity = iframe
      ? host.__canvasGpuIframeIdentity.get(iframe)
      : undefined;
    if (iframe && !iframeIdentity) {
      host.__canvasGpuIframeIdentityCounter =
        (host.__canvasGpuIframeIdentityCounter ?? 0) + 1;
      iframeIdentity = `iframe-${host.__canvasGpuIframeIdentityCounter}`;
      host.__canvasGpuIframeIdentity.set(iframe, iframeIdentity);
    }
    return {
      iframeCount: iframes.length,
      iframeIdentity: iframeIdentity ?? null,
      iframeReady: iframe?.contentDocument?.readyState ?? null,
      iframeRect: rect
        ? {
            width: rect.width,
            height: rect.height,
            left: rect.left,
            top: rect.top,
          }
        : null,
      webglFrames: profile?.frames ?? null,
      webglContextLost: profile?.contextLost ?? null,
      webglErrors: profile?.errors ?? [],
      appVisible: document.visibilityState === "visible",
      bodySize: {
        width: document.body.scrollWidth,
        height: document.body.scrollHeight,
      },
    };
  }, fileId);
}

async function exerciseGesture(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(point.x, point.y);
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await page.keyboard.down("Control");
    for (let step = 0; step < 48; step += 1) {
      await page.mouse.wheel(0, -120);
    }
    await page.keyboard.up("Control");
    for (let step = 0; step < 8; step += 1) {
      await page.mouse.wheel(240, 180);
    }
    await page.keyboard.down("Control");
    for (let step = 0; step < 48; step += 1) {
      await page.mouse.wheel(0, 120);
    }
    await page.keyboard.up("Control");
    for (let step = 0; step < 8; step += 1) {
      await page.mouse.wheel(-240, -180);
    }
  }
  await page.waitForTimeout(800);
}

async function captureHealthScreenshot(page: Page, label: string) {
  const artifactDir = path.resolve(
    process.cwd(),
    "../../.tmp/canvas-gpu-profile",
  );
  await mkdir(artifactDir, { recursive: true });
  const screenshot = await page.screenshot({
    path: path.join(artifactDir, `${label}.png`),
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
  return screenshot.byteLength;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("large canvas keeps its WebGL context and app viewport healthy through zoom/pan", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await installProfile(page);
  const { designId, fileId } = await createLargeScreen(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview`), {
      waitUntil: "domcontentloaded",
    });
    const screen = page.locator(`iframe[data-screen-iframe-id="${fileId}"]`);
    await expect(screen).toBeVisible({ timeout: 40_000 });
    await expect
      .poll(() => screen.contentFrame()?.locator("#gpu-canvas").count())
      .toBe(1);
    const overviewCard = await page
      .locator("[data-screen-card]")
      .first()
      .boundingBox();
    if (!overviewCard) throw new Error("large overview card is not measurable");
    const overviewPoint = {
      x: overviewCard.x + overviewCard.width / 2,
      y: overviewCard.y + overviewCard.height / 2,
    };
    const beforeOverview = await sample(page, fileId);
    const overviewIdentity = beforeOverview.iframeIdentity;
    await exerciseGesture(page, overviewPoint);
    const afterOverview = await sample(page, fileId);
    expect(afterOverview.iframeIdentity).toBe(overviewIdentity);
    expect(afterOverview.iframeReady).toBe("complete");
    expect(afterOverview.webglErrors).toEqual([]);
    expect(afterOverview.webglContextLost).toBe(0);
    expect(afterOverview.webglFrames).toBeGreaterThan(
      beforeOverview.webglFrames ?? 0,
    );
    expect(afterOverview.appVisible).toBe(true);
    const overviewScreenshotBytes = await captureHealthScreenshot(
      page,
      "after-overview",
    );

    await enterInteractView(page, { screenId: fileId });
    const interactIframe = page
      .locator("iframe[data-design-preview-iframe]")
      .last();
    await expect(interactIframe).toBeVisible({ timeout: 20_000 });
    const interactBox = await interactIframe.boundingBox();
    if (!interactBox)
      throw new Error("large interact iframe is not measurable");
    const beforeInteract = await sample(page, fileId);
    const interactIdentity = beforeInteract.iframeIdentity;
    await exerciseGesture(page, {
      x: interactBox.x + Math.min(400, interactBox.width / 2),
      y: interactBox.y + Math.min(400, interactBox.height / 2),
    });
    const afterInteract = await sample(page, fileId);
    expect(afterInteract.iframeIdentity).toBe(interactIdentity);
    expect(afterInteract.iframeReady).toBe("complete");
    expect(afterInteract.webglErrors).toEqual([]);
    expect(afterInteract.webglContextLost).toBe(0);
    expect(afterInteract.webglFrames).toBeGreaterThan(
      beforeInteract.webglFrames ?? 0,
    );
    expect(afterInteract.appVisible).toBe(true);
    const interactScreenshotBytes = await captureHealthScreenshot(
      page,
      "after-interact",
    );

    const hostProfile = await page.evaluate(
      () => (window as any).__canvasGpuHostProfile,
    );
    console.info(
      `[canvas-gpu-profile] ${JSON.stringify({
        beforeOverview,
        afterOverview,
        beforeInteract,
        afterInteract,
        longTaskCount: hostProfile.longTasks.length,
        longestLongTaskMs: Math.round(Math.max(0, ...hostProfile.longTasks)),
        totalLongTaskMs: Math.round(
          hostProfile.longTasks.reduce(
            (sum: number, value: number) => sum + value,
            0,
          ),
        ),
        overviewScreenshotBytes,
        interactScreenshotBytes,
      })}`,
    );
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
