import type { ActionClient } from "./client.js";
import type { ActionMetadataSummary } from "./types.js";

interface BrowserModelContext {
  registerTool?: (tool: {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    execute: (input: Record<string, unknown>) => Promise<unknown>;
  }) => void;
}

export interface RegisterWebMcpOptions {
  /** Explicit allowlist of action names to expose to the browser's `navigator.modelContext`. */
  include: readonly string[];
  /** Optional metadata overrides (otherwise fetched from `<baseUrl>`). */
  metadata?: readonly ActionMetadataSummary[];
}

/**
 * Register selected actions with browser-embedded agents via `navigator.modelContext`
 * (WebMCP), executing under the user's live browser session.
 */
export async function registerWebMcpTools<TRegistry>(
  client: ActionClient<TRegistry>,
  options: RegisterWebMcpOptions,
): Promise<{ registered: string[] }> {
  if (typeof navigator === "undefined") {
    return { registered: [] };
  }
  const modelContext = (
    navigator as Navigator & { modelContext?: BrowserModelContext }
  ).modelContext;
  if (!modelContext?.registerTool) {
    return { registered: [] };
  }

  let catalog: readonly ActionMetadataSummary[] = options.metadata ?? [];
  if (catalog.length === 0) {
    const res = await fetch(client.baseUrl, { credentials: "same-origin" });
    if (res.ok) {
      const json = (await res.json()) as { actions?: ActionMetadataSummary[] };
      catalog = json.actions ?? [];
    }
  }

  const allow = new Set(options.include);
  const registered: string[] = [];

  for (const item of catalog) {
    if (!allow.has(item.name) || !item.mcpExposed) continue;
    modelContext.registerTool({
      name: item.name,
      description: item.description,
      execute: async (input) =>
        client.call(item.name as never, input as never, {
          method: item.httpMethod ?? "POST",
        }),
    });
    registered.push(item.name);
  }

  return { registered };
}
