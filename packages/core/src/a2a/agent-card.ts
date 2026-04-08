import type { A2AConfig, AgentCard } from "./types.js";

export function generateAgentCard(
  config: A2AConfig,
  baseUrl: string,
): AgentCard {
  const card: AgentCard = {
    name: config.name,
    description: config.description,
    url: baseUrl,
    version: config.version ?? "1.0.0",
    protocolVersion: "0.3",
    capabilities: {
      streaming: config.streaming ?? false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    skills: config.skills,
  };

  // Advertise JWT-based A2A identity when A2A_SECRET is configured
  if (process.env.A2A_SECRET) {
    card.securitySchemes = {
      jwtBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    };
    card.security = [{ jwtBearer: [] }];
  } else if (config.apiKeyEnv) {
    card.securitySchemes = {
      apiKey: {
        type: "http",
        scheme: "bearer",
      },
    };
    card.security = [{ apiKey: [] }];
  }

  return card;
}
