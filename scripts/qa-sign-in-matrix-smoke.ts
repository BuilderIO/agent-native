#!/usr/bin/env node
/**
 * Cross-surface sign-in matrix — the browser-driven half.
 *
 * Every login fix shipped before the one sign-in journey held for exactly one
 * surface, because no test covered more than one. This script boots a real
 * template app twice — once at the root base path, once under `/chatapp` — and
 * drives the actual login document with a real browser, then embeds the app in
 * a genuinely cross-origin iframe.
 *
 * Per deploy it proves the four things a return-path regression breaks:
 *
 *   1. an anonymous visitor to a protected route reaches sign-in carrying an
 *      opaque continuation for THAT route;
 *   2. after signing in through the real form they land back on that route,
 *      not on the app root;
 *   3. a signed-in visitor hitting an auth entry path does not loop;
 *   4. a forged continuation cannot nest, cannot leave the origin, and cannot
 *      escape the app's own base path into a sibling app.
 *
 * The `/chatapp` deploy is the one that mattered: `__anBasePath()` used to be
 * marker-only, so `/chatapp/login` was not recognised as an auth entry path
 * and case 3 was a live infinite bounce.
 *
 * The request-level half of the matrix — Builder desktop proxy, Agent Native
 * Desktop deep link, mobile WebView, MCP opaque-origin embed, identity-SSO
 * hop, `/_agent-native/open`, MCP authorize, CDN-cached shell — lives in
 * packages/core/src/server/sign-in-matrix.spec.ts. Those surfaces complete
 * sign-in through a mechanism a headless browser cannot reproduce (a separate
 * Electron cookie jar, a custom-scheme deep link, a native shell), so they are
 * asserted against the shipped runtime rather than mimed with a fake browser.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import type { Browser, BrowserContext, Frame, Page } from "playwright";

import { MISSING_BROWSER_HINT } from "./playwright-browser-hint";

const repoRoot = path.resolve(import.meta.dirname, "..");
const requireFromCore = createRequire(
  path.join(repoRoot, "packages/core/package.json"),
);
const { chromium } = requireFromCore(
  "playwright",
) as typeof import("playwright");

const templateDir = path.join(repoRoot, "templates", "chat");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "an-sign-in-matrix-"));
const appPort = Number(process.env.SIGN_IN_MATRIX_SMOKE_PORT || 9351);
const embedPort = Number(process.env.SIGN_IN_MATRIX_EMBED_PORT || 9353);
const qaEmail = "qa-sign-in-matrix@example.test";
const qaPassword = "local-dev-account";

/** The protected route the anonymous visitor asks for, query and hash included. */
const PROTECTED_ROUTE = "/settings?tab=general#profile";

interface RunningApp {
  origin: string;
  /** `""` for the root deploy, `/chatapp` for the base-path deploy. */
  basePath: string;
  /** `origin + basePath` — what a user would call "the app URL". */
  appUrl: string;
  child: ChildProcessWithoutNullStreams;
  logs: string[];
}

/**
 * Assert core has been built once, rather than rebuilding it here: a rebuild
 * would make this smoke fail for whatever else happens to be mid-edit in the
 * tree, which is not what it is testing.
 */
function requireCoreBuild(): void {
  const dist = path.join(repoRoot, "packages/core/dist/cli/index.js");
  if (fs.existsSync(dist)) return;
  throw new Error(
    `Missing ${dist}. Run \`pnpm --filter @agent-native/core build\` first.`,
  );
}

function cleanGeneratedFiles(): void {
  fs.rmSync(path.join(templateDir, ".react-router"), {
    recursive: true,
    force: true,
  });
}

function appEnv(appUrl: string, basePath: string, dbPath: string) {
  const databaseUrl = `file:${dbPath}`;
  return {
    ...process.env,
    APP_NAME: "chat",
    APP_URL: appUrl,
    BETTER_AUTH_URL: appUrl,
    NODE_ENV: "development",
    // Without this the loopback dev auto-session signs the "anonymous"
    // visitor in before the gate ever runs, and every assertion below
    // silently tests nothing.
    AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT: "1",
    AUTH_SKIP_EMAIL_VERIFICATION: "1",
    BETTER_AUTH_SECRET: "sign-in-matrix-smoke-secret",
    DATABASE_URL: databaseUrl,
    DATABASE_AUTH_TOKEN: "",
    VITE_APP_BASE_PATH: basePath,
    APP_BASE_PATH: basePath,
    NETLIFY: "",
    VERCEL: "",
    CF_PAGES: "",
    DEPLOY_URL: "",
    URL: "",
    NO_COLOR: "1",
  };
}

async function waitForReady(appUrl: string, logs: string[]): Promise<void> {
  const deadline = Date.now() + 180_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${appUrl}/_agent-native/ping`, {
        redirect: "manual",
        signal: AbortSignal.timeout(2_000),
      });
      // 401 is the expected anonymous answer and still proves the server is up.
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(
    `chat did not become ready at ${appUrl}: ${lastError}\n${logs
      .slice(-100)
      .join("")}`,
  );
}

async function startApp(basePath: string): Promise<RunningApp> {
  const origin = `http://127.0.0.1:${appPort}`;
  const appUrl = `${origin}${basePath}`;
  const dbPath = path.join(tmpRoot, `chat${basePath.replace(/\//g, "-")}.db`);
  const logs: string[] = [];
  cleanGeneratedFiles();
  // Vite directly, not `pnpm dev`: `agent-native dev` is a passthrough to this
  // same binary, the template's `dev` script adds `--open` (which would launch
  // a real browser on the developer's machine), and a pnpm wrapper would leave
  // an orphan holding the port between the two deploys.
  const child = spawn(
    path.join(templateDir, "node_modules/.bin/vite"),
    ["--host", "127.0.0.1", "--port", String(appPort), "--strictPort"],
    {
      cwd: templateDir,
      env: appEnv(appUrl, basePath, dbPath),
      stdio: ["ignore", "pipe", "pipe"],
      // Vite starts Nitro as a child. Own the whole tree so the next base-path
      // deployment cannot accidentally talk to a surviving prior server.
      detached: true,
    },
  );
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  child.on("exit", (code, signal) => {
    logs.push(`\n[chat] exited code=${code} signal=${signal}\n`);
  });

  await waitForReady(appUrl, logs);
  // Prove the server answering is THIS deploy. A leftover process from the
  // previous base path answers `ping` perfectly well, and every assertion
  // below would then re-test the surface that already passed.
  const doc = await (await fetch(`${appUrl}/_agent-native/sign-in`)).text();
  assert.ok(
    doc.includes(`var configured = ${JSON.stringify(basePath)};`),
    `the server on ${appUrl} is not serving base path ${JSON.stringify(basePath)}`,
  );
  return { origin, basePath, appUrl, child, logs };
}

async function portIsFree(): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${appPort}/_agent-native/ping`, {
      redirect: "manual",
      signal: AbortSignal.timeout(1_000),
    });
    return false;
  } catch {
    return true;
  }
}

function signalProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (process.platform === "win32") {
    child.kill(signal);
    return;
  }
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The process group may already have exited.
  }
}

async function stopApp(running: RunningApp): Promise<void> {
  signalProcessTree(running.child, "SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => running.child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  signalProcessTree(running.child, "SIGKILL");
  // The next deploy reuses this port with a different base path, so it must be
  // genuinely free before we start — not merely "the wrapper exited".
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await portIsFree()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`port ${appPort} is still held after stopping the app`);
}

async function launchBrowser(): Promise<Browser> {
  // CI installs only the bundled headless shell, so asking for the Chrome
  // channel there is a guaranteed failed launch before the fallback.
  const channel =
    process.env.PLAYWRIGHT_CHANNEL ||
    (process.env.CI || process.env.GITHUB_ACTIONS ? "" : "chrome");
  if (!channel) return await chromium.launch({ headless: true });
  try {
    return await chromium.launch({ channel, headless: true });
  } catch (channelError) {
    if (process.env.PLAYWRIGHT_CHANNEL) throw channelError;
    try {
      return await chromium.launch({ headless: true });
    } catch (bundledError) {
      const first =
        channelError instanceof Error
          ? channelError.message.split("\n")[0]
          : String(channelError);
      const second =
        bundledError instanceof Error
          ? bundledError.message.split("\n")[0]
          : String(bundledError);
      throw new Error(
        [
          "Could not launch Playwright Chromium.",
          `Chrome channel error: ${first}`,
          `Bundled Chromium error: ${second}`,
          MISSING_BROWSER_HINT,
        ].join("\n"),
      );
    }
  }
}

/** Decode a `c` continuation the way the shipped runtime does. */
function decodeToken(token: string): string {
  let b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return decodeURIComponent(Buffer.from(b64, "base64").toString("binary"));
}

function encodeToken(path: string): string {
  return Buffer.from(encodeURIComponent(path), "utf8").toString("base64url");
}

function isAuthEntryPath(pathname: string, basePath: string): boolean {
  if (pathname.endsWith("/_agent-native/sign-in")) return true;
  const rest =
    basePath && pathname.startsWith(basePath)
      ? pathname.slice(basePath.length) || "/"
      : pathname;
  return rest === "/login" || rest === "/signup";
}

function pathnameOf(url: string): string {
  return new URL(url).pathname;
}

function fullPathOf(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search + parsed.hash;
}

/**
 * Navigate and let the page settle, then report every main-frame URL it passed
 * through. A return-path loop shows up here as repeated auth-entry entries.
 */
async function navigateAndSettle(
  page: Page,
  url: string,
  settleMs = 6_000,
): Promise<string[]> {
  const seen: string[] = [];
  const listener = (frame: Frame) => {
    if (frame === page.mainFrame()) seen.push(frame.url());
  };
  page.on("framenavigated", listener);
  try {
    await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
    await page.waitForTimeout(settleMs);
  } finally {
    page.off("framenavigated", listener);
  }
  return seen;
}

/**
 * Ask for a protected route until the client gate answers.
 *
 * Retried rather than waited on: a cold Vite dep-optimize triggers full page
 * reloads that restart the session query, so a single long wait can expire
 * mid-reload on a fresh checkout while the gate itself is fine.
 */
async function reachSignIn(page: Page, url: string): Promise<URL> {
  let lastUrl = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
    try {
      await page.waitForURL(/_agent-native\/sign-in/, { timeout: 30_000 });
      return new URL(page.url());
    } catch {
      lastUrl = page.url();
    }
  }
  throw new Error(
    `anonymous visitor never reached sign-in from ${url} (stuck at ${lastUrl})`,
  );
}

async function signInThroughTheRealForm(page: Page): Promise<void> {
  await page.click('.tab[data-tab="signup"]');
  await page.fill("#s-email", qaEmail);
  await page.fill("#s-pass", qaPassword);
  await page.fill("#s-pass2", qaPassword);
  await page.click("#signup-form button[type=submit]");
}

/** Surfaces 1 and 2: top-level app at root, and under a non-root base path. */
async function runDeploySuite(
  context: BrowserContext,
  app: RunningApp,
): Promise<void> {
  const label = app.basePath || "/ (root)";
  const page = await context.newPage();
  const protectedPath = `${app.basePath}${PROTECTED_ROUTE}`;

  // 1. Anonymous visitor to a protected route reaches sign-in with a
  //    continuation for THAT route.
  const gateUrl = await reachSignIn(page, `${app.origin}${protectedPath}`);
  assert.equal(
    gateUrl.pathname,
    `${app.basePath}/_agent-native/sign-in`,
    `[${label}] the gate must send the visitor to this app's sign-in entry, under its own base path`,
  );
  const token = gateUrl.searchParams.get("c");
  assert.ok(token, `[${label}] the gate must carry a c continuation`);
  assert.equal(
    decodeToken(token),
    protectedPath,
    `[${label}] the continuation must round-trip the exact requested route, query and hash included`,
  );
  // Opacity is what makes nesting structurally impossible: nothing downstream
  // can mistake the token for a redirect target and re-wrap it.
  assert.ok(
    !/[/?:]|%2F/i.test(token),
    `[${label}] the continuation must be opaque, not a re-encoded URL: ${token}`,
  );
  assert.equal(
    gateUrl.searchParams.get("return"),
    null,
    `[${label}] new producers must not emit the legacy ?return= grammar`,
  );

  // 2. Signing in through the real login document lands back on that route.
  await signInThroughTheRealForm(page);
  await page.waitForURL(
    (url) => pathnameOf(url.toString()) === `${app.basePath}/settings`,
    { timeout: 60_000 },
  );
  assert.equal(
    fullPathOf(page.url()),
    protectedPath,
    `[${label}] sign-in must resume the original route, not the app root`,
  );

  // 3. A signed-in visitor at an auth entry path does not loop.
  for (const entry of ["/login", "/signup", "/_agent-native/sign-in"]) {
    const entryPath = `${app.basePath}${entry}`;
    const visited = await navigateAndSettle(page, `${app.origin}${entryPath}`);
    const landed = pathnameOf(page.url());
    assert.equal(
      isAuthEntryPath(landed, app.basePath),
      false,
      `[${label}] a signed-in visitor must be moved off ${entryPath}, got ${landed}`,
    );
    const authEntryVisits = visited.filter((url) =>
      isAuthEntryPath(pathnameOf(url), app.basePath),
    );
    assert.ok(
      authEntryVisits.length <= 1,
      `[${label}] ${entryPath} bounced through the auth entry more than once: ${authEntryVisits.join(" -> ")}`,
    );
  }

  // 4. A forged continuation cannot nest, leave the origin, or escape the base
  //    path into a sibling app on the same host.
  const forged: Array<[string, string]> = [
    ["nested sign-in", encodeToken(`${app.basePath}/_agent-native/sign-in`)],
    ["nested login", encodeToken(`${app.basePath}/login`)],
    ["absolute url", encodeToken("https://evil.example/pwned")],
    ["protocol relative", encodeToken("//evil.example/pwned")],
    ["backslash relative", encodeToken("/\\evil.example/pwned")],
    ["sibling app", encodeToken("/otherapp/admin")],
    ["not a token at all", "https://evil.example/pwned"],
  ];
  for (const [name, badToken] of forged) {
    // A root deploy has no base path, so "sibling app" is a legitimate
    // in-app route there and is only an escape under a base path.
    if (name === "sibling app" && !app.basePath) continue;
    const target = `${app.origin}${app.basePath}/_agent-native/sign-in?c=${encodeURIComponent(badToken)}`;
    await navigateAndSettle(page, target);
    const landed = pathnameOf(page.url());
    assert.equal(
      isAuthEntryPath(landed, app.basePath),
      false,
      `[${label}] forged continuation (${name}) left the visitor stuck at ${landed}`,
    );
    assert.ok(
      landed === (app.basePath || "/") || landed.startsWith(`${app.basePath}/`),
      `[${label}] forged continuation (${name}) escaped to ${landed}`,
    );
    assert.equal(
      new URL(page.url()).origin,
      app.origin,
      `[${label}] forged continuation (${name}) left the origin`,
    );
  }

  await page.close();
}

/**
 * Surface: third-party iframe embed.
 *
 * `localhost` and `127.0.0.1` are different origins to the browser, so a page
 * served from one framing the app on the other is a genuine third-party frame
 * — same cookie partitioning rules a Builder preview embed hits. What this
 * asserts is the WHERE-YOU-LAND half: the framed gate redirects the FRAME to
 * this app's sign-in with the right continuation and never busts out to the
 * top window. Whether the cookie is delivered inside a partitioned frame is a
 * separate, unfixed problem (see the changeset).
 */
async function runIframeSuite(
  context: BrowserContext,
  app: RunningApp,
): Promise<void> {
  const parentOrigin = `http://localhost:${embedPort}`;
  const framed = `${app.origin}${app.basePath}${PROTECTED_ROUTE}`;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><title>embed host</title><iframe id="app" style="width:900px;height:700px" src="${framed}"></iframe>`,
    );
  });
  await new Promise<void>((resolve) =>
    server.listen(embedPort, "127.0.0.1", resolve),
  );

  const page = await context.newPage();
  try {
    await page.goto(parentOrigin, { waitUntil: "commit", timeout: 60_000 });
    const deadline = Date.now() + 120_000;
    let frameUrl = "";
    while (Date.now() < deadline) {
      const frame = page.frames().find((f) => f !== page.mainFrame());
      frameUrl = frame?.url() ?? "";
      if (frameUrl.includes("/_agent-native/sign-in")) break;
      await page.waitForTimeout(500);
    }
    assert.ok(
      frameUrl.includes("/_agent-native/sign-in"),
      `framed anonymous visitor never reached sign-in (frame at ${frameUrl || "<none>"})`,
    );
    const token = new URL(frameUrl).searchParams.get("c");
    assert.ok(token, "framed sign-in must carry a c continuation");
    assert.equal(
      decodeToken(token),
      `${app.basePath}${PROTECTED_ROUTE}`,
      "framed sign-in must resume the route the frame asked for",
    );
    assert.equal(
      new URL(page.url()).origin,
      parentOrigin,
      "the framed gate must never navigate the top window",
    );
  } finally {
    await page.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function main(): Promise<void> {
  requireCoreBuild();
  let browser: Browser | null = null;
  let running: RunningApp | null = null;
  try {
    browser = await launchBrowser();

    for (const basePath of ["", "/chatapp"]) {
      running = await startApp(basePath);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      try {
        await runDeploySuite(context, running);
        if (!basePath) {
          const anonymous = await browser.newContext();
          try {
            await runIframeSuite(anonymous, running);
          } finally {
            await anonymous.close();
          }
        }
      } catch (err) {
        const logs = running.logs.slice(-120).join("");
        const message =
          err instanceof Error ? err.stack || err.message : String(err);
        throw new Error(`${message}\n\nRecent chat logs:\n${logs}`);
      } finally {
        await context.close();
      }
      await stopApp(running);
      running = null;
    }

    console.log("qa-sign-in-matrix-smoke: clean");
    console.log("  browser-driven surfaces:");
    console.log("    1. top-level app, root base path (control case)");
    console.log("    2. non-root base path /chatapp (the live bounce)");
    console.log("    3. third-party iframe embed (return path only)");
    console.log("  per surface: gate -> opaque c -> resume exact route,");
    console.log("               signed-in auth entry does not loop,");
    console.log("               forged continuations cannot nest or escape");
    console.log(
      "  request-level surfaces: packages/core/src/server/sign-in-matrix.spec.ts",
    );
  } finally {
    if (running) await stopApp(running);
    if (browser) await browser.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    cleanGeneratedFiles();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
