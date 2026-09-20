import {
  createNavigationContainerRef,
  StackActions,
  type NavigatorScreenParams,
  type Route,
} from "@react-navigation/native";
import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";

export type MobileTabParamList = {
  analytics: undefined;
  assets: undefined;
  brain: undefined;
  calendar: undefined;
  chat: undefined;
  clips: undefined;
  content: undefined;
  design: undefined;
  dispatch: undefined;
  forms: undefined;
  mail: undefined;
  more: undefined;
  plan: undefined;
  sessions: undefined;
  settings: undefined;
  slides: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<MobileTabParamList> | undefined;
  App: { id: string };
  CaptureAudio: undefined;
  CaptureDictate: { requestId?: string; source?: string } | undefined;
  CaptureVideo: undefined;
  OAuthComplete: undefined;
  NotFound: undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let pendingNavigation: { href: string; mode: "push" | "replace" } | null = null;

const tabRouteNames = new Set<keyof MobileTabParamList>([
  "analytics",
  "assets",
  "brain",
  "calendar",
  "chat",
  "clips",
  "content",
  "design",
  "dispatch",
  "forms",
  "mail",
  "more",
  "plan",
  "sessions",
  "settings",
  "slides",
]);

type NavigationTarget =
  | { name: "Tabs"; params: NavigatorScreenParams<MobileTabParamList> }
  | { name: "App"; params: RootStackParamList["App"] }
  | { name: "CaptureAudio" }
  | { name: "CaptureDictate"; params?: RootStackParamList["CaptureDictate"] }
  | { name: "CaptureVideo" }
  | { name: "OAuthComplete" }
  | { name: "NotFound" };

function targetForPath(href: string): NavigationTarget {
  const url = new URL(href, "https://mobile.agent-native.local");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const tabName = path.slice(1) as keyof MobileTabParamList;
  if (path === "/" || tabRouteNames.has(tabName)) {
    return {
      name: "Tabs",
      params: { screen: path === "/" ? "chat" : tabName },
    };
  }
  if (path.startsWith("/app/")) {
    return {
      name: "App",
      params: { id: decodeURIComponent(path.slice("/app/".length)) },
    };
  }
  if (path === "/capture/audio") return { name: "CaptureAudio" };
  if (path === "/capture/video") return { name: "CaptureVideo" };
  if (path === "/capture/dictate") {
    const requestId = url.searchParams.get("requestId") ?? undefined;
    const source = url.searchParams.get("source") ?? undefined;
    return {
      name: "CaptureDictate",
      params: requestId || source ? { requestId, source } : undefined,
    };
  }
  if (path === "/oauth-complete") return { name: "OAuthComplete" };
  return { name: "NotFound" };
}

export function navigateToPath(
  href: string,
  mode: "push" | "replace" = "push",
): void {
  if (!navigationRef.isReady()) {
    pendingNavigation = { href, mode };
    return;
  }
  const target = targetForPath(href);
  if (target.name === "Tabs") {
    navigationRef.navigate("Tabs", target.params);
    return;
  }
  const params = "params" in target ? target.params : undefined;
  if (mode === "replace") {
    navigationRef.dispatch(StackActions.replace(target.name, params));
  } else {
    navigationRef.dispatch(StackActions.push(target.name, params));
  }
}

export function flushPendingNavigation(): void {
  const pending = pendingNavigation;
  pendingNavigation = null;
  if (pending) navigateToPath(pending.href, pending.mode);
}

export function useMobileNavigation() {
  return useMemo(
    () => ({
      back: () => {
        if (navigationRef.canGoBack()) navigationRef.goBack();
        else navigateToPath("/", "replace");
      },
      push: (href: string) => navigateToPath(href),
      replace: (href: string) => navigateToPath(href, "replace"),
    }),
    [],
  );
}

function pathForRoute(route: Route<string> | undefined): string {
  if (!route) return "/chat";
  if (tabRouteNames.has(route.name as keyof MobileTabParamList)) {
    return `/${route.name}`;
  }
  if (route.name === "App") {
    const id = (route.params as RootStackParamList["App"] | undefined)?.id;
    return id ? `/app/${encodeURIComponent(id)}` : "/more";
  }
  const paths: Partial<Record<keyof RootStackParamList, string>> = {
    CaptureAudio: "/capture/audio",
    CaptureDictate: "/capture/dictate",
    CaptureVideo: "/capture/video",
    OAuthComplete: "/oauth-complete",
    NotFound: "/not-found",
    Tabs: "/chat",
  };
  return paths[route.name as keyof RootStackParamList] ?? "/chat";
}

export function getCurrentPathname(): string {
  return pathForRoute(navigationRef.getCurrentRoute());
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
