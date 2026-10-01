#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
// Measures Content page loads the way the startup acceptance defines them:
// body visible (Element Timing "content-body"), usable sidebar (first Files
// root row, "sidebar-files-row"), and editable ("content-editable" mark), plus
// every framework request with its Server-Timing. The Resource Timing buffer is
// raised by an init script, before the page's first subresource, because a
// Content load makes more requests than the default 250-entry buffer holds.
//
//   node scripts/trace-startup.mjs --base-url http://127.0.0.1:8080 \
//     --email perf-owner@example.local --password '...' \
//     --state cached --path /home --runs 10 [--out .tmp/trace.json]
//
// States: cached (same browser profile, warm HTTP cache), hard (the same warm
// profile with the HTTP cache bypassed, like a hard refresh), warm-network (a
// fresh profile per run), in-app (load --path, then click the sidebar row that
// links to --click-path and time the new document).
//
// Layout stability: --stability follows every element marked
// `data-startup-anchor` (the title, the body, the sidebar's Search row, section
// headers, and first Files row, on placeholders and real elements alike) on
// every animation frame from the first frame it appears, and reports how far
// each moved. A run fails when any anchor moves more than --max-shift pixels
// (default 2). The script exits 1 when any run fails, and 2 when a run found
// no anchors to follow. The layout-shift score cannot replace this: it ignores
// placeholders that are removed and replaced, which is most loading jank.
//
//   --frames <dir>         save every screencast frame per run, with an index
//                          and an ffmpeg concat list, for frame-by-frame review
//   --latency-ms <n>       delay each framework request by n ms, plus up to
//   --jitter-ms <n>        n ms at random, so reads land in different orders on
//                          a local server (request routing also bypasses the
//                          HTTP cache, so keep these off for hosted runs)
//   --viewport 1440x900    the browser viewport
//   --local-storage <json> local storage entries written before every load,
//                          like '{"sidebar-width":"320"}' or
//                          '{"content.sidebar.collapsed":"true"}'
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const next = process.argv[i + 1];
  if (next !== undefined && !next.startsWith("--")) {
    args.set(arg.slice(2), next);
    i += 1;
  } else {
    args.set(arg.slice(2), "true");
  }
}

const baseUrl = (args.get("base-url") ?? "").replace(/\/+$/, "");
if (!baseUrl) throw new Error("--base-url is required");
const state = args.get("state") ?? "cached";
const path = args.get("path") ?? "/home";
const clickPath = args.get("click-path");
const runs = Number(args.get("runs") ?? 10);
const settleMs = Number(args.get("settle-ms") ?? 8000);
const timeoutMs = Number(args.get("timeout-ms") ?? 30000);
const outPath = args.get("out");
const stability = args.get("stability") === "true";
const maxShift = Number(args.get("max-shift") ?? 2);
const framesDir = args.get("frames");
const latencyMs = Number(args.get("latency-ms") ?? 0);
const jitterMs = Number(args.get("jitter-ms") ?? 0);
const localStorageEntries = JSON.parse(args.get("local-storage") ?? "{}");
const [viewportWidth, viewportHeight] = (args.get("viewport") ?? "1440x900")
  .split("x")
  .map(Number);
if (!viewportWidth || !viewportHeight) {
  throw new Error("--viewport must look like 1440x900");
}
if (!["cached", "hard", "warm-network", "in-app"].includes(state)) {
  throw new Error(`Unknown --state ${state}`);
}
if (state === "in-app" && !clickPath) {
  throw new Error("--state in-app needs --click-path /page/<id>");
}

const require = createRequire(
  resolve(import.meta.dirname, "../../../package.json"),
);
const { chromium } = require("@playwright/test");

async function sessionCookies() {
  const raw = args.get("cookie");
  if (raw) return raw;
  const email = args.get("email");
  const password = args.get("password");
  if (!email || !password) {
    throw new Error("Pass --cookie or --email and --password");
  }
  const response = await fetch(`${baseUrl}/_agent-native/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  if (!response.ok) {
    throw new Error(
      `Login failed (${response.status}): ${await response.text()}`,
    );
  }
  // The first-run cookie marks a brand-new sign-up; a returning user's
  // browser no longer carries it.
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((cookie) => !cookie.startsWith("agent-native-first-run="))
    .join("; ");
}

function toPlaywrightCookies(header) {
  const url = new URL(baseUrl);
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      return {
        name: part.slice(0, index),
        value: part.slice(index + 1),
        domain: url.hostname,
        path: "/",
        secure: url.protocol === "https:",
        httpOnly: false,
        sameSite: "Lax",
      };
    });
}

// Runs in the page before any of its own scripts.
function installProbe(options) {
  performance.setResourceTimingBufferSize(5000);
  const trace = { elements: [], anchors: {} };
  window.__startupTrace = trace;
  if (options?.stability) {
    // Animation-frame callbacks run just before each paint, so each sample is
    // where the anchor is drawn in that frame. The first sample is the anchor's
    // reference position; the placeholder and the real element share a name.
    const sample = () => {
      const now = Math.round(performance.now());
      const seen = new Set();
      for (const element of document.querySelectorAll(
        "[data-startup-anchor]",
      )) {
        const name = element.getAttribute("data-startup-anchor");
        if (seen.has(name)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        seen.add(name);
        const x = Math.round(rect.left);
        const y = Math.round(rect.top);
        let anchor = trace.anchors[name];
        if (!anchor) {
          anchor = { firstAt: now, x, y, lastX: x, lastY: y, maxShift: 0 };
          anchor.moves = [];
          trace.anchors[name] = anchor;
        }
        if (x !== anchor.lastX || y !== anchor.lastY) {
          anchor.moves.push({ t: now, x, y });
          anchor.lastX = x;
          anchor.lastY = y;
        }
        anchor.maxShift = Math.max(
          anchor.maxShift,
          Math.abs(x - anchor.x),
          Math.abs(y - anchor.y),
        );
      }
      if (now < 30000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        trace.elements.push({
          identifier: entry.identifier,
          time: entry.renderTime || entry.loadTime,
        });
      }
    }).observe({ type: "element", buffered: true });
  } catch {
    trace.elementTimingUnsupported = true;
  }
  // Builds deployed before the app's own startup marks still get observed
  // milestones: a newly mounted editor with text, and ten sidebar page links.
  const seenEditors = new WeakSet();
  let sidebarSeen = false;
  const observe = () => {
    for (const editor of document.querySelectorAll(".ProseMirror")) {
      if (seenEditors.has(editor) || !editor.textContent.trim()) continue;
      seenEditors.add(editor);
      performance.mark("trace:body-dom", {
        detail: { documentId: location.pathname.split("/").pop() },
      });
    }
    if (
      !sidebarSeen &&
      document.querySelectorAll('nav a[href^="/page/"]').length >= 10
    ) {
      sidebarSeen = true;
      performance.mark("trace:sidebar-dom");
    }
  };
  new MutationObserver(observe).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}

function collect([since, documentId]) {
  const trace = window.__startupTrace ?? { elements: [] };
  const first = (identifier) =>
    trace.elements
      .filter((entry) => entry.identifier === identifier && entry.time >= since)
      .map((entry) => entry.time)
      .sort((a, b) => a - b)[0];
  const mark = (name) =>
    performance
      .getEntriesByName(name, "mark")
      .filter(
        (entry) =>
          entry.startTime >= since &&
          (!documentId || entry.detail?.documentId === documentId),
      )
      .map((entry) => entry.startTime)
      .sort((a, b) => a - b)[0];
  const requests = performance
    .getEntriesByType("resource")
    .filter(
      (entry) =>
        entry.startTime >= since && entry.name.includes("/_agent-native/"),
    )
    .map((entry) => {
      const url = new URL(entry.name);
      const timing = Object.fromEntries(
        entry.serverTiming.map((item) => [
          item.name,
          Math.round(item.duration),
        ]),
      );
      return {
        path: url.pathname.replace(/^.*\/_agent-native\//, ""),
        search: url.search,
        start: Math.round(entry.startTime - since),
        end: Math.round(entry.responseEnd - since),
        bytes: entry.encodedBodySize,
        timing,
      };
    });
  const at = (value) =>
    value === undefined ? null : Math.round(value - since);
  return {
    timeOrigin: performance.timeOrigin,
    visibility: document.visibilityState,
    elementTimingUnsupported: Boolean(trace.elementTimingUnsupported),
    bodyElement: at(first("content-body")),
    bodyPainted: at(mark("content-body-dom:painted")),
    bodyDom: at(mark("content-body-dom")),
    bodyObserved: at(mark("trace:body-dom")),
    sidebarElement: at(first("sidebar-files-row")),
    sidebarPainted: at(mark("sidebar-files-rows-dom:painted")),
    sidebarDom: at(mark("sidebar-files-rows-dom")),
    sidebarObserved: at(mark("trace:sidebar-dom")),
    editable: at(mark("content-editable")),
    anchors: Object.fromEntries(
      Object.entries(trace.anchors).map(([name, anchor]) => [
        name,
        {
          firstAt: at(anchor.firstAt),
          first: [anchor.x, anchor.y],
          maxShift: anchor.maxShift,
          moves: anchor.moves.map((move) => ({
            t: at(move.t),
            to: [move.x, move.y],
          })),
        },
      ]),
    ),
    requests,
  };
}

// Element Timing is the headline; the next-frame and DOM-commit marks cover
// elements Chromium does not report and hidden tabs that never paint.
function bestSignal(name, element, painted, dom, observed) {
  const [value, source] =
    element != null
      ? [element, "element-timing"]
      : painted != null
        ? [painted, "next-frame-mark"]
        : dom != null
          ? [dom, "dom-mark"]
          : [observed, observed != null ? "dom-observer" : "missing"];
  const key = name === "body" ? "bodyVisible" : "sidebarUsable";
  return { [key]: value ?? null, [`${name}MeasuredBy`]: source };
}

function firstRequest(requests, path) {
  return requests
    .filter((request) => request.path === path)
    .sort((a, b) => a.start - b.start)[0];
}

function summarizeRun(result) {
  const requests = result.requests;
  const listDocumentsPaged = requests.filter(
    (request) =>
      request.path === "actions/list-documents" &&
      Number(new URLSearchParams(request.search).get("offset") ?? 0) > 0,
  ).length;
  const session = firstRequest(requests, "auth/session");
  const getDocument = firstRequest(requests, "actions/get-document");
  return {
    ...bestSignal(
      "body",
      result.bodyElement,
      result.bodyPainted,
      result.bodyDom,
      result.bodyObserved,
    ),
    ...bestSignal(
      "sidebar",
      result.sidebarElement,
      result.sidebarPainted,
      result.sidebarDom,
      result.sidebarObserved,
    ),
    editable: result.editable,
    frameworkRequests: requests.length,
    sessionRequests: requests.filter(
      (request) => request.path === "auth/session",
    ).length,
    getDocumentRequests: requests.filter(
      (request) => request.path === "actions/get-document",
    ).length,
    // How long the page's read waited after the session arrived; negative
    // when it started first.
    documentAfterSession:
      session && getDocument ? getDocument.start - session.end : null,
    listDocumentsPaged,
    redirectOffset: result.redirectOffset ?? 0,
    visibility: result.visibility,
    ...(stability ? summarizeStability(result.anchors) : {}),
  };
}

function summarizeStability(anchors) {
  const shifts = Object.fromEntries(
    Object.entries(anchors)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, anchor]) => [name, anchor.maxShift]),
  );
  const moved = Object.entries(anchors)
    .filter(([, anchor]) => anchor.maxShift > maxShift)
    .map(([name]) => name);
  // A run that found no anchors checked nothing, so it is not stable.
  const checked = Object.keys(anchors).length > 0;
  return {
    stable: checked && moved.length === 0,
    moved,
    shifts,
    ...(checked ? {} : { unchecked: true }),
  };
}

function summarizeStabilityRuns(results) {
  const worst = {};
  for (const result of results) {
    for (const [name, shift] of Object.entries(result.summary.shifts ?? {})) {
      worst[name] = Math.max(worst[name] ?? 0, shift);
    }
  }
  return {
    maxShift,
    stableRuns: results.filter((result) => result.summary.stable).length,
    worst: Object.fromEntries(
      Object.entries(worst).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

function percentile(values, p) {
  const sorted = values
    .filter((value) => typeof value === "number")
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
}

async function waitForBody(page, since, documentId) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    // A client-side redirect (for example `/` to `/home`) replaces the
    // document mid-poll; keep polling the new one.
    const done = await page
      .evaluate(
        ([s, id]) =>
          performance
            .getEntriesByType("mark")
            .filter(
              (entry) =>
                entry.name === "content-body-dom" ||
                entry.name === "trace:body-dom",
            )
            .some(
              (entry) =>
                entry.startTime >= s &&
                (!id || entry.detail?.documentId === id),
            ),
        [since, documentId],
      )
      .catch(() => false);
    if (done) return;
    await page.waitForTimeout(100);
  }
  throw new Error(
    `No document body within ${timeoutMs}ms at ${page.url()}; is the session valid?`,
  );
}

const cookieHeader = await sessionCookies();
const browser = await chromium.launch({
  headless: args.get("headed") !== "true",
});
const results = [];

async function newContext() {
  const context = await browser.newContext({
    viewport: { width: viewportWidth, height: viewportHeight },
  });
  context.setDefaultNavigationTimeout(timeoutMs);
  await context.addCookies(toPlaywrightCookies(cookieHeader));
  await context.addInitScript(installProbe, { stability });
  if (Object.keys(localStorageEntries).length) {
    await context.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) {
        window.localStorage.setItem(key, value);
      }
    }, localStorageEntries);
  }
  if (latencyMs > 0 || jitterMs > 0) {
    await context.route(`${baseUrl}/_agent-native/**`, async (route) => {
      await new Promise((done) =>
        setTimeout(done, latencyMs + Math.random() * jitterMs),
      );
      await route.continue();
    });
  }
  return context;
}

// A hard refresh bypasses the HTTP cache, and frame capture records every
// compositor frame with its wall-clock time. Both start before navigation.
async function instrumentPage(page) {
  if (state !== "hard" && !framesDir) return null;
  const cdp = await page.context().newCDPSession(page);
  if (state === "hard") {
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  }
  const frames = [];
  if (framesDir) {
    cdp.on("Page.screencastFrame", (frame) => {
      frames.push({ at: frame.metadata.timestamp * 1000, data: frame.data });
      void cdp
        .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
        .catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
      format: "png",
      everyNthFrame: 1,
      maxWidth: viewportWidth,
      maxHeight: viewportHeight,
    });
  }
  return { cdp, frames };
}

// Writes the run's frames, their times from navigation start, and an ffmpeg
// concat list that holds each frame until the next one:
//   ffmpeg -f concat -safe 0 -i concat.txt -vf fps=60 -pix_fmt yuv420p run.mp4
async function saveFrames(instrumented, run, timeOrigin) {
  if (!framesDir || !instrumented) return;
  await instrumented.cdp.send("Page.stopScreencast").catch(() => {});
  const dir = resolve(framesDir, `run-${run + 1}`);
  mkdirSync(dir, { recursive: true });
  const index = instrumented.frames.map((frame, i) => {
    const name = `f${String(i).padStart(4, "0")}.png`;
    writeFileSync(resolve(dir, name), Buffer.from(frame.data, "base64"));
    return { name, t: Math.round(frame.at - timeOrigin) };
  });
  writeFileSync(
    resolve(dir, "frames.json"),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  const concat = index.flatMap((frame, i) => {
    const next = index[i + 1]?.t ?? frame.t + 500;
    return [
      `file '${frame.name}'`,
      `duration ${(Math.max(1, next - frame.t) / 1000).toFixed(3)}`,
    ];
  });
  if (index.length) concat.push(`file '${index.at(-1).name}'`);
  writeFileSync(resolve(dir, "concat.txt"), `${concat.join("\n")}\n`);
}

let shared = state === "cached" || state === "hard" ? await newContext() : null;
if (shared) {
  const warm = await shared.newPage();
  await warm.goto(`${baseUrl}${path}`, { waitUntil: "load" });
  await waitForBody(warm, 0);
  // A returning user's last visit finished loading, sidebar included, so the
  // layout it left behind is there to restore.
  await warm.waitForTimeout(settleMs);
  await warm.close();
}

for (let run = 0; run < runs; run += 1) {
  const context = shared ?? (await newContext());
  const page = await context.newPage();
  const instrumented = await instrumentPage(page);
  let result;
  if (state === "in-app") {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "load" });
    await waitForBody(page, 0);
    await page.waitForTimeout(settleMs);
    const targetId = clickPath.split("/").pop();
    // The target page's anchors share names with the source page's, so the
    // baseline starts over at the click.
    const since = await page.evaluate(() => {
      window.__startupTrace.anchors = {};
      return performance.now();
    });
    await page
      .locator(`a[href="${clickPath}"]`)
      .filter({ visible: true })
      .first()
      .click();
    await waitForBody(page, since, targetId);
    await page.waitForTimeout(settleMs);
    result = await page.evaluate(collect, [since, targetId]);
  } else {
    const navigationStartedAt = Date.now();
    await page.goto(`${baseUrl}${path}`, { waitUntil: "commit" });
    await waitForBody(page, 0);
    await page.waitForTimeout(settleMs);
    result = await page.evaluate(collect, [0, undefined]);
    // Count from the first navigation even when the page redirected to a new
    // document on the way.
    const offset = Math.max(
      0,
      Math.round(result.timeOrigin - navigationStartedAt),
    );
    result.redirectOffset = offset;
    for (const key of [
      "bodyElement",
      "bodyPainted",
      "bodyDom",
      "sidebarElement",
      "sidebarPainted",
      "sidebarDom",
      "bodyObserved",
      "sidebarObserved",
      "editable",
    ]) {
      if (result[key] != null) result[key] += offset;
    }
  }
  await saveFrames(instrumented, run, result.timeOrigin);
  const summary = summarizeRun(result);
  results.push({
    run,
    summary,
    requests: result.requests,
    ...(stability ? { anchors: result.anchors } : {}),
  });
  console.log(
    `[trace] ${state} ${path} run ${run + 1}/${runs}: ${JSON.stringify(summary)}`,
  );
  await page.close();
  if (!shared) await context.close();
}

await browser.close();

const metric = (name) => results.map((result) => result.summary[name]);
const report = {
  baseUrl,
  state,
  path,
  clickPath: clickPath ?? null,
  runs,
  p50: {
    bodyVisible: percentile(metric("bodyVisible"), 50),
    sidebarUsable: percentile(metric("sidebarUsable"), 50),
    editable: percentile(metric("editable"), 50),
    frameworkRequests: percentile(metric("frameworkRequests"), 50),
    documentAfterSession: percentile(metric("documentAfterSession"), 50),
  },
  p90: {
    bodyVisible: percentile(metric("bodyVisible"), 90),
    sidebarUsable: percentile(metric("sidebarUsable"), 90),
    editable: percentile(metric("editable"), 90),
    documentAfterSession: percentile(metric("documentAfterSession"), 90),
  },
  max: {
    sessionRequests: Math.max(...metric("sessionRequests")),
    getDocumentRequests: Math.max(...metric("getDocumentRequests")),
    listDocumentsPaged: Math.max(...metric("listDocumentsPaged")),
  },
  ...(stability ? { stability: summarizeStabilityRuns(results) } : {}),
  results,
};
console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
if (outPath) {
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`);
}
if (stability) {
  if (results.some((result) => result.summary.unchecked)) process.exitCode = 2;
  else if (report.stability.stableRuns < runs) process.exitCode = 1;
}
