import { useAgentRouteState } from "@agent-native/core/client";

export type ClipsView =
  | "library"
  | "spaces"
  | "space"
  | "archive"
  | "trash"
  | "record"
  | "recording"
  | "share"
  | "embed"
  | "insights"
  | "notifications"
  | "settings"
  | "meetings"
  | "meeting"
  | "dictate";

export interface NavigationState {
  view: ClipsView;
  recordingId?: string;
  spaceId?: string;
  folderId?: string;
  shareId?: string;
  search?: string;
  path?: string;
  meetingId?: string;
  dictationId?: string;
}

interface NavigateCommand extends Partial<NavigationState> {
  path?: string;
}

/**
 * Derive a navigation-state shape from the current URL.
 *
 * Route conventions (keep in sync with the route files in app/routes):
 *
 *   /                           -> library
 *   /library                    -> library
 *   /library?q=...              -> library (with search)
 *   /library/folder/:folderId   -> library (with folderId)
 *   /spaces                     -> spaces
 *   /spaces/:spaceId            -> space
 *   /archive                    -> archive
 *   /trash                      -> trash
 *   /record                     -> record
 *   /r/:recordingId             -> recording
 *   /r/:recordingId/insights    -> insights
 *   /share/:shareId             -> share
 *   /embed/:shareId             -> embed
 *   /notifications              -> notifications
 *   /settings[/*]               -> settings
 */
function stateFromLocation(pathname: string, search: string): NavigationState {
  const params = new URLSearchParams(search);
  const searchTerm = params.get("q") || undefined;
  const p = pathname.replace(/\/+$/, "") || "/";

  // /r/:recordingId[/insights]
  const recordingMatch = p.match(/^\/r\/([^/]+)(?:\/(insights))?$/);
  if (recordingMatch) {
    return {
      view: recordingMatch[2] === "insights" ? "insights" : "recording",
      recordingId: recordingMatch[1],
      ...(searchTerm ? { search: searchTerm } : {}),
    };
  }

  // /share/:shareId and /embed/:shareId
  const shareMatch = p.match(/^\/(share|embed)\/([^/]+)$/);
  if (shareMatch) {
    return {
      view: shareMatch[1] === "embed" ? "embed" : "share",
      shareId: shareMatch[2],
    };
  }

  // /spaces/:spaceId
  const spaceMatch = p.match(/^\/spaces\/([^/]+)$/);
  if (spaceMatch) {
    return { view: "space", spaceId: spaceMatch[1] };
  }

  // /library/folder/:folderId
  const folderMatch = p.match(/^\/library\/folder\/([^/]+)$/);
  if (folderMatch) {
    return {
      view: "library",
      folderId: folderMatch[1],
      ...(searchTerm ? { search: searchTerm } : {}),
    };
  }

  // /meetings and /meetings/:meetingId
  const meetingMatch = p.match(/^\/meetings(?:\/([^/]+))?$/);
  if (meetingMatch) {
    if (meetingMatch[1]) {
      return { view: "meeting", meetingId: meetingMatch[1] };
    }
    return { view: "meetings" };
  }

  // /dictate (optionally /dictate/:dictationId in the future)
  const dictateMatch = p.match(/^\/dictate(?:\/([^/]+))?$/);
  if (dictateMatch) {
    return {
      view: "dictate",
      ...(dictateMatch[1] ? { dictationId: dictateMatch[1] } : {}),
    };
  }

  if (p === "/spaces") return { view: "spaces" };
  if (p === "/archive") return { view: "archive" };
  if (p === "/trash") return { view: "trash" };
  if (p === "/record") return { view: "record" };
  if (p === "/notifications") return { view: "notifications" };
  if (p.startsWith("/settings")) return { view: "settings" };
  if (p === "/library" || p === "/" || p === "") {
    return {
      view: "library",
      ...(searchTerm ? { search: searchTerm } : {}),
    };
  }

  // Fallback — unknown route, default to library.
  return { view: "library" };
}

/**
 * Turn a navigate-command payload (from the agent) into a URL path.
 * If the command includes `path`, prefer that — otherwise map view+ids.
 */
function pathFromCommand(cmd: NavigateCommand): string {
  if (cmd.path) return cmd.path;
  switch (cmd.view) {
    case "recording":
      return cmd.recordingId ? `/r/${cmd.recordingId}` : "/library";
    case "insights":
      return cmd.recordingId ? `/r/${cmd.recordingId}/insights` : "/library";
    case "share":
      return cmd.shareId ? `/share/${cmd.shareId}` : "/library";
    case "embed":
      return cmd.shareId ? `/embed/${cmd.shareId}` : "/library";
    case "space":
      return cmd.spaceId ? `/spaces/${cmd.spaceId}` : "/spaces";
    case "spaces":
      return "/spaces";
    case "archive":
      return "/archive";
    case "trash":
      return "/trash";
    case "record":
      return "/record";
    case "notifications":
      return "/notifications";
    case "settings":
      return "/settings";
    case "meetings":
      return "/meetings";
    case "meeting":
      return cmd.meetingId ? `/meetings/${cmd.meetingId}` : "/meetings";
    case "dictate":
      return "/dictate";
    case "library":
    default:
      if (cmd.folderId) return `/library/folder/${cmd.folderId}`;
      return "/library";
  }
}

export function useNavigationState() {
  useAgentRouteState<NavigationState, NavigateCommand>({
    writeDebounceMs: 300,
    getNavigationState: ({ pathname, search }) =>
      stateFromLocation(pathname, search),
    getCommandPath: (cmd) => pathFromCommand(cmd),
  });
}
