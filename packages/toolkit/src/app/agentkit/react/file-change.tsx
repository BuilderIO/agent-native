import { IconFileDiff, IconFilePlus } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockFooter,
  CodeBlockLine,
} from "./code-block.js";
import { useAgentKitLabels } from "./context.js";
import { computeLineDiff, diffStats } from "./file-diff.js";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
  type TraceCollapsibleOpenProps,
} from "./trace.js";

const MAX_COLLAPSED_LINES = 40;

const EXTENSION_LANGUAGES: Record<string, string> = {
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  htm: "html",
  zsh: "bash",
};

export interface FileChangeData {
  filePath: string;
  /** `edit` uses `oldText` and `newText`; `write` uses `content`. */
  kind: "edit" | "write";
  oldText?: string | undefined;
  newText?: string | undefined;
  content?: string | undefined;
  /** A write's line count when its content was not kept. */
  lineCount?: number | undefined;
  truncated?: boolean | undefined;
}

export function fileChangeStats(change: FileChangeData): {
  added: number;
  removed: number;
} {
  if (change.kind === "write") {
    return {
      added:
        change.lineCount ??
        (change.content ? change.content.split("\n").length : 0),
      removed: 0,
    };
  }
  if (!change.oldText && !change.newText) return { added: 0, removed: 0 };
  return diffStats(computeLineDiff(change.oldText ?? "", change.newText ?? ""));
}

function fileLanguage(filePath: string): string | undefined {
  const name = filePath.split(/[/\\]/).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const extension = name.slice(dot + 1).toLowerCase();
  return EXTENSION_LANGUAGES[extension] ?? extension;
}

/** A long directory truncates before the file name does. */
export function FilePath({ filePath }: { filePath: string }) {
  const separator = filePath.lastIndexOf("/");
  const directory = separator < 0 ? "" : filePath.slice(0, separator + 1);
  const fileName = separator < 0 ? filePath : filePath.slice(separator + 1);
  return (
    <TraceTitle
      className="agentkit-file-path"
      title={filePath}
      data-agent-file-change-path=""
    >
      {directory ? (
        <span className="agentkit-file-path-directory">{directory}</span>
      ) : null}
      <span className="agentkit-file-path-name">{fileName}</span>
    </TraceTitle>
  );
}

export function FileChangeStats({ change }: { change: FileChangeData }) {
  const labels = useAgentKitLabels();
  const { added, removed } = fileChangeStats(change);
  return (
    <TraceDescription
      className="agentkit-file-change-stats"
      data-agent-file-change-stats=""
    >
      <span data-sign="added">+{added}</span>
      {change.kind === "edit" ? (
        <span data-sign="removed">−{removed}</span>
      ) : null}
      {change.truncated ? <span>{labels.workStepFilePartial}</span> : null}
    </TraceDescription>
  );
}

export function FileChangeBody({ change }: { change: FileChangeData }) {
  const labels = useAgentKitLabels();
  const [showAll, setShowAll] = useState(false);
  const diff = useMemo(
    () =>
      change.kind === "edit" && (change.oldText || change.newText)
        ? computeLineDiff(change.oldText ?? "", change.newText ?? "")
        : undefined,
    [change.kind, change.oldText, change.newText],
  );
  const lines = diff ?? (change.content ? change.content.split("\n") : []);
  if (!lines.length) return null;
  const hidden = showAll ? 0 : Math.max(0, lines.length - MAX_COLLAPSED_LINES);
  const footer = hidden ? (
    <CodeBlockFooter>
      <button
        type="button"
        className="agentkit-terminal-earlier"
        onClick={() => setShowAll(true)}
      >
        {labels.workStepFileMoreLines.replace("{{count}}", () => `${hidden}`)}
      </button>
    </CodeBlockFooter>
  ) : null;
  if (diff) {
    const visible = hidden ? diff.slice(0, MAX_COLLAPSED_LINES) : diff;
    return (
      <CodeBlock size="sm" className="agentkit-file-change-body">
        <CodeBlockContent wrap>
          {visible.map((line, index) => (
            <CodeBlockLine
              key={index}
              variant={line.kind === "context" ? "default" : line.kind}
            >
              {line.text}
            </CodeBlockLine>
          ))}
        </CodeBlockContent>
        {footer}
      </CodeBlock>
    );
  }
  const content = change.content ?? "";
  return (
    <CodeBlock size="sm" className="agentkit-file-change-body">
      <CodeBlockContent
        wrap
        lineNumbers
        language={fileLanguage(change.filePath)}
      >
        {hidden
          ? content.split("\n").slice(0, MAX_COLLAPSED_LINES).join("\n")
          : content}
      </CodeBlockContent>
      {footer}
    </CodeBlock>
  );
}

export function FileChange({
  change,
  running = false,
  defaultOpen = false,
  className,
  ...openProps
}: TraceCollapsibleOpenProps & {
  change: FileChangeData;
  running?: boolean;
  defaultOpen?: boolean;
  className?: string;
}) {
  const labels = useAgentKitLabels();
  const hasBody =
    change.kind === "edit"
      ? Boolean(change.oldText || change.newText)
      : Boolean(change.content);
  const line = (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>
        {change.kind === "edit" ? (
          <IconFileDiff aria-hidden="true" className="agentkit-icon" />
        ) : (
          <IconFilePlus aria-hidden="true" className="agentkit-icon" />
        )}
      </TraceIcon>
      <FilePath filePath={change.filePath} />
      {running ? (
        <span className="agentkit-visually-hidden">
          {labels.taskStatusRunning}
        </span>
      ) : (
        <FileChangeStats change={change} />
      )}
    </TraceLine>
  );
  const classes = className
    ? `agentkit-file-change ${className}`
    : "agentkit-file-change";
  if (!hasBody) {
    return (
      <div className={classes} data-kind={change.kind}>
        <span className="agentkit-disclosure-summary" data-expandable="false">
          {line}
        </span>
      </div>
    );
  }
  return (
    <TraceCollapsible
      {...openProps}
      defaultOpen={defaultOpen}
      className={classes}
      data-kind={change.kind}
    >
      <TraceCollapsibleTrigger data-agent-file-change-row="">
        {line}
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="agentkit-file-change-content">
        <FileChangeBody change={change} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
