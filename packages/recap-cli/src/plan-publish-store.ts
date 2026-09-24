/**
 * Canonical publish-token store for the local Plans server.
 *
 * `agent-native connect <hosted-url>` mints a bearer token and writes it into
 * each coding agent's per-client MCP config (`.mcp.json` / Codex `config.toml`
 * via `mcp-config-writers`). Those files are client-specific, so the local Plans
 * server cannot read them for a server-to-server publish.
 *
 * To close that seam, the connect flow ALSO writes a single canonical record to
 * `~/.agent-native/plan-publish.json` whenever it authenticates a first-party
 * Plans app. The local server's `publish-visual-plan` action reads the exact
 * same file (see `templates/plan/server/lib/plan-publish.ts`):
 *
 *   { "url": "https://plan.agent-native.com", "token": "<bearer>" }
 *
 * This mirrors the existing device-token precedent in
 * `code-agent-connector.ts` (`~/.agent-native/remote-device.json`): home-dir
 * JSON, env-overridable path, atomic 0600 write. The write is additive — it
 * merges into any existing file rather than clobbering sibling keys — and
 * best-effort, since persisting MCP config is the primary contract and a failed
 * canonical write must never fail the connect.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Matches the env override read by `templates/plan/server/lib/plan-publish.ts`. */
const CONFIG_PATH_ENV = "PLAN_PUBLISH_CONFIG_PATH";

/**
 * Absolute path to the canonical publish-token file. Honors
 * `PLAN_PUBLISH_CONFIG_PATH` so connect and the local server agree on the
 * location in tests and custom setups; defaults to
 * `~/.agent-native/plan-publish.json`.
 */
export function planPublishConfigPath(): string {
  return path.resolve(
    process.env[CONFIG_PATH_ENV] ??
      path.join(os.homedir(), ".agent-native", "plan-publish.json"),
  );
}

/**
 * Whether `url`'s host is the first-party Agent-Native Plans app whose token
 * we should mirror to the canonical publish file. Only the hosted Plans app
 * (`plan.agent-native.com`) qualifies — mirroring tokens for other
 * agent-native subdomains (assets, mail, …) would silently overwrite the
 * canonical Plans endpoint with the wrong URL+token each time `connect --all`
 * runs last-write-wins. A custom self-hosted origin (ngrok, localhost, a
 * private deployment) is intentionally excluded: the user can still point the
 * server at it via `PLAN_PUBLISH_URL` / `PLAN_PUBLISH_TOKEN` env vars.
 */
export function isFirstPartyPlanHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "plan.agent-native.com";
  } catch {
    return false;
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Merge `{ url, token }` into the canonical publish file without clobbering any
 * other keys the file already holds. Best-effort: returns the written path on
 * success, or `null` if the write failed or the inputs were unusable.
 *
 * `filePath` is injectable for tests; production callers omit it and get the
 * env-overridable home-dir path.
 */
export function writePlanPublishAuth(
  params: { url: string; token: string },
  filePath: string = planPublishConfigPath(),
): string | null {
  const url = stripTrailingSlash((params.url ?? "").trim());
  const token = (params.token ?? "").trim();
  if (!url || !token) return null;

  try {
    let existing: Record<string, unknown> = {};
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        existing = raw as Record<string, unknown>;
      }
    } catch {
      // No existing file (or unreadable/corrupt) — start fresh.
    }

    const merged = {
      ...existing,
      url,
      token,
      updatedAt: new Date().toISOString(),
    };

    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", {
      mode: 0o600,
    });
    fs.renameSync(tmp, filePath);
    return filePath;
  } catch {
    // Best-effort: the per-client MCP config is the primary write. A failed
    // canonical write must never fail the connect flow.
    return null;
  }
}

/**
 * Read the canonical Plans publish auth written by `agent-native connect`.
 * Returns `null` for missing/corrupt/incomplete files so callers can treat the
 * publish token as optional and guide the user to reconnect.
 */
export function readPlanPublishAuth(
  filePath: string = planPublishConfigPath(),
): { url: string; token: string } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const urlValue = record.url ?? record.baseUrl ?? record.hostedUrl;
    const tokenValue = record.token ?? record.accessToken ?? record.bearerToken;
    const url = typeof urlValue === "string" ? urlValue.trim() : "";
    const token = typeof tokenValue === "string" ? tokenValue.trim() : "";
    if (!url || !token) return null;
    return { url: stripTrailingSlash(url), token };
  } catch {
    return null;
  }
}
