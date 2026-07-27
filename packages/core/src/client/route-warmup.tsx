import { useEffect } from "react";
import { matchRoutes, type RouteObject } from "react-router";

import {
  mergeAgentNativeRouteWarmupConfig,
  type AgentNativeRouteWarmupConfigInput,
  type AgentNativeRouteWarmupResolvedConfig,
  type AgentNativeRouteWarmupStrategy,
} from "../shared/route-warmup-config.js";

declare const __AGENT_NATIVE_ROUTE_WARMUP_CONFIG__:
  | AgentNativeRouteWarmupConfigInput
  | string
  | undefined;

type ReactRouterManifestRoute = {
  id: string;
  parentId?: string;
  path?: string;
  index?: boolean;
  module?: string;
  clientActionModule?: string;
  clientLoaderModule?: string;
  hydrateFallbackModule?: string;
  imports?: string[];
};

type ReactRouterManifest = {
  routes?: Record<string, ReactRouterManifestRoute>;
};

type WarmupRouteObject = {
  id: string;
  path?: string;
  index?: boolean;
  children?: WarmupRouteObject[];
};

type LinkWarmupMode = Exclude<AgentNativeRouteWarmupStrategy, "off" | "marked">;

declare global {
  interface Window {
    __reactRouterContext?: { basename?: string };
    __reactRouterManifest?: ReactRouterManifest;
  }
}

const PREFETCH_ATTR = "data-an-prefetch";
const warmedDataRoutes = new Set<string>();
const warmedRouteAssets = new Set<string>();

let cachedManifest: ReactRouterManifest | undefined;
let cachedManifestRoutesSignature = "";
let cachedManifestRouteTree: WarmupRouteObject[] = [];

export interface AgentNativeRouteWarmupProps {
  config?: AgentNativeRouteWarmupConfigInput;
}

function parseBuildTimeRouteWarmupConfig(
  raw: AgentNativeRouteWarmupConfigInput | string | undefined,
): AgentNativeRouteWarmupConfigInput | undefined {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as AgentNativeRouteWarmupConfigInput;
  } catch {
    // Some test/build paths may inject a bare strategy string instead of JSON.
    return raw as AgentNativeRouteWarmupConfigInput;
  }
}

function getBuildTimeRouteWarmupConfig():
  | AgentNativeRouteWarmupConfigInput
  | undefined {
  try {
    if (typeof __AGENT_NATIVE_ROUTE_WARMUP_CONFIG__ !== "undefined") {
      return parseBuildTimeRouteWarmupConfig(
        __AGENT_NATIVE_ROUTE_WARMUP_CONFIG__,
      );
    }
  } catch {
    // Some non-Vite test/runtime paths do not define the global.
  }
  return undefined;
}

function getRouteWarmupConfig(
  config: AgentNativeRouteWarmupConfigInput | undefined,
): AgentNativeRouteWarmupResolvedConfig {
  return mergeAgentNativeRouteWarmupConfig(
    getBuildTimeRouteWarmupConfig(),
    config,
  );
}

function normalizeBasename(basename: string | undefined): string {
  if (!basename || basename === "/") return "/";
  return basename.startsWith("/") ? basename.replace(/\/+$/, "") : "/";
}

function stripBasename(pathname: string): string {
  const basename = normalizeBasename(window.__reactRouterContext?.basename);
  if (basename === "/") return pathname;
  if (pathname === basename) return "/";
  if (pathname.startsWith(`${basename}/`)) {
    return pathname.slice(basename.length) || "/";
  }
  return pathname;
}

function isFrameworkOrApiPath(pathname: string): boolean {
  const appPath = stripBasename(pathname);
  return (
    appPath === "/_agent-native" ||
    appPath.startsWith("/_agent-native/") ||
    appPath === "/api" ||
    appPath.startsWith("/api/")
  );
}

function hrefUrl(href: string): URL | null {
  try {
    return new URL(href, window.location.href);
  } catch {
    return null;
  }
}

function isWarmableRouteUrl(url: URL): boolean {
  if (url.origin !== window.location.origin) return false;
  if (url.pathname === window.location.pathname && url.hash) return false;
  if (isFrameworkOrApiPath(url.pathname)) return false;
  if (/\.\w+$/.test(url.pathname)) return false;
  return true;
}

function isWarmableAnchor(link: HTMLAnchorElement): boolean {
  if (link.hasAttribute("download")) return false;
  if (link.target && link.target !== "_self") return false;
  const url = hrefUrl(link.href);
  return url ? isWarmableRouteUrl(url) : false;
}

function dataRouteUrlForHref(href: string): string | null {
  const url = hrefUrl(href);
  if (!url || !isWarmableRouteUrl(url)) return null;

  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/") return null;
  url.pathname = `${pathname}.data`;
  url.hash = "";
  return url.href;
}

function hasReactRouterManifestRoutes(): boolean {
  const routes = window.__reactRouterManifest?.routes;
  return Boolean(routes && Object.keys(routes).length > 0);
}

function manifestRoutesSignature(
  routes: Record<string, ReactRouterManifestRoute> | undefined,
): string {
  return Object.values(routes ?? {})
    .map((route) =>
      [
        route.id,
        route.parentId ?? "",
        route.path ?? "",
        route.index ? "1" : "0",
      ].join("\0"),
    )
    .sort()
    .join("\n");
}

function getManifestRouteTree(
  manifest: ReactRouterManifest,
): WarmupRouteObject[] {
  const routesSignature = manifestRoutesSignature(manifest.routes);
  if (
    manifest === cachedManifest &&
    routesSignature === cachedManifestRoutesSignature
  ) {
    return cachedManifestRouteTree;
  }

  const manifestRoutes = Object.values(manifest.routes ?? {});
  const nodes = new Map<string, WarmupRouteObject>();
  for (const route of manifestRoutes) {
    nodes.set(route.id, {
      id: route.id,
      path: route.path,
      index: route.index || undefined,
    });
  }

  const tree: WarmupRouteObject[] = [];
  for (const route of manifestRoutes) {
    const node = nodes.get(route.id);
    if (!node) continue;
    const parent = route.parentId ? nodes.get(route.parentId) : null;
    if (parent) {
      parent.children ??= [];
      parent.children.push(node);
    } else {
      tree.push(node);
    }
  }

  cachedManifest = manifest;
  cachedManifestRoutesSignature = routesSignature;
  cachedManifestRouteTree = tree;
  return tree;
}

function assetUrlForManifestPath(assetPath: string): string | null {
  try {
    const url = new URL(assetPath, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    // The framework package is often consumed from prebuilt core dist, where
    // Vite does not replace `import.meta.env` in this module. Use the React
    // Router manifest itself to distinguish production client assets from dev
    // source module ids. Production manifests point at immutable Vite chunks;
    // dev manifests point at raw TS/TSX modules that should not be warmed.
    if (!/\/assets\/[^/?#]+\.m?js$/.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function hasWarmableRouteAssets(): boolean {
  for (const route of Object.values(
    window.__reactRouterManifest?.routes ?? {},
  )) {
    for (const assetPath of [
      route.module,
      route.clientActionModule,
      route.clientLoaderModule,
      route.hydrateFallbackModule,
      ...(route.imports ?? []),
    ]) {
      if (assetPath && assetUrlForManifestPath(assetPath)) return true;
    }
  }
  return false;
}

function routeAssetUrlsForHref(href: string): string[] {
  const manifest = window.__reactRouterManifest;
  if (!manifest?.routes) return [];

  const url = hrefUrl(href);
  if (!url || !isWarmableRouteUrl(url)) return [];

  const basename = normalizeBasename(window.__reactRouterContext?.basename);
  const matches =
    matchRoutes(
      getManifestRouteTree(manifest) as unknown as RouteObject[],
      url.pathname,
      basename,
    ) ?? [];
  const assetUrls: string[] = [];

  for (const match of matches) {
    const routeId = match.route.id;
    if (!routeId) continue;
    const route = manifest.routes[routeId];
    if (!route) continue;
    for (const assetPath of [
      route.module,
      route.clientActionModule,
      route.clientLoaderModule,
      route.hydrateFallbackModule,
      ...(route.imports ?? []),
    ]) {
      if (!assetPath) continue;
      const assetUrl = assetUrlForManifestPath(assetPath);
      if (assetUrl) assetUrls.push(assetUrl);
    }
  }

  return assetUrls;
}

function seedExistingModulepreloads() {
  for (const link of document.querySelectorAll<HTMLLinkElement>(
    'link[rel="modulepreload"][href]',
  )) {
    warmedRouteAssets.add(link.href);
  }
}

function warmRouteAssetsForHref(href: string) {
  for (const assetUrl of routeAssetUrlsForHref(href)) {
    if (warmedRouteAssets.has(assetUrl)) continue;
    warmedRouteAssets.add(assetUrl);

    const link = document.createElement("link");
    link.rel = "modulepreload";
    link.href = assetUrl;
    document.head.appendChild(link);
  }
}

function linkWarmupMode(
  link: HTMLAnchorElement,
  strategy: AgentNativeRouteWarmupStrategy,
): LinkWarmupMode | "none" {
  const explicit = link.getAttribute(PREFETCH_ATTR)?.trim().toLowerCase();
  if (explicit === "none" || explicit === "off" || explicit === "false") {
    return "none";
  }
  if (
    explicit === "render" ||
    explicit === "intent" ||
    explicit === "viewport"
  ) {
    return explicit;
  }
  if (strategy === "off" || strategy === "marked") return "none";
  return strategy;
}

function selectorWarmupMode(link: HTMLAnchorElement): "render" | "none" {
  const explicit = link.getAttribute(PREFETCH_ATTR)?.trim().toLowerCase();
  return explicit === "none" || explicit === "off" || explicit === "false"
    ? "none"
    : "render";
}

function renderWarmupLinksForSelector(selector: string): HTMLAnchorElement[] {
  let elements: Element[];
  try {
    elements = Array.from(document.querySelectorAll(selector));
  } catch {
    return [];
  }

  const links: HTMLAnchorElement[] = [];
  const seen = new Set<HTMLAnchorElement>();
  for (const element of elements) {
    const link =
      element instanceof HTMLAnchorElement
        ? element
        : (element.querySelector<HTMLAnchorElement>("a[href]") ??
          element.closest<HTMLAnchorElement>("a[href]"));
    if (!link || seen.has(link)) continue;
    seen.add(link);
    links.push(link);
  }
  return links;
}

function resetRouteWarmupCachesForTests() {
  cachedManifest = undefined;
  cachedManifestRoutesSignature = "";
  cachedManifestRouteTree = [];
  warmedDataRoutes.clear();
  warmedRouteAssets.clear();
}

/**
 * Warms React Router route data and matched route JS without using native link
 * prefetch. React Router's built-in `<Link prefetch>` does both pieces, but
 * its data side emits `<link rel="prefetch" as="fetch">`; Chrome sends
 * `Sec-Purpose: prefetch` for that request and Cloudflare Speed Brain can 503
 * dynamic `.data` routes before the CDN/origin can serve the cacheable result.
 *
 * Keep `.data` warmup as ordinary `fetch()` and JS warmup as `modulepreload`
 * unless production providers stop rejecting `Sec-Purpose: prefetch`.
 */
export function AgentNativeRouteWarmup({
  config,
}: AgentNativeRouteWarmupProps) {
  useEffect(() => {
    const resolved = getRouteWarmupConfig(config);
    if (resolved.strategy === "off") {
      return;
    }
    // Legacy SPA builds still mount the AgentPanel but do not expose React
    // Router framework `.data` endpoints or a route asset manifest. Only warm
    // route data/modules when that manifest is present; otherwise this would
    // generate noisy `/<path>.data` 404s for apps that cannot serve them.
    const hasManifestRoutes = hasReactRouterManifestRoutes();
    // Vite dev manifests contain raw source module ids. Warming those with
    // modulepreload can route through React Router's dev SSR loader and make
    // local servers log false-positive internal errors. Keep route warmup to
    // manifests that point at built JS assets, where SSR `.data` requests have
    // the CDN cache headers this feature relies on.
    const hasRouteAssets = hasManifestRoutes && hasWarmableRouteAssets();
    const warmData = resolved.data && hasRouteAssets;
    const warmModules = resolved.modules && hasRouteAssets;
    if (!warmData && !warmModules) return;

    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;

    if (warmModules) seedExistingModulepreloads();

    const queue: string[] = [];
    const queuedDataRoutes = new Set<string>();
    const observedLinks = new WeakSet<HTMLAnchorElement>();
    let active = 0;
    let stopped = false;
    let scheduleTimer: number | undefined;

    const pump = () => {
      if (stopped || !warmData) return;
      while (active < resolved.maxConcurrent && queue.length > 0) {
        const href = queue.shift();
        if (!href) continue;
        active += 1;
        window
          .fetch(href, { credentials: "same-origin", cache: "force-cache" })
          .catch(() => {})
          .finally(() => {
            active -= 1;
            window.setTimeout(pump, 50);
          });
      }
    };

    const warmHref = (href: string) => {
      if (warmModules) warmRouteAssetsForHref(href);
      if (!warmData) return;
      const dataUrl = dataRouteUrlForHref(href);
      if (!dataUrl || warmedDataRoutes.has(dataUrl)) return;
      warmedDataRoutes.add(dataUrl);
      if (queuedDataRoutes.has(dataUrl)) return;
      queuedDataRoutes.add(dataUrl);
      queue.push(dataUrl);
      pump();
    };

    const viewportObserver =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const link = entry.target as HTMLAnchorElement;
              viewportObserver?.unobserve(link);
              warmHref(link.href);
            }
          });

    const scan = () => {
      if (warmModules) seedExistingModulepreloads();

      for (const link of renderWarmupLinksForSelector(resolved.selector)) {
        if (!isWarmableAnchor(link)) continue;
        const mode = selectorWarmupMode(link);
        if (mode === "none") continue;
        warmHref(link.href);
      }

      for (const link of document.querySelectorAll<HTMLAnchorElement>(
        "a[href]",
      )) {
        if (!isWarmableAnchor(link)) continue;
        const mode = linkWarmupMode(link, resolved.strategy);
        if (mode === "none") continue;
        if (mode === "render") {
          warmHref(link.href);
          continue;
        }
        if (mode === "viewport") {
          if (!viewportObserver) {
            warmHref(link.href);
          } else if (!observedLinks.has(link)) {
            observedLinks.add(link);
            viewportObserver.observe(link);
          }
        }
      }
    };

    const schedule = () => {
      if (scheduleTimer !== undefined) window.clearTimeout(scheduleTimer);
      scheduleTimer = window.setTimeout(() => {
        scheduleTimer = undefined;
        scan();
      }, 0);
    };

    const warmFromIntent = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link || !isWarmableAnchor(link)) return;
      const mode = linkWarmupMode(link, resolved.strategy);
      if (mode === "none") return;
      warmHref(link.href);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    // The render-warmup selector is configurable, so it may depend on class or
    // custom data attributes. Watch all attribute changes and debounce rescans.
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
    });

    document.addEventListener("pointerover", warmFromIntent, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchstart", warmFromIntent, {
      capture: true,
      passive: true,
    });
    document.addEventListener("focusin", warmFromIntent, true);

    return () => {
      stopped = true;
      if (scheduleTimer !== undefined) window.clearTimeout(scheduleTimer);
      observer.disconnect();
      viewportObserver?.disconnect();
      document.removeEventListener("pointerover", warmFromIntent, true);
      document.removeEventListener("touchstart", warmFromIntent, true);
      document.removeEventListener("focusin", warmFromIntent, true);
    };
  }, [config]);

  return null;
}

export const __routeWarmupInternalsForTests = {
  getManifestRouteTree,
  hasReactRouterManifestRoutes,
  hasWarmableRouteAssets,
  parseBuildTimeRouteWarmupConfig,
  renderWarmupLinksForSelector,
  routeAssetUrlsForHref,
  resetRouteWarmupCachesForTests,
};
