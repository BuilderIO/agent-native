import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function workspaceIdentity(root: string): string {
  const resolved = path.resolve(root);
  let physicalRoot: string;
  try {
    physicalRoot = fs.realpathSync.native(resolved);
  } catch {
    // The resolver may run before a configured root exists. Keep the identity
    // deterministic in that case rather than coercing absence into another path.
    physicalRoot = resolved;
  }
  const canonical =
    process.platform === "win32" ? physicalRoot.toLowerCase() : physicalRoot;
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
