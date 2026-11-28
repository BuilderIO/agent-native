import { useT } from "@agent-native/core/client/i18n";
import type {
  BuilderBodyDiff,
  BuilderBodyDiffLine,
} from "@shared/builder-body-diff";

function bodyDiffLineClass(kind: BuilderBodyDiffLine["kind"]) {
  if (kind === "added") {
    return "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200";
  }
  if (kind === "removed") {
    return "bg-destructive/10 text-destructive";
  }
  return "text-muted-foreground";
}

function BodyDiffLineText({ line }: { line: BuilderBodyDiffLine }) {
  if (line.changedFrom === undefined || line.changedTo === undefined) {
    return <>{line.text || " "}</>;
  }
  return (
    <>
      {line.text.slice(0, line.changedFrom)}
      <mark
        className={
          "rounded-sm text-inherit " +
          (line.kind === "added"
            ? "bg-emerald-200/70 dark:bg-emerald-800/60"
            : "bg-destructive/25")
        }
      >
        {line.text.slice(line.changedFrom, line.changedTo)}
      </mark>
      {line.text.slice(line.changedTo)}
    </>
  );
}

export function BodyLineDiffView({
  diff,
  label,
  className,
}: {
  diff: BuilderBodyDiff;
  label: string;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      role="group"
      className={className ? `grid gap-2 ${className}` : "grid gap-2"}
      aria-label={label}
    >
      {diff.hunks.map((hunk, hunkIndex) => (
        <div
          key={hunkIndex}
          className="overflow-hidden rounded border border-border/70 bg-background font-mono text-xs"
        >
          {hunk.lines.map((line, lineIndex) => (
            <div
              key={lineIndex}
              className={"flex gap-2 px-2 " + bodyDiffLineClass(line.kind)}
            >
              <span aria-hidden="true" className="w-2 shrink-0 select-none">
                {line.kind === "added"
                  ? "+"
                  : line.kind === "removed"
                    ? "\u2212"
                    : ""}
              </span>
              {line.kind !== "same" ? (
                <span className="sr-only">
                  {t(
                    line.kind === "added"
                      ? "database.bodyDiffAdded"
                      : "database.bodyDiffRemoved",
                  )}
                </span>
              ) : null}
              <span className="min-w-0 whitespace-pre-wrap break-words">
                <BodyDiffLineText line={line} />
              </span>
            </div>
          ))}
          {hunk.omittedLineCount > 0 ? (
            <div className="px-2 text-muted-foreground">
              {t(
                hunk.omittedLineCount === 1
                  ? "database.bodyDiffMoreLinesOne"
                  : "database.bodyDiffMoreLines",
                { count: hunk.omittedLineCount },
              )}
            </div>
          ) : null}
        </div>
      ))}
      {diff.omittedHunkCount > 0 ? (
        <div className="text-muted-foreground">
          {t(
            diff.omittedHunkCount === 1
              ? "database.bodyDiffMoreChangesOne"
              : "database.bodyDiffMoreChanges",
            { count: diff.omittedHunkCount },
          )}
        </div>
      ) : null}
    </div>
  );
}
