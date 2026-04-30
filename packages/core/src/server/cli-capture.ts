/**
 * Capture stdout/stderr/console output from CLI-style action handlers
 * without globally swapping `console.log` / `process.stdout.write` /
 * `process.exit` per-call.
 *
 * The previous pattern (save → swap → restore in finally) corrupts the
 * globals when two CLI tool calls run concurrently — request B saves the
 * already-swapped function, then both finally-blocks restore in interleaved
 * order, leaving an arbitrary capture function permanently installed and
 * silently swallowing all subsequent server logs.
 *
 * This module installs the global interceptors ONCE at module load. Each
 * call dispatches to either the captured logs (when an AsyncLocalStorage
 * store is active) or the original implementation. The wrappers are
 * idempotent and safe under any number of concurrent runs.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface CaptureStore {
  logs: string[];
}

const captureStore = new AsyncLocalStorage<CaptureStore>();

/** Sentinel thrown when an action calls `process.exit(...)`. */
export class ExitIntercepted extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

let installed = false;

function installInterceptorsOnce(): void {
  if (installed) return;
  installed = true;

  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origExit = process.exit.bind(process);

  console.log = (...args: unknown[]): void => {
    const store = captureStore.getStore();
    if (store) {
      store.logs.push(args.map((a) => String(a)).join(" "));
      return;
    }
    origLog(...(args as []));
  };

  console.error = (...args: unknown[]): void => {
    const store = captureStore.getStore();
    if (store) {
      store.logs.push(args.map((a) => String(a)).join(" "));
      return;
    }
    origError(...(args as []));
  };

  // process.stdout.write has a complex signature (string | Uint8Array, encoding?, callback?)
  // We only need to capture chunks; preserve return value semantics by returning true.
  process.stdout.write = ((chunk: any, ...rest: any[]) => {
    const store = captureStore.getStore();
    if (store) {
      if (typeof chunk === "string") {
        store.logs.push(chunk);
      } else if (chunk && typeof (chunk as Buffer).toString === "function") {
        store.logs.push((chunk as Buffer).toString());
      }
      // Honor the optional callback that streams expect.
      const cb = rest.find((r) => typeof r === "function");
      if (cb) (cb as (err?: Error | null) => void)(null);
      return true;
    }
    return origStdoutWrite(chunk, ...rest);
  }) as typeof process.stdout.write;

  process.exit = ((code?: number) => {
    const store = captureStore.getStore();
    if (store) {
      throw new ExitIntercepted(code ?? 0);
    }
    return origExit(code);
  }) as typeof process.exit;
}

export interface CaptureCliOptions {
  /**
   * If `true` (default), errors thrown by `fn` (other than
   * `ExitIntercepted`) are appended to the capture buffer as `"Error: ..."`
   * and the resolved logs are returned. If `false`, errors propagate.
   */
  swallowErrors?: boolean;
}

/**
 * Run `fn` with a fresh capture buffer. All console.log / console.error /
 * process.stdout.write calls inside `fn` (including async descendants)
 * append to the buffer instead of going to the server's stdout/stderr.
 * Returns the joined logs (or `"(no output)"` if nothing was captured).
 *
 * `process.exit(code)` inside `fn` throws `ExitIntercepted` internally; it
 * is caught here so the captured output (including any final logs the
 * action wrote before exiting) is preserved.
 */
export async function captureCliOutput(
  fn: () => Promise<unknown>,
  options: CaptureCliOptions = {},
): Promise<string> {
  installInterceptorsOnce();
  const store: CaptureStore = { logs: [] };
  const swallowErrors = options.swallowErrors !== false;
  try {
    await captureStore.run(store, fn);
  } catch (err) {
    if (err instanceof ExitIntercepted) {
      // process.exit() is treated as a clean termination of the CLI action.
    } else if (swallowErrors) {
      const msg = (err as Error)?.message ?? String(err);
      store.logs.push(`Error: ${msg}`);
    } else {
      throw err;
    }
  }
  return store.logs.join("\n") || "(no output)";
}

/**
 * Append a string to the active capture buffer. No-op outside of a
 * `captureCliOutput` scope — used by callers that catch errors from
 * `fn` themselves and want to emit the message into the captured logs.
 */
export function appendCapturedLog(text: string): void {
  const store = captureStore.getStore();
  if (store) store.logs.push(text);
}
