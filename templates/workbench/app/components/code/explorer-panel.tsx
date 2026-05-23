import { useEffect, useState } from "react";
import { agentNativePath } from "@agent-native/core/client";
import { useQuery } from "@tanstack/react-query";
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconFolderOpen,
} from "@tabler/icons-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

interface ExplorerPanelProps {
  workspaceId: string;
  activePath?: string | null;
  onOpenFile: (path: string) => void;
}

/**
 * Lazy file tree for the Explorer panel. Renders the workspace root on
 * mount, and fetches each directory's children on click. We deliberately
 * don't pre-traverse the whole tree: large monorepos would balloon the
 * payload and Monaco's editor only cares about a handful of paths at a
 * time.
 */
export function ExplorerPanel({
  workspaceId,
  activePath,
  onOpenFile,
}: ExplorerPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Explorer
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        <DirectoryNode
          workspaceId={workspaceId}
          path="."
          depth={0}
          rootMode
          activePath={activePath}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  );
}

function DirectoryNode({
  workspaceId,
  path,
  depth,
  rootMode,
  activePath,
  onOpenFile,
}: {
  workspaceId: string;
  path: string;
  depth: number;
  rootMode?: boolean;
  activePath?: string | null;
  onOpenFile: (path: string) => void;
}) {
  // Root auto-expands; child dirs expand on click.
  const [expanded, setExpanded] = useState<boolean>(Boolean(rootMode));

  const { data, isPending, isError } = useQuery<{ nodes: FileNode[] }>({
    queryKey: ["code", "ls", workspaceId, path],
    queryFn: async () => {
      const params = new URLSearchParams({
        workspaceId,
        path,
        depth: "1",
      });
      const res = await fetch(
        agentNativePath(
          `/_agent-native/actions/list-files-in-workspace?${params.toString()}`,
        ),
        { method: "GET" },
      );
      if (!res.ok) {
        throw new Error(`ls failed (${res.status})`);
      }
      const body = await res.json();
      return { nodes: Array.isArray(body.nodes) ? body.nodes : [] };
    },
    enabled: expanded,
    staleTime: 10_000,
  });

  return (
    <ul className={cn("space-y-0.5", depth === 0 && "px-1")}>
      {!rootMode ? (
        <li>
          <DirectoryRow
            label={leafName(path)}
            expanded={expanded}
            depth={depth}
            onToggle={() => setExpanded((v) => !v)}
          />
        </li>
      ) : null}
      {expanded ? (
        isPending ? (
          <li className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
            <Spinner className="size-3" />
            Loading…
          </li>
        ) : isError ? (
          <li className="px-2 py-1 text-[11px] text-destructive">
            Couldn't read directory.
          </li>
        ) : (
          (data?.nodes ?? []).map((node) => (
            <li key={node.path}>
              {node.type === "dir" ? (
                <DirectoryNode
                  workspaceId={workspaceId}
                  path={node.path}
                  depth={depth + 1}
                  activePath={activePath}
                  onOpenFile={onOpenFile}
                />
              ) : (
                <FileRow
                  label={node.name}
                  depth={depth + 1}
                  active={node.path === activePath}
                  onClick={() => onOpenFile(node.path)}
                />
              )}
            </li>
          ))
        )
      ) : null}
    </ul>
  );
}

function DirectoryRow({
  label,
  expanded,
  depth,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  depth: number;
  onToggle: () => void;
}) {
  const Caret = expanded ? IconChevronDown : IconChevronRight;
  const FolderIcon = expanded ? IconFolderOpen : IconFolder;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-accent/50",
        "text-foreground",
      )}
      style={{ paddingLeft: `${4 + depth * 12}px` }}
    >
      <Caret size={12} className="shrink-0 text-muted-foreground" aria-hidden />
      <FolderIcon
        size={12}
        className="shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

function FileRow({
  label,
  depth,
  active,
  onClick,
}: {
  label: string;
  depth: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-accent/50",
        active ? "bg-accent text-accent-foreground" : "text-foreground",
      )}
      style={{ paddingLeft: `${4 + depth * 12 + 14}px` }}
    >
      <IconFile
        size={12}
        className="shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

function leafName(p: string): string {
  if (!p || p === ".") return ".";
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}
