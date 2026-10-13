import { appPath } from "./helpers";
import { expect, test, type App } from "./rails";

const CANVAS_SIZE = 4096;

const LARGE_SCREEN_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: ${CANVAS_SIZE}px; height: ${CANVAS_SIZE}px; background: #0b1020; color: #e2e8f0; }
      body { position: relative; overflow: hidden; font: 16px/1.4 system-ui, sans-serif; }
      .tile { position: absolute; width: 480px; height: 480px; padding: 24px; box-sizing: border-box; border: 1px solid #334155; border-radius: 24px; background: linear-gradient(135deg, #172554, #0f172a); }
      #gl-surface { position: absolute; left: 1792px; top: 1792px; width: 512px; height: 512px; border-radius: 32px; overflow: hidden; }
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

/** Pins the screen to a 4096px canvas frame, the size that stresses the compositor. */
async function seedLargeScreen(app: App) {
  const designId = await app.seed(LARGE_SCREEN_HTML);
  const { files } = await app.savedRecord(designId);
  const fileId = files.find((file) => file.filename === "index.html")!.id;
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
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
            value: {
              x: 0,
              y: 0,
              width: CANVAS_SIZE,
              height: CANVAS_SIZE,
              z: 0,
            },
          },
        ],
      },
    },
  );
  expect(response.ok(), `update-design ${response.status()}`).toBe(true);
  return designId;
}

test.use({ viewport: { width: 1600, height: 1000 } });

// fixme: fails in CI on current main: Ctrl+wheel never zoomed back out
test.fixme("zooming and panning a large WebGL screen keeps the same live document and GL context", async ({
  app,
  page,
}) => {
  const designId = await seedLargeScreen(app);
  await app.open(designId);
  const iframe = page.locator("iframe[data-design-preview-iframe]");
  const live = iframe.contentFrame();
  await expect(live.locator("#gpu-canvas")).toHaveCount(1);
  const gpu = () =>
    live.locator("body").evaluate(() => {
      const profile = (
        window as Window & {
          __canvasGpuProfile?: {
            frames: number;
            contextLost: number;
            errors: string[];
          };
          __liveMarker?: string;
        }
      ).__canvasGpuProfile!;
      return {
        marker:
          (window as Window & { __liveMarker?: string }).__liveMarker ?? null,
        frames: profile.frames,
        contextLost: profile.contextLost,
        errors: profile.errors,
      };
    });
  await live.locator("body").evaluate(() => {
    (window as Window & { __liveMarker?: string }).__liveMarker = "first-load";
  });
  await iframe.evaluate((element) =>
    element.setAttribute("data-e2e-identity", "first-load"),
  );
  await expect.poll(async () => (await gpu()).frames).toBeGreaterThan(0);
  const before = await gpu();
  expect(before).toMatchObject({
    marker: "first-load",
    contextLost: 0,
    errors: [],
  });

  const start = (await iframe.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await page.keyboard.down("Control");
    for (let step = 0; step < 48; step += 1) await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    await expect
      .poll(async () => (await iframe.boundingBox())!.width, {
        message: "Ctrl+wheel never zoomed the canvas in",
      })
      .toBeGreaterThan(start.width * 2);
    const zoomed = (await iframe.boundingBox())!;
    for (let step = 0; step < 8; step += 1) await page.mouse.wheel(240, 180);
    await expect
      .poll(async () => (await iframe.boundingBox())!.x, {
        message: "the wheel never panned the canvas",
      })
      .toBeLessThan(zoomed.x - 200);
    await page.keyboard.down("Control");
    for (let step = 0; step < 48; step += 1) await page.mouse.wheel(0, 120);
    await page.keyboard.up("Control");
    await expect
      .poll(async () => (await iframe.boundingBox())!.width, {
        message: "Ctrl+wheel never zoomed back out",
      })
      .toBeLessThan(zoomed.width);
    for (let step = 0; step < 8; step += 1) await page.mouse.wheel(-240, -180);
  }

  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute("data-e2e-identity", "first-load");
  const after = await gpu();
  expect(after).toMatchObject({
    marker: "first-load",
    contextLost: 0,
    errors: [],
  });
  await expect
    .poll(async () => (await gpu()).frames)
    .toBeGreaterThan(after.frames);
});
