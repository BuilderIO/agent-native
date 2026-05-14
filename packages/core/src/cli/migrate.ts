import fs from "fs";
import path from "path";
import { createApp } from "./create.js";

export interface MigrateCliOptions {
  source?: string;
  output?: string;
  appName?: string;
  target?: string;
  planOnly?: boolean;
}

export function parseMigrateArgs(argv: string[]): MigrateCliOptions {
  const opts: MigrateCliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) {
      opts.output = argv[++i];
    } else if (arg.startsWith("--out=")) {
      opts.output = arg.slice("--out=".length);
    } else if (arg === "--name" && argv[i + 1]) {
      opts.appName = argv[++i];
    } else if (arg.startsWith("--name=")) {
      opts.appName = arg.slice("--name=".length);
    } else if (arg === "--target" && argv[i + 1]) {
      opts.target = argv[++i];
    } else if (arg.startsWith("--target=")) {
      opts.target = arg.slice("--target=".length);
    } else if (arg === "--plan-only") {
      opts.planOnly = true;
    } else if (!arg.startsWith("-") && !opts.source) {
      opts.source = arg;
    }
  }
  return opts;
}

export async function runMigrate(argv: string[]): Promise<void> {
  const opts = parseMigrateArgs(argv);
  if (!opts.source) {
    console.error(
      "Usage: agent-native migrate <source> [--out ../migrated-app] [--name migration]",
    );
    process.exit(1);
  }

  const appName = opts.appName ?? "migration";
  const target = opts.target ?? "agent-native";
  const sourceRoot = path.resolve(process.cwd(), opts.source);
  const outputRoot = path.resolve(
    process.cwd(),
    opts.output ?? "../migrated-app",
  );

  await createApp(appName, { template: "migration" });

  const appDir = resolveScaffoldedAppDir(process.cwd(), appName);
  fs.mkdirSync(path.join(appDir, "data"), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "data", "migration-source.json"),
    `${JSON.stringify(
      {
        name: `Migration from ${path.basename(sourceRoot)}`,
        sourceRoot,
        outputRoot,
        target,
        planOnly: Boolean(opts.planOnly),
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    [
      "",
      "Migration Workbench is ready.",
      "",
      `  Source: ${sourceRoot}`,
      `  Output: ${outputRoot}`,
      `  App:    ${appDir}`,
      "",
      "Next:",
      `  cd ${path.relative(process.cwd(), appDir) || "."}`,
      "  pnpm install",
      "  pnpm dev",
      "",
      "The Workbench will prefill the source and output paths. Create the run, assess, plan, approve, run a task, then verify.",
    ].join("\n"),
  );
}

function resolveScaffoldedAppDir(cwd: string, appName: string): string {
  const workspaceAppDir = path.join(cwd, "apps", appName);
  if (fs.existsSync(workspaceAppDir)) return workspaceAppDir;
  return path.join(cwd, appName);
}
