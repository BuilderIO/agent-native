import { AsyncLocalStorage } from "node:async_hooks";

import { sanitizeToolErrorText } from "../agent/tool-error-redaction.js";

interface CaptureStore {
  logs: string[];
}

const captureStore = new AsyncLocalStorage<CaptureStore>();

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

  process.stdout.write = ((chunk: any, ...rest: any[]) => {
    const store = captureStore.getStore();
    if (store) {
      if (typeof chunk === "string") {
        store.logs.push(chunk);
      } else if (chunk && typeof (chunk as Buffer).toString === "function") {
        store.logs.push((chunk as Buffer).toString());
      }
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
  swallowErrors?: boolean;
}

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
      store.logs.push(sanitizeToolErrorText(`Error: ${msg}`));
    } else {
      throw err;
    }
  }
  return store.logs.join("\n") || "(no output)";
}

export function appendCapturedLog(text: string): void {
  const store = captureStore.getStore();
  if (store) store.logs.push(text);
}
