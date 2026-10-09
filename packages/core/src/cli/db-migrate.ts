import { spawn } from "child_process";

import { tryForwardDbMigrateToDevServer } from "../scripts/db/dev-migrate-proxy.js";
import { findBinUpwards } from "./react-router-command.js";

export function parseDbMigrateArgs(args: string[]): {
  out: string;
  passthrough: string[];
} {
  let out = "./drizzle/migrations";
  const passthrough: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--out" && args[i + 1] !== undefined) {
      out = args[++i];
    } else if (arg.startsWith("--out=")) {
      out = arg.slice("--out=".length);
    } else {
      passthrough.push(arg);
    }
  }
  return { out, passthrough };
}

export async function runDbMigrate(args: string[]): Promise<number> {
  const { out, passthrough } = parseDbMigrateArgs(args);

  try {
    if (await tryForwardDbMigrateToDevServer({ migrationsFolder: out })) {
      return 0;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const bin = findBinUpwards("drizzle-kit") ?? "drizzle-kit";
  return new Promise((resolve) => {
    const child = spawn(bin, ["migrate", ...passthrough], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", (error) => {
      console.error(`Failed to run drizzle-kit: ${error.message}`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
