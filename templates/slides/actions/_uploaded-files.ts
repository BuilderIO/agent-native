import fs from "fs";
import path from "path";

import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import { tenantUploadDir } from "../server/lib/tenant-files.js";
import { readUploadedReferenceBlob } from "../server/lib/uploaded-reference-storage.js";

export async function readUserUploadedFile(
  filePath: string,
): Promise<{ data: Buffer; filename: string }> {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");

  const privateUpload = await readUploadedReferenceBlob(filePath, email);
  if (privateUpload) {
    return privateUpload;
  }

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
  return {
    data: await fs.promises.readFile(resolved),
    filename: path.basename(resolved),
  };
}
