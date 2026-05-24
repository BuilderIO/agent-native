import {
  IconFile,
  IconFileMinus,
  IconFilePlus,
  IconFileText,
} from "@tabler/icons-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PRFileBadge, badgesForFile } from "./pr-file-badge";

/**
 * Left-rail file list on `/prs/:owner/:repo/:n`. v1 renders a flat list with
 * per-file badges; a tree view (folder collapse) lands in v1.1 once we ship
 * keyboard nav through hundreds of files in big diffs. Lift selection state
 * into the parent so the diff and the tree stay in sync.
 */
export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

interface PRFileTreeProps {
  files: PRFile[];
  /** Currently-focused file (its `filename`). */
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function PRFileTree({ files, selectedPath, onSelect }: PRFileTreeProps) {
  if (files.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        No file changes in this PR.
      </p>
    );
  }
  return (
    <ul className="space-y-0.5 px-1 py-1">
      {files.map((file) => {
        const badges = badgesForFile(file.filename);
        const isSelected = selectedPath === file.filename;
        return (
          <li key={file.filename}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onSelect(file.filename)}
                  aria-current={isSelected ? "true" : undefined}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    "cursor-pointer",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent/50",
                  )}
                >
                  <FileStatusIcon status={file.status} />
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {file.filename}
                  </span>
                  {badges.length > 0 ? (
                    <span className="flex shrink-0 items-center gap-0.5">
                      {badges.map((b) => (
                        <PRFileBadge key={b} kind={b} />
                      ))}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{file.additions}
                    </span>{" "}
                    <span className="text-red-600 dark:text-red-400">
                      -{file.deletions}
                    </span>
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-mono text-xs">
                {file.filename}
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

function FileStatusIcon({ status }: { status: string }) {
  if (status === "added") {
    return (
      <IconFilePlus
        size={14}
        className="shrink-0 text-emerald-500"
        aria-label="Added file"
      />
    );
  }
  if (status === "removed") {
    return (
      <IconFileMinus
        size={14}
        className="shrink-0 text-red-500"
        aria-label="Removed file"
      />
    );
  }
  if (status === "renamed") {
    return (
      <IconFileText
        size={14}
        className="shrink-0 text-blue-500"
        aria-label="Renamed file"
      />
    );
  }
  return (
    <IconFile
      size={14}
      className="shrink-0 text-muted-foreground"
      aria-label="Modified file"
    />
  );
}
