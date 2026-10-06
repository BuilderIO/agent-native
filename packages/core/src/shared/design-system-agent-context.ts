export type AgentDesignSystemPurpose = "selected" | "reference";

export interface AgentDesignSystemContextAvailable {
  status: "available";
  purpose: AgentDesignSystemPurpose;
  scope: "summary" | "full";
  id: string;
  title: string;
  agentContext: string;
  next?: string;
}

export interface AgentDesignSystemContextUnavailable {
  status: "unavailable";
  purpose: AgentDesignSystemPurpose;
  id: string;
  message: string;
}

export type AgentDesignSystemContext =
  | AgentDesignSystemContextAvailable
  | AgentDesignSystemContextUnavailable;

export interface AgentDesignSystemReader {
  run(args: {
    id: string;
    compact?: "true" | "false";
    purpose?: AgentDesignSystemPurpose;
  }): unknown;
}

const UNAVAILABLE_MESSAGE =
  "The linked design system could not be read. Retry get-design-system before authoring; do not invent a replacement style.";

const NOT_ACCESSIBLE_MESSAGE =
  "The linked design system no longer exists or is not shared with you. Do not retry get-design-system; ask the user which system to use or unlink it. Do not invent a replacement style.";

const REFERENCE_NOT_ACCESSIBLE_MESSAGE =
  "The linked design system no longer exists or is not shared with you. Do not retry it. The reference deck is still readable, so use its measured visual language as a fallback; if its samples are insufficient, ask the user which system to use or unlink it. Do not invent replacement tokens.";

function unavailableMessage(
  id: string,
  purpose: AgentDesignSystemPurpose,
): string {
  if (purpose === "reference") {
    return `The linked design system ${JSON.stringify(id)} could not be read. Use the accessible reference samples' measured visual language as fallback; if those samples are insufficient, ask the user which system to use. Do not invent replacement tokens.`;
  }
  return UNAVAILABLE_MESSAGE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function loadAgentDesignSystemContext(
  designSystemId: string | null | undefined,
  getDesignSystem: AgentDesignSystemReader,
  opts?: { full?: boolean; purpose?: AgentDesignSystemPurpose },
): Promise<AgentDesignSystemContext | null> {
  const id = typeof designSystemId === "string" ? designSystemId.trim() : "";
  if (!id) return null;

  const full = Boolean(opts?.full);
  const purpose = opts?.purpose ?? "selected";
  try {
    const args: { id: string; compact: "true" | "false" } = {
      id,
      compact: full ? "false" : "true",
    };
    const value = await getDesignSystem.run(
      purpose === "reference" ? { ...args, purpose } : args,
    );
    if (
      !isRecord(value) ||
      typeof value.title !== "string" ||
      typeof value.agentContext !== "string" ||
      !value.agentContext.trim()
    ) {
      return {
        status: "unavailable",
        purpose,
        id,
        message: unavailableMessage(id, purpose),
      };
    }
    return {
      status: "available",
      purpose,
      scope: full ? "full" : "summary",
      id,
      title: value.title,
      agentContext: value.agentContext,
      ...(full
        ? {}
        : {
            next:
              purpose === "reference"
                ? `Call get-design-system { id: ${JSON.stringify(id)}, purpose: "reference" } once before the first slide or screen you author for the full tokens, assets, docs, and custom instructions; keep its guidance advisory to a separately selected target system.`
                : `Call get-design-system { id: "${id}" } once before the first slide or screen you author for the full tokens, assets, docs, and custom instructions; reuse it for every later write.`,
          }),
    };
  } catch (error) {
    const notFound =
      (error as { statusCode?: unknown } | null)?.statusCode === 404;
    return {
      status: "unavailable",
      purpose,
      id,
      message: notFound
        ? purpose === "reference"
          ? REFERENCE_NOT_ACCESSIBLE_MESSAGE
          : NOT_ACCESSIBLE_MESSAGE
        : unavailableMessage(id, purpose),
    };
  }
}

export function formatAgentDesignSystemContext(
  context: AgentDesignSystemContext | null,
): string[] {
  if (!context) return [];
  if (context.status === "unavailable") {
    return [
      context.purpose === "reference"
        ? "### Linked design system (reference default)"
        : "### Linked design system",
      `designSystemId: ${context.id}`,
      "status: unavailable",
      context.message,
    ];
  }
  return [
    context.purpose === "reference"
      ? "### Linked design system (reference default)"
      : "### Linked design system (authoritative)",
    `designSystemId: ${context.id}`,
    `designSystemTitle: ${context.title}`,
    `scope: ${context.scope}`,
    context.purpose === "reference"
      ? "Use this design system's tokens, assets, and instructions only when no separate system is selected for the new deck; a selected target system takes precedence."
      : "Use this design system's tokens, assets, and instructions before authoring or restyling visual content.",
    context.agentContext,
    ...(context.next ? [context.next] : []),
  ];
}
