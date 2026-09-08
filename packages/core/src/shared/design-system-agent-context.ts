export interface AgentDesignSystemContextAvailable {
  status: "available";
  scope: "summary" | "full";
  id: string;
  title: string;
  agentContext: string;
  /** Present when scope is "summary": the one call that returns the full context. */
  next?: string;
}

export interface AgentDesignSystemContextUnavailable {
  status: "unavailable";
  id: string;
  message: string;
}

export type AgentDesignSystemContext =
  | AgentDesignSystemContextAvailable
  | AgentDesignSystemContextUnavailable;

// `ActionDefinition["run"]` (packages/core/src/action.ts) is typed as
// `(args) => Promise<TReturn> | TReturn` — sync returns are allowed at the
// type level even though every real action is async. `Promise<unknown>` here
// would reject that union on every call site that passes an action's default
// export directly, so this accepts the same "sync or async" shape the loader
// already awaits either way.
export interface AgentDesignSystemReader {
  run(args: { id: string; compact?: "true" | "false" }): unknown;
}

const UNAVAILABLE_MESSAGE =
  "The linked design system could not be read. Retry get-design-system before authoring; do not invent a replacement style.";

const NOT_ACCESSIBLE_MESSAGE =
  "The linked design system no longer exists or is not shared with you. Do not retry get-design-system; ask the user which system to use or unlink it. Do not invent a replacement style.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Keep the resource read useful when a linked system is unavailable, while
 * making unreadable context distinct from a resource with no linked system.
 * Reads default to the bounded "summary" scope so every deck/design read
 * does not pay for the full, uncached Builder docs fetch; pass
 * `{ full: true }` only at the one call site that needs the complete tokens,
 * assets, docs, and custom instructions before authoring.
 */
export async function loadAgentDesignSystemContext(
  designSystemId: string | null | undefined,
  getDesignSystem: AgentDesignSystemReader,
  opts?: { full?: boolean },
): Promise<AgentDesignSystemContext | null> {
  const id = typeof designSystemId === "string" ? designSystemId.trim() : "";
  if (!id) return null;

  const full = Boolean(opts?.full);
  try {
    const value = await getDesignSystem.run({
      id,
      compact: full ? "false" : "true",
    });
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
      scope: full ? "full" : "summary",
      id,
      title: value.title,
      agentContext: value.agentContext,
      ...(full
        ? {}
        : {
            next: `Call get-design-system { id: "${id}" } once before the first slide or screen you author for the full tokens, assets, docs, and custom instructions; reuse it for every later write.`,
          }),
    };
  } catch (error) {
    const notFound =
      (error as { statusCode?: unknown } | null)?.statusCode === 404;
    return {
      status: "unavailable",
      id,
      message: notFound ? NOT_ACCESSIBLE_MESSAGE : UNAVAILABLE_MESSAGE,
    };
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
    `scope: ${context.scope}`,
    "Use this design system's tokens, assets, and instructions before authoring or restyling visual content.",
    context.agentContext,
    ...(context.next ? [context.next] : []),
  ];
}
