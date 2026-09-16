import crypto from "node:crypto";
import path from "node:path";

export function workspaceIdentity(root: string): string {
  const resolved = path.resolve(root);
  const canonical =
    process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
