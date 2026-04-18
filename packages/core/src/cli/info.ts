/**
 * `agent-native info <pkg>` — read-only command that prints a package's
 * subpath exports, source paths in node_modules, and docs links.
 *
 * Useful precursor to the full `eject` command (planned for v0.2):
 * a user can inspect what a package ships before ejecting.
 */
import fs from "fs";
import path from "path";

export function runInfo(pkgName?: string): void {
  if (!pkgName) {
    console.error("Usage: agent-native info <package-name>");
    process.exit(1);
  }

  // Resolve the package's installed location via require.resolve against the cwd.
  const cwd = process.cwd();
  const pkgJsonPath = resolvePackageJson(pkgName, cwd);
  if (!pkgJsonPath) {
    console.error(`Package '${pkgName}' not found in ${cwd}/node_modules.`);
    process.exit(1);
  }
  const pkgDir = path.dirname(pkgJsonPath);
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));

  console.log(`# ${pkg.name}@${pkg.version}`);
  console.log("");
  if (pkg.description) {
    console.log(pkg.description);
    console.log("");
  }
  console.log(`Installed at: ${pkgDir}`);

  if (pkg.exports) {
    console.log("");
    console.log("## Subpath exports");
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      console.log(`  ${pad(subpath, 40)} → ${summarizeTarget(target)}`);
    }
  }

  // Check for an @agent-native/-style manifest.
  const manifestPath = path.join(pkgDir, "dist", "manifest.js");
  if (fs.existsSync(manifestPath)) {
    console.log("");
    console.log("## Manifest");
    console.log(`  ${manifestPath}`);
  }

  // Docs bundle.
  const docsDir = path.join(pkgDir, "docs");
  if (fs.existsSync(docsDir)) {
    console.log("");
    console.log("## Docs bundle");
    const llms = path.join(docsDir, "llms.txt");
    const llmsFull = path.join(docsDir, "llms-full.txt");
    if (fs.existsSync(llms)) console.log(`  ${llms}`);
    if (fs.existsSync(llmsFull)) console.log(`  ${llmsFull}`);
    const skillsDir = path.join(docsDir, "skills");
    if (fs.existsSync(skillsDir)) {
      const skills = fs.readdirSync(skillsDir);
      console.log("  skills:");
      for (const s of skills) console.log(`    - ${s}`);
    }
  }

  // Eject pointer.
  const ejectDoc = path.join(pkgDir, "docs", "eject.md");
  if (fs.existsSync(ejectDoc)) {
    console.log("");
    console.log("## Eject");
    console.log(`  See ${ejectDoc} for manual eject instructions.`);
    console.log(
      "  (A full `agent-native eject` command is planned for a future release.)",
    );
  }
}

function resolvePackageJson(pkgName: string, from: string): string | null {
  // Walk up directories searching node_modules/<pkgName>/package.json
  let dir = from;
  while (true) {
    const candidate = path.join(dir, "node_modules", pkgName, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

function summarizeTarget(t: any): string {
  if (typeof t === "string") return t;
  if (t && typeof t === "object") {
    if (t.default) return t.default;
    if (t.import) return t.import;
    return Object.values(t).join(", ");
  }
  return String(t);
}
