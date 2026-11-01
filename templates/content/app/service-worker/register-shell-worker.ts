import {
  appBasePath,
  isWorkspaceRuntime,
} from "@agent-native/core/client/api-path";

import {
  SHELL_ADOPT_MESSAGE,
  SHELL_WORKER_OFF,
  SHELL_WORKER_SCOPE,
  SHELL_WORKER_URL,
  deleteShellCaches,
} from "./shell-contract";
import {
  shellRoutesFromManifest,
  type ReactRouterManifest,
} from "./shell-manifest";
import { matchShellRoute } from "./shell-routes";

const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;
// A worker left on a loopback origin would serve its cached build to the next
// local server on that port.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const EXTERNAL_EMBED_WINDOW_KEY = "__AGENT_NATIVE_EXTERNAL_EMBED";

type ShellWindow = Window & {
  __reactRouterManifest?: Pick<ReactRouterManifest, "routes">;
  [EXTERNAL_EMBED_WINDOW_KEY]?: unknown;
};

function mountedAtRoot(): boolean {
  try {
    return !isWorkspaceRuntime() && !appBasePath();
  } catch {
    // coercion-ok: an unresolvable workspace mount means the app isn't at
    // the origin root, which is the only place the worker's scope fits.
    return false;
  }
}

/**
 * The worker runs only for the standalone app, opened as a top-level page of
 * one of its own routes over HTTPS. The desktop app is left out because chunk
 * recovery can't reload there, and embeds because their host owns the page.
 */
export function shouldRegisterShellWorker(win: ShellWindow): boolean {
  if (!("serviceWorker" in win.navigator) || !win.isSecureContext) return false;
  if (LOOPBACK_HOSTS.has(win.location.hostname)) return false;
  if (/AgentNativeDesktop/i.test(win.navigator.userAgent)) return false;
  if (win.top !== win || win[EXTERNAL_EMBED_WINDOW_KEY]) return false;
  if (!mountedAtRoot()) return false;
  const manifest = win.__reactRouterManifest;
  if (!manifest) return false;
  return Boolean(
    matchShellRoute(win.location.pathname, shellRoutesFromManifest(manifest))
      ?.app,
  );
}

function isShellRegistration(registration: ServiceWorkerRegistration): boolean {
  return [registration.active, registration.waiting, registration.installing]
    .filter((worker): worker is ServiceWorker => Boolean(worker))
    .some((worker) => new URL(worker.scriptURL).pathname === SHELL_WORKER_URL);
}

/** Unregister the shell worker and drop its caches; the off switch's page half. */
export async function removeContentShellWorker(win: Window): Promise<void> {
  const registrations = await win.navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter(isShellRegistration)
      .map((registration) => registration.unregister()),
  );
  if ("caches" in win) await deleteShellCaches(win.caches);
}

function keepWorkerFresh(
  win: Window,
  registration: ServiceWorkerRegistration,
): void {
  let checkedAt = Date.now();
  win.document.addEventListener("visibilitychange", () => {
    if (win.document.visibilityState !== "visible") return;
    if (Date.now() - checkedAt < UPDATE_CHECK_INTERVAL_MS) return;
    checkedAt = Date.now();
    registration.update().catch((error: unknown) => {
      console.warn("[content-shell] worker update check failed", error);
    });
  });
}

async function registerShellWorker(win: Window): Promise<void> {
  const container = win.navigator.serviceWorker;
  try {
    const { controller } = container;
    if (
      controller &&
      new URL(controller.scriptURL).pathname === SHELL_WORKER_URL
    ) {
      // The worker served this page, and the browser checks /sw.js for
      // updates on every navigation. Registering again would undo a worker
      // that removed itself meanwhile (a deploy without it): Chrome revives a
      // registration that still controls a page when the page registers.
      const registration = await container.getRegistration(win.location.href);
      if (registration) keepWorkerFresh(win, registration);
      return;
    }
    const registration = await container.register(SHELL_WORKER_URL, {
      scope: SHELL_WORKER_SCOPE,
      updateViaCache: "none",
    });
    keepWorkerFresh(win, registration);
    // A page the worker didn't serve (the first visit, or a hard reload)
    // asks it to cache this page's shell.
    if (!container.controller) {
      const ready = await container.ready;
      ready.active?.postMessage({
        type: SHELL_ADOPT_MESSAGE,
        url: win.location.href,
      });
    }
  } catch (error) {
    // coercion-ok: some private modes and full disks refuse workers; the app
    // keeps loading from the network as it did before.
    console.warn("[content-shell] worker not registered", error);
  }
}

interface InstallOptions {
  production?: boolean;
  mode?: string;
}

/** Register the app-shell worker once the page has loaded, or remove it when the build turned it off. */
export function installContentShellWorker(
  win: Window = window,
  {
    production = !import.meta.env.DEV,
    mode = import.meta.env.VITE_CONTENT_SERVICE_WORKER,
  }: InstallOptions = {},
): void {
  if (!("serviceWorker" in win.navigator)) return;
  if (mode === SHELL_WORKER_OFF) {
    removeContentShellWorker(win).catch((error: unknown) => {
      console.warn("[content-shell] worker not removed", error);
    });
    return;
  }
  if (!production || !shouldRegisterShellWorker(win)) return;
  const start = () => void registerShellWorker(win);
  if (win.document.readyState === "complete") start();
  else win.addEventListener("load", start, { once: true });
}
