import type { A2AConfig, AgentCard } from "./types.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import { shouldAdvertiseJwtA2AAuth } from "./auth-policy.js";

export function generateAgentCard(
  config: A2AConfig,
  baseUrl: string,
): AgentCard {
  const scopedUrl = withConfiguredAppBasePath(baseUrl);
  const card: AgentCard = {
    name: config.name,
    description: config.description,
    url: scopedUrl,
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
