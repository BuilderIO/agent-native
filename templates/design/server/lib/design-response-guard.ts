import type {
  AgentLoopFinalResponseGuardContext,
  AgentLoopFinalResponseGuardResult,
} from "@agent-native/core/server";

const DESIGN_MUTATION_ACTIONS = new Set([
  "apply-tweaks",
  "create-design",
  "create-design-from-template",
  "create-component",
  "create-file",
  "delete-design",
  "delete-file",
  "duplicate-design",
  "edit-design",
  "generate-design",
  "import-figma-clipboard",
  "import-figma-frame",
  "insert-asset",
  "insert-design-native-asset",
  "insert-figma-library-asset",
  "present-design-variants",
  "update-design",
  "update-file",
]);

const DESIGN_MUTATION_VERBS =
  /\b(?:add|build|change|create|design|duplicate|edit|generate|import|insert|make|modify|place|refine|update)\b/i;
const DESIGN_MUTATION_OBJECTS =
  /\b(?:asset|button|canvas|component|design|file|hero|image|layout|mockup|page|prototype|screen|this|variant|version|wireframe)\b/i;

function normalizeToolName(name: unknown): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/^agent:/, "")
    .replace(/[\s_]+/g, "-");
}

function latestUserText(
  messages: AgentLoopFinalResponseGuardContext["messages"],
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user" || !Array.isArray(message.content)) {
      continue;
    }
    const text = message.content
      .filter((part: any) => part?.type === "text")
      .map((part: any) => String(part.text ?? ""))
      .join("\n");
    if (text.trim()) return text;
  }
  return "";
}

function parseResult(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // coercion-ok: malformed action output is unreadable and must fail closed
    // rather than count as proof that Design content was persisted.
    return null;
  }
}

function nonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasSuccessfulMutation(
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
): boolean {
  return (toolResults ?? []).some((result) => {
    if (result.isError) return false;

    const name = normalizeToolName(result.name);
    if (!DESIGN_MUTATION_ACTIONS.has(name)) return false;

    const parsed = parseResult(String(result.content ?? ""));
    if (!parsed) return false;

    // Creating the project shell is not the requested design. Require the
    // follow-up action that writes a renderable file before accepting success.
    if (name === "create-design") return false;

    if (name === "generate-design") {
      return parsed.renderable === true && nonEmptyArray(parsed.savedFiles);
    }

    if (name === "present-design-variants") {
      return (
        typeof parsed.designId === "string" && nonEmptyArray(parsed.screens)
      );
    }

    if (name === "import-figma-frame" || name === "import-figma-clipboard") {
      return typeof parsed.designId === "string" && nonEmptyArray(parsed.files);
    }

    if (name === "edit-design") return parsed.changed === true;

    if (name === "create-file") {
      return (
        typeof parsed.id === "string" &&
        (parsed.renderable === true || parsed.fileType === "css")
      );
    }

    if (name === "create-design-from-template" || name === "duplicate-design") {
      return (
        typeof parsed.id === "string" &&
        typeof parsed.fileCount === "number" &&
        parsed.fileCount > 0 &&
        parsed.promptPending !== true
      );
    }

    return (
      parsed.updated === true ||
      parsed.inserted === true ||
      parsed.deleted === true ||
      parsed.changed === true ||
      parsed.applied === true ||
      parsed.persisted === true ||
      parsed.saved === true
    );
  });
}

export function looksLikeDesignMutationRequest(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (/^\[(?:reprompt selection|selection question)\]/i.test(normalized)) {
    return false;
  }
  if (/^(?:how|what|why|when|where|which)\b/i.test(normalized)) {
    return false;
  }
  if (/\bhow\s+to\b/i.test(normalized)) return false;

  return (
    DESIGN_MUTATION_VERBS.test(normalized) &&
    DESIGN_MUTATION_OBJECTS.test(normalized)
  );
}

export function designFinalResponseGuard(
  context: AgentLoopFinalResponseGuardContext,
): AgentLoopFinalResponseGuardResult | null {
  if (context.executionMode === "plan") return null;

  const requestText =
    context.requestText?.trim() || latestUserText(context.messages);
  if (!looksLikeDesignMutationRequest(requestText)) return null;
  if (hasSuccessfulMutation(context.toolResults)) return null;

  return {
    retryMessage:
      "This is a design-changing request, so a text-only answer is not completion. " +
      "Continue in this turn and call the appropriate mutating Design action. " +
      "For a new design, create the project if needed and then call `generate-design` " +
      "or `present-design-variants`; for an existing design, read it and call `edit-design`. " +
      "If an image or asset is involved, finish with `insert-asset` when placement is needed. " +
      "Do not claim the design is created, updated, or ready until the action result proves " +
      "that content was persisted.",
    fallbackMessage:
      "I couldn't confirm that a Design artifact was saved, so I haven't marked this request complete. Please retry.",
    maxRetries: 1,
    expandToolSurface: true,
  };
}
