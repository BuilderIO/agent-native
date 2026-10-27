import { providerIdForEngine } from "../agent-provider-catalog.js";
import { mcpIntegrationLogo } from "./mcp-integration-logos.js";

export interface AgentProviderLogo {
  integrationId: string | null;
  label: string;
  logoUrl: string;
  fallback: "local" | "unknown" | null;
}

const PROVIDER_LOGO_IDS: Record<string, string> = {
  anthropic: "anthropic",
  cohere: "cohere",
  google: "google-gemini",
  groq: "groq",
  mistral: "mistral",
  openai: "openai",
  openrouter: "openrouter",
};

function fallbackLabel(engine: string): string {
  const provider = engine.replace(/^ai-sdk:/, "").trim();
  return provider || "AI provider";
}

/**
 * Resolves agent engine IDs through the shared integration-logo catalog.
 * Local and unknown engines deliberately return no borrowed cloud logo.
 */
export function resolveAgentProviderLogo(
  engine: string,
  label?: string,
): AgentProviderLogo {
  if (engine === "builder") {
    const integrationId = "builder-cms";
    return {
      integrationId,
      label: label?.trim() || "Builder",
      logoUrl: mcpIntegrationLogo(integrationId),
      fallback: null,
    };
  }

  const providerId = providerIdForEngine(engine);
  if (providerId === "ollama") {
    return {
      integrationId: null,
      label: label?.trim() || "Ollama",
      logoUrl: "",
      fallback: "local",
    };
  }

  const integrationId = providerId ? PROVIDER_LOGO_IDS[providerId] : undefined;
  if (!integrationId) {
    return {
      integrationId: null,
      label: label?.trim() || fallbackLabel(engine),
      logoUrl: "",
      fallback: "unknown",
    };
  }

  return {
    integrationId,
    label: label?.trim() || fallbackLabel(engine),
    logoUrl: mcpIntegrationLogo(integrationId),
    fallback: null,
  };
}
