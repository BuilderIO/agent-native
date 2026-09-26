
import {
  lineColForOffset,
  readFileSafe,
  relPosix,
  walk,
} from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

const DANGEROUS_SCRIPT_HOOKS = new Set([
  "build",
  "prebuild",
  "postbuild",
  "install",
  "preinstall",
  "postinstall",
  "deploy",
  "predeploy",
  "postdeploy",
  "start",
  "prestart",
  "poststart",
  "ci",
  "release",
  "prerelease",
  "postrelease",
]);

const PATTERNS = [/\bdrizzle-kit\s+push\b/, /\bdrizzle\s+push\b/];

function matchesForbidden(str: unknown): str is string {
  if (!str || typeof str !== "string") return false;
  return PATTERNS.some((p) => p.test(str));
}

interface PackageJsonLike {
  scripts?: Record<string, unknown>;
}

export function scanDrizzlePush(options: GuardScanOptions): GuardResult {
  const { root } = options;
  const findings: GuardFinding[] = [];

  for (const file of walk(root)) {
    const base = file.split("/").pop() ?? file;
    if (base === "netlify.toml") {
      scanNetlifyToml(root, file, findings);
    } else if (base === "package.json") {
      scanPackageJson(root, file, findings);
    }
  }

  return { name: "no-drizzle-push", findings };
}

function scanNetlifyToml(
  root: string,
  file: string,
  findings: GuardFinding[],
): void {
  const contents = readFileSafe(file);
  if (contents === null || !matchesForbidden(contents)) return;
  const lines = contents.split("\n");
  const rel = relPosix(root, file);
  for (let i = 0; i < lines.length; i++) {
    if (matchesForbidden(lines[i])) {
      findings.push({
        file: rel,
        line: i + 1,
        message: `forbidden \`drizzle-kit push\` in netlify.toml: ${lines[i].trim()}`,
      });
    }
  }
}

function scanPackageJson(
  root: string,
  file: string,
  findings: GuardFinding[],
): void {
  const contents = readFileSafe(file);
  if (contents === null) return;
  let json: PackageJsonLike;
  try {
    json = JSON.parse(contents) as PackageJsonLike;
  } catch {
    return;
  }
  const scripts = json.scripts;
  if (!scripts || typeof scripts !== "object") return;
  const rel = relPosix(root, file);
  for (const [name, cmd] of Object.entries(scripts)) {
    if (!DANGEROUS_SCRIPT_HOOKS.has(name)) continue;
    if (matchesForbidden(cmd)) {
      const idx = contents.indexOf(`"${name}"`);
      const line = idx >= 0 ? lineColForOffset(contents, idx).line : 1;
      findings.push({
        file: rel,
        line,
        message: `forbidden \`drizzle-kit push\` in scripts.${name}: ${String(cmd)}`,
      });
    }
  }
}
