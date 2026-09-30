# Harness recipes

Copy-paste helpers. Every one of these exists because its naive version
produced a wrong conclusion.

## Connect

`dlib.openEditor()` already does this. Default is **own browser per run**, which
is what makes parallel workspaces safe:

```js
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const auth = await api();                                   // REST login (auto-registers)
await ctx.addCookies((await auth.storageState()).cookies);  // session without the shared profile
```

No profile directory, no shared Chrome, no tab stealing. Verified: the editor
loads, iframes resolve, and canvas clicks select correctly in headless.

`HEADED=1` attaches to the shared Chrome instead (`connectOverCDP(CDP_URL)`) —
needed only for osmouse/Figma, and it is a machine-wide singleton, so hold
`withLock("osmouse", …)` around it.

If `connectOverCDP` hangs in headed mode, a blank tab is usually wedging it:

```bash
curl -s http://127.0.0.1:9222/json/list | python3 -c "
import sys,json
for x in json.load(sys.stdin):
    if x.get('type')=='page' and not x.get('url'): print(x['id'])"
curl -s "http://127.0.0.1:9222/json/close/<ID>"
```

In headed mode always open a **fresh tab**: a reused one may carry a device
metrics override, which decouples CSS coords from screen pixels and breaks
osmouse. Scope any tab-closing to your own design id — closing every app tab
deadlocks sibling runs.

## Per-worktree configuration

```js
import { BASE, PORT, E2E_PORT, PGLITE, describeEnv } from "./harness-env.mjs";
```

All derived from a hash of the worktree path, so the same worktree always gets
the same port and two never collide. Override with `DESIGN_PORT`, `DESIGN_BASE`,
`E2E_PORT`, `WORKTREE`.

```bash
./start-dev.sh          # idempotent: boots the derived port, or says "already up"
```

## The machine-wide lock

```js
import { withLock } from "./lock.mjs";
await withLock("osmouse", async () => { /* figma / osmouse work */ });
```

O_EXCL lockfile at `/tmp/an-harness-<name>.lock` holding a PID; a dead holder
is reclaimed, so a crash cannot wedge the machine.
Verified serialising: A held 4s, B waited and entered at +4004ms.

## Label derivation — the dumper and the clicker MUST match

```js
const lab = (e) =>
  (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || "")
    .trim().replace(/\s+/g, " ");

const SEL = 'button,[role="button"],[role="tab"],[role="menuitem"],' +
            '[role="option"],[role="combobox"],[role="switch"],select,input';

// Dump EVERYTHING. Filtering before you know what exists is how you "prove"
// a control is missing when it is simply labelled differently.
const dumpControls = () => page.evaluate(({ SEL }) => {
  const lab = (e) => (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || "")
    .trim().replace(/\s+/g, " ");
  return [...document.querySelectorAll(SEL)]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 3 && r.height > 3; })
    .map(lab).filter(Boolean);
}, { SEL });
```

## Click with a hit-test that tolerates wrapper elements

```js
const click = async (target) => {
  const box = await page.evaluate(({ t, SEL }) => {
    const lab = (e) => (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || "")
      .trim().replace(/\s+/g, " ");
    const e = [...document.querySelectorAll(SEL)]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 3 && r.height > 3; })
      .find(e => lab(e) === t);
    if (!e) return null;
    e.scrollIntoView({ block: "center" });
    const r = e.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    // top.contains(e) covers Tooltip/Popover wrappers — without it, working
    // buttons read as "blocked".
    return { cx, cy, hits: e === top || e.contains(top) || Boolean(top && top.contains(e)) };
  }, { t: target, SEL });
  if (!box) return `absent:${target}`;
  if (!box.hits) return `blocked:${target}`;
  await page.mouse.click(box.cx, box.cy);
  await page.waitForTimeout(2200);
  return `clicked:${target}`;
};
```

## Detect a surface that opened (dialog, popover, inline section)

A picker may render inline in the inspector rather than as a dialog, and an
unlabelled search input is invisible to a control dump. Diff broadly:

```js
const openSurfaces = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-state="open"],[role="dialog"],[role="listbox"],[data-radix-popper-content-wrapper]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 20; })
    .map(e => ({ role: e.getAttribute("role") || e.tagName,
                 t: (e.innerText || "").trim().replace(/\s+/g, " ").slice(0, 120) })));

// and/or diff the whole control list around the action
const before = new Set(await dumpControls());
await click("Add breakpoint");
const added = (await dumpControls()).filter(l => !before.has(l));
```

## Node targeting — read the rect from inside the iframe

The screen iframe scales width and height differently, so mapping design
coordinates by ratio silently misses.

```js
const nodePoint = (nodeId, fx = 0.5, fy = 0.5) => page.evaluate(([id, ax, ay]) => {
  for (const f of document.querySelectorAll("iframe")) {
    const d = f.contentDocument; if (!d) continue;
    const el = d.querySelector(`[data-agent-native-node-id="${id}"]`);
    if (!el) continue;
    const fr = f.getBoundingClientRect();
    const s = fr.width / d.documentElement.clientWidth;
    const r = el.getBoundingClientRect();
    return { x: Math.round(fr.x + (r.x + r.width * ax) * s),
             y: Math.round(fr.y + (r.y + r.height * ay) * s) };
  }
  return null;
}, [nodeId, fx, fy]);
```

**Avoid the edges.** A point ~8px inside a frame's top edge grabs the *resize
handle*, not the frame. Prefer an empty interior region (e.g. `fx 0.9, fy 0.5`
on a container whose children sit left).

### Targeting a specific frame

Breakpoints add a **second side-by-side iframe** rather than resizing the first.
Select by inner width, not by index:

```js
const frames = () => page.evaluate(() => [...document.querySelectorAll("iframe")]
  .filter(f => f.getBoundingClientRect().width > 40)
  .map(f => ({ css: Math.round(f.getBoundingClientRect().width),
               innerW: f.contentDocument?.documentElement.clientWidth })));
// => [{css:338, innerW:1440}, {css:190, innerW:810}]
```

A breakpoint frame is covered by an overlay `DIV`, so clicks inside it select
nothing (`elementFromPoint` returns `DIV.relative h-full w-full select-none…`
instead of the `IFRAME`). Edit in the base frame with the chip setting scope.

## Expand every layers-panel row

The chevron is indented per level — a fixed `x + 14` only ever hits level 1.

```js
const expandAll = async () => {
  for (let i = 0; i < 10; i++) {
    const c = await page.evaluate(() => {
      const r = [...document.querySelectorAll('[role="treeitem"]')]
        .find(x => x.getAttribute("aria-expanded") === "false");
      if (!r) return null;
      const b = r.getBoundingClientRect();
      const chev = [...r.querySelectorAll("svg,button")].map(e => e.getBoundingClientRect())
        .filter(g => g.width > 4 && g.width < 24 && g.x < b.x + 110)
        .sort((p, q) => p.x - q.x)[0];
      const box = chev ?? { x: b.x + 14, y: b.y, width: 0, height: b.height };
      return { x: Math.round(box.x + (box.width || 0) / 2),
               y: Math.round(box.y + (box.height || b.height) / 2) };
    });
    if (!c) break;
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(450);
  }
};
```

## Read PERSISTED state, never the DOM

```js
const files = async () => {
  const d = await rest.get(`/_agent-native/actions/get-design?id=${designId}`).then(r => r.json());
  return Object.fromEntries(d.files.map(f => [f.filename, f.content]));
};
```

Give layers distinct names in fixtures (`data-agent-native-layer-name="Alpha"`)
or the panel shows three identical rows and order is unreadable.

## Screenshots — mandatory per interaction (see SKILL.md for the rules)

`shot.mjs` exists so there is no excuse for a claim without evidence, and so
the paths land in the report.

```js
import { shots } from "./shot.mjs";

const cap = shots("drag-into-col");
await cap.app(page, "before");          // whole editor
await cap.node(page, "hero", "before"); // one node, cropped from its iframe rect
/* …gesture… */
await cap.screen(page, "after");        // just the rendered screen
console.log(cap.report());              // paste both paths into the finding
```

Figma side — the caller must already hold the lock:

```js
await withLock("osmouse", async () => {
  const F = await open();
  await F.selExact("Hero");
  await F.page.keyboard.press("Shift+Digit2");   // zoom to selection
  await F.page.waitForTimeout(1200);
  await cap.figma(F.page, "after");
});
```

**Then open every path with the Read tool.** Saving is not looking; an image
nobody opened is not evidence, and neither is an agent's prose summary of one.

## osmouse: a drag that proves it grabbed

```js
const verifiedDrag = async ({ nodeName, from, to }) => {
  await selExact(nodeName);
  const before = await geo();
  execFileSync("/usr/bin/open", ["-a", "Google Chrome"]); await sleep(1200);
  const [sx, sy] = scr(from.x, from.y);
  osm("move", sx, sy);  await sleep(250);
  osm("down", sx, sy);  await sleep(350);
  osm("dragto", sx + 24, sy + 12, 8); await sleep(500);
  const mid = await geo();
  if (mid.x === before.x && mid.y === before.y) {   // never report a drag you did not make
    osm("up");
    return { grabbed: false, reason: "press did not grab the node" };
  }
  const [tx, ty] = scr(to.x, to.y);
  osm("dragto", tx, ty, 40); await sleep(400);
  osm("jiggle", 12);         await sleep(300);      // wake hover/drop targets
  osm("up");                 await sleep(2200);
  return { grabbed: true, before, after: await geo() };
};
```

## Figma: locate by probing, not by arithmetic

Inspector X/Y is parent-relative for auto-layout children.

```js
const locateOnCanvas = async (name, area, step = 14) => {
  const hits = [];
  for (let y = area.y; y <= area.y + area.h; y += step)
    for (let x = area.x; x <= area.x + area.w; x += step) {
      await page.keyboard.press("Escape"); await page.waitForTimeout(90);
      await page.mouse.click(x, y);        await page.waitForTimeout(260);
      if (await selectedIs(name)) hits.push({ x, y });
    }
  if (!hits.length) return null;
  return { centre: { x: avg(hits, "x"), y: avg(hits, "y") }, hits: hits.length };
};
```

Figma shortcuts: `Shift+2` zoom to selection, `Shift+0` 100%, `Shift+1` fit,
`Shift+A` wrap in auto layout. **Bare number keys set opacity** — pressing `2`
once set a real frame to 20%.

## Running e2e without stepping on the dev server

```bash
lsof -nP -iTCP:9401 -sTCP:LISTEN -t | xargs -r kill   # a hung teardown holds it
E2E_PORT=9401 \
  pnpm exec playwright test e2e/<spec>.spec.ts --reporter=line
```

Baseline at HEAD by stashing **only** the product files (and your spec edits):

```bash
git stash push -- <product files> <edited specs>
# run
git stash pop && git add <the same files>   # pop leaves them unstaged
```
