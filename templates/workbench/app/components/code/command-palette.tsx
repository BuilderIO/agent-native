import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";
import { IconFile } from "@tabler/icons-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  workspaceId: string | null;
  onOpenFile: (path: string) => void;
}

/**
 * Cmd+K / Cmd+P quick file switcher.
 *
 * The palette eagerly loads two levels of the workspace tree on open
 * (depth=2 keeps the response small for medium repos), then cmdk's
 * built-in fuzzy match filters as the user types. When typing a query
 * that matches no top-level paths, falls back to substring search
 * across files in case the file lives deeper than depth=2 — that
 * second query only fires for queries >= 2 chars to avoid flooding
 * the server on every keystroke.
 */
export function CommandPalette({
  open,
  onOpenChange,
  workspaceId,
  onOpenFile,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  // Reset query when the palette closes.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const treeQuery = useQuery<{ nodes: FileNode[] }>({
    queryKey: ["code", "palette-tree", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return { nodes: [] };
      const params = new URLSearchParams({
        workspaceId,
        path: ".",
        depth: "3",
      });
      const res = await fetch(
        agentNativePath(
          `/_agent-native/actions/list-files-in-workspace?${params.toString()}`,
        ),
      );
      if (!res.ok) return { nodes: [] };
      const body = await res.json();
      // Flatten depth=3 into a flat file list for cmdk filtering.
      const flat: FileNode[] = [];
      function walk(nodes: any[], parent: string) {
        for (const n of nodes) {
          if (n.type === "file") {
            flat.push({ name: n.name, path: n.path, type: "file" });
          } else if (n.type === "dir" && Array.isArray(n.children)) {
            walk(n.children, n.path);
          }
        }
      }
      walk(Array.isArray(body.nodes) ? body.nodes : [], ".");
      return { nodes: flat };
    },
    enabled: open && Boolean(workspaceId),
    staleTime: 30_000,
  });

  // Fallback: server-side substring search for queries that don't
  // match the cached tree (e.g. deeply nested files past depth=3).
  const searchQuery = useQuery<{ hits: Array<{ path: string }> }>({
    queryKey: ["code", "palette-search", workspaceId, query],
    queryFn: async () => {
      if (!workspaceId || query.trim().length < 2) return { hits: [] };
      const params = new URLSearchParams({
        workspaceId,
        query,
        max: "20",
      });
      const res = await fetch(
        agentNativePath(
          `/_agent-native/actions/search-files?${params.toString()}`,
        ),
      );
      if (!res.ok) return { hits: [] };
      const body = await res.json();
      // De-dupe by path (search returns per-line hits).
      const seen = new Set<string>();
      const paths: Array<{ path: string }> = [];
      for (const h of body.hits ?? []) {
        if (!seen.has(h.path)) {
          seen.add(h.path);
          paths.push({ path: h.path });
        }
      }
      return { hits: paths };
    },
    enabled: open && Boolean(workspaceId) && query.trim().length >= 2,
    staleTime: 5_000,
  });

  const treeFiles = treeQuery.data?.nodes ?? [];
  const searchPaths = (searchQuery.data?.hits ?? []).map((h) => h.path);

  const combined = useMemo(() => {
    const set = new Set<string>();
    const out: Array<{ path: string; source: "tree" | "search" }> = [];
    for (const f of treeFiles) {
      if (!set.has(f.path)) {
        set.add(f.path);
        out.push({ path: f.path, source: "tree" });
      }
    }
    for (const p of searchPaths) {
      if (!set.has(p)) {
        set.add(p);
        out.push({ path: p, source: "search" });
      }
    }
    return out;
  }, [treeFiles, searchPaths]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={
          workspaceId ? "Find a file (Cmd+P)…" : "Pick a workspace first."
        }
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {!workspaceId
            ? "No workspace selected."
            : treeQuery.isPending
              ? "Loading files…"
              : "No matches."}
        </CommandEmpty>
        <CommandGroup heading="Files">
          {combined.slice(0, 100).map((entry) => (
            <CommandItem
              key={entry.path}
              value={entry.path}
              onSelect={() => onOpenFile(entry.path)}
            >
              <IconFile size={12} aria-hidden />
              <span className="font-mono text-xs">{entry.path}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
