import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLAN_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const LOCAL_PLAN_OWNER_EMAIL = "local@agent-native.local";

let generatedAuthRunId: string | undefined;
let generatedAuthStatePath: string | undefined;
let generatedAuthEmailPath: string | undefined;

export function planE2eBaseUrl() {
  return process.env.PLAN_BASE_URL || "http://localhost:8081";
}

function safeBaseUrlSlug(baseURL: string) {
  const hash = createHash("sha1").update(baseURL).digest("hex").slice(0, 8);
  try {
    const url = new URL(baseURL);
    const protocol = url.protocol.replace(/:$/, "");
    const host = url.hostname.replace(/[^a-zA-Z0-9.-]/g, "-");
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${protocol}-${host}-${port}-${hash}`;
  } catch {
    return `url-${hash}`;
  }
}

function authRunId() {
  const existing = process.env.PLAN_E2E_AUTH_RUN_ID?.trim();
  if (existing) return existing;
  generatedAuthRunId ??= `${Date.now().toString(36)}-${process.pid}`;
  return generatedAuthRunId;
}

export function planE2eAuthDir(baseURL = planE2eBaseUrl()) {
  const explicit = process.env.PLAN_E2E_AUTH_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(
    PLAN_ROOT,
    "e2e",
    ".auth",
    `${safeBaseUrlSlug(baseURL)}-${authRunId()}`,
  );
}

export function planE2eAuthStatePath(baseURL = planE2eBaseUrl()) {
  const explicit = process.env.PLAN_E2E_AUTH_STATE?.trim();
  if (explicit) return path.resolve(explicit);
  generatedAuthStatePath ??= path.join(planE2eAuthDir(baseURL), "state.json");
  return generatedAuthStatePath;
}

export function planE2eAuthEmailPath(baseURL = planE2eBaseUrl()) {
  const explicit = process.env.PLAN_E2E_EMAIL_FILE?.trim();
  if (explicit) return path.resolve(explicit);
  generatedAuthEmailPath ??= path.join(planE2eAuthDir(baseURL), "email.txt");
  return generatedAuthEmailPath;
}

export function planE2eUsesLocalPlanOwner() {
  const nodeEnv = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  const authMode = process.env.AUTH_MODE;
  return !(
    nodeEnv === "production" ||
    nodeEnv === "prod" ||
    process.env.PLAN_LOCAL_MODE === "0" ||
    (authMode && authMode !== "local")
  );
}

export function expectedPlanCommentAuthorEmail(reviewerEmail: string) {
  const explicit = process.env.PLAN_E2E_EXPECT_COMMENT_EMAIL?.trim();
  if (explicit) return explicit;
  return planE2eUsesLocalPlanOwner() ? LOCAL_PLAN_OWNER_EMAIL : reviewerEmail;
}
