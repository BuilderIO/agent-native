import { classifyTerminalErrorCode } from "./error-detail.js";
import { classifyAgentFailure } from "./failure-taxonomy.js";

export function runErrorTelemetryProperties(
  code: string | undefined,
  message?: string | null,
): { error_code: string; error_cause: string } {
  const errorCode =
    code && /^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$/.test(code)
      ? code
      : (classifyTerminalErrorCode(message ?? undefined) ?? "unknown");
  return {
    error_code: errorCode,
    error_cause: classifyAgentFailure({ errorCode }).code,
  };
}

export function runTelemetryException(error: unknown, code: string): Error {
  const original = error instanceof Error ? error : undefined;
  const exception = new Error("Internal Server Error");
  exception.name =
    original && /^[a-zA-Z][a-zA-Z0-9_.]{0,99}$/.test(original.name)
      ? original.name
      : "Error";
  const frames = original ? stackFrames(original) : [];
  exception.stack = frames.length
    ? `${exception.name}: ${exception.message}\n${frames.join("\n")}`
    : undefined;
  Object.assign(exception, { errorCode: code });
  return exception;
}

function stackFrames(error: Error): string[] {
  // V8 renders `stack` as String(error) followed by the frames, and any line
  // of the message can look like a frame. Without that exact header, where the
  // message ends is unknown, so no line is kept.
  const header = `${String(error)}\n`;
  const stack = error.stack;
  if (!stack?.startsWith(header)) return [];
  return stack
    .slice(header.length)
    .split(/\r?\n/)
    .filter((line) => /^\s+at\s.*(?:\)|:\d+:\d+)$/.test(line));
}
