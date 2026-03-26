import { Fragment } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { FileText, Folder, Clock } from "lucide-react";
import { sendToAgentChat } from "@agent-native/core/client";
import type { FileEntry } from "@shared/api";
import { cn } from "@/lib/utils";

function FileNode({ entry, depth }: { entry: FileEntry; depth: number }) {
  if (entry.name.startsWith(".")) return null;

  if (entry.type === "directory") {
    const children = entry.children ?? [];
    return (
      <div className={cn(depth > 0 && "ml-3 border-l border-border pl-3")}>
        <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
          <Folder className="h-4 w-4 shrink-0 text-primary/80" aria-hidden />
          <span className="font-medium text-foreground/90">{entry.name}</span>
        </div>
        <div className="space-y-0.5">
          {children.map((child) => (
            <Fragment key={child.path}>
              <FileNode entry={child} depth={depth + 1} />
            </Fragment>
          ))}
        </div>
      </div>
    );
  }

  const modified = entry.modified
    ? formatDistanceToNow(new Date(entry.modified), { addSuffix: true })
    : null;

  return (
    <div className={cn(depth > 0 && "ml-3 border-l border-border pl-3")}>
      <Link
        to={`/file/${entry.path}`}
        className="flex items-center gap-2 rounded-md py-1.5 pr-2 text-sm transition-colors hover:bg-accent/40 hover:text-accent-foreground"
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{entry.name}</span>
        {modified ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden />
            {modified}
          </span>
        ) : null}
      </Link>
    </div>
  );
}

export function FileViewer({ files }: { files: FileEntry[] }) {
  if (files.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 px-6">
        <p className="text-center text-lg text-muted-foreground">Your desk is empty</p>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition hover:opacity-90"
          onClick={() =>
            sendToAgentChat({
              message: "Read my context file and suggest what to work on first",
              submit: true,
            })
          }
        >
          Get Started
        </button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Workspace</h1>
      <div className="space-y-1">
        {files.map((entry) => (
          <Fragment key={entry.path}>
            <FileNode entry={entry} depth={0} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
