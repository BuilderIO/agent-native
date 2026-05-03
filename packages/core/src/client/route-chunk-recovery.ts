const INSTALL_KEY = "__agentNativeRouteChunkRecoveryInstalled";
const INTENDED_NAV_MAX_AGE_MS = 15_000;

export interface RouteChunkRecoveryState {
  intendedHref: string | null;
  intendedAt: number;
  routeModuleFailureAt: number;
  recoveryHref: string | null;
  recovering: boolean;
}

export function createRouteChunkRecoveryState(): RouteChunkRecoveryState {
  return {
    intendedHref: null,
    intendedAt: 0,
    routeModuleFailureAt: 0,
    recoveryHref: null,
    recovering: false,
  };
}

export function isRouteModuleReloadMessage(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /Error loading route module `[^`]+`, reloading page\.\.\./.test(value)
  );
}

export function isDynamicImportFailureMessage(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return (
    value.includes("Failed to fetch dynamically imported module") ||
    value.includes("error loading dynamically imported module") ||
    value.includes("Importing a module script failed")
  );
}

export function rememberIntendedNavigation(
  state: RouteChunkRecoveryState,
  href: string,
  now = Date.now(),
): void {
  state.intendedHref = href;
  state.intendedAt = now;
}

export function getFreshIntendedNavigation(
  state: RouteChunkRecoveryState,
  currentHref: string,
  now = Date.now(),
): string | null {
  if (!state.intendedHref) return null;
  if (now - state.intendedAt > INTENDED_NAV_MAX_AGE_MS) return null;
  if (state.intendedHref === currentHref) return null;
  return state.intendedHref;
}

function anchorFromTarget(
  target: EventTarget | null,
): HTMLAnchorElement | null {
  let node = target as HTMLElement | null;
  while (node) {
    if (
      node.tagName?.toUpperCase() === "A" &&
      typeof (node as HTMLAnchorElement).href === "string"
    ) {
      return node as HTMLAnchorElement;
    }
    node = node.parentElement;
  }
  return null;
}

function sameOriginHref(win: Window, href: string): string | null {
  try {
    const url = new URL(href, win.location.href);
    return url.origin === win.location.origin ? url.href : null;
  } catch {
    return null;
  }
}

export function intendedHrefFromClick(
  win: Window,
  event: MouseEvent,
): string | null {
  if (event.defaultPrevented) return null;
  if (event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null;
  }

  const anchor = anchorFromTarget(event.target);
  if (!anchor) return null;
  if (anchor.hasAttribute("download")) return null;
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return null;
  return sameOriginHref(win, anchor.href);
}

function hardNavigate(win: Window, href: string): void {
  try {
    win.location.assign(href);
  } catch {
    win.location.href = href;
  }
}

function recoverToIntendedNavigation(
  win: Window,
  state: RouteChunkRecoveryState,
): boolean {
  const target = getFreshIntendedNavigation(state, win.location.href);
  if (!target) return false;
  state.recovering = true;
  state.recoveryHref = target;
  try {
    win.history.replaceState(win.history.state, "", target);
  } catch {}
  hardNavigate(win, target);
  return true;
}

function patchHistoryMethod(
  win: Window,
  state: RouteChunkRecoveryState,
  method: "pushState" | "replaceState",
): void {
  const original = win.history[method];
  win.history[method] = function patchedHistoryMethod(...args) {
    if (typeof args[2] === "string" || args[2] instanceof URL) {
      const href = sameOriginHref(win, String(args[2]));
      if (href) rememberIntendedNavigation(state, href);
    }
    return original.apply(this, args);
  };
}

function patchReload(win: Window, state: RouteChunkRecoveryState): void {
  const originalReload = win.location.reload.bind(win.location);
  const patchedReload = function patchedReload() {
    if (
      state.recoveryHref &&
      Date.now() - state.routeModuleFailureAt <= 1_000
    ) {
      hardNavigate(win, state.recoveryHref);
      return;
    }
    if (
      Date.now() - state.routeModuleFailureAt <= 1_000 &&
      recoverToIntendedNavigation(win, state)
    ) {
      return;
    }
    originalReload();
  };

  try {
    Object.defineProperty(win.location, "reload", {
      configurable: true,
      value: patchedReload,
    });
  } catch {
    try {
      win.location.reload = patchedReload;
    } catch {}
  }
}

export function installRouteChunkRecovery(
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
) {
  const consoleRef = (win as unknown as { console?: Console } | undefined)
    ?.console;
  if (
    !win?.document ||
    !win.location ||
    !win.history ||
    typeof win.addEventListener !== "function" ||
    !consoleRef
  ) {
    return;
  }

  const installedTarget = win as unknown as Record<string, boolean>;
  if (installedTarget[INSTALL_KEY]) return;
  installedTarget[INSTALL_KEY] = true;

  const state = createRouteChunkRecoveryState();

  win.document.addEventListener(
    "click",
    (event) => {
      const href = intendedHrefFromClick(win, event);
      if (href) rememberIntendedNavigation(state, href);
    },
    true,
  );

  patchHistoryMethod(win, state, "pushState");
  patchHistoryMethod(win, state, "replaceState");
  patchReload(win, state);

  win.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    const message = String(reason?.message || reason || "");
    if (!isDynamicImportFailureMessage(message)) return;
    state.routeModuleFailureAt = Date.now();
    if (recoverToIntendedNavigation(win, state)) {
      event.preventDefault();
    }
  });

  // React Router catches stale route-module import failures and reloads the
  // current URL. Its console message is the only signal exposed before reload.
  const originalError = consoleRef.error.bind(consoleRef);
  try {
    consoleRef.error = (...args: unknown[]) => {
      if (args.some(isRouteModuleReloadMessage)) {
        state.routeModuleFailureAt = Date.now();
        recoverToIntendedNavigation(win, state);
      }
      originalError(...args);
    };
  } catch {}
}
