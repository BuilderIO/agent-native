declare const __AGENT_NATIVE_BUILD_ID__: string | undefined;
declare const __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__: string | undefined;

const RELOAD_MARKER_KEY = "__agentNativeClientCompatibilityReload";
export const BUILD_CACHE_BUSTER_PARAM = "__an_build";

type CompatibilityWindow = Pick<Window, "location" | "history"> & {
  sessionStorage?: Storage;
  __agentNativeClientCompatibilityReload?: string;
};

export function clientBuildId(): string {
  if (typeof __AGENT_NATIVE_BUILD_ID__ === "string") {
    return __AGENT_NATIVE_BUILD_ID__;
  }
  return (
    (globalThis as typeof globalThis & { __AGENT_NATIVE_BUILD_ID__?: string })
      .__AGENT_NATIVE_BUILD_ID__ ?? ""
  );
}

export function clientCompatibilityVersion(): string {
  if (typeof __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__ === "string") {
    return __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__;
  }
  return (
    (
      globalThis as typeof globalThis & {
        __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__?: string;
      }
    ).__AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__ ?? ""
  );
}

function readReloadMarker(win: CompatibilityWindow): string {
  try {
    return win.sessionStorage?.getItem(RELOAD_MARKER_KEY) ?? "";
  } catch {
    return win.__agentNativeClientCompatibilityReload ?? "";
  }
}

function writeReloadMarker(win: CompatibilityWindow, marker: string): void {
  win.__agentNativeClientCompatibilityReload = marker;
  try {
    win.sessionStorage?.setItem(RELOAD_MARKER_KEY, marker);
  } catch {}
}

export function reloadForClientCompatibilityMismatch(
  serverBuildId: string,
  requiredCompatibility: string,
  win: CompatibilityWindow | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  if (!win?.location) return false;
  const marker = `${requiredCompatibility}:${serverBuildId}`;
  if (readReloadMarker(win) === marker) return false;
  writeReloadMarker(win, marker);
  const target = new URL(win.location.href);
  target.searchParams.set(BUILD_CACHE_BUSTER_PARAM, serverBuildId || "latest");
  win.location.replace(target.href);
  return true;
}

export function stripBuildCompatibilityCacheBuster(
  win: CompatibilityWindow | undefined = typeof window === "undefined"
    ? undefined
    : window,
): void {
  if (!win?.location || !win.history) return;
  const target = new URL(win.location.href);
  if (!target.searchParams.has(BUILD_CACHE_BUSTER_PARAM)) return;
  target.searchParams.delete(BUILD_CACHE_BUSTER_PARAM);
  win.history.replaceState(win.history.state, "", target.href);
}
