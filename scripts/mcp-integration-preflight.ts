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
  protocol: "initialize" | "reachable" | "unavailable";
  status: "verified" | "preflight-only" | "restricted";
  note: string;
}

function initializeBody() {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
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
    const response = await fetch(integration.url, {
      method: isSse ? "GET" : "POST",
      headers: isSse
        ? { Accept: "text/event-stream" }
        : {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
          },
      ...(isSse ? {} : { body: initializeBody() }),
      redirect: "manual",
      signal: controller.signal,
    });
    const body = (await response.text()).slice(0, 2_000);
    const protocol = isProtocolResponse(body)
      ? "initialize"
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
        : protocol === "initialize" &&
            response.status >= 200 &&
            response.status < 300
          ? "verified"
          : "preflight-only",
      note: restricted
        ? "Reachable, but authorization, redirect, or provider setup is still required."
        : response.status === 401
          ? "MCP endpoint is reachable and requires provider authorization."
          : protocol === "initialize"
            ? "Unauthenticated MCP initialize returned a protocol response."
            : "Endpoint responded, but the unauthenticated probe did not complete MCP initialize.",
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
