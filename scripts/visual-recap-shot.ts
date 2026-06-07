#!/usr/bin/env node
/**
 * Capture a PNG screenshot of a rendered plan page using Playwright chromium.
 *
 * Invoked from the workflow via the plan template's already-present Playwright:
 *   pnpm exec tsx scripts/visual-recap-shot.ts \
 *     --url <plan url> --out recap.png
 *
 * Because the plan is org-visibility (login-gated), an UNAUTHENTICATED chromium
 * may land on a sign-in screen rather than the plan. That is fine for v1: we
 * still capture whatever renders and upload it as a workflow ARTIFACT — we do
 * NOT embed it in the PR comment (see TODO(phase-2) in the workflow). The
 * comment's durable value is the link, not the image.
 *
 * Args:
 *   --url <url>   Plan URL to navigate to (required).
 *   --out <path>  PNG output path (default: recap.png).
 *   --token <t>   Optional bearer token; if given, sent as an Authorization
 *                 header so an authenticated render is attempted.
 *
 * Never throws fatally for the workflow's sake — on any failure it prints a
 * JSON `{ ok:false, reason }` and exits 0 so the screenshot step is best-effort.
 */

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = "true";
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const url = args.url;
const out = args.out || "recap.png";
const token = args.token && args.token !== "true" ? args.token : null;

function done(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exit(0);
}

if (!url || url === "true") {
  done({ ok: false, reason: "missing --url" });
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (err) {
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    done({
      ok: false,
      reason: `playwright not available: ${err?.message ?? err}`,
    });
  }
}

const HARD_TIMEOUT_MS = 60_000;

let browser;
const hardTimer = setTimeout(() => {
  done({ ok: false, reason: "hard 60s timeout reached" });
}, HARD_TIMEOUT_MS);

try {
  browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    ...(token
      ? { extraHTTPHeaders: { authorization: `Bearer ${token}` } }
      : {}),
  });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });

  // Wait for a stable signal that the plan document rendered. We try a few
  // selectors the plan app uses for rendered content, then fall back to a short
  // settle delay so we still capture *something* if none match (e.g. a login
  // screen on an org-gated plan).
  const selectors = [
    "[data-plan-document]",
    "[data-plan-block]",
    "main article",
    "[data-testid='plan-document']",
    "main",
  ];
  let matched = false;
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 6_000, state: "visible" });
      matched = true;
      break;
    } catch {
      /* try the next selector */
    }
  }
  // Let fonts / sketch overlays settle.
  await page.waitForTimeout(matched ? 1_200 : 500);

  await page.screenshot({ path: out, fullPage: true });
  clearTimeout(hardTimer);
  await browser.close();
  done({ ok: true, out, matched });
} catch (err) {
  clearTimeout(hardTimer);
  try {
    if (browser) await browser.close();
  } catch {
    /* ignore */
  }
  done({ ok: false, reason: err?.message ?? String(err) });
}
