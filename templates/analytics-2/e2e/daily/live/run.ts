import { spawn } from "node:child_process";
import { resolve } from "node:path";

const target = "https://labs.agent-native.com/analytics-2";

export async function runLive(base: string, args: string[]): Promise<number> {
  if (base !== target)
    throw new Error(`Unsupported live BASE_URL; expected ${target}`);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--grep" || arg === "-g") {
      if (!args[++i]) throw new Error(`${arg} requires a pattern`);
    } else if (
      arg !== "--list" &&
      arg !== "navigation.spec.ts" &&
      arg !== "live/navigation.spec.ts" &&
      arg !== "live-notebook.spec.ts" &&
      arg !== "live/live-notebook.spec.ts" &&
      arg !== "live-ask-query.spec.ts" &&
      arg !== "mobile-data-browser.spec.ts" &&
      arg !== "live/mobile-data-browser.spec.ts" &&
      arg !== "live/live-ask-query.spec.ts" &&
      arg !== "objects.spec.ts" &&
      arg !== "live/objects.spec.ts"
    ) {
      throw new Error(
        `Unsupported live check or option: ${arg}. Only live/navigation.spec.ts, live/live-notebook.spec.ts, live/live-ask-query.spec.ts, live/mobile-data-browser.spec.ts and live/objects.spec.ts are supported; local fixture tests cannot run live.`,
      );
    }
  }
  const root = resolve(import.meta.dirname, "../../../../..");
  const child = spawn(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config",
      resolve(import.meta.dirname, "playwright.config.ts"),
      ...args,
    ],
    {
      cwd: root,
      env: { ...process.env, E2E_BASE_URL: base },
      stdio: "inherit",
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => child.kill(signal));
  return await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => done(code ?? 1));
  });
}
