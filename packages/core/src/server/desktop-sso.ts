/**
 * Desktop SSO broker.
 *
 * In the Electron desktop app each template runs in its own persistent
 * session partition with its own Nitro server and database. Cookies are
 * isolated per partition, and session tokens don't federate across the
 * per-template `session` tables — so signing into Mail leaves Calendar
 * with a useless cookie (same value, but no matching row in Calendar's
 * database), and Calendar reads as "logged out" on the next request.
 *
 * This module is a file-based broker that lives in the user's home
 * directory. When a template creates a session, it writes the token +
 * email here. When any template's `getSession` can't resolve its own
 * cookie, it falls back to this record (but only for requests from
 * Electron, so web deployments stay DB-backed).
 *
 * The file is user-owned (0600) and lives under the OS home directory,
 * so the trust boundary is the local machine — same as the desktop app
 * itself. It is intentionally not written or read outside of Electron
 * requests; plain-web/serverless deployments never touch it.
 */

import os from "node:os";
import path from "node:path";

let _fs: typeof import("fs") | undefined;
async function getFs(): Promise<typeof import("fs")> {
  if (!_fs) _fs = await import("node:fs");
  return _fs;
}

export interface DesktopSsoRecord {
  email: string;
  token: string;
  expiresAt: number;
}

function getSsoPath(): string {
  return path.join(os.homedir(), ".agent-native", "desktop-sso.json");
}

export async function readDesktopSso(): Promise<DesktopSsoRecord | null> {
  try {
    const fs = await getFs();
    const raw = fs.readFileSync(getSsoPath(), "utf-8");
    const rec = JSON.parse(raw) as DesktopSsoRecord;
    if (
      !rec ||
      typeof rec.email !== "string" ||
      typeof rec.token !== "string" ||
      typeof rec.expiresAt !== "number" ||
      rec.expiresAt <= 0 ||
      rec.expiresAt < Date.now()
    ) {
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

export async function writeDesktopSso(rec: DesktopSsoRecord): Promise<void> {
  try {
    const fs = await getFs();
    const p = getSsoPath();
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
    fs.renameSync(tmp, p);
  } catch {
    // Best-effort: SSO is a desktop optimization, never fatal.
  }
}

export async function clearDesktopSso(): Promise<void> {
  try {
    const fs = await getFs();
    fs.unlinkSync(getSsoPath());
  } catch {
    // File didn't exist — fine.
  }
}
