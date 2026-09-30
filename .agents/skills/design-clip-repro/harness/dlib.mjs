import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { BASE, CDP_URL, CREDS, HEADED, LAUNCH, OSM, PROD_BASE, SCREEN_Y_OFFSET, SHOTS_DIR, TEST_ACCOUNT, chromium, request } from "./harness-env.mjs";

export { BASE, HEADED } from "./harness-env.mjs";
export const osm = (...a) => execFileSync(OSM, a.map(String), { encoding: "utf8" }).trim();
export const scr = (cx, cy) => [Math.round(cx), Math.round(cy + SCREEN_Y_OFFSET)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits out 429s (Retry-After, capped) instead of failing or hammering the server. */
async function send(label, request) {
  for (let attempt = 1; ; attempt++) {
    const res = await request();
    if (res.status() !== 429 || attempt > 3) return res;
    const wait = Math.min(Number(res.headers()["retry-after"]) || 10, 60);
    console.error(`${label}: rate limited, retrying in ${wait}s`);
    await sleep(wait * 1000);
  }
}

/**
 * A per-worktree PGlite database starts empty, so the first run has no account
 * to log into. Register on demand (409 = someone already did) and log in.
 */
async function authenticate(ctx, base, creds, register) {
  const post = (path) =>
    send(path, () => ctx.post(path, { data: creds, headers: { "Content-Type": "application/json" } }));
  let res = await post("/_agent-native/auth/login");
  if (!res.ok() && register) {
    const reg = await post("/_agent-native/auth/register");
    if (!reg.ok() && reg.status() !== 409) {
      throw new Error(`register failed: ${reg.status()} ${await reg.text()}`);
    }
    res = await post("/_agent-native/auth/login");
  }
  if (!res.ok()) throw new Error(`login failed at ${base} as ${creds.email}: ${res.status()}`);
  return ctx;
}

// A cold dev server can take over a minute to answer while it compiles.
const REQUEST_TIMEOUT_MS = 120000;
const SESSIONS = join(homedir(), ".cache", "design-clip-repro", "sessions");

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * A logged-in REST context. The session is cached and reused while valid, so a
 * run signs in once: production rate-limits sign-in. Only a server on this
 * machine may register the account.
 */
export async function api(base = BASE, creds = CREDS) {
  const key = createHash("sha1").update(`${new URL(base).host}\n${creds.email}`).digest("hex").slice(0, 16);
  const file = join(SESSIONS, `${key}.json`);
  if (existsSync(file)) {
    const ctx = await request.newContext({ baseURL: base, storageState: file, timeout: REQUEST_TIMEOUT_MS });
    const session = await ctx.get("/_agent-native/auth/session").then((r) => r.json()).catch(() => null);
    if (session && !session.error) return ctx;
    await ctx.dispose();
  }
  const ctx = await authenticate(
    await request.newContext({ baseURL: base, timeout: REQUEST_TIMEOUT_MS }),
    base,
    creds,
    LOOPBACK.has(new URL(base).hostname),
  );
  mkdirSync(SESSIONS, { recursive: true, mode: 0o700 });
  await ctx.storageState({ path: file });
  chmodSync(file, 0o600);
  return ctx;
}

/** Runs a Design action over REST, throwing with the server's message instead of returning an error body. */
export async function action(ctx, name, params = {}, method = "POST") {
  const res = await send(name, () =>
    method === "GET"
      ? ctx.get(`/_agent-native/actions/${name}?${new URLSearchParams(params)}`)
      : ctx.post(`/_agent-native/actions/${name}`, { data: params, headers: { "Content-Type": "application/json" } }),
  );
  const body = await res.text();
  if (!res.ok()) throw new Error(`${name} failed: ${res.status()} ${body.slice(0, 400)}`);
  return body ? JSON.parse(body) : null;
}

export async function newDesign(title, bodyHtml = "") {
  const ctx = await api();
  const { id } = await action(ctx, "create-design", { title, projectType: "prototype" });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>*{box-sizing:border-box;margin:0}body{width:1200px;height:760px;position:relative;background:#0B0B0F;font-family:Inter,system-ui,sans-serif}</style>
</head><body>${bodyHtml}</body></html>`;
  await action(ctx, "create-file", { designId: id, filename: "index.html", content: html, fileType: "html" });
  await ctx.dispose();
  return id;
}

/**
 * The readiness the Design e2e helpers use: the Move tool, a preview iframe,
 * and selectable nodes inside it. A cold dev server compiles the editor on the
 * first visit, so this keeps waiting while modules still load and gives up
 * early only when the page goes quiet. The error's `compiling` says which.
 */
export async function waitForEditor(page, { maxMs = 200000, quietMs = 60000 } = {}) {
  // A cold compile can hold one module request open for over a minute, so a
  // pending request counts as activity. Event streams stay open forever.
  const tracked = (req) => !["eventsource", "websocket"].includes(req.resourceType());
  let lastActivity = Date.now();
  let requests = 0;
  let pending = 0;
  const onStart = (req) => {
    if (!tracked(req)) return;
    pending++;
    lastActivity = Date.now();
  };
  const onDone = (req) => {
    if (!tracked(req)) return;
    pending = Math.max(0, pending - 1);
    requests++;
    lastActivity = Date.now();
  };
  page.on("request", onStart);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  try {
    const started = Date.now();
    let loggedAt = started;
    for (;;) {
      if (await editorReady(page).catch(() => false)) return Date.now() - started;
      const now = Date.now();
      const compiling = pending > 0 || now - lastActivity < quietMs;
      if (!compiling || now - started >= maxMs) {
        const shot = `${SHOTS_DIR}/editor-timeout-${now}.png`;
        await page.screenshot({ path: shot }).catch(() => {});
        const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
        const err = new Error(
          compiling
            ? `Design editor still compiling after ${Math.round((now - started) / 1000)}s (${requests} requests). ${shot}`
            : `Design editor not ready and the page went quiet. ${shot} Page text: ${text.slice(0, 200)}`,
        );
        err.compiling = compiling;
        throw err;
      }
      if (now - loggedAt >= 30000) {
        loggedAt = now;
        console.error(`editor loading ${Math.round((now - started) / 1000)}s, ${requests} requests`);
      }
      await page.waitForTimeout(1000);
    }
  } finally {
    page.off("request", onStart);
    page.off("requestfinished", onDone);
    page.off("requestfailed", onDone);
  }
}

async function editorReady(page) {
  if (!(await page.getByRole("button", { name: "Move", exact: true }).isVisible())) return false;
  const frames = page.locator("iframe[data-design-preview-iframe]");
  const count = await frames.count();
  for (let i = 0; i < count; i++) {
    const nodes = await frames
      .nth(i)
      .contentFrame()
      .locator("[data-agent-native-node-id], h1, h2, p, button")
      .count()
      .catch(() => 0);
    if (nodes > 0) return true;
  }
  return false;
}

/**
 * Opens a design in the editor.
 * - `prod: true`: production Design as the test account (a copy-design.mjs copy).
 * - `reuse: true`: the branch browser, keeping the tab open between scripts so
 *   only the first pays the editor's load. Not for osmouse work (a reused tab
 *   can carry a device-metrics override). End every script with `close()`.
 */
export async function openEditor(designId, { prod = false, reuse = false } = {}) {
  if (prod && !TEST_ACCOUNT) throw new Error("openEditor({ prod: true }) needs DESIGN_TEST_EMAIL / DESIGN_TEST_PASSWORD");
  const [base, creds] = prod ? [PROD_BASE, TEST_ACCOUNT] : [BASE, CREDS];
  // Default: this run owns its browser, so N runs never contend. HEADED=1
  // attaches to the one shared Chrome instead — required for osmouse, and a
  // machine-wide singleton, so hold the osmouse lock around it.
  const headed = HEADED || reuse;
  let browser;
  let ctx;
  let page;
  if (headed) {
    browser = await chromium.connectOverCDP(CDP_URL);
    ctx = browser.contexts()[0];
    const tabs = ctx.pages().filter((p) => p.url().includes(`/design/${designId}`));
    if (reuse && tabs.length > 0) {
      page = tabs[0];
    } else {
      // A reused tab may carry a device-metrics override, which decouples CSS
      // coordinates from real screen pixels and breaks osmouse. Only close this
      // design's own tabs — closing every app tab kills sibling runs.
      for (const old of tabs) await old.close().catch(() => {});
    }
  } else {
    browser = await chromium.launch(LAUNCH);
    ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
  }
  if (!page) {
    // The shared browser's profile may never have logged in to this server.
    const auth = await api(base, creds);
    await ctx.addCookies((await auth.storageState()).cookies);
    await auth.dispose();
    page = await ctx.newPage();
    if (headed) await page.bringToFront();
    await page
      .goto(`${base}/design/${designId}?editorView=overview`, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS })
      .catch((err) => {
        throw Object.assign(err, { compiling: err.name === "TimeoutError" });
      });
    await waitForEditor(page);
    await page.waitForTimeout(9000);
  }
  await page.evaluate(() => { window.__DESIGN_TRACE = true; });

  const rest = await api(base, creds);
  const files = async () => {
    const d = await rest.get(`/_agent-native/actions/get-design?id=${designId}`).then((r) => r.json());
    return Object.fromEntries(d.files.map((f) => [f.filename, f.content]));
  };
  const summary = async () => Object.fromEntries(Object.entries(await files())
    .map(([n, c]) => [n, { bytes: c.length, nodes: (c.match(/data-agent-native-node-id/g) || []).length }]));

  const tool = async (label) => {
    const b = await page.evaluate((l) => {
      const el = [...document.querySelectorAll('button,[role="button"]')].find((e) => e.offsetParent && e.getAttribute("aria-label") === l);
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, label);
    if (!b) throw new Error("no tool: " + label);
    await page.mouse.click(b.x, b.y); await page.waitForTimeout(650);
  };
  const draw = async (toolName, x1, y1, x2, y2) => {
    await tool(toolName);
    await page.mouse.move(x1, y1); await page.mouse.down();
    const n = 22;
    for (let i = 1; i <= n; i++) { await page.mouse.move(x1 + (x2-x1)*i/n, y1 + (y2-y1)*i/n); await page.waitForTimeout(16); }
    await page.waitForTimeout(300); await page.mouse.up(); await page.waitForTimeout(2200);
  };
  const dragCanvas = async (from, to, hold = 700) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    const n = 30;
    for (let i = 1; i <= n; i++) { await page.mouse.move(from.x + (to.x-from.x)*i/n, from.y + (to.y-from.y)*i/n); await page.waitForTimeout(22); }
    await page.waitForTimeout(hold); await page.mouse.up(); await page.waitForTimeout(3000);
  };
  const layers = () => page.evaluate(() =>
    [...document.querySelectorAll('[role="treeitem"],[role="row"]')]
      .map((r) => ({ name: (r.innerText || "").trim().split("\n")[0].slice(0, 24), level: +(r.getAttribute("aria-level") || 0) }))
      .filter((r) => r.name));
  const screenRect = () => page.evaluate(() => {
    const f = [...document.querySelectorAll("iframe")].filter((f) => f.offsetWidth > 200)[0];
    const r = f.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
             cx: Math.round(r.x + r.width/2), cy: Math.round(r.y + r.height/2) };
  });
  const traceClear = () => page.evaluate(() => window.__designTrace?.clear());
  const traceDrop = () => page.evaluate(() => window.__designTrace
    ? window.__designTrace.dump().split("\n").filter((l) => /drop:(finalize|cross-screen-persist|placement|refused)|persist:write/.test(l)).join("\n")
    : "no trace");

  /** Draw in 1200x760 design space, re-reading screen geometry each call. */
  const drawIn = async (toolName, x1, y1, x2, y2) => {
    const r = await screenRect();
    const m = (dx, dy) => ({ x: Math.round(r.x + (dx / 1200) * r.w), y: Math.round(r.y + (dy / 760) * r.h) });
    const a = m(x1, y1), b = m(x2, y2);
    await draw(toolName, a.x, a.y, b.x, b.y);
  };
  const pointIn = async (dx, dy) => {
    const r = await screenRect();
    return { x: Math.round(r.x + (dx / 1200) * r.w), y: Math.round(r.y + (dy / 760) * r.h) };
  };
  const selectAt = async (x, y) => {
    await page.keyboard.press("Escape"); await page.waitForTimeout(250);
    await page.mouse.click(x, y); await page.waitForTimeout(800);
    return page.evaluate(() => [...document.querySelectorAll('[role="treeitem"],[role="row"]')]
      .filter(r => r.getAttribute("aria-selected") === "true")
      .map(r => (r.innerText || "").trim().split("\n")[0].slice(0, 22)));
  };
  /**
   * Canvas point for a node, read from the iframe itself. The screen iframe is
   * not uniformly scaled (width and height scale differ), so mapping design
   * coordinates by ratio silently misses.
   */
  const nodePoint = async (nodeId, fx = 0.5, fy = 0.5) => page.evaluate(
    ([id, ax, ay]) => {
      for (const f of document.querySelectorAll("iframe")) {
        const d = f.contentDocument; if (!d) continue;
        const el = d.querySelector(`[data-agent-native-node-id="${id}"]`);
        if (!el) continue;
        const fr = f.getBoundingClientRect();
        const s = fr.width / f.offsetWidth;
        const r = el.getBoundingClientRect();
        return { x: Math.round(fr.x + (r.x + r.width * ax) * s),
                 y: Math.round(fr.y + (r.y + r.height * ay) * s),
                 w: Math.round(r.width * s), h: Math.round(r.height * s) };
      }
      return null;
    }, [nodeId, fx, fy]);

  /** Fill is not an input: open the colour picker, then type into its Hex field. */
  const setFill = async (hex) => {
    const btn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button,[role="button"]')].filter((e) => e.offsetParent)
        .find((e) => /open color picker/i.test(e.getAttribute("aria-label") || ""));
      if (!b) return null; const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!btn) return false;
    await page.mouse.click(btn.x, btn.y); await page.waitForTimeout(1100);
    const f = await page.evaluate(() => {
      const i = [...document.querySelectorAll("input")].filter((i) => i.offsetParent)
        .find((i) => /hex/i.test(i.getAttribute("aria-label") || ""));
      if (!i) return null; const r = i.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!f) { await page.keyboard.press("Escape"); return false; }
    await page.mouse.click(f.x, f.y); await page.waitForTimeout(200);
    await page.keyboard.press("ControlOrMeta+A"); await page.waitForTimeout(120);
    await page.keyboard.type(hex); await page.waitForTimeout(150);
    await page.keyboard.press("Enter"); await page.waitForTimeout(2200);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    return true;
  };
  const contextAction = async (point, pattern) => {
    await page.mouse.click(point.x, point.y, { button: "right" }); await page.waitForTimeout(1100);
    const item = await page.evaluate((src) => {
      const rx = new RegExp(src, "i");
      const el = [...document.querySelectorAll('[role="menuitem"],[role="menu"] button')].filter((e) => e.offsetParent)
        .find((e) => rx.test(e.innerText || ""));
      if (!el) return null; const r = el.getBoundingClientRect();
      return { disabled: el.getAttribute("aria-disabled") === "true",
               x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, pattern);
    if (!item || item.disabled) { await page.keyboard.press("Escape"); return item ? "disabled" : "absent"; }
    await page.mouse.click(item.x, item.y); await page.waitForTimeout(2800);
    return "clicked";
  };

  /** Clicks the visible control whose label (aria-label, text or title) matches, after a hit-test. */
  const clickLabel = async (label, { exact = true, panel = false } = {}) => {
    const box = await page.evaluate(([label, exact, panel]) => {
      const minX = panel ? window.innerWidth - 320 : 0;
      const text = (e) => (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || "").trim().replace(/\s+/g, " ");
      const el = [...document.querySelectorAll('button,[role="button"],[role="tab"],[role="menuitem"],[role="menuitemradio"],[role="option"],[role="treeitem"]')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 3 && r.height > 3 && r.x >= minX; })
        .find((e) => (exact ? text(e) === label : text(e).startsWith(label)));
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, hit: el === top || el.contains(top) || Boolean(top?.contains(el)) };
    }, [label, exact, panel]);
    if (!box) return `absent: ${label}`;
    if (!box.hit) return `covered: ${label}`;
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(1200);
    return `clicked: ${label}`;
  };
  /** Selects the layer whose name starts with `name`; returns the selected rows. */
  const selectLayer = async (name) => {
    const result = await clickLabel(name, { exact: false });
    const selected = await page.evaluate(() =>
      [...document.querySelectorAll('[role="treeitem"][aria-selected="true"]')].map((e) => (e.innerText || "").trim().split("\n")[0]));
    return { result, selected };
  };
  /** The inspector's fields as label → value. Read numbers here, not from screenshots. */
  const inspector = () => page.evaluate(() => {
    const out = {};
    for (const e of document.querySelectorAll("input,select,[role='combobox']")) {
      const r = e.getBoundingClientRect();
      const label = e.getAttribute("aria-label") || e.getAttribute("placeholder");
      if (!label || r.width < 3 || r.x < window.innerWidth - 320) continue;
      out[label] = `${e.value ?? e.innerText}${e.disabled || e.getAttribute("aria-disabled") === "true" ? " (disabled)" : ""}`;
    }
    return out;
  });
  /** Types into the inspector field labelled `label` (case-insensitive prefix) and returns its new value. */
  const setField = async (label, value) => {
    const box = await page.evaluate((label) => {
      const i = [...document.querySelectorAll("input")].find((i) => i.offsetParent && i.getBoundingClientRect().x >= window.innerWidth - 320
        && (i.getAttribute("aria-label") || "").toLowerCase().startsWith(label.toLowerCase()));
      if (!i) return null;
      i.scrollIntoView({ block: "center" });
      const r = i.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: i.disabled, label: i.getAttribute("aria-label") };
    }, label);
    if (!box) return `absent: ${label}`;
    if (box.disabled) return `disabled: ${box.label}`;
    await page.mouse.click(box.x, box.y);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(String(value));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    return `${box.label} = ${(await inspector())[box.label]}`;
  };
  /** Computed CSS of a node inside the screen iframe. */
  const styles = (nodeId, props = ["transform", "scale", "rotate", "translate", "mix-blend-mode", "color", "background-color", "border-radius", "opacity"]) =>
    page.evaluate(([id, props]) => {
      for (const f of document.querySelectorAll("iframe")) {
        const el = f.contentDocument?.querySelector(`[data-agent-native-node-id="${id}"]`);
        if (!el) continue;
        const cs = f.contentWindow.getComputedStyle(el);
        return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
      }
      return null;
    }, [nodeId, props]);
  /** The open menu's items and which one is checked. */
  const menu = () => page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"]')]
      .filter((e) => e.offsetParent)
      .map((e) => ({ label: (e.innerText || "").trim(), checked: e.getAttribute("aria-checked") === "true" || e.getAttribute("aria-selected") === "true" })));
  /** Opens the inspector's export Preview and saves the rendered image to `path`; null when there is none. */
  const exportPreview = async (path) => {
    const previewSrc = () => page.evaluate(() =>
      [...document.querySelectorAll("img")].find((img) => img.src.startsWith("blob:") && img.offsetParent && img.getBoundingClientRect().x > window.innerWidth - 320)?.src ?? null);
    // "Preview" toggles, so clicking an open preview would close it.
    let src = await previewSrc();
    if (!src) await clickLabel("Preview", { panel: true });
    for (let i = 0; i < 30 && !src; i++) {
      await page.waitForTimeout(1000);
      src = await previewSrc();
    }
    if (!src) return null;
    const b64 = await page.evaluate(async (src) => {
      const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    }, src);
    writeFileSync(path, Buffer.from(b64, "base64"));
    return path;
  };
  /** Leaves a reused tab open for the next script; otherwise closes what this call opened. */
  const close = async () => {
    if (!reuse) await (headed ? page.close() : browser.close()).catch(() => {});
    if (headed) await browser.close().catch(() => {});
    await rest.dispose().catch(() => {});
  };

  return { page, browser, close, files, summary, clickLabel, selectLayer, inspector, setField, styles, menu, exportPreview, tool, draw, dragCanvas, layers, screenRect, traceClear, traceDrop, designId, drawIn, pointIn, selectAt, nodePoint, setFill, contextAction };
}
