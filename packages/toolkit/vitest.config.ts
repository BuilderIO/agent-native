import fs from "node:fs";
import path from "node:path";

import { defineConfig, mergeConfig, type Plugin } from "vitest/config";

import baseConfig from "../../vitest.shared";

type ExportTarget =
  | string
  | { import?: string; default?: string; [condition: string]: unknown }
  | null;

interface ExportPattern {
  prefix: string;
  suffix: string;
  key: string;
  target: string;
}

interface PackageSource {
  dir: string;
  name: string;
  exact: Map<string, string>;
  patterns: ExportPattern[];
}

function readPackageSource(dir: string): PackageSource {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  ) as { name: string; exports: Record<string, ExportTarget> };
  const exact = new Map<string, string>();
  const patterns: ExportPattern[] = [];
  for (const [key, entry] of Object.entries(manifest.exports)) {
    // Vitest picks import/default over `browser` in jsdom specs as well, so
    // the source mapping follows the same condition.
    const target =
      typeof entry === "string" ? entry : (entry?.import ?? entry?.default);
    if (typeof target !== "string" || !target.startsWith("./dist/")) continue;
    const star = key.indexOf("*");
    if (star === -1) {
      exact.set(key, target);
    } else {
      patterns.push({
        prefix: key.slice(0, star),
        suffix: key.slice(star + 1),
        key,
        target,
      });
    }
  }
  // Node's pattern order: the longest prefix wins, then the longest key.
  patterns.sort(
    (a, b) => b.prefix.length - a.prefix.length || b.key.length - a.key.length,
  );
  return { dir, name: manifest.name, exact, patterns };
}

function sourceFileFor(pkg: PackageSource, distTarget: string): string {
  const base = path.join(pkg.dir, "src", distTarget.slice("./dist/".length));
  const candidates = distTarget.endsWith(".js")
    ? [".ts", ".tsx"].map((ext) => base.slice(0, -".js".length) + ext)
    : [base];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) {
    throw new Error(
      `${pkg.name} export ${distTarget} has no source file (tried ${candidates.join(", ")}).`,
    );
  }
  return source;
}

function resolveSourceExport(
  pkg: PackageSource,
  specifier: string,
): string | null {
  if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`)) {
    return null;
  }
  const subpath = `.${specifier.slice(pkg.name.length)}`;
  const exactTarget = pkg.exact.get(subpath);
  if (exactTarget) return sourceFileFor(pkg, exactTarget);
  for (const pattern of pkg.patterns) {
    if (
      subpath.length >= pattern.prefix.length + pattern.suffix.length &&
      subpath.startsWith(pattern.prefix) &&
      subpath.endsWith(pattern.suffix)
    ) {
      const match = subpath.slice(
        pattern.prefix.length,
        subpath.length - pattern.suffix.length,
      );
      return sourceFileFor(pkg, pattern.target.replaceAll("*", match));
    }
  }
  return null;
}

// Toolkit specs run against workspace source, including toolkit's own
// `@agent-native/toolkit/*` self-imports. Package exports point at `dist`, so
// without this a spec would mix current source with whatever was last built.
function workspaceSourceExports(packageDirs: string[]): Plugin {
  const packages = packageDirs.map(readPackageSource);
  return {
    name: "toolkit-workspace-source-exports",
    enforce: "pre",
    resolveId(specifier) {
      for (const pkg of packages) {
        const source = resolveSourceExport(pkg, specifier);
        if (source) return source;
      }
      return null;
    },
  };
}

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [
      workspaceSourceExports([
        __dirname,
        path.resolve(__dirname, "../core"),
        path.resolve(__dirname, "../agentkit"),
      ]),
    ],
    test: {
      setupFiles: ["./test-setup.ts"],
    },
  }),
);
