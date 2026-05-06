import crypto from "crypto";
import os from "os";
import path from "path";

export function tenantFileKey(email: string): string {
  return crypto
    .createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

export function tenantUploadDir(email: string): string {
  return path.join(process.cwd(), "data", "uploads", tenantFileKey(email));
}

function exportRootDir(): string {
  if (
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.cwd() === "/var/task" ||
    process.cwd().startsWith("/var/task/")
  ) {
    return path.join(os.tmpdir(), "agent-native-slides", "exports");
  }

  return path.join(process.cwd(), "data", "exports");
}

export function tenantExportDir(email: string): string {
  return path.join(exportRootDir(), tenantFileKey(email));
}

export function safeGeneratedFilename(title: string, ext: ".html" | ".pptx") {
  const base =
    title
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "deck";
  const suffix = crypto.randomBytes(6).toString("hex");
  return `${base}-${Date.now()}-${suffix}${ext}`;
}
