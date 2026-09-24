/**
 * Per-model-family prompt overlays.
 *
 * A small addendum appended to the assembled system prompt when a non-Claude
 * engine is active. Claude is the baseline so it gets no overlay. GPT-family
 * models benefit from an explicit autonomy/persistence nudge and parallel-tool
 * encouragement. Gemini benefits from concise tool-call discipline.
 *
 * Each overlay is ≤8 lines. They are selected by the active model id at the
 * point in agent-chat-plugin.ts where both the assembled prompt and the
 * resolved model id are known.
 */

/**
 * Return the model-family overlay string for the given model id, or an empty
 * string for Claude (baseline — no overlay needed).
 */
export function getModelFamilyOverlay(modelId: string): string {
  const id = modelId.toLowerCase();

  // Claude family — baseline, no overlay
  if (
    id.startsWith("claude-") ||
    id.startsWith("us.anthropic.") ||
    id.includes("anthropic")
  ) {
    return "";
  }

  // GPT / OpenAI family
  if (
    id.startsWith("gpt-") ||
    id.startsWith("o1") ||
    id.startsWith("o3") ||
    id.startsWith("o4") ||
    id.startsWith("codex-")
  ) {
    return `
<model-overlay>
Keep going until the task is fully resolved before yielding back — do not stop at a proposal or partial result when you can carry it through. If you hit a blocker, try the obvious unblockers yourself rather than stopping to ask. Use parallel tool calls freely for independent read-only lookups; batch them in one turn to minimize round-trips.
</model-overlay>`;
  }

  // Gemini family
  if (id.startsWith("gemini-") || id.includes("gemini")) {
    return `
<model-overlay>
Keep tool calls concise and non-redundant: do not repeat a tool call you already made in this turn with the same arguments. When you have all the information you need to answer, answer directly without an extra tool call to confirm.
</model-overlay>`;
  }

  // Other / unknown — no overlay
  return "";
}
