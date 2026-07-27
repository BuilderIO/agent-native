#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function resolveBetterSqlite3() {
  try {
    return require.resolve("better-sqlite3");
  } catch {
    const pnpmDir = join(__dirname, "..", "..", "..", "node_modules", ".pnpm");
    if (!existsSync(pnpmDir))
      throw new Error("better-sqlite3 is not installed");
    const packageDir = readdirSync(pnpmDir).find((entry) =>
      entry.startsWith("better-sqlite3@"),
    );
    if (!packageDir) throw new Error("better-sqlite3 is not installed");
    return join(
      pnpmDir,
      packageDir,
      "node_modules",
      "better-sqlite3",
      "lib",
      "index.js",
    );
  }
}

try {
  const { default: Database } = await import(
    pathToFileURL(resolveBetterSqlite3()).href
  );
  const db = new Database(":memory:");
  db.close();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`
[content dev preflight] better-sqlite3 could not load its native binding.

This usually means the local install was restored without rebuilding native
modules. Try:

  pnpm rebuild better-sqlite3

If that still fails, rebuild the package directly:

  cd ../../node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
  npm run build-release

Original error:
${message}
`);
  process.exit(1);
}
