import { spawn } from "node:child_process";
import os from "node:os";

type ProfileName = "test" | "typecheck";

type Profile = {
  script: string;
  pnpmArgs: string[];
  defaultConcurrency: (cores: number) => number;
};

const profiles: Record<ProfileName, Profile> = {
  test: {
    script: "test",
    pnpmArgs: [],
    defaultConcurrency: (cores) => clamp(Math.floor(cores / 2), 4, 6),
  },
  typecheck: {
    script: "typecheck",
    pnpmArgs: ["--reporter-hide-prefix"],
    defaultConcurrency: (cores) => clamp(Math.floor(cores * 0.75), 4, 10),
  },
};

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const profileName = args[0] as ProfileName | undefined;
if (!profileName || !(profileName in profiles)) {
  printHelp();
  process.exit(1);
}

const parsedArgs = parseArgs(args.slice(1));

if (parsedArgs.unknown.length > 0) {
  console.error(
    `[workspace-run] Unknown option(s): ${parsedArgs.unknown.join(", ")}`,
  );
  printHelp();
  process.exit(1);
}

const profile = profiles[profileName];
const cores = availableParallelism();
const concurrency = resolveConcurrency(
  profileName,
  profile,
  cores,
  parsedArgs.concurrency,
);
const pnpmArgs = [
  "-r",
  "--no-bail",
  `--workspace-concurrency=${formatConcurrency(concurrency)}`,
  ...profile.pnpmArgs,
  profile.script,
];

if (parsedArgs.forwarded.length > 0) {
  pnpmArgs.push("--", ...parsedArgs.forwarded);
}

const command = pnpmCommand();
console.error(
  `[workspace-run] ${profile.script}: workspace-concurrency=${formatConcurrency(
    concurrency,
  )}`,
);

if (parsedArgs.dryRun) {
  console.log([command, ...pnpmArgs.map(quoteArg)].join(" "));
  process.exit(0);
}

const child = spawn(command, pnpmArgs, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`[workspace-run] Failed to start pnpm: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[workspace-run] pnpm exited from signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

function printHelp() {
  console.log(`Usage: tsx scripts/workspace-run.ts <test|typecheck> [options] [-- <script args>]

Runs a recursive pnpm workspace script with adaptive, bounded concurrency.

Options:
  --concurrency <n|Infinity>  Override computed workspace concurrency
  --dry-run                   Print the pnpm command without running it

Environment overrides:
  TEST_WORKSPACE_CONCURRENCY / TYPECHECK_WORKSPACE_CONCURRENCY
  AGENT_NATIVE_TEST_WORKSPACE_CONCURRENCY / AGENT_NATIVE_TYPECHECK_WORKSPACE_CONCURRENCY
  PNPM_WORKSPACE_CONCURRENCY / WORKSPACE_CONCURRENCY / AGENT_NATIVE_WORKSPACE_CONCURRENCY
`);
}

function parseArgs(rawArgs: string[]): {
  concurrency?: string;
  dryRun: boolean;
  forwarded: string[];
  unknown: string[];
} {
  let forwarding = false;
  let concurrency: string | undefined;
  let dryRun = false;
  const forwarded: string[] = [];
  const unknown: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--") {
      forwarding = true;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--concurrency") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("--")) {
        unknown.push(arg);
      } else {
        concurrency = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--concurrency=")) {
      concurrency = arg.slice("--concurrency=".length);
      continue;
    }

    if (forwarding) {
      forwarded.push(arg);
    } else {
      unknown.push(arg);
    }
  }

  return { concurrency, dryRun, forwarded, unknown };
}

function resolveConcurrency(
  profileName: ProfileName,
  profile: Profile,
  cores: number,
  explicitValue?: string,
): number | typeof Infinity {
  const envValue =
    explicitValue ??
    firstEnvValue([
      `${profileName.toUpperCase()}_WORKSPACE_CONCURRENCY`,
      `AGENT_NATIVE_${profileName.toUpperCase()}_WORKSPACE_CONCURRENCY`,
      "PNPM_WORKSPACE_CONCURRENCY",
      "WORKSPACE_CONCURRENCY",
      "AGENT_NATIVE_WORKSPACE_CONCURRENCY",
    ]);

  if (envValue) {
    return parseConcurrency(envValue, "workspace concurrency");
  }

  return profile.defaultConcurrency(cores);
}

function availableParallelism(): number {
  return Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
}

function parseConcurrency(
  value: string,
  label: string,
): number | typeof Infinity {
  if (value === "Infinity") return Infinity;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`[workspace-run] Invalid ${label}: ${value}`);
    process.exit(1);
  }
  return parsed;
}

function formatConcurrency(value: number | typeof Infinity): string {
  return value === Infinity ? "Infinity" : String(value);
}

function firstEnvValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function quoteArg(arg: string): string {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(arg)) return arg;
  return JSON.stringify(arg);
}
