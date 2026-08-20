import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");

/** First-party templates bundled into published `@agent-native/core`. */
const BUNDLED_TEMPLATES = ["chat", "base"] as const;

if (process.argv.includes("--clean")) {
  for (const template of BUNDLED_TEMPLATES) {
    rmSync(join(rootDir, "packages", "core", "src", "templates", template), {
      recursive: true,
      force: true,
    });
  }
  process.exit(0);
}

for (const template of BUNDLED_TEMPLATES) {
  syncTemplate(template);
}

function syncTemplate(template: (typeof BUNDLED_TEMPLATES)[number]): void {
  const sourceRoot = join(rootDir, "templates", template);
  const targetRoot = join(
    rootDir,
    "packages",
    "core",
    "src",
    "templates",
    template,
  );

  const trackedFiles = execFileSync(
    "git",
    ["ls-files", "-z", "--", `templates/${template}`],
    { cwd: rootDir },
  )
    .toString()
    .split("\0")
    .filter(Boolean);

  if (trackedFiles.length === 0) {
    throw new Error(`No tracked files found under ${sourceRoot}.`);
  }

  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });

  for (const trackedPath of trackedFiles) {
    const relativePath = relative(`templates/${template}`, trackedPath);
    if (/\.(?:spec|test)\.(?:ts|tsx)$/.test(relativePath)) continue;
    const sourcePath = join(rootDir, trackedPath);
    const targetPath = join(targetRoot, relativePath);
    const stat = lstatSync(sourcePath);

    mkdirSync(dirname(targetPath), { recursive: true });
    if (stat.isSymbolicLink()) {
      symlinkSync(readlinkSync(sourcePath), targetPath);
      continue;
    }

    writeFileSync(targetPath, readFileSync(sourcePath));
  }
}
