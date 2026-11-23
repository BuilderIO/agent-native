/**
 * Clean-checkout bootstrap for the generated formatter assets.
 *
 * `server/assets/formatter/` is intentionally ignored: it contains ~17 MiB of
 * pinned binaries. Dev and formatter tests need the asset directory, so this
 * script builds it only when the manifest is missing. It is never imported by
 * the server runtime and never runs on a request or server cold start.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const manifest = path.join(
  appRoot,
  "server",
  "assets",
  "formatter",
  "manifest.json",
);

if (existsSync(manifest)) {
  console.log("[formatter] generated assets are already present.");
  process.exit(0);
}

console.error(
  "[formatter] generated assets are missing; fetching pinned assets " +
    "(network required; see server/formatter/build-assets.ts).",
);
const result = spawnSync(
  "pnpm",
  ["exec", "tsx", "server/formatter/build-assets.ts"],
  { cwd: appRoot, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
