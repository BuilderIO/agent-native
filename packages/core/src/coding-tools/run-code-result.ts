// Client code imports this module, so it must stay free of Node imports.

export const RUN_CODE_TOOL_NAME = "run-code";

export function runCodeStatusLines(run: {
  timedOut: boolean;
  timeoutMs: number;
  exitCode: number | null;
}): string[] {
  const lines: string[] = [];
  if (run.timedOut) lines.push(`timedOut: true (${run.timeoutMs}ms)`);
  if (run.exitCode !== 0 && run.exitCode !== null) {
    lines.push(`exitCode: ${run.exitCode}`);
  }
  return lines;
}

const STATUS_LINE = /^(?:timedOut: true \(\d+ms\)|exitCode: -?\d+)$/;
const BRIDGE_LINE = /^bridgeToolsUsed: /;
const UNHANDLED_ERROR = /^Unhandled error: (.+)$/m;
const THROWN_ERROR = /^((?:[A-Z]\w*)?(?:Error|Exception)\b.*)$/m;

/**
 * Failure is for the transcript only: thrown as a tool error, each debugging
 * attempt would trip the loop breakers and setup-step stop patterns.
 */
export function runCodeResultFailure(result: unknown): string | undefined {
  if (typeof result !== "string") return undefined;
  // Status lines lead the result; the same text later is the program's own.
  const status: string[] = [];
  for (const block of result.split("\n\n")) {
    if (STATUS_LINE.test(block)) status.push(block);
    else if (!BRIDGE_LINE.test(block)) break;
  }
  if (!status.length) return undefined;
  // Only stderr names the error: stdout can print any text that looks like one.
  const stderrAt = result.indexOf("\n\nstderr:\n");
  const stderr = stderrAt < 0 ? "" : result.slice(stderrAt);
  return (
    UNHANDLED_ERROR.exec(stderr)?.at(1)?.trim() ||
    THROWN_ERROR.exec(stderr)?.at(1)?.trim() ||
    status.join(", ")
  );
}
