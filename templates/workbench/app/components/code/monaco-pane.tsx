import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";
import { lazy, Suspense } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { IconDeviceFloppy, IconAlertTriangle } from "@tabler/icons-react";

// Lazy-load Monaco — it's ~500KB and we don't want it on the welcome view.
const Editor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.Editor })),
);
const DiffEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })),
);

interface FileResult {
  content: string;
  encoding: "utf-8" | "base64";
  sizeBytes: number;
}

interface DiffResult {
  oldContent: string;
  newContent: string;
  unifiedDiff: string;
}

interface MonacoPaneProps {
  workspaceId: string | null;
  filePath: string | null;
  isDiff?: boolean;
  onDirtyChange?: (path: string, dirty: boolean) => void;
}

/**
 * The center editor surface for the Code Room. Two modes:
 *   1. Edit mode (default) — Monaco's plain `<Editor>`. Cmd+S calls
 *      the `write-file` action. The save button on the title bar does
 *      the same thing for click users.
 *   2. Diff mode (when the URL starts with `/code/diff/`) — Monaco's
 *      `<DiffEditor>` with the file's working-copy content as the
 *      modified side and the index/HEAD version as the original.
 *
 * The pane lazy-loads Monaco — it's a hefty bundle and we don't want
 * it on the welcome view.
 */
export function MonacoPane({
  workspaceId,
  filePath,
  isDiff = false,
  onDirtyChange,
}: MonacoPaneProps) {
  if (!workspaceId || !filePath) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Pick a file from the Explorer to start editing.
      </div>
    );
  }

  return isDiff ? (
    <DiffView workspaceId={workspaceId} filePath={filePath} />
  ) : (
    <EditView
      workspaceId={workspaceId}
      filePath={filePath}
      onDirtyChange={onDirtyChange}
    />
  );
}

function EditView({
  workspaceId,
  filePath,
  onDirtyChange,
}: {
  workspaceId: string;
  filePath: string;
  onDirtyChange?: (path: string, dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const fileQuery = useQuery<FileResult>({
    queryKey: ["code", "read-file", workspaceId, filePath],
    queryFn: async () => {
      const params = new URLSearchParams({ workspaceId, path: filePath });
      const res = await fetch(
        agentNativePath(
          `/_agent-native/actions/read-file?${params.toString()}`,
        ),
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `read-file failed (${res.status})`);
      }
      return (await res.json()) as FileResult;
    },
    staleTime: 0,
  });

  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset draft when the file changes or fresh content lands.
  useEffect(() => {
    setDraft(null);
  }, [workspaceId, filePath]);

  const initialContent =
    fileQuery.data?.encoding === "utf-8" ? fileQuery.data.content : null;
  const dirty = draft !== null && draft !== initialContent;

  // Surface the dirty state to the tab bar so it can render a dot.
  useEffect(() => {
    onDirtyChange?.(filePath, dirty);
  }, [filePath, dirty, onDirtyChange]);

  // Cmd+S / Ctrl+S to save.
  useEffect(() => {
    if (!fileQuery.data) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, fileQuery.data, workspaceId, filePath]);

  async function save() {
    if (draft === null || saving) return;
    setSaving(true);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/actions/write-file"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, path: filePath, content: draft }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `write-file failed (${res.status})`);
      }
      // Optimistically update the cached "initial" content so dirty
      // resets to false without a re-fetch flicker.
      queryClient.setQueryData<FileResult>(
        ["code", "read-file", workspaceId, filePath],
        (prev) => (prev ? { ...prev, content: draft } : prev),
      );
      // Reset the draft so the next render compares against the new initial.
      setDraft(null);
      toast.success("Saved");
      // Bump git-status so the Changes panel reflects the new dirty file.
      queryClient.invalidateQueries({
        queryKey: ["code", "git-changes", workspaceId],
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save file.");
    } finally {
      setSaving(false);
    }
  }

  if (fileQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Spinner className="mr-2 size-3" /> Loading {filePath}…
      </div>
    );
  }
  if (fileQuery.isError) {
    return (
      <ErrorState
        message={
          fileQuery.error instanceof Error
            ? fileQuery.error.message
            : "Couldn't read file."
        }
        onRetry={() => fileQuery.refetch()}
      />
    );
  }
  if (fileQuery.data.encoding === "base64") {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        This file looks binary and can't be edited in the text editor.
      </div>
    );
  }

  const value = draft ?? fileQuery.data.content;
  const language = languageForPath(filePath);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-muted/10 px-2 text-xs">
        <span className="truncate font-mono text-muted-foreground">
          {filePath}
        </span>
        <Button
          size="sm"
          variant={dirty ? "default" : "ghost"}
          className="h-6 cursor-pointer px-2 text-[11px]"
          onClick={() => void save()}
          disabled={!dirty || saving}
        >
          <IconDeviceFloppy size={12} aria-hidden />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              <Spinner className="mr-2 size-3" /> Loading editor…
            </div>
          }
        >
          <Editor
            value={value}
            language={language}
            theme="vs-dark"
            onChange={(next) => setDraft(next ?? "")}
            options={MONACO_OPTIONS}
          />
        </Suspense>
      </div>
    </div>
  );
}

function DiffView({
  workspaceId,
  filePath,
}: {
  workspaceId: string;
  filePath: string;
}) {
  const query = useQuery<DiffResult>({
    queryKey: ["code", "git-diff-file", workspaceId, filePath, "all"],
    queryFn: async () => {
      const params = new URLSearchParams({
        workspaceId,
        path: filePath,
        scope: "all",
      });
      const res = await fetch(
        agentNativePath(
          `/_agent-native/actions/git-diff-file?${params.toString()}`,
        ),
      );
      if (!res.ok) throw new Error(`diff failed (${res.status})`);
      return (await res.json()) as DiffResult;
    },
    staleTime: 5_000,
  });

  if (query.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Spinner className="mr-2 size-3" /> Loading diff…
      </div>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        message={
          query.error instanceof Error
            ? query.error.message
            : "Couldn't load diff."
        }
        onRetry={() => query.refetch()}
      />
    );
  }
  const language = languageForPath(filePath);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center border-b border-border bg-muted/10 px-2 text-xs">
        <span className="truncate font-mono text-muted-foreground">
          Diff · {filePath}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              <Spinner className="mr-2 size-3" /> Loading diff editor…
            </div>
          }
        >
          <DiffEditor
            original={query.data.oldContent}
            modified={query.data.newContent}
            language={language}
            theme="vs-dark"
            options={{
              ...MONACO_OPTIONS,
              readOnly: true,
              renderSideBySide: true,
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <IconAlertTriangle
        size={20}
        className="text-muted-foreground"
        aria-hidden
      />
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      <Button
        size="sm"
        variant="outline"
        className="cursor-pointer"
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}

const MONACO_OPTIONS = {
  fontSize: 13,
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  cursorBlinking: "smooth" as const,
  automaticLayout: true,
  tabSize: 2,
  wordWrap: "off" as const,
};

/** Best-effort language inference from a file extension. */
function languageForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs"))
    return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".rb")) return "ruby";
  if (lower.endsWith(".sh")) return "shell";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".toml")) return "ini";
  return "plaintext";
}
