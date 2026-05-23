import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useActionQuery, agentNativePath } from "@agent-native/core/client";
import { ActivityBar, type ActivityId } from "@/components/code/activity-bar";
import { WorkspacePicker } from "@/components/code/workspace-picker";
import { ExplorerPanel } from "@/components/code/explorer-panel";
import { ChangesPanel } from "@/components/code/changes-panel";
import { SearchPanel } from "@/components/code/search-panel";
import { SourceControlPanel } from "@/components/code/source-control-panel";
import { FileTabs, type OpenTab } from "@/components/code/file-tabs";
import { MonacoPane } from "@/components/code/monaco-pane";
import { CommandPalette } from "@/components/code/command-palette";
import { CodeSettingsPanel } from "@/components/code/code-settings-panel";
import { CodeEmptyState } from "@/components/code/code-empty-state";

/**
 * Top-level layout for the Code Room — VS Code style activity bar +
 * left sidebar + center editor area.
 *
 * Layout (desktop):
 *
 *   ┌──┬───────────────┬──────────────────────────────────┐
 *   │A │   sidebar     │   tabs                            │
 *   │B │   (panel)     ├──────────────────────────────────┤
 *   │  │               │   monaco editor / diff            │
 *   │  │               │                                   │
 *   │S │               │   status bar (branch · path)      │
 *   └──┴───────────────┴──────────────────────────────────┘
 *
 * The shell owns the `activity` state (which sidebar panel is showing)
 * + the list of open tabs. Workspace selection lives in URL state /
 * the `workspace-picker` dropdown — we read the current workspaceId from
 * `useParams` (the catch-all route puts it there as `?ws=` … see notes
 * below) and fall back to the first row in `list-code-workspaces`.
 *
 * Tabs are local React state in v1 — the `workbench_open_files` table
 * is wired by the agent only (`agent says "open these tabs"`); the UI
 * just shows what the user currently has open. v1.1 will persist them
 * round-trip.
 */
export interface CodeShellProps {
  /** Path that's open in the editor, relative to the workspace root, or null for the welcome view. */
  filePath?: string | null;
  /** When true, render the diff editor instead of plain editing. */
  isDiff?: boolean;
}

interface WorkspacesResult {
  workspaces: Array<{
    id: string;
    label: string;
    path: string;
    isDefault: boolean;
    addedAt: string;
  }>;
}

export function CodeShell({ filePath = null, isDiff = false }: CodeShellProps) {
  const navigate = useNavigate();
  const params = useParams<{ "*"?: string }>();

  const workspacesQuery = useActionQuery<WorkspacesResult>(
    "list-code-workspaces" as any,
    {} as any,
  );

  // Active workspace: explicit `?ws=` query string > default flag > first row.
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  useEffect(() => {
    if (workspaceId) return;
    const rows = workspacesQuery.data?.workspaces ?? [];
    if (rows.length === 0) return;
    const wsFromUrl = readWorkspaceIdFromUrl();
    const preferred = wsFromUrl
      ? rows.find((r) => r.id === wsFromUrl)
      : (rows.find((r) => r.isDefault) ?? rows[0]);
    if (preferred) setWorkspaceId(preferred.id);
  }, [workspacesQuery.data, workspaceId]);

  const activeWorkspace = useMemo(
    () =>
      workspacesQuery.data?.workspaces?.find((r) => r.id === workspaceId) ??
      null,
    [workspacesQuery.data, workspaceId],
  );

  // Activity bar state: which sidebar panel is showing.
  const [activity, setActivity] = useState<ActivityId>("explorer");

  // Open tabs are in-memory in v1. The active tab matches `filePath` when set.
  const [tabs, setTabs] = useState<OpenTab[]>([]);

  useEffect(() => {
    if (!filePath) return;
    setTabs((current) => {
      if (current.some((t) => t.path === filePath)) return current;
      return [...current, { path: filePath, dirty: false }];
    });
  }, [filePath]);

  const handleOpenFile = useCallback(
    (nextPath: string, opts?: { diff?: boolean }) => {
      const prefix = opts?.diff ? "/code/diff/" : "/code/";
      navigate(
        `${prefix}${encodeRelative(nextPath)}${urlSuffixForWorkspace(workspaceId)}`,
      );
    },
    [navigate, workspaceId],
  );

  const handleCloseTab = useCallback(
    (closePath: string) => {
      setTabs((current) => {
        const next = current.filter((t) => t.path !== closePath);
        if (filePath === closePath) {
          // Navigate to the previous tab or to the welcome view.
          const remainingActive = next[next.length - 1]?.path;
          if (remainingActive) {
            navigate(
              `/code/${encodeRelative(remainingActive)}${urlSuffixForWorkspace(workspaceId)}`,
            );
          } else {
            navigate(`/code${urlSuffixForWorkspace(workspaceId)}`);
          }
        }
        return next;
      });
    },
    [filePath, navigate, workspaceId],
  );

  // Cmd+K / Cmd+P opens the command palette.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "p")) {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // No workspaces yet -> empty state with a CTA to add one via Settings panel.
  const hasWorkspaces = (workspacesQuery.data?.workspaces?.length ?? 0) > 0;
  if (!workspacesQuery.isPending && !hasWorkspaces) {
    return (
      <div className="flex h-full">
        <ActivityBar
          activity={activity}
          onActivityChange={setActivity}
          showSettings
        />
        <div className="flex-1 overflow-auto">
          <CodeEmptyState onAddWorkspace={() => setActivity("settings")} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ActivityBar
        activity={activity}
        onActivityChange={setActivity}
        showSettings
      />
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-border bg-muted/20">
        <WorkspacePicker
          workspaces={workspacesQuery.data?.workspaces ?? []}
          activeWorkspaceId={workspaceId}
          onWorkspaceChange={(id) => {
            setWorkspaceId(id);
            // Close stale tabs when the workspace changes — they belong
            // to the previous root and the paths won't resolve.
            setTabs([]);
            navigate(`/code${id ? `?ws=${id}` : ""}`);
          }}
          onAddWorkspace={() => setActivity("settings")}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeWorkspace ? (
            activity === "explorer" ? (
              <ExplorerPanel
                workspaceId={activeWorkspace.id}
                activePath={filePath}
                onOpenFile={handleOpenFile}
              />
            ) : activity === "changes" ? (
              <ChangesPanel
                workspaceId={activeWorkspace.id}
                onOpenDiff={(p) => handleOpenFile(p, { diff: true })}
              />
            ) : activity === "search" ? (
              <SearchPanel
                workspaceId={activeWorkspace.id}
                onOpenHit={(p) => handleOpenFile(p)}
              />
            ) : activity === "source-control" ? (
              <SourceControlPanel
                workspaceId={activeWorkspace.id}
                onOpenDiff={(p) => handleOpenFile(p, { diff: true })}
              />
            ) : activity === "settings" ? (
              <CodeSettingsPanel
                workspaces={workspacesQuery.data?.workspaces ?? []}
                onWorkspaceAdded={() => workspacesQuery.refetch()}
                onWorkspaceRemoved={(id) => {
                  workspacesQuery.refetch();
                  if (id === workspaceId) {
                    setWorkspaceId(null);
                    setTabs([]);
                    navigate("/code");
                  }
                }}
              />
            ) : null
          ) : (
            <div className="flex h-full items-center justify-center px-4 py-6 text-center text-xs text-muted-foreground">
              Pick a workspace above.
            </div>
          )}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <FileTabs
          tabs={tabs}
          activePath={filePath}
          onActivate={(p) =>
            navigate(
              `/code/${encodeRelative(p)}${urlSuffixForWorkspace(workspaceId)}`,
            )
          }
          onClose={handleCloseTab}
        />
        <div className="min-h-0 flex-1">
          <MonacoPane
            workspaceId={activeWorkspace?.id ?? null}
            filePath={filePath}
            isDiff={isDiff}
            onDirtyChange={(p, dirty) =>
              setTabs((current) =>
                current.map((t) => (t.path === p ? { ...t, dirty } : t)),
              )
            }
          />
        </div>
        {activeWorkspace ? (
          <StatusBar
            branchHint={null}
            workspaceLabel={activeWorkspace.label}
            filePath={filePath}
          />
        ) : null}
      </main>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        workspaceId={activeWorkspace?.id ?? null}
        onOpenFile={(p) => {
          setPaletteOpen(false);
          handleOpenFile(p);
        }}
      />
    </div>
  );
}

function StatusBar({
  branchHint,
  workspaceLabel,
  filePath,
}: {
  branchHint: string | null;
  workspaceLabel: string;
  filePath: string | null;
}) {
  return (
    <footer className="flex h-6 items-center gap-3 border-t border-border bg-muted/30 px-3 text-[11px] text-muted-foreground">
      <span className="truncate">{workspaceLabel}</span>
      {branchHint ? <span className="truncate">· {branchHint}</span> : null}
      {filePath ? (
        <span className="ml-auto truncate font-mono">{filePath}</span>
      ) : null}
    </footer>
  );
}

/** Encode a relative file path into a URL segment, preserving slashes. */
function encodeRelative(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

function urlSuffixForWorkspace(workspaceId: string | null): string {
  if (!workspaceId) return "";
  return `?ws=${encodeURIComponent(workspaceId)}`;
}

function readWorkspaceIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("ws");
}
