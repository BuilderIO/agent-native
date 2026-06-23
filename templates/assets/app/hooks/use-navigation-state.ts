import {
  markAgentChatHomeHandoff,
  useAgentRouteState,
  getBrowserTabId,
} from "@agent-native/core/client";
import { useLocation } from "react-router";
import { ASSETS_CHAT_STORAGE_KEY } from "@/lib/chat";

function optionalParam(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim();
  return value ? value : undefined;
}

function optionalLibraryTab(params: URLSearchParams) {
  const tab = params.get("tab");
  return tab === "references" ||
    tab === "generated" ||
    tab === "runs" ||
    tab === "settings"
    ? tab
    : undefined;
}

function navigationFromPath(pathname: string, search = "") {
  // The "library" view is the brand-kit detail page (route /brand-kits/:id).
  // Keep the internal view key stable for the agent/MCP contract.
  const library = pathname.match(/^\/brand-kits\/([^/]+)/);
  if (library) {
    const params = new URLSearchParams(search);
    return {
      view: "library",
      libraryId: library[1],
      activeTab: optionalLibraryTab(params),
    };
  }
  const asset = pathname.match(/^\/asset\/([^/]+)/);
  if (asset) return { view: "asset", assetId: asset[1] };
  const image = pathname.match(/^\/image\/([^/]+)/);
  if (image) return { view: "asset", assetId: image[1] };
  if (pathname === "/") return { view: "create" };
  // The "picker" view is the image Library browser (route /library).
  if (pathname === "/library") {
    const params = new URLSearchParams(search);
    return {
      view: "picker",
      mediaType:
        params.get("mediaType") === "video"
          ? "video"
          : params.get("mediaType") === "image"
            ? "image"
            : undefined,
      libraryId: optionalParam(params, "libraryId"),
      query: optionalParam(params, "q"),
      prompt: optionalParam(params, "prompt"),
      aspectRatio: optionalParam(params, "aspectRatio"),
    };
  }
  // The "libraries" view is the Brand Kits list (route /brand-kits).
  if (pathname === "/brand-kits") return { view: "libraries" };
  if (pathname === "/extensions") return { view: "extensions" };
  const extension = pathname.match(/^\/extensions\/([^/]+)/);
  if (extension) return { view: "extensions", extensionId: extension[1] };
  if (pathname === "/audit") return { view: "audit" };
  if (pathname === "/settings") return { view: "settings" };
  return { view: "create" };
}

function pathFromCommand(command: any): string | null {
  if (!command) return null;
  if (typeof command.path === "string") return command.path;
  if (command.view === "library" && command.libraryId) {
    const params = new URLSearchParams();
    if (typeof command.activeTab === "string") {
      params.set("tab", command.activeTab);
    }
    const query = params.toString();
    return `/brand-kits/${command.libraryId}${query ? `?${query}` : ""}`;
  }
  if (
    (command.view === "asset" || command.view === "image") &&
    command.assetId
  ) {
    return `/asset/${command.assetId}`;
  }
  if (
    (command.view === "generation-session" ||
      command.view === "generation-run") &&
    command.libraryId
  ) {
    const tab =
      typeof command.activeTab === "string" ? command.activeTab : "runs";
    return `/brand-kits/${command.libraryId}?tab=${encodeURIComponent(tab)}`;
  }
  if (command.view === "audit") return "/audit";
  if (command.view === "settings") return "/settings";
  if (command.view === "create") return "/";
  if (command.view === "picker") {
    const params = new URLSearchParams();
    if (command.mediaType === "image" || command.mediaType === "video") {
      params.set("mediaType", command.mediaType);
    }
    if (typeof command.libraryId === "string" && command.libraryId.trim()) {
      params.set("libraryId", command.libraryId.trim());
    }
    if (typeof command.query === "string" && command.query.trim()) {
      params.set("q", command.query.trim());
    }
    if (typeof command.prompt === "string" && command.prompt.trim()) {
      params.set("prompt", command.prompt.trim());
    }
    if (typeof command.aspectRatio === "string" && command.aspectRatio.trim()) {
      params.set("aspectRatio", command.aspectRatio.trim());
    }
    const query = params.toString();
    return query ? `/library?${query}` : "/library";
  }
  if (command.view === "libraries") return "/brand-kits";
  if (command.view === "extensions" && command.extensionId) {
    return `/extensions/${command.extensionId}`;
  }
  if (command.view === "extensions") return "/extensions";
  return null;
}

export function useNavigationState() {
  const location = useLocation();
  useAgentRouteState({
    browserTabId: getBrowserTabId(),
    requestSource: getBrowserTabId(),
    getNavigationState: ({ pathname, search }) =>
      navigationFromPath(pathname, search),
    getCommandPath: (command) => pathFromCommand(command),
    onNavigate: (_command, path) => {
      if (location.pathname === "/" && pathnameFromPath(path) !== "/") {
        markAgentChatHomeHandoff(ASSETS_CHAT_STORAGE_KEY);
      }
    },
  });
}

function pathnameFromPath(path: string): string {
  return path.split(/[?#]/, 1)[0] || "/";
}
