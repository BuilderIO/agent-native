import { IconAlertTriangle, IconTerminal2 } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
} from "./code-block.js";
import { useAgentKitDurationFormat, useAgentKitLabels } from "./context.js";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
  type TraceCollapsibleOpenProps,
} from "./trace.js";

// A global regex's `test` keeps state between calls, so `HAS_ANSI` is separate.
const ANSI_SEQUENCE = /\u001b\[[0-9;]*m/g;
const HAS_ANSI = /\u001b\[[0-9;]*m/;

const DEFAULT_MAX_LINES = 500;
const SESSION_REPLAY_MASK_PROPS = { "data-an-mask": "" } as const;
const FOLLOW_SLACK_PX = 24;

/** Copy sits beside the trigger: a button cannot nest in the trigger. */
export function Terminal({
  command,
  output,
  running = false,
  exitCode,
  durationMs,
  timedOut = false,
  failed: failedOverride,
  defaultOpen = false,
  maxLines = DEFAULT_MAX_LINES,
  className,
  ...openProps
}: TraceCollapsibleOpenProps & {
  command: string;
  /** May hold ANSI color codes. */
  output?: string | undefined;
  running?: boolean;
  exitCode?: number | null | undefined;
  durationMs?: number | undefined;
  timedOut?: boolean | undefined;
  /** A failure the exit code does not show, such as a rejected command. */
  failed?: boolean | undefined;
  defaultOpen?: boolean;
  /** How many of the newest lines show before "Show earlier lines". */
  maxLines?: number;
  className?: string;
}) {
  const labels = useAgentKitLabels();
  const formatDuration = useAgentKitDurationFormat();
  const failed =
    !running &&
    (failedOverride === true ||
      timedOut ||
      (exitCode !== undefined && exitCode !== null && exitCode !== 0));
  const hasOutput = Boolean(output?.trim());
  // Opens once when running output starts; never closes on its own.
  const [autoOpen, setAutoOpen] = useState(false);
  // Outlives the body, which remounts on each toggle.
  const [showAllOutput, setShowAllOutput] = useState(false);
  useEffect(() => {
    if (running && hasOutput) setAutoOpen(true);
  }, [running, hasOutput]);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = openProps.open ?? (uncontrolledOpen || autoOpen);
  const setOpen = (next: boolean) => {
    if (openProps.open === undefined) {
      setUncontrolledOpen(next);
      setAutoOpen(false);
    }
    openProps.onOpenChange?.(next);
  };
  const meta = [
    !running && durationMs !== undefined && durationMs >= 1_000
      ? formatDuration(durationMs)
      : undefined,
    failed && exitCode !== undefined && exitCode !== null && exitCode !== 0
      ? labels.workStepTerminalExitCode.replace("{{code}}", () => `${exitCode}`)
      : undefined,
    timedOut ? labels.workStepTerminalTimedOut : undefined,
  ].filter((part): part is string => Boolean(part));
  const line = (
    <TraceLine status={running ? "running" : failed ? "error" : undefined}>
      <TraceIcon>
        {/* Without an exit code, the triangle marks a failure besides color. */}
        {failed ? (
          <IconAlertTriangle aria-hidden="true" className="agentkit-icon" />
        ) : (
          <IconTerminal2 aria-hidden="true" className="agentkit-icon" />
        )}
      </TraceIcon>
      <TraceTitle className="agentkit-terminal-command">{command}</TraceTitle>
      {running || failed ? (
        // Status shows as motion and color; the accessible name says it.
        <span className="agentkit-visually-hidden">
          {running ? labels.taskStatusRunning : labels.taskStatusFailed}
        </span>
      ) : null}
      {meta.length ? (
        <TraceDescription>{meta.join(" · ")}</TraceDescription>
      ) : null}
    </TraceLine>
  );
  return (
    <Trace
      data-slot="terminal"
      data-status={running ? "running" : failed ? "failed" : "completed"}
      className={
        className ? `agentkit-terminal ${className}` : "agentkit-terminal"
      }
    >
      {hasOutput ? (
        <TraceCollapsible open={open} onOpenChange={setOpen}>
          <div className="agentkit-terminal-row">
            <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
            <span className="agentkit-terminal-actions">
              <CodeBlockCopyButton
                value={(output ?? "").replace(ANSI_SEQUENCE, "")}
                label={labels.workStepCopyOutput}
              />
            </span>
          </div>
          <TraceCollapsibleContent
            // A fresh node on each toggle: masking a node replay already
            // recorded would not hide its text.
            key={open ? "open" : "closed"}
            keepMounted
            className="agentkit-terminal-body"
          >
            <TerminalOutput
              output={output ?? ""}
              maxLines={maxLines}
              masked={failed || !open}
              showAll={showAllOutput}
              onShowAll={() => setShowAllOutput(true)}
            />
          </TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        <span className="agentkit-disclosure-summary" data-expandable="false">
          {line}
        </span>
      )}
    </Trace>
  );
}

export function TerminalOutput({
  output,
  maxLines = DEFAULT_MAX_LINES,
  masked = false,
  showAll: controlledShowAll,
  onShowAll,
}: {
  output: string;
  maxLines?: number;
  /** Hides the output from session replays. */
  masked?: boolean;
  /** Shows every line. Pass with `onShowAll` to control it. */
  showAll?: boolean;
  /** Called when the user reveals the earlier lines. */
  onShowAll?: () => void;
}) {
  const labels = useAgentKitLabels();
  const [revealed, setRevealed] = useState(false);
  // With both props the host owns it; with one, a press still reveals.
  const showAll =
    onShowAll && controlledShowAll !== undefined
      ? controlledShowAll
      : controlledShowAll === true || revealed;
  const setShowAll = () => {
    setRevealed(true);
    onShowAll?.();
  };
  const content = useRef<HTMLPreElement>(null);
  const lines = output.replace(/\n$/, "").split("\n");
  const hidden = showAll ? 0 : Math.max(0, lines.length - maxLines);
  const visible = hidden ? lines.slice(hidden).join("\n") : output;
  // Follow only if the reader was at the bottom before the output grew;
  // measured here, not tracked from scroll events.
  const lastHeight = useRef(0);
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const wasAtBottom =
      lastHeight.current - element.scrollTop - element.clientHeight <=
      FOLLOW_SLACK_PX;
    if (wasAtBottom) element.scrollTop = element.scrollHeight;
    lastHeight.current = element.scrollHeight;
  }, [visible]);
  return (
    <CodeBlock size="sm">
      {hidden ? (
        <CodeBlockHeader>
          <button
            type="button"
            className="agentkit-terminal-earlier"
            onClick={setShowAll}
          >
            {labels.workStepTerminalEarlierLines.replace(
              "{{count}}",
              () => `${hidden}`,
            )}
          </button>
        </CodeBlockHeader>
      ) : null}
      <CodeBlockContent
        ref={content}
        wrap
        language={HAS_ANSI.test(visible) ? "ansi" : undefined}
        className="agentkit-terminal-output"
        {...(masked ? SESSION_REPLAY_MASK_PROPS : {})}
      >
        {visible}
      </CodeBlockContent>
    </CodeBlock>
  );
}
