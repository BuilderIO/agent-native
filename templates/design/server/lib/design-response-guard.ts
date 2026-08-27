import type {
  AgentLoopFinalResponseGuardContext,
  AgentLoopFinalResponseGuardResult,
} from "@agent-native/core/server";

const DESIGN_MUTATION_ACTIONS = new Set([
  "apply-a11y-fix",
  "apply-component-prop-edit",
  "apply-source-edit",
  "apply-tweaks",
  "apply-visual-edit",
  "create-design",
  "create-design-from-template",
  "create-design-system",
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
  /\b(?:add|adjust|align|apply|build|change|clean|create|decrease|delete|design|duplicate|edit|enhance|fix|generate|improve|import|increase|insert|make|modify|move|polish|place|reduce|refine|remove|replace|resize|restyle|rework|tune|update)\b/i;
const DESIGN_MUTATION_OBJECTS =
  /\b(?:animation|animations|asset|background|behavior|behaviors|border|button|canvas|card|color|colors|component|design|file|footer|font|gap|header|height|hero|image|interaction|interactions|it|layout|mockup|motion|nav|page|palette|padding|prototype|radius|screen|shadow|size|spacing|state|states|style|styles|text|this|theme|transition|transitions|typography|variant|version|width|wireframe)\b/i;
const DESIGN_ADVISORY_WORDS =
  /\b(?:advise|advice|analy[sz]e|audit|critique|recommend(?:ation)?s?|review|suggest(?:ion)?s?)\b/i;
const DESIGN_ADVISORY_SKILLS =
  /\b(?:improve|learn|develop)\s+(?:my|your)\s+(?:(?:design|visual|ui)\s+)?skills?\b(?!\s+(?:section|card|component|layout|panel|row|screen|page|button|text)\b)/i;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasNoFileErrors(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
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
      return (
        parsed.renderable === true &&
        nonEmptyArray(parsed.savedFiles) &&
        hasNoFileErrors(parsed.fileErrors)
      );
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

    if (name === "apply-tweaks") {
      return (
        typeof parsed.designId === "string" &&
        parsed.applied === true &&
        isRecord(parsed.appliedTweaks) &&
        Object.keys(parsed.appliedTweaks).length > 0
      );
    }

    if (name === "create-design-system") {
      return typeof parsed.id === "string";
    }

    if (name === "update-design") {
      return parsed.updated === true && parsed.stale !== true;
    }

    if (name === "update-file") {
      return parsed.updated === true && parsed.skippedStaleMirror !== true;
    }

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
  if (DESIGN_ADVISORY_SKILLS.test(normalized)) return false;

  const advisoryMatch = DESIGN_ADVISORY_WORDS.exec(normalized);
  if (advisoryMatch) {
    const beforeAdvisory = normalized.slice(0, advisoryMatch.index);
    const afterAdvisory = normalized.slice(
      advisoryMatch.index + advisoryMatch[0].length,
    );
    const followsAdvisory =
      /(?:\b(?:and|also|but|then)\s+|[.!?;:,]\s*)(?:add|adjust|align|apply|build|change|clean|create|decrease|delete|design|duplicate|edit|enhance|fix|generate|improve|import|increase|insert|make|modify|move|place|reduce|refine|remove|replace|resize|restyle|rework|tune|update)\b/i.test(
        afterAdvisory,
      );
    if (!DESIGN_MUTATION_VERBS.test(beforeAdvisory) && !followsAdvisory) {
      return false;
    }
  }

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
