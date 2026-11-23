// Collector for the dashboard chart cell's post-click states. Read-only: it
// opens a seeded project, opens the cell's "More actions" menu, closes it with
// the control that opened it, re-opens it, and records what it saw. It never
// renames, deletes or saves a cell.
//
//   node matrix.mjs [--app <name>] [--project <id>] [--cell <label>]
//                   [--allow-red <check-id>]... [--json <path>]
//
// Exit 0 only when every check passes, or when the only failing checks were
// named with --allow-red (a known-red expectation that a fix should turn green).
import fs from "node:fs";

import { evaluate } from "./checks.mjs";
import { measureEndpoint } from "./measure-endpoint.mjs";

// Arguments only: the app's build-time doctor refuses process.env reads outside the
// deploy allowlist, and a check has no business reading credentials anyway.
const args = process.argv.slice(2);
const allowRed = [];
let jsonPath = null;
let app = "analytics-2";
let PROJECT = "prj_sample_16ud0pb_revenue";
let CELL = "Chart 1";
let URL_PATH = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--allow-red") allowRed.push(args[(i += 1)]);
  else if (args[i] === "--json") jsonPath = args[(i += 1)];
  else if (args[i] === "--app") app = args[(i += 1)];
  else if (args[i] === "--project") PROJECT = args[(i += 1)];
  else if (args[i] === "--cell") CELL = args[(i += 1)];
  else if (args[i] === "--url") URL_PATH = args[(i += 1)];
}
const BASE = `https://labs.agent-native.com/${app}`;

const { endpoint } = measureEndpoint({ app, note: () => {} });
const version = await fetch(`${endpoint}/json/version`).then((r) => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
ws.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const entry = pending.get(message.id);
  pending.delete(message.id);
  message.error
    ? entry.rej(new Error(message.error.message))
    : entry.res(message.result || {});
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    );
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --url runs the same checks against another app's real page; the evaluator
// reports BLOCKED when this journey's surface is not there, never a pass.
const pageUrl = URL_PATH ?? `${BASE}/project/${PROJECT}/latest`;
const target = await send("Target.createTarget", { url: pageUrl });
const session = (
  await send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  })
).sessionId;
await send("Runtime.enable", {}, session);
const evaluateInPage = async (expression) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const result = await send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        session,
      );
      return result.result?.value;
    } catch {
      await wait(1500);
    }
  }
  throw new Error("the page never answered");
};

const trigger = `document.querySelector('[aria-label="More actions for ${CELL}"]')`;
const menuState = `(()=>{const m=document.querySelector('[role="menu"]'); if(!m) return {open:false, items:[], dividers:0, rightEdge:0, triggerRight:0, focusOnFirstItem:false, ownerLabel:null}; const r=m.getBoundingClientRect(); const t=${trigger}.getBoundingClientRect(); const items=[...m.querySelectorAll('[role="menuitem"]')]; const seps=[...m.querySelectorAll('hr,[role="separator"]')]; const danger=items.findIndex(i=>/is-danger/.test(i.className)); return {open:true, items:items.map(i=>(i.textContent||'').trim()), dividers:seps.length, rightEdge:Math.round(r.right), triggerRight:Math.round(t.right), focusOnFirstItem:items[0]===document.activeElement, ownerLabel:m.getAttribute('aria-label'), dangerIndex:danger>=0?danger:null, dividersBefore:danger>=0?seps.filter(x=>x.compareDocumentPosition(items[danger])&Node.DOCUMENT_POSITION_FOLLOWING).length:null};})()`;

let found = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluateInPage(`(()=>!!${trigger})()`)) {
    found = true;
    break;
  }
  await wait(2000);
}
await wait(2000);

const observation = { trustedInput: false, triggerFound: found };
// A page that never shows the control is a blocked surface, not a failing menu:
// report it that way instead of scoring checks against an absent element.
if (!found) {
  observation.servedSha = await evaluateInPage(
    `(async()=>{const r=await fetch('${BASE}/',{method:'HEAD'}); return r.headers.get('x-agent-native-build-sha');})()`,
  );
  const blocked = evaluate(observation);
  const report = {
    kind: "postclick-matrix",
    app,
    journey: "chart cell -> More actions menu -> close -> reopen",
    servedSha: observation.servedSha,
    observation,
    ...blocked,
    allowRed,
    unexpected: [],
    exit: 3,
    note: "the control this journey starts from is not on this page; the surface is BLOCKED here",
  };
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await send("Target.closeTarget", { targetId: target.targetId });
  ws.close();
  process.exit(3);
}

Object.assign(observation, {
  chart: await evaluateInPage(
    `(()=>{const cell=${trigger}.closest('.nb-cell'); const out=cell.querySelector('.nb-output'); return {hasTable:!!out?.querySelector('table'), chartSurface:out?out.querySelectorAll('svg,canvas').length:0, rows:out?out.querySelectorAll('tbody tr').length:0};})()`,
  ),
});

// Dispatch a hover first: the cell action group is reveal-on-hover, so a hit test
// or a click before the pointer arrives measures the inert layer behind it.
await send(
  "Input.dispatchMouseEvent",
  { type: "mouseMoved", x: 10, y: 10 },
  session,
).catch(() => {});
await evaluateInPage(
  `(()=>{const t=${trigger}; if(!t) return false; t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect(); window.__pcPoint={x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}; return true;})()`,
);
const point = await evaluateInPage(`(()=>window.__pcPoint||null)()`);
if (point) {
  await send(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: point.x, y: point.y },
    session,
  ).catch(() => {});
  await wait(300);
}
observation.visibility = await evaluateInPage(
  `(()=>{const t=${trigger}; if(!t) return null; const r=t.getBoundingClientRect(); t.scrollIntoView({block:'center'}); const r2=t.getBoundingClientRect(); const hit=document.elementFromPoint(Math.round(r2.left+r2.width/2), Math.round(r2.top+r2.height/2)); return {triggerBox:{top:Math.round(r2.top),bottom:Math.round(r2.bottom),left:Math.round(r2.left),right:Math.round(r2.right)}, viewport:{width:window.innerWidth,height:window.innerHeight}, hitIsTrigger:!!hit && (hit===t || t.contains(hit)), triggerEntity:(t.getAttribute('aria-label')||'').replace(/^More actions for /,'')||null, boxBeforeScrollTop:Math.round(r.top)};})()`,
);
await evaluateInPage(`(()=>{${trigger}.click(); return true;})()`);
await wait(900);
observation.menuOpen = await evaluateInPage(menuState);

// Close with the control that opened it, then check that it actually closed
// before observing anything else.
await evaluateInPage(`(()=>{${trigger}.click(); return true;})()`);
await wait(900);
observation.afterClose = await evaluateInPage(
  `(()=>{const open=!!document.querySelector('[role="menu"]'); const active=document.activeElement; const inMenu=!!active?.closest?.('[role="menu"]'); const label=active===${trigger}?'trigger':(active?.getAttribute?.('aria-label')||active?.tagName||null); return {open, activeLabel:label, focusedInMenu:inMenu};})()`,
);

await evaluateInPage(`(()=>{${trigger}.click(); return true;})()`);
await wait(900);
observation.reopened = await evaluateInPage(menuState);
await evaluateInPage(`(()=>{${trigger}.click(); return true;})()`);

observation.servedSha = await evaluateInPage(
  `(async()=>{const r=await fetch('${BASE}/',{method:'HEAD'}); return r.headers.get('x-agent-native-build-sha');})()`,
);
observation.pageUrl = pageUrl;
await send("Target.closeTarget", { targetId: target.targetId });
ws.close();

const result = evaluate(observation);
const unexpected = result.failed.filter((id) => !allowRed.includes(id));
const EXIT = { PASS: 0, FAIL: 1, INCOMPLETE: 2, BLOCKED: 3 };
const report = {
  kind: "postclick-matrix",
  app,
  journey: "chart cell -> More actions menu -> close -> reopen",
  servedSha: observation.servedSha,
  observation,
  ...result,
  allowRed,
  unexpected,
  exit: unexpected.length > 0 ? 1 : (EXIT[result.verdict] ?? 1),
};

if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.exit);
