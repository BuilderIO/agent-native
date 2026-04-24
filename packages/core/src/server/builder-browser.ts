import type { H3Event } from "h3";
import { getOrigin } from "./google-oauth.js";

const DEFAULT_BUILDER_APP_HOST = "https://builder.io";
const DEFAULT_BUILDER_API_HOST = "https://api.builder.io";
const BUILDER_BROWSER_HOST = "agent-native-browser";
const BUILDER_BROWSER_CLIENT_ID = "Agent Native Browser";

export interface BuilderBrowserStatus {
  configured: boolean;
  builderEnabled: boolean;
  appHost: string;
  apiHost: string;
  connectUrl: string;
  publicKeyConfigured: boolean;
  privateKeyConfigured: boolean;
  userId?: string;
  orgName?: string;
  orgKind?: string;
}

export interface BrowserConnectionArgs {
  sessionId?: string;
  projectId?: string;
  branchName?: string;
  proxyOrigin?: string;
  proxyDefaultOrigin?: string;
  proxyDestination?: string;
}

function isAllowedBrowserReturnUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    const isAllowedProtocol =
      parsed.protocol === "http:" || parsed.protocol === "https:";
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]";
    const isBuilderDomain =
      hostname === "builder.io" || hostname.endsWith(".builder.io");
    const isAgentNativeDomain =
      hostname === "agent-native.com" || hostname.endsWith(".agent-native.com");
    return (
      isAllowedProtocol &&
      (isLocalhost || isBuilderDomain || isAgentNativeDomain)
    );
  } catch {
    return false;
  }
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function getBuilderAppHost(): string {
  return (
    process.env.BUILDER_APP_HOST ||
    process.env.BUILDER_PUBLIC_APP_HOST ||
    DEFAULT_BUILDER_APP_HOST
  );
}

export function getBuilderApiHost(): string {
  return (
    process.env.AIR_HOST ||
    process.env.BUILDER_HOST ||
    process.env.BUILDER_API_HOST ||
    DEFAULT_BUILDER_API_HOST
  );
}

export function getBuilderBrowserConnectUrl(origin: string): string {
  const normalizedOrigin = normalizeOrigin(origin);
  const callbackUrl = `${normalizedOrigin}/_agent-native/builder/callback`;
  const url = new URL("/cli-auth", getBuilderAppHost());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("host", BUILDER_BROWSER_HOST);
  url.searchParams.set("client_id", BUILDER_BROWSER_CLIENT_ID);
  url.searchParams.set("redirect_url", callbackUrl);
  url.searchParams.set("preview_url", normalizedOrigin);
  url.searchParams.set("framework", "agent-native");
  return url.toString();
}

export function getBuilderBrowserStatus(origin: string): BuilderBrowserStatus {
  return {
    configured: !!(
      process.env.BUILDER_PRIVATE_KEY && process.env.BUILDER_PUBLIC_KEY
    ),
    builderEnabled: !!process.env.ENABLE_BUILDER,
    appHost: getBuilderAppHost(),
    apiHost: getBuilderApiHost(),
    connectUrl: getBuilderBrowserConnectUrl(origin),
    publicKeyConfigured: !!process.env.BUILDER_PUBLIC_KEY,
    privateKeyConfigured: !!process.env.BUILDER_PRIVATE_KEY,
    userId: process.env.BUILDER_USER_ID || undefined,
    orgName: process.env.BUILDER_ORG_NAME || undefined,
    orgKind: process.env.BUILDER_ORG_KIND || undefined,
  };
}

export function getBuilderBrowserStatusForEvent(
  event: H3Event,
): BuilderBrowserStatus {
  return getBuilderBrowserStatus(getOrigin(event));
}

/**
 * Env vars written by the Builder CLI-auth callback. Single source of truth
 * for the connect/disconnect key set — `getBuilderCallbackEnvVars` and the
 * disconnect handler's scrub loop both derive from this list, so drift
 * (e.g. disconnect silently leaving `BUILDER_USER_ID` behind because
 * someone added a key to one site but not the other) is impossible.
 */
export const BUILDER_ENV_KEYS = [
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
  "BUILDER_USER_ID",
  "BUILDER_ORG_NAME",
  "BUILDER_ORG_KIND",
] as const;

export type BuilderEnvKey = (typeof BUILDER_ENV_KEYS)[number];

export function getBuilderCallbackEnvVars(params: {
  privateKey?: string | null;
  publicKey?: string | null;
  userId?: string | null;
  orgName?: string | null;
  orgKind?: string | null;
}) {
  const values: Record<BuilderEnvKey, string> = {
    BUILDER_PRIVATE_KEY: params.privateKey?.trim() || "",
    BUILDER_PUBLIC_KEY: params.publicKey?.trim() || "",
    BUILDER_USER_ID: params.userId?.trim() || "",
    BUILDER_ORG_NAME: params.orgName?.trim() || "",
    BUILDER_ORG_KIND: params.orgKind?.trim() || "",
  };
  return BUILDER_ENV_KEYS.map((key) => ({ key, value: values[key] }));
}

export function resolveSafePreviewUrl(
  previewUrl: string | null | undefined,
  event: H3Event,
): string {
  if (previewUrl && isAllowedBrowserReturnUrl(previewUrl)) {
    return previewUrl;
  }
  return getOrigin(event);
}

export function createBuilderBrowserCallbackPage(previewUrl: string): string {
  const escapedUrl = JSON.stringify(previewUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>Builder Connected</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(20, 184, 166, 0.18), transparent 38%),
          linear-gradient(180deg, #f7fafc 0%, #eef2f7 100%);
        color: #0f172a;
        font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
      }
      .card {
        width: min(460px, calc(100vw - 32px));
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 18px;
        padding: 28px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
      }
      h1 { margin: 0 0 8px; font-size: 22px; }
      p { margin: 0 0 12px; color: #475569; }
      a { color: #0f766e; font-weight: 600; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Builder connected</h1>
      <p>Browser access is now available to your agent-native app.</p>
      <p>You can close this tab and return to the workspace.</p>
      <p><a href=${escapedUrl} target="_blank" rel="noopener noreferrer">Open the workspace</a></p>
    </main>
    <script>
      // If we're a popup opened by the app, close ourselves and let the
      // parent tab keep polling for connection status. If close() is
      // blocked (e.g. we're the top-level tab because popups were
      // downgraded), fall back to navigating back to the workspace.
      window.setTimeout(function () {
        try { window.close(); } catch (e) {}
        window.setTimeout(function () {
          if (!window.closed) {
            window.location.replace(${escapedUrl});
          }
        }, 200);
      }, 700);
    </script>
  </body>
</html>`;
}

export interface RunBuilderAgentArgs {
  prompt: string;
  projectId?: string;
  branchName?: string;
  userEmail?: string;
  userId?: string;
}

export interface RunBuilderAgentResult {
  branchName: string;
  projectId: string;
  url: string;
  status: string;
}

/**
 * POST a prompt to the Builder agents-run API. The Builder agent runs in a
 * cloud sandbox and writes code to a branch; the returned URL opens that
 * branch in the Visual Editor so the user can watch progress.
 *
 * Spec: https://www.builder.io/c/docs/agents-run-api
 */
export async function runBuilderAgent(
  args: RunBuilderAgentArgs,
): Promise<RunBuilderAgentResult> {
  const privateKey = process.env.BUILDER_PRIVATE_KEY;
  const publicKey = process.env.BUILDER_PUBLIC_KEY;
  if (!privateKey || !publicKey) {
    throw new Error("Builder keys are not configured");
  }
  if (!args.prompt || !args.prompt.trim()) {
    throw new Error("prompt is required");
  }
  if (!args.userEmail && !args.userId) {
    throw new Error("userEmail or userId is required");
  }

  const url = new URL("/agents/run", getBuilderApiHost());
  url.searchParams.set("apiKey", publicKey);

  const body: Record<string, unknown> = {
    userMessage: { userPrompt: args.prompt },
  };
  if (args.projectId) body.projectId = args.projectId;
  if (args.branchName) body.branchName = args.branchName;
  if (args.userEmail) body.userEmail = args.userEmail;
  if (args.userId) body.userId = args.userId;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${privateKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const parsed = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const msg =
      typeof parsed.error === "string"
        ? parsed.error
        : `Builder agent run failed (${response.status})`;
    throw new Error(msg);
  }

  return {
    branchName: String(parsed.branchName ?? ""),
    projectId: String(parsed.projectId ?? ""),
    url: String(parsed.url ?? ""),
    status: String(parsed.status ?? "processing"),
  };
}

export async function requestBuilderBrowserConnection(
  args: BrowserConnectionArgs,
): Promise<Record<string, unknown>> {
  const privateKey = process.env.BUILDER_PRIVATE_KEY;
  const publicKey = process.env.BUILDER_PUBLIC_KEY;
  if (!privateKey || !publicKey) {
    throw new Error("Builder browser access is not configured");
  }

  const sessionId = args.sessionId?.trim();
  if (!sessionId) {
    throw new Error("sessionId is required");
  }

  const url = new URL("/codegen/get-browser-connection", getBuilderApiHost());
  url.searchParams.set("apiKey", publicKey);
  if (process.env.BUILDER_USER_ID) {
    url.searchParams.set("userId", process.env.BUILDER_USER_ID);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${privateKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId,
      projectId: args.projectId || undefined,
      branchName: args.branchName || undefined,
      proxyOrigin: args.proxyOrigin || undefined,
      proxyDefaultOrigin: args.proxyDefaultOrigin || undefined,
      proxyDst: args.proxyDestination || undefined,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const error =
      typeof body.error === "string"
        ? body.error
        : `Builder browser request failed (${response.status})`;
    throw new Error(error);
  }

  return body;
}
