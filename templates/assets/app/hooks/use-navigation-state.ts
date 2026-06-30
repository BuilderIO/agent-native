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

function isPickerRequest(params: URLSearchParams) {
  return (
    params.get("__an_picker") === "1" ||
    params.get("__an_mcp_chat_bridge") === "1"
  );
}

function navigationFromPath(pathname: string, search = "") {
  const params = new URLSearchParams(search);
  const chat = pathname.match(/^\/chat\/([^/]+)/);
  if (chat) {
    return {
      view: "create",
      threadId: decodePathParam(chat[1]),
    };
  }
  // The "library" view is the unified Library workspace. Keep the internal
  // detail key stable for agent/MCP callers that already navigate by brand-kit
  // id, while the URL is now /library/:id.
  const library = pathname.match(/^\/(?:library|brand-kits)\/([^/]+)/);
  if (library) {
    return {
      view: "library",
      selection: decodePathParam(library[1]),
      libraryId: decodePathParam(library[1]),
      activeTab: optionalLibraryTab(params),
    };
  }
  const asset = pathname.match(/^\/asset\/([^/]+)/);
  if (asset) return { view: "asset", assetId: asset[1] };
  const image = pathname.match(/^\/image\/([^/]+)/);
  if (image) return { view: "asset", assetId: image[1] };
  if (pathname === "/") {
    return {
      view: "create",
    };
  }
  if (pathname === "/library") {
    if (isPickerRequest(params)) {
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
        layout: params.get("layout") === "vertical" ? "vertical" : undefined,
      };
    }
    const queryLibraryId = optionalParam(params, "libraryId");
    if (queryLibraryId) {
      return {
        view: "library",
        selection: queryLibraryId,
        libraryId: queryLibraryId,
        activeTab: optionalLibraryTab(params),
      };
    }
    return {
      view: "library",
      selection: "all",
      tab: optionalParam(params, "tab"),
      scope: optionalParam(params, "scope"),
      search: optionalParam(params, "q"),
    };
  }
  if (pathname === "/brand-kits") return { view: "library", selection: "all" };
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
    return `/library/${command.libraryId}${query ? `?${query}` : ""}`;
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
    return `/library/${command.libraryId}?tab=${encodeURIComponent(tab)}`;
  }
  if (command.view === "audit") return "/audit";
  if (command.view === "settings") return "/settings";
  if (command.view === "create") {
    if (typeof command.threadId === "string" && command.threadId.trim()) {
      return `/chat/${encodeURIComponent(command.threadId.trim())}`;
    }
    return "/";
  }
  if (command.view === "picker") {
    const params = new URLSearchParams();
    params.set("__an_picker", "1");
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
    if (command.layout === "vertical") {
      params.set("layout", "vertical");
    }
    const query = params.toString();
    return query ? `/library?${query}` : "/library";
  }
  if (command.view === "libraries") return "/library";
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
      if (
        isCreatePath(location.pathname) &&
        !isCreatePath(pathnameFromPath(path))
      ) {
        markAgentChatHomeHandoff(ASSETS_CHAT_STORAGE_KEY);
      }
    },
  });
}

function pathnameFromPath(path: string): string {
  return path.split(/[?#]/, 1)[0] || "/";
}

function decodePathParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isCreatePath(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/chat/");
}
