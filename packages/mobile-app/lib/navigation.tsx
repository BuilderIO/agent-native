import { router, type Href } from "expo-router";
import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";

import { APP_ID_TO_ROUTE } from "@/lib/mobile-app-navigation";

let navigationReady = false;
let pendingNavigation: { href: string; mode: "push" | "replace" } | null = null;

const TAB_PATHS = new Set([
  ...Object.values(APP_ID_TO_ROUTE),
  "/more",
  "/sessions",
  "/settings",
]);

function getTabPath(href: string): string | null {
  const pathname =
    new URL(href, "https://mobile.agent-native.local").pathname.replace(
      /\/+$/,
      "",
    ) || "/";

  if (pathname === "/") return "/chat";
  return TAB_PATHS.has(pathname) ? pathname : null;
}

function performNavigation(href: string, mode: "push" | "replace"): void {
  const tabPath = getTabPath(href);
  if (tabPath) {
    router.navigate(tabPath as Href);
    return;
  }

  if (mode === "replace") router.replace(href as Href);
  else router.push(href as Href);
}

export function navigateToPath(
  href: string,
  mode: "push" | "replace" = "push",
): void {
  if (!navigationReady) {
    pendingNavigation = { href, mode };
    return;
  }

  performNavigation(href, mode);
}

export function flushPendingNavigation(): void {
  navigationReady = true;
  const pending = pendingNavigation;
  pendingNavigation = null;
  if (pending) performNavigation(pending.href, pending.mode);
}

export function useMobileNavigation() {
  return useMemo(
    () => ({
      back: () => {
        if (navigationReady && router.canGoBack()) router.back();
        else navigateToPath("/chat", "replace");
      },
      push: (href: string) => navigateToPath(href),
      replace: (href: string) => navigateToPath(href, "replace"),
    }),
    [],
  );
}

const NavigationPathContext = createContext("/chat");

export function NavigationPathProvider({
  children,
  pathname,
}: PropsWithChildren<{ pathname: string }>) {
  return (
    <NavigationPathContext.Provider value={pathname}>
      {children}
    </NavigationPathContext.Provider>
  );
}

export function useCurrentPathname(): string {
  return useContext(NavigationPathContext);
}
