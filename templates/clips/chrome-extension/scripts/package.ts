import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist");
const releaseDir = resolve(root, "releases");

const manifest = JSON.parse(
  await readFile(resolve(distDir, "manifest.json"), "utf8"),
) as { version?: string };
const version = manifest.version;
if (!version) {
  throw new Error(
    "dist/manifest.json is missing a version; run the build first",
  );
}
const zipPath = resolve(releaseDir, `clips-chrome-extension-${version}.zip`);

await mkdir(releaseDir, { recursive: true });
await rm(zipPath, { force: true });
await execFileAsync("zip", ["-qr", zipPath, "."], { cwd: distDir });

console.log(`Chrome Web Store package ready: ${zipPath}`);
