import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = resolve(root, "dist");
const releaseDirectory = resolve(root, "releases");
const manifest = JSON.parse(
  await readFile(resolve(distDirectory, "manifest.json"), "utf8"),
) as { version?: string };

if (!manifest.version) {
  throw new Error("dist/manifest.json is missing a version.");
}

const archive = resolve(
  releaseDirectory,
  `agent-browser-extension-${manifest.version}.zip`,
);

await mkdir(releaseDirectory, { recursive: true });
await rm(archive, { force: true });
await execFileAsync("zip", ["-qr", archive, "."], { cwd: distDirectory });

console.log(`Chrome Web Store package ready: ${archive}`);
