import { IconAlertTriangle } from "@tabler/icons-react";

import { CodeBlockCopyButton } from "./code-block.js";
import { useAgentKitLabels } from "./context.js";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
  type TraceCollapsibleOpenProps,
} from "./trace.js";

export interface StackFrame {
  text: string;
  name?: string;
  /** Without the line and column. */
  file?: string;
  line?: number;
  column?: number;
  /** Runtime, dependency, or standard library code rather than the caller's. */
  internal: boolean;
}

export interface ParsedStackTrace {
  error: string;
  frames: StackFrame[];
  /** The trace exactly as printed, for copying. */
  text: string;
  /** Whether the text holds nothing but the trace. */
  whole: boolean;
}

const V8_FRAME = /^\s+at\s+(.+)$/;
const PYTHON_HEADER = /^Traceback \(most recent call last\):\s*$/;
const PYTHON_FRAME = /^\s+File "([^"]+)", line (\d+)(?:, in (.+))?$/;
const INTERNAL_FILE =
  /(?:^|[/\\])node_modules[/\\]|^node:|^internal[/\\]|[/\\]site-packages[/\\]|[/\\]lib[/\\]python\d|^<frozen /;

/** The first V8 or Python trace in `text`, without the output around it. */
export function parseStackTrace(text: string): ParsedStackTrace | undefined {
  const lines = text.split("\n");
  return parseV8(lines) ?? parsePython(lines);
}

function parseV8(lines: string[]): ParsedStackTrace | undefined {
  const first = lines.findIndex((line) => V8_FRAME.test(line));
  const error = lines[first - 1]?.trim();
  if (first < 1 || !error) return undefined;
  const frames: StackFrame[] = [];
  for (const line of lines.slice(first)) {
    const body = V8_FRAME.exec(line)?.[1];
    if (body === undefined) break;
    frames.push(v8Frame(body.trim()));
  }
  return result(lines, first - 1, first + frames.length, error, frames);
}

function v8Frame(body: string): StackFrame {
  const named = /^(.*?) \((.+)\)$/.exec(body);
  const name = group(named, 1)?.replace(/^async /, "") || undefined;
  const location = group(named, 2) ?? body.replace(/^async /, "");
  const position = /^(.*?):(\d+):(\d+)$/.exec(location);
  const file = group(position, 1) ?? location;
  const line = group(position, 2);
  const column = group(position, 3);
  return {
    text: `at ${body}`,
    ...(name ? { name } : {}),
    file,
    ...(line && column ? { line: Number(line), column: Number(column) } : {}),
    internal: INTERNAL_FILE.test(file),
  };
}

function group(
  match: RegExpExecArray | null,
  index: number,
): string | undefined {
  return match?.[index];
}

function parsePython(lines: string[]): ParsedStackTrace | undefined {
  const start = lines.findIndex((line) => PYTHON_HEADER.test(line));
  if (start < 0) return undefined;
  const frames: StackFrame[] = [];
  let index = start + 1;
  for (const line of lines.slice(start + 1)) {
    const [, file, number, name] = PYTHON_FRAME.exec(line) ?? [];
    if (file && number) {
      frames.push({
        text: line.trim(),
        ...(name ? { name } : {}),
        file,
        line: Number(number),
        internal: INTERNAL_FILE.test(file),
      });
    } else if (!/^\s/.test(line)) {
      break;
    }
    index++;
  }
  const error = lines[index]?.trim();
  if (!error || !frames.length) return undefined;
  return result(lines, start, index + 1, error, frames);
}

function result(
  lines: string[],
  start: number,
  end: number,
  error: string,
  frames: StackFrame[],
): ParsedStackTrace {
  const outside = [...lines.slice(0, start), ...lines.slice(end)];
  return {
    error,
    frames,
    text: lines.slice(start, end).join("\n"),
    whole: outside.every((line) => !line.trim()),
  };
}

/** Copy sits beside the trigger: a button cannot nest in the trigger. */
export function StackTrace({
  trace,
  defaultOpen,
  onFilePathClick,
  className,
  ...openProps
}: TraceCollapsibleOpenProps & {
  trace: string | ParsedStackTrace;
  defaultOpen?: boolean;
  /** Makes the caller's frames links to their file and line. */
  onFilePathClick?: (frame: StackFrame) => void;
  className?: string;
}) {
  const labels = useAgentKitLabels();
  const parsed = typeof trace === "string" ? parseStackTrace(trace) : trace;
  if (!parsed) return null;
  return (
    <Trace
      data-slot="stack-trace"
      className={
        className ? `agentkit-stack-trace ${className}` : "agentkit-stack-trace"
      }
    >
      <TraceCollapsible {...openProps} defaultOpen={defaultOpen}>
        <div className="agentkit-stack-trace-row">
          <TraceCollapsibleTrigger>
            <TraceLine status="error">
              <TraceIcon>
                <IconAlertTriangle
                  aria-hidden="true"
                  className="agentkit-icon"
                />
              </TraceIcon>
              <TraceTitle>{parsed.error}</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <span className="agentkit-stack-trace-actions">
            <CodeBlockCopyButton
              value={parsed.text}
              label={labels.workStepCopyStackTrace}
            />
          </span>
        </div>
        <TraceCollapsibleContent
          keepMounted
          className="agentkit-stack-trace-body"
        >
          {/* The title truncates, so the full error leads the frames. */}
          <p className="agentkit-stack-trace-error">{parsed.error}</p>
          <StackTraceFrames
            frames={parsed.frames}
            onFilePathClick={onFilePathClick}
          />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

export function StackTraceFrames({
  frames,
  onFilePathClick,
}: {
  frames: StackFrame[];
  onFilePathClick?: ((frame: StackFrame) => void) | undefined;
}) {
  const labels = useAgentKitLabels();
  const runs: Array<{
    start: number;
    internal: boolean;
    frames: StackFrame[];
  }> = [];
  frames.forEach((frame, index) => {
    const last = runs.at(-1);
    if (last?.internal && frame.internal) last.frames.push(frame);
    else runs.push({ start: index, internal: frame.internal, frames: [frame] });
  });
  const items = runs.map(({ start, frames: run }) => {
    if (run.length < 2) {
      return run.map((frame) => (
        <StackTraceFrame
          key={start}
          frame={frame}
          onFilePathClick={onFilePathClick}
        />
      ));
    }
    return (
      <li key={start} className="agentkit-stack-frames-folded">
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <span className="agentkit-disclosure-label">
                {labels.workStepFrameworkFrames.replace(
                  "{{count}}",
                  () => `${run.length}`,
                )}
              </span>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent keepMounted>
            <ol className="agentkit-stack-frames">
              {run.map((frame, offset) => (
                <StackTraceFrame key={start + offset} frame={frame} />
              ))}
            </ol>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </li>
    );
  });
  return <ol className="agentkit-stack-frames">{items}</ol>;
}

function StackTraceFrame({
  frame,
  onFilePathClick,
}: {
  frame: StackFrame;
  onFilePathClick?: ((frame: StackFrame) => void) | undefined;
}) {
  const position =
    frame.line !== undefined
      ? `:${frame.line}${frame.column !== undefined ? `:${frame.column}` : ""}`
      : "";
  // The file name only, so a long path never hides the line number.
  const location = frame.file
    ? `${frame.file.split(/[/\\]/).at(-1) || frame.file}${position}`
    : frame.text;
  const fullLocation = frame.file ? `${frame.file}${position}` : frame.text;
  return (
    <li
      className="agentkit-stack-frame"
      data-internal={frame.internal ? "true" : undefined}
    >
      {frame.name ? (
        <span className="agentkit-stack-frame-name">{frame.name}</span>
      ) : null}
      {onFilePathClick && frame.file && !frame.internal ? (
        <button
          type="button"
          className="agentkit-stack-frame-location"
          title={fullLocation}
          onClick={() => onFilePathClick(frame)}
        >
          {location}
        </button>
      ) : (
        <span className="agentkit-stack-frame-location" title={fullLocation}>
          {location}
        </span>
      )}
    </li>
  );
}
