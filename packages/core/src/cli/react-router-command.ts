import fs from "fs";
import { createRequire } from "module";
import path from "path";

export function findBinUpwards(
  binName: string | string[],
  cwd = process.cwd(),
): string | undefined {
  let dir = path.resolve(cwd);
  const names = typeof binName === "string" ? [binName] : binName;
  while (true) {
    for (const name of names) {
      const candidate = path.join(dir, "node_modules", ".bin", name);
      if (fs.existsSync(candidate)) return candidate;
    }
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
  if (shim && process.platform !== "win32") {
    return { command: shim, args, shell: false };
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
    const localPackageJson = shim
      ? path.join(
          path.dirname(path.dirname(shim)),
          "@react-router/dev/package.json",
        )
      : undefined;
    if (!localPackageJson || !fs.existsSync(localPackageJson)) {
      return {
        command: "react-router",
        args,
        shell: process.platform === "win32",
      };
    }
    pkgJsonPath = localPackageJson;
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
