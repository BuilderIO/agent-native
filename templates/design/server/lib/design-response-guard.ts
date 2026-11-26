import {
  DEFAULT_LOCALE,
  LOCALIZATION_SETTING_KEY,
  isLocaleCode,
  normalizeLocalizationPreference,
  type BuiltinLocaleCode,
} from "@agent-native/core/localization";
import type {
  AgentLoopFinalResponseGuardContext,
  AgentLoopFinalResponseGuardResult,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getUserSetting } from "@agent-native/core/settings";
import { splitAgentChatContextFromMessage } from "@agent-native/core/shared";

import {
  DESIGN_OUTPUT_ACTIONS,
  isAssetsImageTool,
} from "../../shared/generation-output-receipt.js";
import { DESIGN_MUTATION_REQUIRED_DIRECTIVE } from "../../shared/mutation-turn.js";
import {
  isRepromptSelectionMessage,
  isSelectionQuestionMessage,
} from "./reprompt-action-guard.js";

const DESIGN_MUTATION_ACTIONS = new Set([
  // Full-app designs: the change lands in the Builder branch's code.
  "send-builder-message",
  "apply-builder-edits",
  "apply-component-prop-edit",
  "apply-source-edit",
  "apply-tweaks",
  "apply-visual-edit",
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
  "move-design-element",
  "present-design-variants",
  "update-design",
  "update-file",
]);

const DESIGN_MUTATION_VERBS =
  /\b(?:add|adding|adjust|adjusting|align|aligning|apply|applying|build|building|change|changing|clean|cleaning|create|creating|decrease|decreasing|delete|deleting|design|designing|duplicate|duplicating|edit|editing|enhance|enhancing|fix|fixing|generate|generating|improve|improving|import|importing|increase|increasing|insert|inserting|make|making|modify|modifying|move|moving|polish|polishing|place|placing|reduce|reducing|refine|refining|remove|removing|replace|replacing|resize|resizing|restyle|restyling|rework|reworking|tune|tuning|update|updating)\b/i;
const DESIGN_MUTATION_OBJECTS =
  /\b(?:(?:animation|asset|background|behavior|border|button|canvas|card|color|component|design|file|footer|font|gap|header|height|hero|image|interaction|layout|mockup|motion|nav|page|palette|padding|prototype|radius|screen|shadow|size|spacing|state|style|text|theme|transition|typography|variant|version|visual|width|wireframe)s?|it|this)\b/i;
const DESIGN_ADVISORY_WORDS =
  /\b(?:advise|advice|analy[sz]e|audit|critique|feedback|recommend(?:ation)?s?|review|suggest(?:ion)?s?|teach(?:ing)?|tip|tips|thoughts?|tutorials?)\b/i;
const DESIGN_TEST_REQUEST =
  /\bvisual(?:[\s-]+(?:regression|snapshot))?(?:[\s-]+(?:and|or|plus|&)[\s-]+(?:visual[\s-]+)?(?:regression|snapshot))?(?:[\s-]+(?:test|tests|testing|suite|suites)|[\s-]+snapshots?)\b/i;
const DESIGN_TEST_TARGET_PREPOSITIONS =
  /^(?:\s*(?:[,.!?;:]|[-–—])*\s*)(?:for|of|on|in|against|with|using)\b/i;
const DESIGN_TEST_CLAUSE_BOUNDARY =
  /[.!?,;]|(?<!\w)[-–—](?!\w)|\b(?:and|also|but|then|after(?:\s+that)?|afterwards?|subsequently|before|while|followed\s+by)\b/gi;
const DESIGN_TEST_TARGET_DESCRIPTOR = new RegExp(
  `^\\s*(?:(?:a|an|the|another|new)\\s+)?(?:[\\w-]+\\s+)*${DESIGN_MUTATION_OBJECTS.source}\\s*$`,
  "i",
);
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
const DESIGN_AMBIGUOUS_VERB = /^(?:design|designing)$/i;
const DESIGN_REQUEST_LEAD_IN =
  /\b(?:please|kindly|also|and|then|now|to|let'?s)$|\b(?:can|could|would|will)\s+you(?:\s+please)?$|\bi(?:'d|\s+would)?\s+(?:like|want|need)\s+(?:you\s+)?to$/i;
const DESIGN_FINITE_VERB_FOLLOWS =
  /^\s*(?:is|are|was|were|be|been|being|has|have|had|will|would|can|could|should|may|might|must|does|do|did)\b/i;

function matchSpans(pattern: RegExp, text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    spans.push([start, start + match[0].length]);
  }
  return spans;
}

/**
 * `design` is the only token in both the verb and the object pattern, and in
 * this app it is far more often the noun. Let it supply the verb only where a
 * verb can stand: opening the message or a clause, or after a request lead-in,
 * and never in front of a finite verb of its own ("design is ..." is a
 * statement about designs). Prohibited and conditional verbs do not require
 * a write merely because a verification request mentions them.
 */
function suppliesMutationVerb(
  text: string,
  [start, end]: [number, number],
): boolean {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const prohibitionScope = before
    .split(/[.!?;,\n]|\b(?:but|then|also)\b/i)
    .pop()!;
  if (
    /\b(?:\w+n['’]t|not(?!\s+only\b)|never|avoid|without|rather\s+than|instead\s+of)\b/i.test(
      prohibitionScope,
    )
  )
    return false;
  const conditionScope = before
    .split(/[.!?;\n]|\b(?:and|but|then|also)\b/i)
    .pop()!;
  const suffix = after.split(/[.!?;\n]|\b(?:and|but|then|also)\b/i)[0];
  if (
    /\b(?:if|unless)\b/i.test(conditionScope) ||
    /\b(?:if|unless)\b|\b(?:as|when|where)\s+(?:needed|necessary|appropriate|required)\b/i.test(
      suffix,
    )
  )
    return false;
  if (
    /^mak(?:e|ing)$/i.test(text.slice(start, end)) &&
    /^\s+(?:sure|certain)\b/i.test(after)
  )
    return false;
  if (!DESIGN_AMBIGUOUS_VERB.test(text.slice(start, end))) return true;
  if (DESIGN_FINITE_VERB_FOLLOWS.test(text.slice(end))) return false;
  const prefix = text.slice(0, start).replace(/\s+$/, "");
  if (prefix === "" || /[.!?,;:]$/.test(prefix)) return true;
  return DESIGN_REQUEST_LEAD_IN.test(prefix);
}

function hasDistinctVerbAndObject(text: string): boolean {
  const verbs = matchSpans(
    new RegExp(DESIGN_MUTATION_VERBS.source, "gi"),
    text,
  ).filter((span) => suppliesMutationVerb(text, span));
  if (verbs.length === 0) return false;
  return matchSpans(
    new RegExp(DESIGN_MUTATION_OBJECTS.source, "gi"),
    text,
  ).some(([objectStart, objectEnd]) =>
    verbs.some(
      ([verbStart, verbEnd]) =>
        verbEnd <= objectStart || objectEnd <= verbStart,
    ),
  );
}

function normalizeToolName(name: unknown): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/^agent:/, "")
    .replace(/[\s_]+/g, "-");
}

function userMessageText(
  message: AgentLoopFinalResponseGuardContext["messages"][number],
): string {
  if (message.role !== "user") return "";
  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

function latestUserText(
  messages: AgentLoopFinalResponseGuardContext["messages"],
): string {
  for (const message of [...messages].reverse()) {
    const text = userMessageText(message);
    if (text.trim()) return text;
  }
  return "";
}

function isInternalPrompt(text: string): boolean {
  return (
    text.includes("<response-guard>") ||
    text.startsWith("Continue from where you left off")
  );
}

function currentTurnUserTexts(
  messages: AgentLoopFinalResponseGuardContext["messages"],
): string[] {
  let start = 0;
  let previous: (typeof messages)[number] | null = null;
  for (const [index, message] of messages.entries()) {
    const text = userMessageText(message);
    const startsTurn =
      text.trim() !== "" &&
      !isInternalPrompt(text) &&
      (previous === null ||
        (previous.role === "assistant" &&
          !previous.content.some((part) => part.type === "tool-call")));
    if (startsTurn) start = index;
    previous = message;
  }
  return messages
    .slice(start)
    .map(userMessageText)
    .filter((text) => text.trim() && !isInternalPrompt(text));
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
    if (isAssetsImageTool(name)) return true;
    if (!DESIGN_MUTATION_ACTIONS.has(name)) return false;

    const parsed = parseResult(String(result.content ?? ""));
    if (!parsed) return false;

    if (name === "create-design") return false;

    // A full-app change is persisted in the app's source by Builder; only a
    // run Builder reported as finished is the proof (a timed-out one may
    // still be running).
    if (name === "send-builder-message") {
      return parsed.completed === true && !parsed.error;
    }
    if (name === "apply-builder-edits") {
      return typeof parsed.sentCount === "number" && parsed.sentCount > 0;
    }

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

    if (name === "update-design") {
      return (
        parsed.updated === true &&
        parsed.changed === true &&
        parsed.stale !== true
      );
    }

    if (name === "move-design-element") return parsed.moved === true;

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

function removeDesignTestRequests(text: string): string {
  const mutationClauseBoundary = `\\s+(?:(?:(?:and|also|but|or)(?:\\s+(?:then|after|after\\s+that|afterwards?|subsequently|before|while))?|then|after|after\\s+that|afterwards?|subsequently|before|while|followed\\s+by)\\s+)(?:(?:please|kindly)\\s+)?(?:(?:can|could|would)\\s+you(?:\\s+please)?\\s+)?(?:[\\w-]+\\s+)?${DESIGN_MUTATION_VERBS.source}|(?<!\\w)[-–—](?!\\w)|[.!?]|[,;](?=\\s+(?:(?:please|kindly)\\s+)?(?:(?:can|could|would)\\s+you(?:\\s+please)?\\s+)?(?:[\\w-]+\\s+)?${DESIGN_MUTATION_VERBS.source})|$`;
  const mutationVerbs = new RegExp(DESIGN_MUTATION_VERBS.source, "gi");
  const testRequests = new RegExp(DESIGN_TEST_REQUEST.source, "gi");
  const targetSuffix = new RegExp(
    `${DESIGN_TEST_TARGET_PREPOSITIONS.source}[^.!?]*?(?=${mutationClauseBoundary})`,
    "i",
  );
  const sharedObjectPattern = new RegExp(
    `(?:^|\\s)(?:and|plus|&)\\s+(?:[\\w-]+\\s+)*?(${DESIGN_MUTATION_OBJECTS.source})(?=\\s|$|[,.!?;])`,
    "gi",
  );
  const removals: Array<[number, number]> = [];

  for (const match of text.matchAll(testRequests)) {
    const testStart = match.index ?? 0;
    const testEnd = testStart + match[0].length;
    const prefix = text.slice(0, testStart);
    const boundaries = [...prefix.matchAll(DESIGN_TEST_CLAUSE_BOUNDARY)].filter(
      (boundary) => {
        const boundaryStart = boundary.index ?? 0;
        const boundaryEnd = boundaryStart + boundary[0].length;
        return (
          !/\band\b/i.test(boundary[0]) ||
          !DESIGN_TEST_TARGET_DESCRIPTOR.test(prefix.slice(boundaryEnd))
        );
      },
    );
    const lastBoundary = boundaries[boundaries.length - 1];
    const clauseStart = lastBoundary
      ? (lastBoundary.index ?? 0) + lastBoundary[0].length
      : 0;
    const precedingVerbs = [
      ...prefix.slice(clauseStart).matchAll(mutationVerbs),
    ];
    const precedingVerb = precedingVerbs[precedingVerbs.length - 1];
    const precedingVerbStart = precedingVerb
      ? clauseStart + (precedingVerb.index ?? 0)
      : testStart;
    const precedingVerbEnd =
      precedingVerbStart + (precedingVerb?.[0].length ?? 0);
    const precedingText = text.slice(precedingVerbEnd, testStart);
    const hasDesignObjectBeforeTest = precedingVerb
      ? DESIGN_MUTATION_OBJECTS.test(precedingText) &&
        !DESIGN_TEST_TARGET_DESCRIPTOR.test(precedingText)
      : false;
    const afterTest = text.slice(testEnd);
    const sharedObject = [...afterTest.matchAll(sharedObjectPattern)].find(
      (match) => {
        const matchStart = match.index ?? 0;
        const object = match[1] ?? "";
        const hasMutationDeterminer =
          /\b(?:a|an|another|new|some|any|one|two|three)\b/i.test(match[0]);
        return (
          !/[,;]/.test(afterTest.slice(0, matchStart)) &&
          !DESIGN_TEST_REQUEST.test(afterTest.slice(matchStart)) &&
          (hasMutationDeterminer ||
            !/\b(?:for|of|on|in|against|with|using)\b/i.test(
              afterTest.slice(0, matchStart),
            )) &&
          !/^(?:it|this)$/i.test(object) &&
          DESIGN_MUTATION_OBJECTS.test(object)
        );
      },
    );
    const hasSharedDesignObject = sharedObject !== undefined;
    let removalEnd = testEnd;
    if (!hasSharedDesignObject) {
      const target = targetSuffix.exec(afterTest);
      if (target) removalEnd += target[0].length;
    }
    removals.push([
      precedingVerb && !hasDesignObjectBeforeTest && !hasSharedDesignObject
        ? precedingVerbStart
        : testStart,
      removalEnd,
    ]);
  }

  if (removals.length === 0) return text;

  removals.sort((left, right) => left[0] - right[0]);
  const mergedRemovals: Array<[number, number]> = [];
  for (const [start, end] of removals) {
    const previous = mergedRemovals[mergedRemovals.length - 1];
    if (previous && start <= previous[1]) {
      previous[1] = Math.max(previous[1], end);
    } else {
      mergedRemovals.push([start, end]);
    }
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of mergedRemovals) {
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
  if (DESIGN_TEST_REQUEST.test(mutationText)) {
    const remainingMutationText = removeDesignTestRequests(mutationText);
    if (!hasDistinctVerbAndObject(remainingMutationText)) return false;
  }

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

  return hasDistinctVerbAndObject(mutationText);
}

function requiresPersistedDesignOutput(composedRequest: string): boolean {
  const { message, context } =
    splitAgentChatContextFromMessage(composedRequest);
  if (
    isRepromptSelectionMessage(context) ||
    isSelectionQuestionMessage(context)
  ) {
    return false;
  }
  if (context.includes(DESIGN_MUTATION_REQUIRED_DIRECTIVE)) return true;
  return looksLikeDesignMutationRequest(message);
}

const noDesignChangesSavedLoaders: Record<
  BuiltinLocaleCode,
  () => Promise<string>
> = {
  "en-US": async () =>
    (await import("../../app/i18n/en-US.js")).default.responseGuard
      .noDesignChangesSaved,
  "zh-CN": async () =>
    (await import("../../app/i18n/zh-CN.js")).default.responseGuard
      .noDesignChangesSaved,
  "zh-TW": async () =>
    (await import("../../app/i18n/zh-TW.js")).default.responseGuard
      .noDesignChangesSaved,
  "es-ES": async () =>
    (await import("../../app/i18n/es-ES.js")).default.responseGuard
      .noDesignChangesSaved,
  "fr-FR": async () =>
    (await import("../../app/i18n/fr-FR.js")).default.responseGuard
      .noDesignChangesSaved,
  "de-DE": async () =>
    (await import("../../app/i18n/de-DE.js")).default.responseGuard
      .noDesignChangesSaved,
  "ja-JP": async () =>
    (await import("../../app/i18n/ja-JP.js")).default.responseGuard
      .noDesignChangesSaved,
  "ko-KR": async () =>
    (await import("../../app/i18n/ko-KR.js")).default.responseGuard
      .noDesignChangesSaved,
  "pt-BR": async () =>
    (await import("../../app/i18n/pt-BR.js")).default.responseGuard
      .noDesignChangesSaved,
  "hi-IN": async () =>
    (await import("../../app/i18n/hi-IN.js")).default.responseGuard
      .noDesignChangesSaved,
  "ar-SA": async () =>
    (await import("../../app/i18n/ar-SA.js")).default.responseGuard
      .noDesignChangesSaved,
};

async function noDesignChangesSavedLabel(): Promise<string> {
  try {
    const email = getRequestUserEmail();
    const preference = normalizeLocalizationPreference(
      email ? await getUserSetting(email, LOCALIZATION_SETTING_KEY) : undefined,
    );
    const locale = isLocaleCode(preference.locale)
      ? preference.locale
      : DEFAULT_LOCALE;
    return await noDesignChangesSavedLoaders[locale]();
  } catch (error) {
    // coercion-ok: label locale is cosmetic; the guard's decision is unaffected.
    console.warn("[design-response-guard] locale label unavailable", error);
    return noDesignChangesSavedLoaders[DEFAULT_LOCALE]();
  }
}

const CHAT_ATTACHMENT_ERROR_TAG =
  /<chat-attachment-(?:processing|read)-error[\s>]/;

function thrownErrorCode(content: string): string | null {
  const match = /\(errorCode:\s*([\w-]+)\)(?![\s\S]*\(errorCode:)/.exec(
    content,
  );
  return match?.[1] ?? null;
}

const UNREADABLE_ATTACHMENT_ERROR_CODES = new Set([
  "composer_peer_unavailable",
  "composer_reference_unavailable",
]);
const UNREADABLE_READ_ATTACHMENT_CODES = new Set([
  "attachment_not_stored",
  "attachment_reread_failed",
  "attachment_read_failed",
]);
const CAPABILITY_MISSING_ERROR_CODES = new Set([
  "full_app_building_disabled",
  "builder_project_not_configured",
]);

function isBlockerResult(
  result: AgentLoopFinalResponseGuardContext["toolResults"][number],
): boolean {
  const content = result.content;
  if (result.isError) {
    const code = thrownErrorCode(content);
    return (
      code !== null &&
      (UNREADABLE_ATTACHMENT_ERROR_CODES.has(code) ||
        CAPABILITY_MISSING_ERROR_CODES.has(code))
    );
  }

  const name = normalizeToolName(result.name);
  if (
    name !== "read-attachment" &&
    name !== "import-document" &&
    name !== "create-builder-app" &&
    name !== "migrate-inline-design-to-app"
  ) {
    return false;
  }
  const parsed = parseResult(content);
  if (!parsed) return false;

  if (name === "read-attachment") {
    return (
      typeof parsed.error === "string" &&
      typeof parsed.errorCode === "string" &&
      UNREADABLE_READ_ATTACHMENT_CODES.has(parsed.errorCode)
    );
  }
  if (name === "import-document") {
    return (
      Array.isArray(parsed.files) &&
      parsed.files.length > 0 &&
      parsed.files.every(
        (file) =>
          !isRecord(file) ||
          !isRecord(file.designHints) ||
          typeof file.designHints.extractedText !== "string" ||
          file.designHints.extractedText.trim() === "",
      )
    );
  }
  return parsed.status === "not-configured";
}

function hasStructuralBlocker(
  context: AgentLoopFinalResponseGuardContext,
): boolean {
  if (
    [context.requestText ?? "", ...currentTurnUserTexts(context.messages)].some(
      (text) => CHAT_ATTACHMENT_ERROR_TAG.test(text),
    )
  ) {
    return true;
  }

  return context.toolResults.some(
    (result, index) =>
      isBlockerResult(result) &&
      !context.toolResults
        .slice(index + 1)
        .some(
          (later) =>
            normalizeToolName(later.name) === normalizeToolName(result.name) &&
            !later.isError &&
            !isBlockerResult(later),
        ),
  );
}

export async function designFinalResponseGuard(
  context: AgentLoopFinalResponseGuardContext,
): Promise<AgentLoopFinalResponseGuardResult | null> {
  if (context.executionMode === "plan") return null;

  const requestText =
    context.requestText?.trim() || latestUserText(context.messages);
  if (!requiresPersistedDesignOutput(requestText)) return null;
  // A verified, changed receipt from a Design output action is the same proof
  // the editor's output check trusts; receipts from other writers are not.
  if (
    context.receipts?.some(
      (receipt) =>
        DESIGN_OUTPUT_ACTIONS.has(receipt.tool) &&
        receipt.changed &&
        receipt.verified === true,
    ) ||
    hasSuccessfulMutation(context.toolResults)
  ) {
    return null;
  }

  return {
    retryMessage:
      "This is a design-changing request, so a text-only answer is not completion. " +
      "Either call the appropriate mutating Design action in this turn, or say plainly what blocks you. " +
      "For a new design, create the project if needed and then call `generate-design` " +
      "or `present-design-variants`; for an existing design, read it and call `edit-design`. " +
      "If an image or asset is involved, finish with `insert-asset` when placement is needed. " +
      "Do not claim the design is created, updated, or ready until the action result proves " +
      "that content was persisted.",
    exhaustedDraftPrefix: await noDesignChangesSavedLabel(),
    fallbackMessage:
      "I couldn't confirm that a Design artifact was saved, so I haven't marked this request complete. Please retry.",
    maxRetries: hasStructuralBlocker(context) ? 0 : 1,
  };
}
