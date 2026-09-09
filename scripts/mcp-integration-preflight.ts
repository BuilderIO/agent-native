import {
  DEFAULT_MCP_INTEGRATIONS,
  type DefaultMcpIntegration,
} from "../packages/core/src/client/resources/mcp-integration-catalog.js";

const REQUEST_TIMEOUT_MS = 12_000;

interface PreflightResult {
  id: string;
  name: string;
  url: string;
  httpStatus: number | null;
  protocol: "discover" | "initialize" | "reachable" | "unavailable";
  status: "verified" | "preflight-only" | "restricted";
  note: string;
}

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-11-25";

function discoverBody() {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "server/discover",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": {
          name: "agent-native-preflight",
          version: "1.0.0",
        },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  });
}

function initializeBody() {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "agent-native-preflight", version: "1.0.0" },
    },
  });
}

function isProtocolResponse(body: string): boolean {
  return /"(?:result|error)"\s*:/.test(body);
}

async function probe(
  integration: DefaultMcpIntegration,
): Promise<PreflightResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const isSse = /\/sse(?:[/?]|$)/i.test(integration.url);
    let response = await fetch(integration.url, {
      method: isSse ? "GET" : "POST",
      headers: isSse
        ? { Accept: "text/event-stream" }
        : {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION,
            "Mcp-Method": "server/discover",
          },
      ...(isSse ? {} : { body: discoverBody() }),
      redirect: "manual",
      signal: controller.signal,
    });
    let body = (await response.text()).slice(0, 2_000);
    let negotiated: "discover" | "initialize" = "discover";
    if (
      !isSse &&
      isProtocolResponse(body) &&
      (response.ok || response.status === 400) &&
      !/"supportedVersions"\s*:/.test(body)
    ) {
      response = await fetch(integration.url, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        body: initializeBody(),
        redirect: "manual",
        signal: controller.signal,
      });
      body = (await response.text()).slice(0, 2_000);
      negotiated = "initialize";
    }
    const protocol = isProtocolResponse(body)
      ? negotiated
      : response.status >= 200 && response.status < 500
        ? "reachable"
        : "unavailable";
    const restricted =
      integration.verification === "restricted" ||
      response.status === 403 ||
      (response.status >= 300 && response.status < 400);
    return {
      id: integration.id,
      name: integration.name,
      url: integration.url,
      httpStatus: response.status,
      protocol,
      status: restricted
        ? "restricted"
        : (protocol === "discover" || protocol === "initialize") &&
            response.status >= 200 &&
            response.status < 300
          ? "verified"
          : "preflight-only",
      note: restricted
        ? "Reachable, but authorization, redirect, or provider setup is still required."
        : response.status === 401
          ? "MCP endpoint is reachable and requires provider authorization."
          : protocol === "discover"
            ? "Unauthenticated MCP discovery returned a modern protocol response."
            : protocol === "initialize"
              ? "Modern discovery fell back to a legacy MCP initialize response."
              : "Endpoint responded, but the unauthenticated probe did not complete MCP discovery.",
    };
  } catch (error) {
    return {
      id: integration.id,
      name: integration.name,
      url: integration.url,
      httpStatus: null,
      protocol: "unavailable",
      status:
        integration.verification === "restricted"
          ? "restricted"
          : "preflight-only",
      note:
        error instanceof Error && error.name === "AbortError"
          ? `Probe timed out after ${REQUEST_TIMEOUT_MS}ms.`
          : `Probe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

const results = await Promise.all(DEFAULT_MCP_INTEGRATIONS.map(probe));
console.log(
  JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
);
