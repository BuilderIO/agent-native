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

export function isHostedSlidesRuntime(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NETLIFY && env.NETLIFY !== "false" && env.NETLIFY_LOCAL !== "true") {
    return true;
  }
  if (
    (env.AWS_LAMBDA_FUNCTION_NAME ||
      env.LAMBDA_TASK_ROOT ||
      cwd === "/var/task" ||
      cwd.startsWith("/var/task/")) &&
    env.NETLIFY_LOCAL !== "true"
  ) {
    return true;
  }
  return Boolean(
    env.VERCEL ||
    env.VERCEL_ENV ||
    env.CF_PAGES ||
    env.RENDER ||
    env.FLY_APP_NAME ||
    env.K_SERVICE,
  );
}

function exportRootDir(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (isHostedSlidesRuntime(cwd, env)) {
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
