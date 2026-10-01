import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Harness configuration for the two places this skill runs: a Fusion branch
 * container (headed Chromium on display :99, the dev server on 8080) and a
 * developer machine (your Chrome, one dev server per worktree). Every value
 * can be overridden by the environment variable named beside it.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

function findWorktree() {
  if (process.env.WORKTREE) return resolve(process.env.WORKTREE);
  for (let dir = HERE; dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(`${dir}/templates/design/package.json`)) return dir;
  }
  console.error(`No agent-native checkout above ${HERE}. Set WORKTREE.`);
  process.exit(2);
}

export const WORKTREE = findWorktree();
export const FUSION = Boolean(
  process.env.FUSION_ENVIRONMENT?.startsWith("cloud"),
);

// A Fusion branch ends a command after 5 minutes, so every harness script ends
// itself first with a readable error.
const HARNESS_TIMEOUT_MS = Number(
  process.env.HARNESS_TIMEOUT_MS ?? (FUSION ? 280 : 540) * 1000,
);
setTimeout(() => {
  console.error(
    `harness timeout: ${process.argv[1]} ran over ${HARNESS_TIMEOUT_MS / 1000}s and was stopped. ` +
      `Split the probe, or screenshot where it stalls.`,
  );
  process.exit(124);
}, HARNESS_TIMEOUT_MS).unref();

export const SLUG = createHash("sha1")
  .update(WORKTREE)
  .digest("hex")
  .slice(0, 6);

/**
 * Locally each worktree gets its own port and database, so parallel worktrees
 * never collide. A `.port` file pins a worktree to a server that already runs.
 */
const PINNED = (() => {
  const file = `${WORKTREE}/templates/design/.tmp/parity/.port`;
  if (!existsSync(file)) return undefined;
  const port = Number(readFileSync(file, "utf8").trim().split(/\s+/)[0]);
  return Number.isFinite(port) && port > 0 ? port : undefined;
})();
export const PORT = Number(
  process.env.DESIGN_PORT ??
    (FUSION ? 8080 : (PINNED ?? 9300 + (parseInt(SLUG, 16) % 90))),
);
// A Fusion branch serves every template behind the dev-lazy gateway on 8080,
// with Design mounted at /design. Stay on 127.0.0.1: the gateway redirects
// localhost there, and only gateway traffic keeps Design from being evicted.
export const BASE =
  process.env.DESIGN_BASE ??
  `http://127.0.0.1:${PORT}${FUSION ? "/design" : ""}`;
export const E2E_PORT = Number(process.env.E2E_PORT ?? PORT + 100);
export const PGLITE = `pglite:${WORKTREE}/templates/design/.tmp/pglite-${SLUG}`;

/** An account on this checkout's own database; the first run registers it. */
export const CREDS = {
  email: process.env.DESIGN_EMAIL ?? "agent+autoz@local.test",
  password: process.env.DESIGN_PASSWORD ?? "password-e2e-1234",
};

/**
 * The deployed Design app and the dedicated test account that reaches real
 * designs. Never register there: a missing account is a setup problem to report.
 */
export const PROD_BASE =
  process.env.DESIGN_PROD_BASE ?? "https://beta.design.agent-native.com";
export const TEST_ACCOUNT =
  process.env.DESIGN_TEST_EMAIL && process.env.DESIGN_TEST_PASSWORD
    ? {
        email: process.env.DESIGN_TEST_EMAIL,
        password: process.env.DESIGN_TEST_PASSWORD,
      }
    : null;

/** Screenshots live in the workspace, where the Read tool can open them. */
export const SHOTS_DIR = `${WORKTREE}/templates/design/.tmp/parity/shots`;
mkdirSync(SHOTS_DIR, { recursive: true });

/**
 * Headed mode attaches to the one shared browser (the branch browser, or your
 * Chrome started with --remote-debugging-port=9222). It is a machine-wide
 * singleton: only use it for osmouse/Figma work, and hold the lock while you
 * do. Everything else runs in its own headless browser and is parallel-safe.
 */
export const HEADED = process.env.HEADED === "1";
export const CDP_URL = process.env.CDP_URL ?? "http://127.0.0.1:9222";
export const OSM =
  process.env.OSMOUSE ??
  (FUSION
    ? `${HERE}/osmouse-linux`
    : `${WORKTREE}/templates/design/.tmp/osinput/osmouse`);
/** Pixels between the top of the screen and the page viewport. */
export const SCREEN_Y_OFFSET = Number(
  process.env.SCREEN_Y_OFFSET ?? (FUSION ? 87 : 120),
);

// Locally Playwright's own Chromium is used; the container has the system one.
const CHROME_BIN =
  process.env.CHROME_BIN ?? (FUSION ? "/usr/bin/chromium" : undefined);
// Chromium refuses to sandbox as root, which is how a Fusion container runs.
// Copied designs run their own scripts, so keep the sandbox everywhere else.
const AS_ROOT = process.getuid?.() === 0;
export const LAUNCH = {
  headless: true,
  ...(CHROME_BIN ? { executablePath: CHROME_BIN } : {}),
  args: AS_ROOT ? ["--no-sandbox", "--disable-dev-shm-usage"] : [],
};

// The skill folder has no node_modules of its own; the Design app pins Playwright.
export const { chromium, request } = createRequire(
  `${WORKTREE}/templates/design/package.json`,
)("playwright");

export function describeEnv() {
  return `${FUSION ? "fusion" : "local"} worktree=${WORKTREE.split("/").pop()} port=${PORT} headed=${HEADED}`;
}
