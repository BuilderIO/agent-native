import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { FileEntry } from "@shared/api";
import { FileViewer } from "@/components/FileViewer";
import { FileDetail } from "@/components/FileDetail";
import { ContextEditor } from "@/components/ContextEditor";
import { ActivityFeed } from "@/components/ActivityFeed";

function collectFiles(entries: FileEntry[]): FileEntry[] {
  const out: FileEntry[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.type === "file") {
      out.push(e);
    } else if (e.children?.length) {
      out.push(...collectFiles(e.children));
    }
  }
  return out;
}

function isEmptyOrOnlyContext(files: FileEntry[]): boolean {
  const leafFiles = collectFiles(files);
  if (leafFiles.length === 0) return true;
  return leafFiles.length === 1 && leafFiles[0].path === "context.md";
}

export function Workspace() {
  const params = useParams();
  const filePath = params["*"]?.replace(/^\/+/, "") ?? "";

  const { data: files = [], isLoading } = useQuery({
    queryKey: ["files"],
    queryFn: async (): Promise<FileEntry[]> => {
      const res = await fetch("/api/files");
      if (!res.ok) return [];
      return res.json() as Promise<FileEntry[]>;
    },
  });

  const showContextEditor = useMemo(() => {
    return !filePath && isEmptyOrOnlyContext(files);
  }, [filePath, files]);

  return (
    <div className="dark flex min-h-screen bg-background text-foreground">
      <main className="min-w-0 flex-1">
        {isLoading ? (
          <div className="p-8 text-sm text-muted-foreground">Loading workspace…</div>
        ) : filePath ? (
          <FileDetail path={filePath} />
        ) : showContextEditor ? (
          <ContextEditor />
        ) : (
          <FileViewer files={files} />
        )}
      </main>
      <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card/20">
        <ActivityFeed />
      </aside>
    </div>
  );
}
