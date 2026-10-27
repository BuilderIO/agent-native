import fs from "fs";
import { createRequire } from "module";
import path from "path";

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
