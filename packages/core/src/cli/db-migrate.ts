import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import { tryForwardDbMigrateToDevServer } from "../scripts/db/dev-migrate-proxy.js";
import { findBinUpwards } from "./react-router-command.js";

const DEFAULT_CONFIG_FILES = [
  "drizzle.config.ts",
  "drizzle.config.js",
  "drizzle.config.json",
];

export function parseDbMigrateConfigArg(
  args: string[],
): { config: string } | null {
  if (args.length === 0) {
    const config = DEFAULT_CONFIG_FILES.find((name) =>
      fs.existsSync(path.resolve(process.cwd(), name)),
    );
    return config ? { config } : null;
  }
  if (args.length === 2 && args[0] === "--config" && args[1]) {
    return { config: args[1] };
  }
  if (
    args.length === 1 &&
    args[0].startsWith("--config=") &&
    args[0].length > "--config=".length
  ) {
    return { config: args[0].slice("--config=".length) };
  }
  return null;
}

interface LoadedDrizzleConfig {
  out?: string;
  driver?: string;
  migrations?: { table?: string; schema?: string };
  dbCredentials?: { url?: string };
}

async function loadDrizzleConfig(
  configPath: string,
): Promise<LoadedDrizzleConfig> {
  const { createJiti } = await import("jiti");
  const resolved = path.resolve(process.cwd(), configPath);
  const jiti = createJiti(pathToFileURL(resolved).href, {
    interopDefault: true,
    moduleCache: false,
  });
  const config = await jiti.import(resolved, { default: true });
  if (!config || typeof config !== "object") {
    throw new Error(`${configPath} does not export a drizzle config.`);
  }
  return config as LoadedDrizzleConfig;
}

export async function runDbMigrate(args: string[]): Promise<number> {
  const parsed = parseDbMigrateConfigArg(args);

  if (parsed) {
    try {
      const config = await loadDrizzleConfig(parsed.config);
      const url = config.dbCredentials?.url;
      if (config.driver === "pglite" && typeof url === "string") {
        const forwarded = await tryForwardDbMigrateToDevServer({
          dataDir: url === "memory://" ? url : path.resolve(process.cwd(), url),
          migrationsFolder: config.out ?? "drizzle",
          ...(config.migrations?.table
            ? { migrationsTable: config.migrations.table }
            : {}),
          ...(config.migrations?.schema
            ? { migrationsSchema: config.migrations.schema }
            : {}),
        });
        if (forwarded) return 0;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  const bin = findBinUpwards("drizzle-kit") ?? "drizzle-kit";
  return new Promise((resolve) => {
    const child = spawn(bin, ["migrate", ...args], {
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
