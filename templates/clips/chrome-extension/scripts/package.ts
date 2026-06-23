import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist");
const releaseDir = resolve(root, "releases");
const zipPath = resolve(releaseDir, "clips-chrome-extension-0.1.0.zip");

await mkdir(releaseDir, { recursive: true });
await rm(zipPath, { force: true });
await execFileAsync("zip", ["-qr", zipPath, "."], { cwd: distDir });

console.log(`Chrome Web Store package ready: ${zipPath}`);
