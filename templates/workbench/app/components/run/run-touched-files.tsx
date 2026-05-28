import { Link } from "react-router";
import { IconFileCode, IconFileDiff } from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";

interface RunTouchedFilesProps {
  files: string[];
  /** Linked PR — when present, each file links into the PR diff view. */
  linkedPr?: {
    owner: string;
    repo: string;
    number: number;
  };
}

/**
 * Right-rail list of files touched by a run. Inferred from `tool_start`
 * event inputs (read/write/edit calls).
 *
 * When a linked PR exists, each file becomes a click-through that lands on
 * the PR Room with the file in focus.
 */
export function RunTouchedFiles({ files, linkedPr }: RunTouchedFilesProps) {
  if (files.length === 0) {
    return (
      <Card>
        <CardContent className="p-5">
          <SectionHeading count={0} />
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No files touched yet.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <SectionHeading count={files.length} />
        <ul className="space-y-1.5">
          {files.map((file) => (
            <li key={file}>
              <FileRow file={file} linkedPr={linkedPr} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SectionHeading({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
      <span className="font-semibold">Touched files</span>
      <span>{count}</span>
    </div>
  );
}

function FileRow({
  file,
  linkedPr,
}: {
  file: string;
  linkedPr?: { owner: string; repo: string; number: number };
}) {
  const content = (
    <span className="flex items-center gap-2 truncate">
      <IconFileCode
        size={14}
        className="shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="truncate font-mono text-xs text-foreground">{file}</span>
    </span>
  );

  if (linkedPr) {
    const path = `/prs/${encodeURIComponent(linkedPr.owner)}/${encodeURIComponent(
      linkedPr.repo,
    )}/${linkedPr.number}`;
    return (
      <Link
        to={`${path}?file=${encodeURIComponent(file)}`}
        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40"
        aria-label={`Open ${file} in linked PR`}
      >
        {content}
        <IconFileDiff
          size={12}
          className="shrink-0 text-muted-foreground"
          aria-hidden
        />
      </Link>
    );
  }

  return (
    <div
      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
      title={file}
    >
      {content}
    </div>
  );
}
