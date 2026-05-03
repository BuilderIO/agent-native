import type { A2AConfig, AgentCard } from "./types.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import { shouldAdvertiseJwtA2AAuth } from "./auth-policy.js";

export function generateAgentCard(
  config: A2AConfig,
  baseUrl: string,
  endpointPath = "/_agent-native/a2a",
): AgentCard {
  const scopedUrl = withConfiguredAppBasePath(baseUrl);
  const endpointUrl = withEndpointPath(scopedUrl, endpointPath);
  const card: AgentCard = {
    name: config.name,
    description: config.description,
    url: endpointUrl,
    version: config.version ?? "1.0.0",
    protocolVersion: "0.3",
    capabilities: {
      streaming: config.streaming ?? false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    skills: config.skills,
  };

  const securitySchemes: NonNullable<AgentCard["securitySchemes"]> = {};
  const security: NonNullable<AgentCard["security"]> = [];

  // Hosted production deployments require JWT-capable A2A even before card
  // generation can prove whether auth will use the shared A2A_SECRET or an
  // org-scoped secret from SQL.
  if (shouldAdvertiseJwtA2AAuth()) {
    securitySchemes.jwtBearer = {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    };
    security.push({ jwtBearer: [] });
  }

  if (config.apiKeyEnv) {
    securitySchemes.apiKey = {
      type: "http",
      scheme: "bearer",
    };
    security.push({ apiKey: [] });
  }

  if (security.length > 0) {
    card.securitySchemes = securitySchemes;
    card.security = security;
  }

  return card;
}

function normalizeEndpointPath(value: string): string {
  const normalized = value.trim().split("/").filter(Boolean).join("/");
  return normalized ? `/${normalized}` : "";
}

function withEndpointPath(baseUrl: string, endpointPath: string): string {
  const path = normalizeEndpointPath(endpointPath);
  const trimmed = baseUrl.replace(/\/$/, "");
  if (!path) return trimmed;

  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/$/, "");
    if (pathname === path || pathname.endsWith(path)) {
      return trimmed;
    }
    url.pathname = `${pathname === "/" ? "" : pathname}${path}`;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    // Fall through for relative or otherwise non-URL strings.
  }

  if (trimmed.endsWith(path)) return trimmed;
  return `${trimmed}${path}`;
}
