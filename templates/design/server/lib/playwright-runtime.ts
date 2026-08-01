/**
 * playwright-runtime.ts — shared headless-Chromium bootstrap used by every
 * server-side action that needs a real rendered DOM (as opposed to static
 * HTML/CSS analysis): `take-design-screenshot.ts`'s visual diagnostics pass
 * and `design-to-figma-svg.ts`'s scene extractor for the Figma SVG export.
 *
 * Extracted out of `take-design-screenshot.ts` (which originally owned this
 * logic) so `server/lib/*` modules can share it without an inverted
 * lib -> action dependency. `take-design-screenshot.ts` re-exports these same
 * names for backward compatibility with its existing spec/imports.
 */

export type PlaywrightModule = {
  chromium: import("@playwright/test").BrowserType;
};

// ---------------------------------------------------------------------------
// Cloudflare arm — the platform browser binding + its Playwright fork
// ---------------------------------------------------------------------------

/**
 * Binding name for Cloudflare Browser Rendering. The generated Worker
 * configuration emits exactly this name (see `configureCloudflareModuleBrowser`
 * in `@agent-native/core`'s deploy build) — a hand-picked name here that drifts
 * from the emitted one is an unbound binding at runtime.
 */
export const CLOUDFLARE_BROWSER_BINDING = "BROWSER";

/** The fork's `BrowserWorker`: a binding is anything with a `fetch`. */
export type CloudflareBrowserWorker = { fetch: typeof fetch };

/** `launch` as exported by `@cloudflare/playwright`. */
export type CloudflareLaunch = (
  endpoint: CloudflareBrowserWorker,
) => Promise<import("@playwright/test").Browser>;

export type CloudflareBrowserFailure =
  | "no-env"
  | "unbound"
  | "not-a-browser-binding"
  | "fork-not-installed";

/**
 * A Cloudflare-specific browser failure, kept distinct from "Playwright's
 * Chromium binary is missing" so callers can report the cause that actually
 * applies. Every arm of this is a configuration fact the operator can act on.
 */
export class CloudflareBrowserBindingError extends Error {
  readonly reason: CloudflareBrowserFailure;
  readonly binding = CLOUDFLARE_BROWSER_BINDING;
  readonly detail?: string;

  constructor(
    reason: CloudflareBrowserFailure,
    options: { detail?: string } = {},
  ) {
    super(cloudflareBrowserFailureMessage(reason, options.detail));
    this.name = "CloudflareBrowserBindingError";
    this.reason = reason;
    this.detail = options.detail;
  }
}

function cloudflareBrowserFailureMessage(
  reason: CloudflareBrowserFailure,
  detail?: string,
): string {
  const suffix = detail ? ` (${detail})` : "";
  switch (reason) {
    case "no-env":
      return (
        "This looks like a Cloudflare Worker, but no Worker environment is " +
        "readable, so the " +
        `${CLOUDFLARE_BROWSER_BINDING} browser binding cannot be resolved. ` +
        "Bindings are captured per invocation by the generated Worker entry — " +
        "a caller running outside a fetch, queue, or scheduled invocation has " +
        "none." +
        suffix
      );
    case "unbound":
      return (
        `The Cloudflare Worker has no ${CLOUDFLARE_BROWSER_BINDING} binding, ` +
        "so Browser Rendering is unavailable on this deploy. Add " +
        `\`"browser": { "binding": "${CLOUDFLARE_BROWSER_BINDING}" }\` to the ` +
        "Worker's wrangler configuration and redeploy." +
        suffix
      );
    case "not-a-browser-binding":
      return (
        `The Cloudflare Worker's ${CLOUDFLARE_BROWSER_BINDING} binding exists ` +
        "but is not a Browser Rendering binding (no fetch()) — check what the " +
        "wrangler configuration bound to that name." +
        suffix
      );
    case "fork-not-installed":
      return (
        "The Cloudflare Worker has a Browser Rendering binding, but " +
        "@cloudflare/playwright — the Playwright-compatible fork that drives " +
        "it — could not be imported. Install it as a dependency of this app." +
        suffix
      );
  }
}

/**
 * Model-actionable cause when `err` is a Cloudflare browser failure, `null`
 * otherwise. Callers use it to name the real cause instead of the Node-shaped
 * "this deploy does not bundle a Chromium binary", which is wrong here: on a
 * Worker the browser is a binding, not a binary.
 */
export function cloudflareBrowserCauseMessage(err: unknown): string | null {
  return err instanceof CloudflareBrowserBindingError ? err.message : null;
}

function readCloudflareEnv(): Record<string, unknown> | null {
  const scope = globalThis as {
    __cf_env?: Record<string, unknown>;
    __env__?: Record<string, unknown>;
  };
  return scope.__cf_env ?? scope.__env__ ?? null;
}

/**
 * True on Cloudflare Workers, including the local Workers runtime. Core's
 * `shared/runtime.ts` holds the same predicate, but it is not reachable
 * through any `@agent-native/core` export a template may import.
 */
export function isCloudflareWorkerRuntime(): boolean {
  return (
    "__cf_env" in globalThis ||
    "__env__" in globalThis ||
    (typeof navigator !== "undefined" &&
      navigator.userAgent === "Cloudflare-Workers")
  );
}

/**
 * The bound Browser Rendering binding, or a thrown
 * `CloudflareBrowserBindingError` naming which of the three configuration
 * facts is true. There is deliberately no null/placeholder return: a caller
 * that could not tell "unbound" from "bound" would launch into nothing and
 * report a blank render as a screenshot.
 */
export function requireCloudflareBrowserBinding(
  env: Record<string, unknown> | null = readCloudflareEnv(),
): CloudflareBrowserWorker {
  if (!env) throw new CloudflareBrowserBindingError("no-env");
  const binding = env[CLOUDFLARE_BROWSER_BINDING];
  if (binding == null) throw new CloudflareBrowserBindingError("unbound");
  if (
    typeof binding !== "object" ||
    typeof (binding as CloudflareBrowserWorker).fetch !== "function"
  ) {
    throw new CloudflareBrowserBindingError("not-a-browser-binding");
  }
  return binding as CloudflareBrowserWorker;
}

/**
 * Adapt the fork's `launch(binding)` to the `{ chromium }` shape the Node arms
 * return, so both call sites keep going through `launchChromium`. The launch
 * options the Node path passes are dropped on purpose: `--no-sandbox` and an
 * `executablePath` describe a locally spawned process, and Browser Rendering
 * has neither.
 */
export function createCloudflareBrowserRuntime(
  launch: CloudflareLaunch,
  binding: CloudflareBrowserWorker,
): PlaywrightModule {
  return {
    chromium: {
      launch: () => launch(binding),
    } as unknown as import("@playwright/test").BrowserType,
  };
}

async function importCloudflarePlaywright(): Promise<PlaywrightModule> {
  const binding = requireCloudflareBrowserBinding();
  let launch: CloudflareLaunch;
  try {
    // Literal specifier on purpose, unlike the Node arms above: a Worker
    // cannot resolve a module at runtime, so the fork has to be statically
    // linkable or it is simply not there when this line runs.
    ({ launch } = (await import("@cloudflare/playwright")) as unknown as {
      launch: CloudflareLaunch;
    });
  } catch (err) {
    throw new CloudflareBrowserBindingError("fork-not-installed", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  return createCloudflareBrowserRuntime(launch, binding);
}

/**
 * Dynamic import of a real Chromium-capable Playwright package.  On Cloudflare
 * Workers that is the platform's Browser Rendering binding driven through
 * `@cloudflare/playwright` (an optionalDependency of this template — the
 * package is absent wherever the binding is). Elsewhere it tries the bare
 * `"playwright"` package first (present when `@agent-native/core`'s optional
 * dependency resolved), then falls back to `@playwright/test` (a direct
 * devDependency of this template, used by its own e2e suite, which re-exports
 * the same chromium/Browser API). Loaded via a non-literal specifier so
 * bundlers don't try to statically resolve/include it — it's optional and can
 * be entirely absent (e.g. in a hosted deploy).
 */
export async function importPlaywright(): Promise<PlaywrightModule> {
  if (isCloudflareWorkerRuntime()) return await importCloudflarePlaywright();
  try {
    const specifier = "playwright";
    return (await import(
      /* @vite-ignore */ specifier
    )) as unknown as PlaywrightModule;
  } catch {
    return (await import("@playwright/test")) as unknown as PlaywrightModule;
  }
}

const SYSTEM_CHROME_EXECUTABLES = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

/** Pure classifier for "no Chromium binary available" errors. */
export function isMissingBrowserError(err: unknown): boolean {
  // A Cloudflare binding failure is a different fact: there is no binary to be
  // missing, and treating it as one would send the caller down the
  // system-Chrome fallback and report the wrong cause.
  if (err instanceof CloudflareBrowserBindingError) return false;
  const message = err instanceof Error ? err.message : String(err);
  return /Executable doesn't exist|playwright install|browser.*not found|chromium.*not found/i.test(
    message,
  );
}

/**
 * "No browser to render with", whichever runtime we are on: a missing local
 * Chromium binary, or a Cloudflare Worker whose browser capability is not
 * configured. Callers turn this into their own `{ ok: false, reason }`.
 */
export function isBrowserUnavailableError(err: unknown): boolean {
  return err instanceof CloudflareBrowserBindingError
    ? true
    : isMissingBrowserError(err);
}

/** Launches Chromium, falling back to a system Chrome/Chromium binary when
 *  Playwright's bundled browser isn't installed (hosted/serverless deploys). */
export async function launchChromium(
  chromium: import("@playwright/test").BrowserType,
): Promise<import("@playwright/test").Browser> {
  const launchOptions = { args: ["--no-sandbox"] };
  try {
    return await chromium.launch(launchOptions);
  } catch (err) {
    if (!isMissingBrowserError(err)) throw err;
    // A Worker has no local Chromium to fall back to, and probing for one
    // would run `node:fs` against a filesystem that does not exist — losing
    // the Browser Rendering error that actually explains the failure.
    if (isCloudflareWorkerRuntime()) throw err;
    const { existsSync } = await import("node:fs");
    for (const executablePath of SYSTEM_CHROME_EXECUTABLES) {
      if (!existsSync(executablePath)) continue;
      try {
        return await chromium.launch({ ...launchOptions, executablePath });
      } catch {
        // Try the next candidate; the original error is rethrown below.
      }
    }
    throw err;
  }
}

// NOTE: no shared `chromiumUnavailableReason` here on purpose — each caller's
// message should name ITS OWN fallback (e.g. `take-design-screenshot.ts`
// points at `run-design-audit`; the Figma SVG export points at `export-svg`),
// so that stays a small, action-local export next to each call site. Only the
// CAUSE is shared, through `cloudflareBrowserCauseMessage`.
