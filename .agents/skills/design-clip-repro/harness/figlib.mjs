import { execFileSync } from "node:child_process";

import { CDP_URL, OSM, SCREEN_Y_OFFSET, chromium } from "./harness-env.mjs";
export { withLock } from "./lock.mjs";
export const osm = (...a) => execFileSync(OSM, a.map(String), { encoding: "utf8" }).trim();
export const scr = (cx, cy) => [Math.round(cx), Math.round(cy + SCREEN_Y_OFFSET)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function open() {
  // Figma is a machine-wide singleton: one logged-in session, one canvas, and
  // osmouse drives the one physical cursor. Always wrap calls to open() in
  // withLock("osmouse", …). Pick the tab by URL — pages()[0] is whatever tab
  // happens to be first, which silently drove the wrong window.
  const browser = await chromium.connectOverCDP(CDP_URL);
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().includes("figma.com/design"));
  if (!page) throw new Error("no figma.com/design tab open in the shared Chrome");
  await page.bringToFront(); await page.waitForTimeout(600);
  // Onboarding coach marks dim the canvas and silently swallow pointer input
  // while keystrokes still work, so every drag after them reads as "no effect".
  for (let i = 0; i < 4; i++) {
    const closed = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button[aria-label="Close"]')].find((e) => e.offsetParent);
      b?.click();
      return Boolean(b);
    });
    if (!closed) break;
    await page.waitForTimeout(500);
  }
  // New files open on the Agents panel; the layer rows only exist under File.
  await page.locator('button[aria-label="File"]').first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);

  const tree = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="row"][data-testid^="layer-row"]')).map((r) => {
      const b = r.getBoundingClientRect();
      return { name: (r.innerText || "").trim().split("\n")[0].slice(0, 22),
               level: +r.getAttribute("aria-level"), pos: +r.getAttribute("aria-posinset"),
               sel: r.getAttribute("aria-selected") === "true",
               x: Math.round(b.x + 70), y: Math.round(b.y + b.height / 2) };
    }));
  const show = async (l) => { const t = await tree(); console.log(l, t.map(r => `${"· ".repeat(r.level)}${r.name}`).join(" / ")); return t; };
  const geo = () => page.evaluate(() => {
    const g = (l) => { const i = [...document.querySelectorAll("input")].find(i => i.getAttribute("aria-label") === l && i.offsetParent); return i ? i.value : null; };
    return { x: g("X-position"), y: g("Y-position"), w: g("Width") ?? g("Horizontal resizing"), h: g("Height") ?? g("Vertical resizing") };
  });
  const selExact = async (name) => {
    for (let i = 0; i < 3; i++) {
      const r = (await tree()).find(x => x.name === name);
      if (!r) throw new Error("no row: " + name);
      await page.mouse.click(r.x, r.y); await page.waitForTimeout(850);
      const ok = (await tree()).find(x => x.name === name)?.sel;
      if (ok) return true;
    }
    throw new Error("could not select: " + name);
  };
  const expand = async (name) => {
    for (let i = 0; i < 4; i++) {
      const info = await page.evaluate((n) => {
        const r = [...document.querySelectorAll('[role="row"][data-testid^="layer-row"]')]
          .find(r => (r.innerText || "").trim().split("\n")[0].slice(0, 22) === n);
        if (!r) return null;
        const b = r.getBoundingClientRect();
        return { expanded: r.getAttribute("aria-expanded"), x: Math.round(b.x + 18), y: Math.round(b.y + b.height / 2) };
      }, name);
      if (!info) return false;
      if (info.expanded === "true" || info.expanded === null) return true;
      await page.mouse.click(info.x, info.y); await page.waitForTimeout(800);
    }
    return false;
  };
  const mkText = async (cx, cy, body) => {
    await page.keyboard.press("Escape"); await page.waitForTimeout(250);
    await page.keyboard.press("t"); await page.waitForTimeout(400);
    await page.mouse.click(cx, cy); await page.waitForTimeout(650);
    await page.keyboard.type(body); await page.waitForTimeout(350);
    await page.keyboard.press("Escape"); await page.waitForTimeout(800);
  };
  // Centre a node at 100% zoom so doc coords map linearly onto client coords.
  const calibrate = async (name) => {
    await selExact(name);
    await page.keyboard.press("Shift+Digit2"); await page.waitForTimeout(1200);
    await page.keyboard.press("Shift+Digit0"); await page.waitForTimeout(1400);
    const g = await geo();
    const cb = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { cx: r.x + r.width/2, cy: r.y + r.height/2 }; });
    const c = { x: +g.x + +g.w / 2, y: +g.y + +g.h / 2 };
    return { geo: g, S: (dx, dy) => ({ x: Math.round(cb.cx + (dx - c.x)), y: Math.round(cb.cy + (dy - c.y)) }) };
  };

  /**
   * Find a node's real screen position by probing: click candidate points and
   * ask the layers panel what got selected. Inspector X/Y is parent-relative
   * for auto-layout children, so arithmetic on it silently targets empty canvas.
   */
  const locateOnCanvas = async (name, area, step = 14) => {
    const hits = [];
    for (let y = area.y; y <= area.y + area.h; y += step) {
      for (let x = area.x; x <= area.x + area.w; x += step) {
        await page.keyboard.press("Escape"); await page.waitForTimeout(90);
        await page.mouse.click(x, y); await page.waitForTimeout(260);
        const sel = await page.evaluate((n) => {
          const r = [...document.querySelectorAll('[role="row"][data-testid^="layer-row"]')]
            .find(r => r.getAttribute("aria-selected") === "true");
          const got = r ? (r.innerText || "").trim().split("\n")[0].slice(0, 22) : null;
          return got === n;
        }, name);
        if (sel) hits.push({ x, y });
      }
    }
    if (!hits.length) return null;
    const cx = Math.round(hits.reduce((a, h) => a + h.x, 0) / hits.length);
    const cy = Math.round(hits.reduce((a, h) => a + h.y, 0) / hits.length);
    return { centre: { x: cx, y: cy }, hits: hits.length };
  };

  /** Drag that proves it grabbed the node before trusting the outcome. */
  const verifiedDrag = async ({ nodeName, from, to, label }) => {
    await selExact(nodeName);
    const before = await geo();
    const [sx, sy] = scr(from.x, from.y);
    osm("move", sx, sy); await sleep(250);
    osm("down", sx, sy); await sleep(350);
    osm("dragto", sx + 24, sy + 12, 8); await sleep(500);
    const mid = await geo();
    const grabbed = mid.x !== before.x || mid.y !== before.y;
    if (!grabbed) {
      osm("up");
      return { label, grabbed: false, reason: "press did not grab the node (no movement after 24px nudge)" };
    }
    const [tx, ty] = scr(to.x, to.y);
    osm("dragto", tx, ty, 40); await sleep(400);
    osm("jiggle", 12); await sleep(300);
    osm("up"); await sleep(2200);
    const after = await geo();
    return { label, grabbed: true, before, after, moved: after.x !== before.x || after.y !== before.y };
  };

  // Figma labels controls with aria-label or data-tooltip; the inspector is the right-hand 260px.
  const control = (label, tags) => page.evaluate(([label, tags]) => {
    const text = (e) => (e.getAttribute("aria-label") || e.getAttribute("data-tooltip") || e.innerText || "").trim().replace(/\s+/g, " ");
    const el = [...document.querySelectorAll(tags)]
      .find((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && text(e).toLowerCase() === label.toLowerCase(); });
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: Boolean(el.disabled) };
  }, [label, tags]);
  /** Clicks the control labelled `label` (buttons, menu items, options, or plain text with `text: true`). */
  const click = async (label, { text = false } = {}) => {
    const box = await control(label, text ? "button,[role=button],[role=menuitem],[role=option],div,span" : "button,[role=button],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option]");
    if (!box) return `absent: ${label}`;
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(900);
    return `clicked: ${label}`;
  };
  /** The inspector's inputs as label → value. Read numbers here, not from screenshots. */
  const inspector = () => page.evaluate(() => {
    const out = {};
    for (const i of document.querySelectorAll("input")) {
      const r = i.getBoundingClientRect();
      const label = i.getAttribute("aria-label") || i.getAttribute("data-tooltip");
      if (label && r.width > 2 && r.x > window.innerWidth - 260) out[label] = `${i.value}${i.disabled ? " (disabled)" : ""}`;
    }
    return out;
  });
  /** Types into the inspector input labelled `label` and returns its new value. */
  const setField = async (label, value) => {
    const box = await control(label, "input");
    if (!box) return `absent: ${label}`;
    if (box.disabled) return `disabled: ${label}`;
    await page.mouse.click(box.x, box.y);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(String(value));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
    return `${label} = ${(await inspector())[label]}`;
  };
  /** A fresh page for the measurement, so existing work in the file is never touched. */
  const newPage = async (name = `clip-repro-${Date.now()}`) => {
    if ((await click("Add new page")).startsWith("absent")) return "absent: Add new page";
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    return name;
  };
  /** Screenshot of the inspector column only (blend rows, export preview), saved to `path`. */
  const panelShot = async (path) => {
    const { innerWidth: w, innerHeight: h } = await page.evaluate(() => ({ innerWidth, innerHeight }));
    await page.screenshot({ path, clip: { x: w - 260, y: 0, width: 260, height: h } });
    return path;
  };

  return { page, browser, tree, show, geo, selExact, mkText, calibrate, verifiedDrag, expand, locateOnCanvas, click, inspector, setField, newPage, panelShot };
}
