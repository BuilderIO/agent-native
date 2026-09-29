import fs from "fs";
import path from "path";

export function findWorkspaceRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 20; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const wsCore = pkg?.["agent-native"]?.workspaceCore;
        if (typeof wsCore === "string" && wsCore.length > 0) {
          return dir;
        }
      } catch {
        // Keep walking on malformed package.json
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
