import type { AgentToolCall } from "@agent-native/agentkit/protocol";
import {
  DEFAULT_MCP_INTEGRATIONS,
  findMcpIntegrationForToolName,
  type DefaultMcpIntegration,
} from "@agent-native/core/client/resources/mcp-integration-catalog";

import type { AgentKitToolSource } from "../../agentkit/react/context.js";
import { McpIntegrationLogo } from "../../resources/McpIntegrationLogo.js";
const normalizeId = (value: string) => value.toLowerCase().replace(/_/g, "-");
const integrationIdentities = DEFAULT_MCP_INTEGRATIONS.map((integration) => ({
  integration,
  aliases: [
    integration.id,
    integration.provider,
    ...(integration.brandAliases ?? []),
    ...(integration.aliases ?? []),
  ].map(normalizeId),
}));

export function resolveToolIntegration(
  toolName: string,
  input?: unknown,
): DefaultMcpIntegration | undefined {
  if (toolName.toLowerCase().startsWith("mcp__")) {
    return findMcpIntegrationForToolName(toolName) ?? undefined;
  }
  const name = normalizeId(toolName);
  if (name === "provider-api-request") {
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch (error) {
        if (error instanceof SyntaxError) return undefined;
        throw error;
      }
    }
    const provider =
      input && typeof input === "object" && "provider" in input
        ? input.provider
        : undefined;
    if (typeof provider !== "string") return undefined;
    return integrationIdentities.find(({ aliases }) =>
      aliases.includes(normalizeId(provider)),
    )?.integration;
  }
  const matches = integrationIdentities.filter(({ aliases }) =>
    aliases.some((alias) => `-${name}-`.includes(`-${alias}-`)),
  );
  return matches.length === 1 ? matches[0]!.integration : undefined;
}

export function IntegrationToolBadge({
  integration,
}: {
  integration: DefaultMcpIntegration;
}) {
  return (
    <span
      role="img"
      aria-label={integration.name}
      data-integration-id={integration.id}
      className="inline-flex shrink-0 align-middle"
    >
      <McpIntegrationLogo
        name={integration.name}
        integrationId={integration.id}
        logoUrl={integration.logoUrl}
        title={integration.name}
        className="size-5 rounded-md"
        imageClassName="size-3.5"
      />
    </span>
  );
}

export function resolveAgentKitToolSource(
  tool: AgentToolCall,
): AgentKitToolSource | undefined {
  const integration = resolveToolIntegration(tool.name, tool.input);
  return integration
    ? {
        id: integration.id,
        icon: <IntegrationToolBadge integration={integration} />,
      }
    : undefined;
}
