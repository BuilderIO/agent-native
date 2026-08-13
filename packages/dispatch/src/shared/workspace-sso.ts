import { DISPATCH_WORKSPACE_SSO_FLAG } from "./feature-flags.js";

export { DISPATCH_WORKSPACE_SSO_FLAG };

/** Exact first-party origins. Never replace this with a suffix or wildcard. */
export const CANONICAL_WORKSPACE_SSO_APP_ORIGINS = {
  analytics: "https://analytics.agent-native.com",
  assets: "https://assets.agent-native.com",
  brain: "https://brain.agent-native.com",
  calendar: "https://calendar.agent-native.com",
  chat: "https://chat.agent-native.com",
  clips: "https://clips.agent-native.com",
  content: "https://content.agent-native.com",
  crm: "https://crm.agent-native.com",
  design: "https://design.agent-native.com",
  dispatch: "https://dispatch.agent-native.com",
  forms: "https://forms.agent-native.com",
  macros: "https://macros.agent-native.com",
  mail: "https://mail.agent-native.com",
  plan: "https://plan.agent-native.com",
  slides: "https://slides.agent-native.com",
  tasks: "https://tasks.agent-native.com",
} as const;

export const WORKSPACE_SSO_CALLBACK_PATH =
  "/_agent-native/identity/callback" as const;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const APP_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export interface WorkspaceSsoAppRegistration {
  appId: string;
  clientId: string;
  origin: string;
  callbackPath: typeof WORKSPACE_SSO_CALLBACK_PATH;
}

export function exactWorkspaceSsoOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || CONTROL_CHARS.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && LOCALHOST_HOSTS.has(url.hostname))
    ) {
      return null;
    }
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Parse the same additive custom registry used by browser identity SSO. The
 * raw value is passed in so this shared module stays safe to import in the
 * browser bundle.
 */
export function parseWorkspaceSsoAppRegistrations(
  raw: unknown,
): WorkspaceSsoAppRegistration[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  const registrations: WorkspaceSsoAppRegistration[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const appId = candidate.appId;
    const clientId = candidate.clientId;
    const origin = exactWorkspaceSsoOrigin(candidate.origin);
    if (
      typeof appId !== "string" ||
      !APP_ID.test(appId) ||
      typeof clientId !== "string" ||
      !CLIENT_ID.test(clientId) ||
      !origin ||
      candidate.callbackPath !== WORKSPACE_SSO_CALLBACK_PATH ||
      !Array.isArray(candidate.capabilities) ||
      !candidate.capabilities.includes("identity-sso") ||
      seen.has(appId) ||
      Object.prototype.hasOwnProperty.call(
        CANONICAL_WORKSPACE_SSO_APP_ORIGINS,
        appId,
      )
    ) {
      continue;
    }
    seen.add(appId);
    registrations.push({
      appId,
      clientId,
      origin,
      callbackPath: WORKSPACE_SSO_CALLBACK_PATH,
    });
  }
  return registrations;
}
