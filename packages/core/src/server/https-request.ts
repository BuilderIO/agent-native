import type { H3Event } from "h3";
import { getHeader } from "h3";

import { getAppConfig } from "../app-config/index.js";
import {
  firstPublicBuilderPreviewOriginFromEnv,
  isLoopbackBuilderRequestHost,
} from "./builder-preview-origin.js";

/**
 * Whether the browser reached this request over HTTPS. Gates `Secure` /
 * `SameSite=None` cookie attributes and HSTS.
 */
export function isHttpsRequest(event: H3Event): boolean {
  try {
    const xfProto = getHeader(event, "x-forwarded-proto");
    if (xfProto && String(xfProto).split(",")[0].trim() === "https") {
      return true;
    }
    if (event.url?.protocol === "https:") return true;
    const req: any = (event as any).req ?? event.node?.req;
    const url: string | undefined = req?.url;
    if (typeof url === "string" && url.startsWith("https://")) return true;
    if (event.node?.req?.socket && (event.node.req.socket as any).encrypted) {
      return true;
    }
    const appUrl = getAppConfig().app.url ?? "";
    if (appUrl.startsWith("https://")) return true;
    return isBuilderPreviewTunnelRequest(event);
    // coercion-ok: an uninspectable event keeps the conservative plain-HTTP cookie default.
  } catch {
    return false;
  }
}

// Builder's preview tunnel terminates TLS upstream and reaches the container
// over plain-HTTP loopback with `x-forwarded-proto: http`, and workspace dev
// pins every child's APP_URL to the loopback gateway. Without this, cookies
// come back `SameSite=Lax` and the cross-origin preview iframe drops them.
// Rewriting `x-forwarded-proto` at the gateway instead would make every
// `${proto}://${host}` origin builder produce `https://localhost:8080`.
function isBuilderPreviewTunnelRequest(event: H3Event): boolean {
  if (!isBuilderPreviewHttpsEnvironment()) return false;
  const host = (
    getHeader(event, "x-forwarded-host") ?? getHeader(event, "host")
  )
    ?.split(",")[0]
    ?.trim();
  return isLoopbackBuilderRequestHost(host);
}

/** A dev server that browsers reach through Builder's HTTPS preview tunnel. */
export function isBuilderPreviewHttpsEnvironment(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== "development" && nodeEnv !== "test") return false;
  return (
    firstPublicBuilderPreviewOriginFromEnv()?.startsWith("https://") === true
  );
}
