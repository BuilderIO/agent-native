import fs from "fs";
import path from "path";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { tenantUploadDir } from "../server/lib/tenant-files.js";

export function resolveUserUploadedFile(filePath: string): string {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");

  const allowedDir = tenantUploadDir(email);
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  const resolved = path.resolve(absPath);

  if (
    !(resolved === allowedDir || resolved.startsWith(allowedDir + path.sep))
  ) {
    throw new Error("Access denied: file path must be within your uploads");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return resolved;
}
