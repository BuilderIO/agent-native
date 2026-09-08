import { useT } from "@agent-native/core/client/i18n";
import {
  CommandMenu,
  useCommandMenuShortcut,
} from "@agent-native/core/client/navigation";
import { useOrgRole } from "@agent-native/core/client/org";
import { docsUrl } from "@agent-native/core/shared";
import {
  IconArchive,
  IconCalendar,
  IconFileText,
  IconFolder,
  IconFolderPlus,
  IconHierarchy2,
  IconMessage,
  IconMicrophone2,
  IconMoon,
  IconSearch,
  IconSettings,
  IconSun,
  IconTrash,
  IconUsersGroup,
  IconVideo,
  IconVideoPlus,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { type ComponentProps, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

import {
  useDictationCommandSearch,
  useMeetingCommandSearch,
  type DictationCommandSearchHit,
  type MeetingCommandSearchHit,
} from "@/hooks/use-command-search";
import {
  useFolders,
  useOrganizations,
  useRecordingSearch,
  useSpaces,
  type SearchHit,
} from "@/hooks/use-library";
import {
  OPEN_CREATE_FOLDER_EVENT,
  OPEN_CREATE_SPACE_EVENT,
  openBugReportDialog,
} from "@/lib/command-events";
import { SEARCH_FOCUS_PATH } from "@/lib/search-focus";

import changelog from "../../CHANGELOG.md?raw";

interface ClipsCommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CommandRouteContext =
  | { kind: "recording"; recordingId: string }
  | { kind: "meeting"; meetingId: string }
  | { kind: "folder"; folderId: string; spaceId?: string }
  | { kind: "space"; spaceId: string }
  | {
      kind:
        | "library"
        | "shared"
        | "spaces"
        | "meetings"
        | "dictate"
        | "archive"
        | "trash"
        | "settings"
        | "record"
        | "other";
    };

function commandRouteContext(pathname: string): CommandRouteContext {
  const recording = pathname.match(/^\/r\/([^/]+)\/?$/);
  if (recording) return { kind: "recording", recordingId: recording[1] };

  const spaceFolder = pathname.match(/^\/spaces\/([^/]+)\/folder\/([^/]+)\/?$/);
  if (spaceFolder) {
    return {
      kind: "folder",
      spaceId: spaceFolder[1],
      folderId: spaceFolder[2],
    };
  }

  const libraryFolder = pathname.match(/^\/library\/folder\/([^/]+)\/?$/);
  if (libraryFolder) return { kind: "folder", folderId: libraryFolder[1] };

  const space = pathname.match(/^\/spaces\/([^/]+)\/?$/);
  if (space) return { kind: "space", spaceId: space[1] };

  if (pathname === "/library") return { kind: "library" };
  if (pathname === "/shared") return { kind: "shared" };
  if (pathname === "/spaces") return { kind: "spaces" };
  if (pathname === "/meetings") return { kind: "meetings" };
  if (pathname.startsWith("/meetings/")) {
    return { kind: "meeting", meetingId: pathname.slice("/meetings/".length) };
  }
  if (pathname === "/dictate") return { kind: "dictate" };
  if (pathname === "/archive") return { kind: "archive" };
  if (pathname === "/trash") return { kind: "trash" };
  if (pathname === "/record") return { kind: "record" };
  if (pathname.startsWith("/settings")) return { kind: "settings" };
  return { kind: "other" };
}

function withQuery(pathname: string, entries: Record<string, string>) {
  const params = new URLSearchParams(entries);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function openCreateFolder() {
  window.dispatchEvent(new Event(OPEN_CREATE_FOLDER_EVENT));
}

function openCreateSpace() {
  window.dispatchEvent(new Event(OPEN_CREATE_SPACE_EVENT));
}

function formatSearchSnippet(text: string | null | undefined) {
  return text?.replace(/\s+/g, " ").trim() || null;
}

function RecordingSearchResults({
  results,
  navigate,
  t,
}: {
  results: SearchHit[];
  navigate: ReturnType<typeof useNavigate>;
  t: ReturnType<typeof useT>;
}) {
  if (results.length === 0) return null;
  return (
    <CommandMenu.Group heading={t("navigation.recordings")}>
      {results.slice(0, 8).map((hit) => (
        <CommandMenu.Item
          key={`recording:${hit.id}:${hit.matchPanel ?? "metadata"}`}
          onSelect={() => {
            const params: Record<string, string> = {};
            if (hit.matchPanel) params.panel = hit.matchPanel;
            if (
              typeof hit.matchMs === "number" &&
              Number.isFinite(hit.matchMs)
            ) {
              params.t = Math.max(0, Math.floor(hit.matchMs / 1000)).toString();
            }
            void navigate(withQuery(`/r/${hit.id}`, params));
          }}
          keywords={[
            hit.title,
            hit.description,
            hit.snippet ?? "",
            "recording",
            "clip",
          ]}
          className="items-start py-2"
        >
          <IconVideo className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{hit.title}</span>
            {formatSearchSnippet(hit.snippet ?? hit.description) ? (
              <span className="mt-0.5 block line-clamp-2 text-xs leading-snug text-muted-foreground">
                {formatSearchSnippet(hit.snippet ?? hit.description)}
              </span>
            ) : null}
          </span>
          {hit.matchPanel ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {hit.matchPanel === "comments"
                ? t("sharePage.comments")
                : t("recordingPage.transcript")}
            </span>
          ) : null}
        </CommandMenu.Item>
      ))}
    </CommandMenu.Group>
  );
}

function MeetingSearchResults({
  results,
  navigate,
  t,
}: {
  results: MeetingCommandSearchHit[];
  navigate: ReturnType<typeof useNavigate>;
  t: ReturnType<typeof useT>;
}) {
  if (results.length === 0) return null;
  return (
    <CommandMenu.Group heading={t("navigation.meetings")}>
      {results.map((meeting) => (
        <CommandMenu.Item
          key={`meeting:${meeting.id}`}
          onSelect={() => void navigate(`/meetings/${meeting.id}`)}
          keywords={[meeting.title, meeting.snippet ?? "", "meeting", "call"]}
          className="items-start py-2"
        >
          <IconCalendar className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{meeting.title}</span>
            {formatSearchSnippet(meeting.snippet) ? (
              <span className="mt-0.5 block line-clamp-2 text-xs leading-snug text-muted-foreground">
                {formatSearchSnippet(meeting.snippet)}
              </span>
            ) : null}
          </span>
        </CommandMenu.Item>
      ))}
    </CommandMenu.Group>
  );
}

function DictationSearchResults({
  results,
  navigate,
  t,
}: {
  results: DictationCommandSearchHit[];
  navigate: ReturnType<typeof useNavigate>;
  t: ReturnType<typeof useT>;
}) {
  if (results.length === 0) return null;
  return (
    <CommandMenu.Group heading={t("navigation.dictate")}>
      {results.map((dictation) => (
        <CommandMenu.Item
          key={`dictation:${dictation.id}`}
          onSelect={() =>
            void navigate(withQuery("/dictate", { dictationId: dictation.id }))
          }
          keywords={[
            dictation.fullText,
            dictation.cleanedText ?? "",
            "dictation",
            "voice",
          ]}
          className="items-start py-2"
        >
          <IconMicrophone2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block line-clamp-2 font-medium">
              {formatSearchSnippet(dictation.snippet) ?? dictation.fullText}
            </span>
            {dictation.targetApp ? (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {dictation.targetApp}
              </span>
            ) : null}
          </span>
        </CommandMenu.Item>
      ))}
    </CommandMenu.Group>
  );
}

function LocalSearchResults({
  query,
  folders,
  spaces,
  navigate,
  t,
}: {
  query: string;
  folders: Array<{ id: string; name: string; spaceId?: string | null }>;
  spaces: Array<{ id: string; name: string }>;
  navigate: ReturnType<typeof useNavigate>;
  t: ReturnType<typeof useT>;
}) {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return null;
  const matchingFolders = folders
    .filter((folder) => folder.name.toLowerCase().includes(needle))
    .slice(0, 8);
  const matchingSpaces = spaces
    .filter((space) => space.name.toLowerCase().includes(needle))
    .slice(0, 8);

  return (
    <>
      {matchingFolders.length > 0 && (
        <CommandMenu.Group heading={t("navigation.folders")}>
          {matchingFolders.map((folder) => (
            <CommandMenu.Item
              key={`folder:${folder.id}`}
              onSelect={() =>
                void navigate(
                  folder.spaceId
                    ? `/spaces/${folder.spaceId}/folder/${folder.id}`
                    : `/library/folder/${folder.id}`,
                )
              }
              keywords={[folder.name, "folder"]}
            >
              <IconFolder className="size-4 text-muted-foreground" />
              <span className="truncate">{folder.name}</span>
            </CommandMenu.Item>
          ))}
        </CommandMenu.Group>
      )}
      {matchingSpaces.length > 0 && (
        <CommandMenu.Group heading={t("navigation.spaces")}>
          {matchingSpaces.map((space) => (
            <CommandMenu.Item
              key={`space:${space.id}`}
              onSelect={() => void navigate(`/spaces/${space.id}`)}
              keywords={[space.name, "space"]}
            >
              <IconUsersGroup className="size-4 text-muted-foreground" />
              <span className="truncate">{space.name}</span>
            </CommandMenu.Item>
          ))}
        </CommandMenu.Group>
      )}
    </>
  );
}

function ClipsCommandSearchResults({
  search,
  folders,
  spaces,
  navigate,
  t,
}: {
  search: string;
  folders: Array<{ id: string; name: string; spaceId?: string | null }>;
  spaces: Array<{ id: string; name: string }>;
  navigate: ReturnType<typeof useNavigate>;
  t: ReturnType<typeof useT>;
}) {
  const recordingSearch = useRecordingSearch(search.trim());
  const meetingSearch = useMeetingCommandSearch(search);
  const dictationSearch = useDictationCommandSearch(search);

  if (search.trim().length < 2) return null;
  return (
    <>
      <LocalSearchResults
        query={search}
        folders={folders}
        spaces={spaces}
        navigate={navigate}
        t={t}
      />
      <RecordingSearchResults
        results={recordingSearch.data?.results ?? []}
        navigate={navigate}
        t={t}
      />
      <MeetingSearchResults
        results={meetingSearch.data?.meetings ?? []}
        navigate={navigate}
        t={t}
      />
      <DictationSearchResults
        results={dictationSearch.data?.dictations ?? []}
        navigate={navigate}
        t={t}
      />
    </>
  );
}

function ThemeToggleItem() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useT();
  const isDark = resolvedTheme === "dark";
  return (
    <CommandMenu.Item
      onSelect={() => setTheme(isDark ? "light" : "dark")}
      keywords={["theme", "dark", "light", "mode"]}
    >
      {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
      {t("root.toggleTheme")}
    </CommandMenu.Item>
  );
}

export function ClipsCommandMenu({
  open,
  onOpenChange,
}: ClipsCommandMenuProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const { canManageOrg } = useOrgRole();
  const context = useMemo(
    () => commandRouteContext(location.pathname),
    [location.pathname],
  );
  const { data: organizations } = useOrganizations();
  const organizationId =
    organizations?.currentId ?? organizations?.organizations?.[0]?.id;
  const { data: folderData } = useFolders(
    { organizationId },
    { enabled: open && Boolean(organizationId) },
  );
  const { data: spaceData } = useSpaces(organizationId, {
    enabled: open && Boolean(organizationId),
  });
  const folders = (folderData?.folders ?? []) as Array<{
    id: string;
    name: string;
    spaceId?: string | null;
  }>;
  const spaces = (spaceData?.spaces ?? []) as Array<{
    id: string;
    name: string;
  }>;
  const renderResults = useCallback(
    (search: string) => (
      <ClipsCommandSearchResults
        search={search}
        folders={folders}
        spaces={spaces}
        navigate={navigate}
        t={t}
      />
    ),
    [folders, navigate, spaces, t],
  );

  useCommandMenuShortcut(useCallback(() => onOpenChange(true), [onOpenChange]));

  const scopedRecordPath =
    context.kind === "folder"
      ? withQuery("/record", {
          folderId: context.folderId,
          ...(context.spaceId ? { spaceId: context.spaceId } : {}),
        })
      : context.kind === "space"
        ? withQuery("/record", { spaceId: context.spaceId })
        : "/record";

  return (
    <CommandMenu
      open={open}
      onOpenChange={onOpenChange}
      changelog={changelog}
      changelogLabel={t("settings.whatsNew")}
      changelogKey="clips"
      renderResults={renderResults}
    >
      <CommandMenu.Group heading={t("root.commandActions")}>
        {context.kind === "recording" && (
          <>
            <CommandMenu.Item
              onSelect={() =>
                void navigate(
                  withQuery(`/r/${context.recordingId}`, {
                    panel: "comments",
                  }),
                )
              }
              keywords={["comments", "discussion", "feedback", "recording"]}
            >
              <IconMessage size={16} />
              {t("sharePage.comments")}
            </CommandMenu.Item>
            <CommandMenu.Item
              onSelect={() =>
                void navigate(
                  withQuery(`/r/${context.recordingId}`, {
                    panel: "transcript",
                  }),
                )
              }
              keywords={["transcript", "captions", "recording"]}
            >
              <IconFileText size={16} />
              {t("recordingPage.transcript")}
            </CommandMenu.Item>
            <CommandMenu.Item
              onSelect={() =>
                void navigate(
                  withQuery(`/r/${context.recordingId}`, { panel: "agent" }),
                )
              }
              keywords={["agent", "ask", "recording"]}
            >
              <IconHierarchy2 size={16} />
              {t("recordingPage.agent")}
            </CommandMenu.Item>
            <CommandMenu.Item
              onSelect={() =>
                void navigate(
                  withQuery(`/r/${context.recordingId}`, {
                    panel: "settings",
                  }),
                )
              }
              keywords={["settings", "recording"]}
            >
              <IconSettings size={16} />
              {t("recordingPage.settings")}
            </CommandMenu.Item>
          </>
        )}
        {(context.kind === "library" ||
          context.kind === "folder" ||
          context.kind === "space") && (
          <CommandMenu.Item
            onSelect={() => void navigate(scopedRecordPath)}
            keywords={["record", "recording", "capture", "new"]}
          >
            <IconVideoPlus size={16} />
            {t("navigation.newRecording")}
          </CommandMenu.Item>
        )}
        {(context.kind === "library" ||
          context.kind === "folder" ||
          context.kind === "space") && (
          <CommandMenu.Item
            onSelect={openCreateFolder}
            keywords={["folder", "new", "create"]}
          >
            <IconFolderPlus size={16} />
            {t("navigation.newFolder")}
          </CommandMenu.Item>
        )}
        {context.kind === "spaces" && canManageOrg && (
          <CommandMenu.Item
            onSelect={openCreateSpace}
            keywords={["space", "new", "create"]}
          >
            <IconUsersGroup size={16} />
            {t("createSpaceDialog.newSpace")}
          </CommandMenu.Item>
        )}
        <CommandMenu.Item
          onSelect={() => void navigate(SEARCH_FOCUS_PATH)}
          keywords={["search", "recordings", "meetings", "dictations", "find"]}
        >
          <IconSearch size={16} />
          {t("root.commandSearch")}
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => void navigate("/settings/agent")}
          keywords={["agent", "assistant", "chat"]}
        >
          <IconHierarchy2 size={16} />
          {t("root.openAgent")}
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={openBugReportDialog}
          keywords={["feedback", "bug", "report"]}
        >
          <IconMessage size={16} />
          {t("bugReportRoute.sidebarCta")}
        </CommandMenu.Item>
      </CommandMenu.Group>

      <CommandMenu.Group heading={t("navigation.library")}>
        <CommandMenu.Item
          onSelect={() => void navigate("/library")}
          keywords={["library", "recordings"]}
        >
          <IconVideo size={16} />
          {t("navigation.library")}
          <CommandMenu.Shortcut>G L</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => void navigate("/shared")}
          keywords={["shared", "clips"]}
        >
          <IconUsersGroup size={16} />
          {t("navigation.sharedWithMe")}
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => void navigate("/spaces")}
          keywords={["spaces", "team"]}
        >
          <IconUsersGroup size={16} />
          {t("navigation.spaces")}
          <CommandMenu.Shortcut>G S</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => void navigate("/meetings")}
          keywords={["meetings", "calls"]}
        >
          <IconCalendar size={16} />
          {t("navigation.meetings")}
          <CommandMenu.Shortcut>G M</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => void navigate("/dictate")}
          keywords={["dictate", "dictations", "voice"]}
        >
          <IconMicrophone2 size={16} />
          {t("navigation.dictate")}
          <CommandMenu.Shortcut>G D</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => void navigate("/archive")}
          keywords={["archive"]}
        >
          <IconArchive size={16} />
          {t("navigation.archive")}
          <CommandMenu.Shortcut>G A</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => void navigate("/trash")}
          keywords={["trash", "deleted"]}
        >
          <IconTrash size={16} />
          {t("navigation.trash")}
          <CommandMenu.Shortcut>G T</CommandMenu.Shortcut>
        </CommandMenu.Item>
      </CommandMenu.Group>

      <CommandMenu.Group heading={t("root.commandAppearance")}>
        <ThemeToggleItem />
      </CommandMenu.Group>

      <CommandMenu.DocsGroup docs={CLIPS_COMMAND_DOCS} />
    </CommandMenu>
  );
}

const CLIPS_COMMAND_DOCS = [
  {
    title: "Use the Chrome extension for browser logs", // i18n-ignore: documentation metadata is intentionally kept in the source language.
    description:
      "Record a browser tab with redacted console logs, JavaScript exceptions, and fetch/XHR diagnostics.",
    href: docsUrl("template-clips-capture-everywhere", {
      hash: "browser-logs-with-the-chrome-extension",
    }),
    keywords: [
      "logs",
      "browser logs",
      "developer logs",
      "console logs",
      "network logs",
      "fetch",
      "xhr",
      "diagnostics",
      "chrome extension",
      "recording",
    ],
  },
] satisfies ComponentProps<typeof CommandMenu.DocsGroup>["docs"];
