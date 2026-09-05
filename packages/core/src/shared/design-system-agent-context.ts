export interface AgentDesignSystemContextAvailable {
  status: "available";
  id: string;
  title: string;
  agentContext: string;
}

export interface AgentDesignSystemContextUnavailable {
  status: "unavailable";
  id: string;
  message: string;
}

export type AgentDesignSystemContext =
  | AgentDesignSystemContextAvailable
  | AgentDesignSystemContextUnavailable;

const UNAVAILABLE_MESSAGE =
  "The linked design system could not be read. Retry get-design-system before authoring; do not invent a replacement style.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Keep the resource read useful when a linked system is unavailable, while
 * making unreadable context distinct from a resource with no linked system.
 */
export async function loadAgentDesignSystemContext(
  designSystemId: string | null | undefined,
  load: (id: string) => Promise<unknown>,
): Promise<AgentDesignSystemContext | null> {
  const id = typeof designSystemId === "string" ? designSystemId.trim() : "";
  if (!id) return null;

  try {
    const value = await load(id);
    if (
      !isRecord(value) ||
      typeof value.title !== "string" ||
      typeof value.agentContext !== "string" ||
      !value.agentContext.trim()
    ) {
      return { status: "unavailable", id, message: UNAVAILABLE_MESSAGE };
    }
    return {
      status: "available",
      id,
      title: value.title,
      agentContext: value.agentContext,
    };
  } catch {
    return { status: "unavailable", id, message: UNAVAILABLE_MESSAGE };
  }
}

export function formatAgentDesignSystemContext(
  context: AgentDesignSystemContext | null,
): string[] {
  if (!context) return [];
  if (context.status === "unavailable") {
    return [
      "### Linked design system",
      `designSystemId: ${context.id}`,
      "status: unavailable",
      context.message,
    ];
  }
  return [
    "### Linked design system (authoritative)",
    `designSystemId: ${context.id}`,
    `designSystemTitle: ${context.title}`,
    "Use this design system's tokens, assets, and instructions before authoring or restyling visual content.",
    context.agentContext,
  ];
}
