import type { H3Event } from "h3";
import { getOrigin } from "./google-oauth.js";

const DEFAULT_BUILDER_APP_HOST = "https://builder.io";
const DEFAULT_BUILDER_API_HOST = "https://api.builder.io";
const BUILDER_BROWSER_HOST = "agent-native-browser";
const BUILDER_BROWSER_CLIENT_ID = "Agent Native Browser";

export interface BuilderBrowserStatus {
  configured: boolean;
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
    return isAllowedProtocol && (isLocalhost || isBuilderDomain);
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

export function getBuilderCallbackEnvVars(params: {
  privateKey?: string | null;
  publicKey?: string | null;
  userId?: string | null;
  orgName?: string | null;
  orgKind?: string | null;
}) {
  return [
    { key: "BUILDER_PRIVATE_KEY", value: params.privateKey?.trim() || "" },
    { key: "BUILDER_PUBLIC_KEY", value: params.publicKey?.trim() || "" },
    { key: "BUILDER_USER_ID", value: params.userId?.trim() || "" },
    { key: "BUILDER_ORG_NAME", value: params.orgName?.trim() || "" },
    { key: "BUILDER_ORG_KIND", value: params.orgKind?.trim() || "" },
  ];
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
      <p>Returning you to the workspace…</p>
      <p><a href=${escapedUrl}>Open the workspace</a></p>
    </main>
    <script>
      window.setTimeout(function () {
        window.location.replace(${escapedUrl});
      }, 900);
    </script>
  </body>
</html>`;
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
