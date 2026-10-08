import { useCallback, useEffect, useState } from "react";

import type { McpConnectIdentity } from "../shared/mcp-connect-content.js";
import { appPath } from "./api-path.js";

export type McpConnectIdentityState =
  | { status: "loading" }
  | { status: "ready"; identity: McpConnectIdentity }
  | { status: "error"; error: Error };

function isMcpConnectIdentity(value: unknown): value is McpConnectIdentity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.serverName === "string" &&
    candidate.serverName.length > 0 &&
    typeof candidate.appName === "string" &&
    typeof candidate.appUrl === "string" &&
    typeof candidate.mcpUrl === "string" &&
    candidate.mcpUrl.length > 0 &&
    typeof candidate.environment === "string"
  );
}

/**
 * Without `x-forwarded-proto` the server guesses `https` for any host that
 * is not loopback, so a plain-HTTP LAN deployment advertises URLs it does not
 * answer on. This page reached the same host and knows its real scheme.
 */
function withPageScheme(url: string): string {
  if (typeof window === "undefined") return url;
  const page = window.location;
  if (page.protocol !== "http:" && page.protocol !== "https:") return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.host !== page.host || parsed.protocol === page.protocol) {
    return url;
  }
  return page.protocol + url.slice(parsed.protocol.length);
}

/**
 * The server name and MCP URL this app hands to MCP clients, as the server
 * resolves them. Surfaces must not derive a name from the hostname: that is
 * how settings, the connect page and the CLI wrote three different names.
 */
export async function fetchMcpConnectIdentity(): Promise<McpConnectIdentity> {
  const response = await fetch(appPath("/mcp/connect/identity"), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`MCP connect identity request failed (${response.status})`);
  }
  const body: unknown = await response.json();
  if (!isMcpConnectIdentity(body)) {
    throw new Error("MCP connect identity response was malformed");
  }
  return {
    ...body,
    appUrl: withPageScheme(body.appUrl),
    mcpUrl: withPageScheme(body.mcpUrl),
  };
}

export function useMcpConnectIdentity(): McpConnectIdentityState & {
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<McpConnectIdentityState>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchMcpConnectIdentity().then(
      (identity) => {
        if (!cancelled) setState({ status: "ready", identity });
      },
      (error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...state, retry };
}
