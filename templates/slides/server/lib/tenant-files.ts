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

export function tenantUploadDir(email: string, cwd = process.cwd()): string {
  return path.join(cwd, "data", "uploads", tenantFileKey(email));
}

function exportRootDir(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (
    env.NETLIFY ||
    env.VERCEL ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    cwd === "/var/task" ||
    cwd.startsWith("/var/task/")
  ) {
    return path.join(os.tmpdir(), "agent-native-slides", "exports");
  }

  return path.join(cwd, "data", "exports");
}

export function tenantExportDir(
  email: string,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(exportRootDir(cwd, env), tenantFileKey(email));
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
