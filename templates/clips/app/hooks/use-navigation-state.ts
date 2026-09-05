import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { useAgentRouteState } from "@agent-native/core/client/navigation";

export type ClipsView =
  | "library"
  | "shared"
  | "spaces"
  | "space"
  | "archive"
  | "trash"
  | "record"
  | "bug-report"
  | "bug-report-done"
  | "recording"
  | "share"
  | "embed"
  | "insights"
  | "notifications"
  | "settings"
  | "meetings"
  | "meeting"
  | "dictate";

export type RecordingPanel =
  | "comments"
  | "transcript"
  | "agent"
  | "insights"
  | "settings";

export interface NavigationState {
  view: ClipsView;
  recordingId?: string;
  spaceId?: string;
  folderId?: string;
  shareId?: string;
  search?: string;
  path?: string;
  meetingId?: string;
  meetingsTab?: "agenda" | "past";
  dictationId?: string;
  panel?: RecordingPanel;
  atMs?: number;
}

interface NavigateCommand extends Partial<NavigationState> {
  path?: string;
}

function decodePathSegment(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
    // coercion-ok: null explicitly marks a malformed route segment for rejection.
  } catch {
    return null;
  }
}

/**
 * Derive a navigation-state shape from the current URL.
 *
 * Route conventions (keep in sync with the route files in app/routes):
 *
 *   /home                       -> library
 *   /library                    -> library
 *   /library?q=...              -> library (with search)
 *   /library/folder/:folderId   -> library (with folderId)
 *   /shared                     -> shared
 *   /spaces                     -> spaces
 *   /spaces/:spaceId            -> space
 *   /archive                    -> archive
 *   /trash                      -> trash
 *   /record                     -> record
 *   /bug-report                 -> bug-report
 *   /bug-report/done            -> bug-report-done
 *   /r/:recordingId             -> recording (or insights with ?panel=insights)
 *   /share/:shareId             -> share
 *   /embed/:shareId             -> embed
 *   /notifications              -> notifications
 *   /settings[/*]               -> settings
 *   /meetings                   -> meetings (meetingsTab: agenda)
 *   /meetings?tab=past          -> meetings (meetingsTab: past)
 *   /meetings/:meetingId        -> meeting
 */
export function stateFromLocation(
  pathname: string,
  search: string,
): NavigationState {
  const params = new URLSearchParams(search);
  const searchTerm = params.get("q") || undefined;
  const p = pathname.replace(/\/+$/, "") || "/";

  // /r/:recordingId
  const recordingMatch = p.match(/^\/r\/([^/]+)$/);
  if (recordingMatch) {
    const recordingId = decodePathSegment(recordingMatch[1]);
    if (!recordingId) return { view: "library" };
    const panel = params.get("panel");
    const atParam = params.get("at") ?? params.get("t");
    const atMs = atParam == null ? undefined : Number(atParam);
    return {
      view: panel === "insights" ? "insights" : "recording",
      recordingId,
      ...(panel === "comments" ||
      panel === "transcript" ||
      panel === "agent" ||
      panel === "insights" ||
      panel === "settings"
        ? { panel }
        : {}),
      ...(Number.isFinite(atMs) && atMs! >= 0 ? { atMs } : {}),
      ...(searchTerm ? { search: searchTerm } : {}),
    };
  }

  // /share/:shareId and /embed/:shareId
  const shareMatch = p.match(/^\/(share|embed)\/([^/]+)$/);
  if (shareMatch) {
    const shareId = decodePathSegment(shareMatch[2]);
    if (!shareId) return { view: "library" };
    return {
      view: shareMatch[1] === "embed" ? "embed" : "share",
      shareId,
    };
  }

  // /spaces/:spaceId
  const spaceMatch = p.match(/^\/spaces\/([^/]+)$/);
  if (spaceMatch) {
    const spaceId = decodePathSegment(spaceMatch[1]);
    return spaceId ? { view: "space", spaceId } : { view: "library" };
  }

  // /library/folder/:folderId
  const folderMatch = p.match(/^\/library\/folder\/([^/]+)$/);
  if (folderMatch) {
    const folderId = decodePathSegment(folderMatch[1]);
    if (!folderId) return { view: "library" };
    return {
      view: "library",
      folderId,
      ...(searchTerm ? { search: searchTerm } : {}),
    };
  }

  // /meetings and /meetings/:meetingId
  const meetingMatch = p.match(/^\/meetings(?:\/([^/]+))?$/);
  if (meetingMatch) {
    if (meetingMatch[1]) {
      const meetingId = decodePathSegment(meetingMatch[1]);
      return meetingId ? { view: "meeting", meetingId } : { view: "library" };
    }
    // ?tab= is absent on the default Agenda tab, so report it explicitly
    // rather than leaving the agent to infer which list the user is looking at.
    return {
      view: "meetings",
      meetingsTab: params.get("tab") === "past" ? "past" : "agenda",
      ...(searchTerm ? { search: searchTerm } : {}),
    };
  }

  // /dictate (optionally /dictate/:dictationId in the future)
  const dictateMatch = p.match(/^\/dictate(?:\/([^/]+))?$/);
  if (dictateMatch) {
    const dictationId = decodePathSegment(dictateMatch[1]);
    if (dictateMatch[1] && !dictationId) return { view: "library" };
    return {
      view: "dictate",
      ...(dictationId ? { dictationId } : {}),
    };
  }

  if (p === "/spaces") return { view: "spaces" };
  if (p === "/shared") return { view: "shared" };
  if (p === "/archive") return { view: "archive" };
  if (p === "/trash") return { view: "trash" };
  if (p === "/record") return { view: "record" };
  if (p === "/bug-report") return { view: "bug-report" };
  if (p === "/bug-report/done") {
    return {
      view: "bug-report-done",
      recordingId: params.get("recordingId") || undefined,
    };
  }
  if (p === "/notifications") return { view: "notifications" };
  if (p.startsWith("/settings")) return { view: "settings" };
  if (p === "/library" || p === "/home") {
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
export function pathFromCommand(cmd: NavigateCommand): string {
  if (cmd.path) return cmd.path;
  switch (cmd.view) {
    case "recording":
      if (!cmd.recordingId) return "/library";
      const recordingParams = new URLSearchParams();
      if (cmd.panel) recordingParams.set("panel", cmd.panel);
      if (typeof cmd.atMs === "number" && Number.isFinite(cmd.atMs)) {
        recordingParams.set("at", String(Math.max(0, Math.round(cmd.atMs))));
      }
      return `/r/${encodeURIComponent(cmd.recordingId)}${
        recordingParams.size > 0 ? `?${recordingParams.toString()}` : ""
      }`;
    case "insights":
      return cmd.recordingId
        ? `/r/${encodeURIComponent(cmd.recordingId)}?panel=insights`
        : "/library";
    case "share":
      return cmd.shareId
        ? `/share/${encodeURIComponent(cmd.shareId)}`
        : "/library";
    case "embed":
      return cmd.shareId
        ? `/embed/${encodeURIComponent(cmd.shareId)}`
        : "/library";
    case "space":
      return cmd.spaceId
        ? `/spaces/${encodeURIComponent(cmd.spaceId)}`
        : "/spaces";
    case "spaces":
      return "/spaces";
    case "shared":
      return "/shared";
    case "archive":
      return "/archive";
    case "trash":
      return "/trash";
    case "record":
      return "/record";
    case "bug-report":
      return "/bug-report";
    case "bug-report-done":
      return cmd.recordingId
        ? `/bug-report/done?recordingId=${encodeURIComponent(cmd.recordingId)}`
        : "/bug-report/done";
    case "notifications":
      return "/notifications";
    case "settings":
      return "/settings";
    case "meetings":
      return cmd.meetingsTab === "past" ? "/meetings?tab=past" : "/meetings";
    case "meeting":
      return cmd.meetingId
        ? `/meetings/${encodeURIComponent(cmd.meetingId)}`
        : "/meetings";
    case "dictate":
      return "/dictate";
    case "library":
    default:
      if (cmd.folderId) {
        return `/library/folder/${encodeURIComponent(cmd.folderId)}`;
      }
      return "/library";
  }
}

export function useNavigationState() {
  useAgentRouteState<NavigationState, NavigateCommand>({
    // Scope navigation to this browser tab so the agent reads the clip THIS
    // tab is showing, not whichever tab navigated last. Without this, the
    // global `navigation` key is shared across tabs and a chat in tab B can
    // summarize the clip open in tab A.
    browserTabId: getBrowserTabId(),
    // Commit navigation immediately so the agent never reads a stale
    // recordingId after the user switches clips. The only high-frequency URL
    // change (meetings ?q=) is already debounced where it is written.
    getNavigationState: ({ pathname, search }) =>
      stateFromLocation(pathname, search),
    getCommandPath: (cmd) => pathFromCommand(cmd),
  });
}
