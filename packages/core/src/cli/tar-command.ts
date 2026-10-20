import path from "node:path";

export function resolveTarExecutable(
  platform: NodeJS.Platform = process.platform,
  systemRoot = process.env.SYSTEMROOT,
): string {
  if (platform !== "win32") return "tar";
  if (!systemRoot) {
    throw new Error(
      "SystemRoot is required to resolve the Windows tar executable.",
    );
  }
  return path.win32.join(systemRoot, "System32", "tar.exe");
}
