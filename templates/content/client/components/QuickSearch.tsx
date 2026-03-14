import { useEffect, useState, useMemo, useCallback } from "react";
import { FileText, FolderOpen, BookOpen, Lock } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useProjects, SHARED_SLUG } from "@/hooks/use-projects";
import { useAllFiles } from "@/hooks/use-all-files";

interface QuickSearchProps {
  onSelectFile: (projectSlug: string, filePath: string) => void;
  onSelectProject: (slug: string) => void;
  currentWorkspace?: string | null;
  /** Controlled open state - if provided, component is controlled */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function QuickSearch({
  onSelectFile,
  onSelectProject,
  currentWorkspace,
  open: controlledOpen,
  onOpenChange,
}: QuickSearchProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (isControlled) {
        onOpenChange?.(next);
      } else {
        setInternalOpen(next);
      }
    },
    [isControlled, onOpenChange]
  );

  const { data: projectsData } = useProjects();
  const projects = projectsData?.projects ?? [];

  // Fetch all file entries when dialog opens
  const { entries, isLoading } = useAllFiles(open ? projects : []);

  // Keyboard shortcut: Cmd+P / Ctrl+P
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setOpen(!open);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  const handleSelect = useCallback(
    (value: string) => {
      setOpen(false);
      // value format: "project:<slug>" or "file:<projectSlug>:<filePath>"
      if (value.startsWith("project:")) {
        const slug = value.slice("project:".length);
        onSelectProject(slug);
      } else if (value.startsWith("file:")) {
        const rest = value.slice("file:".length);
        const sepIdx = rest.indexOf(":");
        const projectSlug = rest.slice(0, sepIdx);
        const filePath = rest.slice(sepIdx + 1);
        onSelectFile(projectSlug, filePath);
      }
    },
    [onSelectFile, onSelectProject, setOpen]
  );

  // Workspace priority: 0 = current, 1 = other
  const getWorkspacePriority = useCallback(
    (slug: string) => {
      const ws = slug.includes("/") ? slug.split("/")[0] : slug;
      if (currentWorkspace && ws === currentWorkspace) return 0;
      return 1;
    },
    [currentWorkspace]
  );

  // Group file entries by project, sorted by workspace priority
  const projectFiles = useMemo(() => {
    const groups: Record<string, typeof entries> = {};
    for (const entry of entries) {
      const key = entry.projectSlug;
      if (!groups[key]) groups[key] = [];
      groups[key].push(entry);
    }

    // Sort by workspace priority
    const sorted: Record<string, typeof entries> = {};
    const keys = Object.keys(groups).sort(
      (a, b) => getWorkspacePriority(a) - getWorkspacePriority(b)
    );
    for (const k of keys) sorted[k] = groups[k];
    return sorted;
  }, [entries, getWorkspacePriority]);

  // Helper to extract workspace from a project slug
  const getWorkspace = useCallback((slug: string | undefined) => {
    if (!slug) return "";
    const sep = slug.indexOf("/");
    return sep > 0 ? slug.slice(0, sep) : slug;
  }, []);

  // Sort projects by workspace priority
  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) => getWorkspacePriority(a.slug) - getWorkspacePriority(b.slug)
      ),
    [projects, getWorkspacePriority]
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search files and projects..." />
      <CommandList className="max-h-[400px]">
        <CommandEmpty>
          {isLoading ? "Loading files..." : "No results found."}
        </CommandEmpty>

        {/* Projects */}
        {projects.length > 0 && (
          <CommandGroup heading="Projects">
            {sortedProjects.map((p) => {
              const ws = getWorkspace(p.slug);
              return (
                <CommandItem
                  key={`project:${p.slug}`}
                  value={`project:${p.slug} ${p.name}`}
                  onSelect={() => handleSelect(`project:${p.slug}`)}
                  className="gap-2.5"
                >
                  <FolderOpen size={14} className="text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{p.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {ws === "private" && (
                      <span title="Private workspace"><Lock size={11} className="text-muted-foreground" /></span>
                    )}
                    {p.isPrivate && ws !== "private" && (
                      <span title="Private project"><Lock size={11} className="text-muted-foreground" /></span>
                    )}
                    <span className="text-[11px] text-muted-foreground">{ws === "private" ? "Private" : ws}</span>
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Files grouped by project, ordered by workspace priority */}
        {Object.entries(projectFiles).map(([slug, files]) => {
          const label =
            slug === SHARED_SLUG
              ? "Shared Resources"
              : projects.find((p) => p.slug === slug)?.name ?? slug;
          const ws = getWorkspace(slug);
          const groupLabel = label;
          return (
            <CommandGroup key={slug} heading={groupLabel}>
              {files.map((f) => {
                if (!f.projectSlug || !f.filePath) return null;
                return (
                  <CommandItem
                    key={`file:${f.projectSlug}:${f.filePath}`}
                    value={`file:${f.projectSlug}:${f.filePath} ${f.title || ""} ${f.fileName || ""}`}
                    onSelect={() =>
                      handleSelect(`file:${f.projectSlug}:${f.filePath}`)
                    }
                    className="gap-2.5"
                  >
                    {f.projectSlug === SHARED_SLUG ? (
                      <BookOpen size={14} className="text-muted-foreground shrink-0" />
                    ) : (
                      <FileText size={14} className="text-muted-foreground shrink-0" />
                    )}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate text-sm">
                        {f.title || f.fileName}
                      </span>
                      {f.title && f.title !== f.fileName && (
                        <span className="truncate text-xs text-muted-foreground">
                          {f.filePath}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {ws === "private" && (
                        <span title="Private workspace"><Lock size={11} className="text-muted-foreground" /></span>
                      )}
                      <span className="text-[11px] text-muted-foreground">{ws === "private" ? "Private" : ws}</span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}
      </CommandList>

      {/* Footer hint */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>
            <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">
              ↑↓
            </kbd>{" "}
            navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">
              ↵
            </kbd>{" "}
            open
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">
              esc
            </kbd>{" "}
            close
          </span>
        </div>
      </div>
    </CommandDialog>
  );
}
