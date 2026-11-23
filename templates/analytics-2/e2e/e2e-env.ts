export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4197"; // guard:allow-env-credential — non-secret e2e target URL, test harness only
export const AUTH_DISABLED = process.env.AUTH_DISABLED === "1"; // guard:allow-env-credential — non-secret e2e auth-bypass switch, test harness only
export const ARCHIVE_SHOT_DIR = process.env.ARCHIVE_SHOT_DIR ?? "/tmp"; // guard:allow-env-credential — non-secret e2e screenshot directory, test harness only
