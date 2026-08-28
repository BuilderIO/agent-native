import type {
  AgentLoopFinalResponseGuardContext,
  AgentLoopFinalResponseGuardResult,
} from "@agent-native/core/server";

const DESIGN_MUTATION_ACTIONS = new Set([
  "apply-a11y-fix",
  "apply-component-prop-edit",
  "apply-motion-edit",
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
  /\b(?:advise|advice|analy[sz]e|audit|critique|feedback|recommend(?:ation)?s?|review|suggest(?:ion)?s?|thoughts?)\b/i;
const DESIGN_WORD_PATTERN = /\b[\w-]+\b/g;
const DESIGN_ADVISORY_SKILL_VERBS = new Set(["develop", "improve", "learn"]);
const DESIGN_ADVISORY_SKILL_PRONOUNS = new Set(["my", "your"]);
const DESIGN_SKILL_UI_TARGETS = new Set([
  "button",
  "card",
  "component",
  "layout",
  "page",
  "panel",
  "row",
  "screen",
  "section",
  "text",
]);
const DESIGN_SKILL_UI_TARGET_PHRASES = new Set([
  "footer row",
  "header row",
  "hero section",
  "nav item",
]);
const DESIGN_SKILL_DOMAIN_PREPOSITIONS = new Set([
  "about",
  "across",
  "for",
  "in",
  "on",
  "through",
  "toward",
  "within",
  "with",
]);
const DESIGN_SKILL_CLAUSE_BOUNDARIES = new Set(["also", "and", "but", "then"]);

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

    if (name === "apply-motion-edit") {
      return (
        parsed.persisted === true &&
        typeof parsed.designId === "string" &&
        typeof parsed.timelineId === "string" &&
        parsed.contentPatched === true
      );
    }

    if (name === "create-design-system") {
      return typeof parsed.id === "string";
    }

    if (name === "update-design") {
      return (
        parsed.updated === true &&
        parsed.changed === true &&
        parsed.stale !== true
      );
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

function removeAdvisorySkillsClauses(text: string): string {
  const words: Array<{
    end: number;
    start: number;
    value: string;
    whitespaceBefore: boolean;
  }> = [];
  let previousEnd = 0;
  for (const match of text.matchAll(DESIGN_WORD_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    words.push({
      end,
      start,
      value: match[0].toLowerCase(),
      whitespaceBefore: text.slice(previousEnd, start).trim() === "",
    });
    previousEnd = end;
  }
  const removals: Array<[number, number]> = [];

  let index = 0;
  while (index < words.length - 2) {
    const verb = words[index];
    const pronoun = words[index + 1];
    if (
      !DESIGN_ADVISORY_SKILL_VERBS.has(verb.value) ||
      !DESIGN_ADVISORY_SKILL_PRONOUNS.has(pronoun.value) ||
      !pronoun.whitespaceBefore
    ) {
      index += 1;
      continue;
    }

    let skillIndex = index + 2;
    while (
      skillIndex < words.length &&
      words[skillIndex].whitespaceBefore &&
      !/^skills?$/.test(words[skillIndex].value)
    ) {
      skillIndex += 1;
    }

    const skill = words[skillIndex];
    if (!skill || !/^skills?$/.test(skill.value) || !skill.whitespaceBefore) {
      index = skillIndex;
      continue;
    }

    const nextWord = words[skillIndex + 1];
    const nextNextWord = words[skillIndex + 2];
    const nextTargetPhrase =
      nextWord &&
      nextNextWord &&
      nextWord.whitespaceBefore &&
      nextNextWord.whitespaceBefore
        ? `${nextWord.value} ${nextNextWord.value}`
        : "";
    const targetsUiContent =
      nextWord &&
      nextWord.whitespaceBefore &&
      (DESIGN_SKILL_UI_TARGETS.has(nextWord.value) ||
        DESIGN_SKILL_UI_TARGET_PHRASES.has(nextTargetPhrase));
    let removalEnd = skill.end;
    if (
      !targetsUiContent &&
      nextWord &&
      nextWord.whitespaceBefore &&
      DESIGN_SKILL_DOMAIN_PREPOSITIONS.has(nextWord.value)
    ) {
      let domainIndex = skillIndex + 1;
      while (
        domainIndex < words.length &&
        words[domainIndex].whitespaceBefore &&
        !DESIGN_SKILL_CLAUSE_BOUNDARIES.has(words[domainIndex].value)
      ) {
        removalEnd = words[domainIndex].end;
        domainIndex += 1;
      }
    }
    if (!targetsUiContent) removals.push([verb.start, removalEnd]);
    index = skillIndex + 1;
  }

  if (removals.length === 0) return text;

  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of removals) {
    parts.push(text.slice(cursor, start), " ");
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
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

  const mutationText = removeAdvisorySkillsClauses(normalized);

  const advisoryMatch = DESIGN_ADVISORY_WORDS.exec(mutationText);
  if (advisoryMatch) {
    const beforeAdvisory = mutationText.slice(0, advisoryMatch.index);
    const afterAdvisory = mutationText.slice(
      advisoryMatch.index + advisoryMatch[0].length,
    );
    const followsAdvisory =
      /(?:\b(?:(?:and|also|but)(?:\s+then)?|then)\s+|[.!?;:,]\s*)(?:(?:please|kindly)\s+|(?:(?:can|could|would)\s+you(?:\s+please)?\s+))?(?:add|adjust|align|apply|build|change|clean|create|decrease|delete|design|duplicate|edit|enhance|fix|generate|improve|import|increase|insert|make|modify|move|place|polish|reduce|refine|remove|replace|resize|restyle|rework|tune|update)\b/i.test(
        afterAdvisory,
      );
    if (!DESIGN_MUTATION_VERBS.test(beforeAdvisory) && !followsAdvisory) {
      return false;
    }
  }

  return (
    DESIGN_MUTATION_VERBS.test(mutationText) &&
    DESIGN_MUTATION_OBJECTS.test(mutationText)
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
