import fs from "fs";
import { createRequire } from "module";
import path from "path";

import { AGENT_NATIVE_TYPEGEN_ENV } from "../shared/runtime-config.js";

export function findBinUpwards(
  binName: string,
  cwd = process.cwd(),
): string | undefined {
  let dir = cwd;
  for (let i = 0; i < 20; i++) {
    const candidate = path.join(dir, "node_modules", ".bin", binName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export function findReactRouterInvocation(
  args: string[],
  cwd = process.cwd(),
): { command: string; args: string[]; shell: boolean } {
  const shim = findBinUpwards("react-router", cwd);
  if (shim) {
    return { command: shim, args, shell: process.platform === "win32" };
  }

  const require = createRequire(path.join(cwd, "package.json"));
  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve("@react-router/dev/package.json");
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ERR_PACKAGE_PATH_NOT_EXPORTED"
    ) {
      throw error;
    }
    return {
      command: "react-router",
      args,
      shell: process.platform === "win32",
    };
  }

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
    bin?: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["react-router"];
  if (!rel)
    throw new Error("@react-router/dev does not declare a react-router bin");

  const entry = path.resolve(path.dirname(pkgJsonPath), rel);
  if (!fs.existsSync(entry)) {
    throw new Error(`@react-router/dev react-router bin is missing: ${entry}`);
  }

  return {
    command: process.execPath,
    args: [entry, ...args],
    shell: false,
  };
}

const TYPE_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
// `./+types/<route>` resolves through tsconfig rootDirs; some apps import the
// `.react-router/types/...` path directly.
const GENERATED_ROUTE_TYPES_PATH = /\/\+types\/|\.react-router\/types\//;
// The only React Router APIs typed by typegen's `Register` augmentation.
// Without it they fall back to loose types instead of failing.
const REGISTER_TYPED_IMPORT =
  /\bimport\s*(?:type\s*)?\{[^}]*\b(?:href|unstable_useRoute)\b[^}]*\}\s*from\s*["']react-router["']/;

export function usesGeneratedRouteTypes(appRoot = process.cwd()): boolean {
  const visit = (directory: string): boolean => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      // Dot-directories hold generated types and deploy output, never routes.
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (visit(entryPath)) return true;
      } else if (
        entry.isFile() &&
        TYPE_SOURCE_EXTENSIONS.has(path.extname(entry.name))
      ) {
        const source = fs.readFileSync(entryPath, "utf-8");
        if (
          GENERATED_ROUTE_TYPES_PATH.test(source) ||
          REGISTER_TYPED_IMPORT.test(source)
        ) {
          return true;
        }
      }
    }
    return false;
  };
  return visit(appRoot);
}

export function reactRouterTypegenEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    NODE_ENV: "development",
    [AGENT_NATIVE_TYPEGEN_ENV]: "1",
  };
}
