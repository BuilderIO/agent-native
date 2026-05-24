import { IconExternalLink, IconMessage2Plus } from "@tabler/icons-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Center-pane diff viewer. v1 renders GitHub's unified `.patch` strings
 * directly — Monaco's full `<DiffEditor>` adds 500KB+ of JS per file and we
 * found the unified approach to be plenty readable for the MVP. The Monaco
 * dep stays in `package.json` so v1.1 can swap in a side-by-side viewer
 * without a churn on package install.
 *
 * Accepts a single file via `file` (centered diff for one selected file from
 * the left-rail tree). Inline-comment composing fires `onComposeInlineComment`
 * with the right-side (added) line number; the parent owns the actual
 * `add-pr-inline-comment` action call.
 */
export interface PRDiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | null;
  blobUrl?: string;
}

interface PRDiffProps {
  file: PRDiffFile | null;
  onComposeInlineComment?: (path: string, line: number) => void;
}

interface DiffLine {
  kind: "context" | "add" | "remove" | "hunk" | "meta";
  text: string;
  newLine?: number;
  oldLine?: number;
}

export function PRDiff({ file, onComposeInlineComment }: PRDiffProps) {
  if (!file) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-12 text-sm text-muted-foreground">
        Select a file from the left rail to view the diff.
      </div>
    );
  }
  if (!file.patch) {
    return (
      <Card className="m-4">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
          <div className="space-y-1">
            <p className="font-mono text-sm">{file.filename}</p>
            <DiffMetaBadges file={file} />
          </div>
          {file.blobUrl ? (
            <Button
              variant="outline"
              size="sm"
              asChild
              className="cursor-pointer"
            >
              <a href={file.blobUrl} target="_blank" rel="noreferrer">
                <IconExternalLink size={14} aria-hidden />
                Open in GitHub
              </a>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          Diff isn't available for this file (likely a binary or rename without
          changes). Open it in GitHub for the full view.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="m-4 overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <p className="font-mono text-sm">{file.filename}</p>
          <DiffMetaBadges file={file} />
        </div>
        {file.blobUrl ? (
          <Button
            variant="outline"
            size="sm"
            asChild
            className="cursor-pointer"
          >
            <a href={file.blobUrl} target="_blank" rel="noreferrer">
              <IconExternalLink size={14} aria-hidden />
              Open in GitHub
            </a>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <UnifiedDiff
          patch={file.patch}
          onComposeInlineComment={
            onComposeInlineComment
              ? (line) => onComposeInlineComment(file.filename, line)
              : undefined
          }
        />
      </CardContent>
    </Card>
  );
}

function DiffMetaBadges({ file }: { file: PRDiffFile }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className="font-mono text-[10px] uppercase">
        {file.status}
      </Badge>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        <span className="text-emerald-600 dark:text-emerald-400">
          +{file.additions}
        </span>{" "}
        <span className="text-red-600 dark:text-red-400">
          -{file.deletions}
        </span>
      </span>
    </div>
  );
}

function UnifiedDiff({
  patch,
  onComposeInlineComment,
}: {
  patch: string;
  onComposeInlineComment?: (line: number) => void;
}) {
  const lines = useMemo(() => parsePatch(patch), [patch]);
  return (
    <pre className="overflow-x-auto bg-muted/30 font-mono text-[12px] leading-5">
      <code>
        {lines.map((line, idx) => (
          <DiffLineRow
            key={idx}
            line={line}
            onComposeInlineComment={onComposeInlineComment}
          />
        ))}
      </code>
    </pre>
  );
}

function DiffLineRow({
  line,
  onComposeInlineComment,
}: {
  line: DiffLine;
  onComposeInlineComment?: (line: number) => void;
}) {
  if (line.kind === "hunk") {
    return (
      <div className="border-y bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground">
        {line.text}
      </div>
    );
  }
  if (line.kind === "meta") {
    return (
      <div className="px-3 py-0.5 text-[11px] text-muted-foreground">
        {line.text}
      </div>
    );
  }
  const tone =
    line.kind === "add"
      ? "bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
      : line.kind === "remove"
        ? "bg-red-500/10 text-red-900 dark:text-red-100"
        : "text-foreground";
  return (
    <div
      className={cn(
        "group grid grid-cols-[3rem_3rem_1.25rem_1fr_2rem] items-start gap-0 px-0",
        tone,
      )}
    >
      <span className="select-none px-1 text-right text-[10px] tabular-nums text-muted-foreground/60">
        {line.oldLine ?? ""}
      </span>
      <span className="select-none px-1 text-right text-[10px] tabular-nums text-muted-foreground/60">
        {line.newLine ?? ""}
      </span>
      <span className="select-none text-center text-muted-foreground/60">
        {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
      </span>
      <span className="whitespace-pre-wrap break-words pr-2">{line.text}</span>
      <span className="px-1">
        {onComposeInlineComment && line.kind === "add" && line.newLine ? (
          <button
            type="button"
            onClick={() => onComposeInlineComment(line.newLine!)}
            className="cursor-pointer rounded text-muted-foreground/0 transition-colors hover:bg-accent/60 hover:text-foreground group-hover:text-muted-foreground"
            aria-label={`Comment on line ${line.newLine}`}
          >
            <IconMessage2Plus size={12} aria-hidden />
          </button>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Parse a GitHub unified-patch string into rendered lines. We track both old
 * and new line numbers so inline-comment composing knows the right-side
 * (added) line to anchor against.
 */
function parsePatch(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      out.push({ kind: "hunk", text: raw });
      continue;
    }
    if (raw.startsWith("---") || raw.startsWith("+++")) {
      out.push({ kind: "meta", text: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({
        kind: "add",
        text: raw.slice(1),
        newLine: newLine,
      });
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      out.push({
        kind: "remove",
        text: raw.slice(1),
        oldLine: oldLine,
      });
      oldLine += 1;
      continue;
    }
    out.push({
      kind: "context",
      text: raw.startsWith(" ") ? raw.slice(1) : raw,
      oldLine: oldLine,
      newLine: newLine,
    });
    oldLine += 1;
    newLine += 1;
  }
  return out;
}
