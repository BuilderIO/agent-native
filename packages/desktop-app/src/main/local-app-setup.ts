import { spawn } from "node:child_process";

export interface LocalAppSetupStep {
  label: string;
  command: string;
  args: string[];
  timeoutMs: number;
}

export const LOCAL_APP_TEMPLATE = "chat";

export function localAppSetupSteps(): LocalAppSetupStep[] {
  return [
    {
      label: "Creating the app from the starter template",
      command: "npx",
      args: [
        "--yes",
        "@agent-native/core@latest",
        "create",
        ".",
        "--standalone",
        "--template",
        LOCAL_APP_TEMPLATE,
      ],
      timeoutMs: 10 * 60_000,
    },
    {
      label: "Installing the app's dependencies",
      command: "pnpm",
      args: ["install"],
      timeoutMs: 15 * 60_000,
    },
  ];
}

export interface LocalAppSetupRunner {
  (
    step: LocalAppSetupStep,
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      onOutput: (text: string) => void;
    },
  ): Promise<{ code: number | null; error?: string }>;
}

export const spawnLocalAppSetupStep: LocalAppSetupRunner = (
  step,
  { cwd, env, onOutput },
) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result: { code: number | null; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(step.command, step.args, {
      cwd,
      env: { ...env, CI: "1", BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ code: null, error: `${step.label} timed out.` });
    }, step.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => onOutput(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => onOutput(chunk.toString()));
    child.once("error", (error) =>
      finish({ code: null, error: error.message }),
    );
    child.once("exit", (code) => finish({ code }));
  });

export type LocalAppSetupResult =
  | { ok: true }
  | { ok: false; step: string; error: string };

export async function setupLocalAppFolder(input: {
  targetPath: string;
  env: NodeJS.ProcessEnv;
  run?: LocalAppSetupRunner;
  steps?: LocalAppSetupStep[];
  onStep?: (step: LocalAppSetupStep) => void;
  onOutput?: (text: string) => void;
  isCancelled?: () => boolean;
}): Promise<LocalAppSetupResult> {
  const run = input.run ?? spawnLocalAppSetupStep;
  for (const step of input.steps ?? localAppSetupSteps()) {
    if (input.isCancelled?.()) {
      return { ok: false, step: step.label, error: "Setup was cancelled." };
    }
    input.onStep?.(step);
    const result = await run(step, {
      cwd: input.targetPath,
      env: input.env,
      onOutput: input.onOutput ?? (() => undefined),
    });
    if (result.code !== 0) {
      return {
        ok: false,
        step: step.label,
        error:
          result.error ??
          `${step.command} exited with code ${result.code ?? "unknown"}.`,
      };
    }
  }
  return { ok: true };
}
