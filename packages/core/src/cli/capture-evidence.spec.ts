import fs from "node:fs";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  isPrivateAddress,
  sliceScript,
  sliceStylesheet,
} from "./capture-evidence-source.js";
import {
  captureEvidence,
  parseCaptureEvidenceArgs,
  parseViewport,
  type CaptureEvidenceOptions,
  type EvidenceManifest,
} from "./capture-evidence.js";

const SITE_CSS = `
.orb { width: 80px; height: 80px; background: #39f; animation: pulse 2s linear infinite alternate; }
@keyframes pulse { from { transform: translateX(0); } to { transform: translateX(120px); } }
.footer-unrelated { color: red; }
.banner-ad { display: none; }
`;

const GL_SCRIPT = `
const canvas = document.getElementById("gl");
const gl = canvas.getContext("webgl");
if (!gl) {
  document.getElementById("fallback").hidden = false;
} else {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, "attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }");
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, "precision mediump float; uniform float uTime; uniform vec2 uResolution; void main(){ gl_FragColor = vec4(sin(uTime), uResolution.x / 400., 0., 1.); }");
  gl.compileShader(fs);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uTime = gl.getUniformLocation(prog, "uTime");
  const uRes = gl.getUniformLocation(prog, "uResolution");
  const start = DELAY_MS;
  const t0 = performance.now();
  function frame(now) {
    if (now - t0 >= start) {
      gl.uniform1f(uTime, (now - t0) / 1000);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
`;

function glPage(delayMs: number): string {
  return `<!doctype html><body>
<div id="stage"><canvas id="gl" class="shader-surface" width="400" height="300"></canvas></div>
<p id="fallback" hidden>static fallback image</p>
<script>${GL_SCRIPT.replace("DELAY_MS", String(delayMs))}</script></body>`;
}

const LIBS = Array.from({ length: 10 }, (_, i) => `/lib-${i}.js`);

const routes: Record<string, { type: string; body: string }> = {
  "/css.html": {
    type: "text/html",
    body: `<!doctype html><head><link rel="stylesheet" href="/site.css"></head><body>
<div id="fx" class="orb stage-box"></div><footer class="footer-unrelated">legal</footer>
<script src="/unrelated.js"></script></body>`,
  },
  "/site.css": { type: "text/css", body: SITE_CSS },
  "/unrelated.js": {
    type: "text/javascript",
    body: "window.analyticsReady = true; // absorb nothing",
  },
  "/gl.html": { type: "text/html", body: glPage(0) },
  "/gl-late.html": { type: "text/html", body: glPage(30_000) },
  "/canvas2d.html": {
    type: "text/html",
    body: `<!doctype html><canvas id="c" width="100" height="100"></canvas>
<script>document.getElementById("c").getContext("2d").fillRect(0,0,10,10)</script>`,
  },
  "/many.html": {
    type: "text/html",
    body: `<!doctype html><div id="fx" style="width:40px;height:40px"></div>${LIBS.map((l) => `<script src="${l}"></script>`).join("")}`,
  },
};
for (const lib of LIBS) {
  routes[lib] = { type: "text/javascript", body: `window.lib = "${lib}";` };
}

let server: http.Server;
let base = "";
const sockets = new Set<Socket>();
const outDirs: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/hang.html") return;
    const route = routes[req.url ?? ""];
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": route.type });
    res.end(route.body);
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((resolve) => server.close(resolve));
  for (const dir of outDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function options(
  pagePath: string,
  overrides: Partial<CaptureEvidenceOptions> = {},
): CaptureEvidenceOptions {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-evidence-spec-"));
  outDirs.push(outDir);
  return {
    url: `${base}${pagePath}`,
    viewports: [{ width: 800, height: 600, deviceScaleFactor: 1 }],
    outDir,
    totalBudgetMs: 40_000,
    opBudgetMs: 10_000,
    observeMs: 500,
    observeIntervalMs: 100,
    maxRequests: 100,
    maxResources: 20,
    maxResourceBytes: 1_000_000,
    maxTotalBytes: 4_000_000,
    sliceBytes: 4_000,
    maxSliceTotalBytes: 20_000,
    forceFallback: false,
    allowPrivateNetwork: true,
    ...overrides,
  };
}

function op(m: EvidenceManifest, name: string) {
  return m.operations.find((o) => o.name === name);
}

describe("capture-evidence browser fixtures", () => {
  it("captures a CSS animation with actual geometry and a relevant source slice", async () => {
    const m = await captureEvidence(
      options("/css.html", {
        selector: "#fx",
        viewports: [{ width: 800, height: 600, deviceScaleFactor: 2 }],
      }),
    );
    const vp = m.viewports[0] as any;
    expect(m.outcome).toBe("complete");
    expect(vp.actual.devicePixelRatio).toBe(2);
    expect(vp.actual.innerWidth).toBe(800);
    expect(vp.actual.screenshotPx).toEqual({ width: 1600, height: 1200 });
    expect(vp.effect.kinds).toContain("css-animation");
    expect(vp.animations.items[0]).toMatchObject({
      kind: "CSSAnimation",
      name: "pulse",
    });
    expect(vp.motion.animationsAdvancing).toBe(true);
    expect(vp.motion.live).toBe(true);
    expect(vp.effect.gpu.status).toBe("not-applicable");
    expect(vp.selection.element.rect.width).toBe(80);

    const slice = m.sourceSlices.find((s: any) =>
      s.resourceUrl.endsWith("/site.css"),
    ) as any;
    const text = fs.readFileSync(
      path.join(m.manifestPath, "..", slice.file),
      "utf8",
    );
    expect(text).toContain("@keyframes pulse");
    expect(text).not.toContain("footer-unrelated");
    expect(slice.resourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      m.sourceSlices.some((s: any) => s.resourceUrl.endsWith("unrelated.js")),
    ).toBe(false);

    for (const capture of vp.captures) {
      expect(fs.existsSync(path.join(m.manifestPath, "..", capture.path))).toBe(
        true,
      );
    }
    expect(m.cleanup).toMatchObject({ browserClosed: true });
  }, 60_000);

  it("reads live GPU uniforms and time facts from a WebGL canvas", async () => {
    const m = await captureEvidence(
      options("/gl.html", { selector: "#stage" }),
    );
    const vp = m.viewports[0] as any;
    expect(vp.effect.gpu.status).toBe("live");
    const canvas = vp.effect.gpu.canvases[0];
    expect(Object.keys(canvas.uniforms)).toEqual(
      expect.arrayContaining(["uTime", "uResolution"]),
    );
    expect(canvas.uniforms.uResolution.values).toEqual([400, 300]);
    expect(canvas.draws).toBeGreaterThan(0);
    expect(vp.motion.uniformsChanged).toContain("uTime");
    expect(vp.navigation.readiness.reason).toBe("gpu-draw-observed");
    expect((m.capability as any).webgl.available).toBe(true);
  }, 60_000);

  it("reports a forced no-WebGL run as a static fallback, not an empty live capture", async () => {
    const m = await captureEvidence(
      options("/gl.html", { selector: "#stage", forceFallback: true }),
    );
    const vp = m.viewports[0] as any;
    expect(m.capability).toMatchObject({
      status: "webgl-unavailable",
      forcedFallback: true,
    });
    expect(vp.effect.gpu.status).toBe("static-fallback");
    expect(vp.effect.kinds).toContain("gpu-static-fallback");
    expect(vp.effect.gpu.canvases[0].uniforms).toBeUndefined();
    expect(op(m, "classify-gpu")?.status).toBe("unsupported");
    expect(m.outcome).toBe("partial");
  }, 60_000);

  it("distinguishes unsupported introspection (2D canvas) from an absent selection", async () => {
    const unsupported = await captureEvidence(
      options("/canvas2d.html", { selector: "#c" }),
    );
    expect((unsupported.viewports[0] as any).effect.gpu.status).toBe(
      "context-not-observed",
    );
    expect(op(unsupported, "classify-gpu")?.status).toBe("unsupported");

    const absent = await captureEvidence(
      options("/css.html", { selector: "#does-not-exist" }),
    );
    const vp = absent.viewports[0] as any;
    expect(vp.selection).toMatchObject({ present: false, matchCount: 0 });
    expect(op(absent, "probe-selection")?.status).toBe("partial");
    expect(op(absent, "wait-ready")?.status).toBe("timeout");
    expect(absent.outcome).toBe("failed");
  }, 60_000);

  it("keeps one browser session across viewports and reports each actual geometry", async () => {
    const m = await captureEvidence(
      options("/css.html", {
        selector: "#fx",
        viewports: [
          { width: 1000, height: 700, deviceScaleFactor: 1 },
          { width: 390, height: 800, deviceScaleFactor: 3 },
        ],
      }),
    );
    expect(
      m.operations.filter((o) => o.name === "launch-browser"),
    ).toHaveLength(1);
    const [a, b] = m.viewports as any[];
    expect(a.actual).toMatchObject({ innerWidth: 1000, devicePixelRatio: 1 });
    expect(b.actual).toMatchObject({ innerWidth: 390, devicePixelRatio: 3 });
    expect(b.actual.screenshotPx).toEqual({ width: 1170, height: 2400 });
    expect(b.reusedEvidenceFrom).toBe("1000x700@1");
    const siteCss = (m.resources as any).items.find((r: any) =>
      r.url.endsWith("/site.css"),
    );
    expect(siteCss.seenInViewports).toHaveLength(2);
    expect((m.resources as any).bodiesHashed).toBe(
      (m.resources as any).items.filter((r: any) => r.bodyStatus === "hashed")
        .length,
    );
  }, 60_000);

  it("bounds resource collection by body count and request cap", async () => {
    const bodies = await captureEvidence(
      options("/many.html", { selector: "#fx", maxResources: 3 }),
    );
    const items = (bodies.resources as any).items as any[];
    expect((bodies.resources as any).bodiesHashed).toBe(3);
    expect(
      items.filter((r) => r.bodyStatus === "skipped-budget").length,
    ).toBeGreaterThan(0);
    expect(op(bodies, "collect-resources")?.status).toBe("partial");
    expect(bodies.outcome).toBe("partial");

    const capped = await captureEvidence(
      options("/many.html", { selector: "#fx", maxRequests: 4 }),
    );
    expect((capped.resources as any).blocked.overRequestCap).toBeGreaterThan(0);
    expect(capped.uncertainty.join(" ")).toContain("request cap");
  }, 60_000);

  it("returns a partial result and cleans up when the effect never becomes ready", async () => {
    const m = await captureEvidence(
      options("/gl-late.html", {
        selector: "#stage",
        opBudgetMs: 1_500,
        observeMs: 0,
      }),
    );
    const vp = m.viewports[0] as any;
    expect(op(m, "wait-ready")?.status).toBe("timeout");
    expect(vp.navigation.readiness.reason).toBe("waiting-for-first-draw");
    expect(vp.effect.gpu.status).toBe("context-without-draws");
    expect(op(m, "classify-gpu")?.status).toBe("partial");
    expect(m.outcome).toBe("partial");
    expect(m.cleanup).toMatchObject({ browserClosed: true });
  }, 60_000);

  it("fails with a timed-out navigation instead of reporting empty success", async () => {
    const m = await captureEvidence(
      options("/hang.html", { opBudgetMs: 1_500, totalBudgetMs: 6_000 }),
    );
    expect(op(m, "navigate")?.status).toMatch(/timeout|error/);
    expect(m.outcome).toBe("failed");
    expect(m.cleanup).toMatchObject({ browserClosed: true });
    expect(fs.existsSync(m.manifestPath)).toBe(true);
  }, 60_000);

  it("skips later operations once the total budget is exhausted", async () => {
    const m = await captureEvidence(
      options("/css.html", {
        selector: "#fx",
        totalBudgetMs: 1_000,
        viewports: [
          { width: 800, height: 600, deviceScaleFactor: 1 },
          { width: 500, height: 600, deviceScaleFactor: 1 },
        ],
      }),
    );
    expect(m.outcome).not.toBe("complete");
    expect(
      m.operations.some(
        (o) => o.status === "skipped" || o.status === "timeout",
      ),
    ).toBe(true);
  }, 60_000);

  it("blocks loopback hosts unless explicitly allowed", async () => {
    const m = await captureEvidence(
      options("/css.html", { allowPrivateNetwork: false, opBudgetMs: 3_000 }),
    );
    expect(m.outcome).toBe("failed");
    expect((m.resources as any).blocked.privateOrLoopbackHosts).toContain(
      "127.0.0.1",
    );
  }, 60_000);

  it("refuses an evidence dir inside the destination", async () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "an-dest-"));
    outDirs.push(dest);
    await expect(
      captureEvidence(
        options("/css.html", {
          destination: dest,
          outDir: path.join(dest, "evidence"),
        }),
      ),
    ).rejects.toThrow(/outside --destination/);
  });
});

describe("capture-evidence helpers", () => {
  it("parses viewports and rejects out-of-range input", () => {
    expect(parseViewport("1440x900")).toEqual({
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    });
    expect(parseViewport("390x844@3").deviceScaleFactor).toBe(3);
    expect(() => parseViewport("10x10")).toThrow();
    expect(() => parseViewport("800x600@9")).toThrow();
  });

  it("requires a url, defaults a viewport and rejects unknown flags", () => {
    expect(() => parseCaptureEvidenceArgs([])).toThrow(/--url/);
    expect(() =>
      parseCaptureEvidenceArgs(["--url", "https://a.test", "--x"]),
    ).toThrow(/Unknown/);
    const parsed = parseCaptureEvidenceArgs([
      "--url=https://a.test",
      "--viewport",
      "390x844@2",
    ]);
    expect("options" in parsed && parsed.options.viewports).toHaveLength(1);
  });

  it("slices CSS to matching rules only and matches whole identifiers", () => {
    const css =
      ".orb{a:1}.orbit{b:2}@media (min-width:1px){.orb{c:3}}.other{d:4}";
    const result = sliceStylesheet(css, ["orb"], 1000);
    const text = result.slices.map((s) => s.text).join("|");
    expect(text).toContain(".orb{a:1}");
    expect(text).toContain("@media");
    expect(text).not.toContain(".orbit");
    expect(text).not.toContain(".other");
  });

  it("windows script around term hits and enforces the byte cap", () => {
    const script = `${"x".repeat(500)} initHero(); ${"y".repeat(500)} absorb ${"z".repeat(500)}`;
    const hit = sliceScript(script, ["initHero"], 20, 1000);
    expect(hit.slices).toHaveLength(1);
    expect(hit.slices[0].text).toContain("initHero");
    expect(hit.slices[0].text.length).toBeLessThan(80);
    expect(sliceScript(script, ["orb"], 20, 1000).hits).toBe(0);
    const capped = sliceScript("aaa ".repeat(200), ["aaa"], 40, 50);
    expect(capped.truncated).toBe(true);
    expect(
      capped.slices.reduce((n, s) => n + s.text.length, 0),
    ).toBeLessThanOrEqual(50);
  });

  it("classifies private and public addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.1",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["93.184.216.34", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});
