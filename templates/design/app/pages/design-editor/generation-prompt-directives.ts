import { callAction } from "@agent-native/core/client/hooks";
import type { TweakDefinition } from "@shared/api";
import { resolveCanvasIntent } from "@shared/canvas-dimensions";
import { DESIGN_MUTATION_REQUIRED_DIRECTIVE } from "@shared/mutation-turn";
import { hasSpecifiedDesignPrompt } from "@shared/specified-design-prompt";

import type { UploadedFile } from "@/components/editor/PromptDialog";
import { agentChatContentFromImages } from "@/lib/chat-image-attachments";

import {
  coveredIntakeTopics,
  INTAKE_QUESTION_TOPIC_LABELS,
  INTAKE_QUESTION_TOPICS,
  type IntakeTopicCoverage,
} from "./intake-question-topics";

const WEBSITE_STYLE_REFERENCE_DIRECTIVE =
  "When the user asks to use or match a website's styling or branding and provides a URL, call `import-from-url` for each URL before generating or editing. Treat the returned design.md-style visual system as the source of truth for colors, typography, spacing, components, and imagery. If no URL is provided, ask for one instead of guessing the site's style from its name.";

export {
  agentChatContentFromImages,
  imageAttachmentsFromUploadedFiles,
} from "@/lib/chat-image-attachments";

export function formatUploadedFileContext(files: UploadedFile[]): string {
  if (files.length === 0) return "";

  const lines: string[] = [
    "",
    `The user uploaded ${files.length} file(s) for context:`,
  ];

  files.forEach((file, index) => {
    lines.push(
      `${index + 1}. ${file.originalName} (${file.type}, ${(file.size / 1024).toFixed(1)}KB) at path: ${file.path}`,
    );
    const text = file.textContent?.trim();
    if (text) {
      lines.push(
        `Extracted text${file.textTruncated ? " (truncated)" : ""}:\n${text}`,
      );
    }
  });

  return lines.join("\n");
}

export function formatTweakDefinitionsContext(
  tweaks: TweakDefinition[],
): string {
  if (tweaks.length === 0) return "None yet.";
  return JSON.stringify(
    tweaks.map((tweak) => ({
      id: tweak.id,
      label: tweak.label,
      type: tweak.type,
      cssVar: tweak.cssVar,
      defaultValue: tweak.defaultValue,
      options: tweak.options,
      min: tweak.min,
      max: tweak.max,
      step: tweak.step,
    })),
    null,
    2,
  );
}

export function designSystemGenerationDirectives(
  designSystemId?: string | null,
): string[] {
  if (!designSystemId) return [];
  return [
    `Use design system id "${designSystemId}" for this generation.`,
    "Use the selected design system context in this message as mandatory generation input. If details are missing or conflict, call `get-design-system` for that id before writing visual code.",
    `When calling \`generate-design\`, pass \`designSystemId: "${designSystemId}"\` so the design remains linked.`,
  ];
}

export function designSystemTemplateEditDirectives(
  designSystemId?: string | null,
): string[] {
  if (!designSystemId) return [];
  return [
    `Use design system id "${designSystemId}" while adapting the copied template.`,
    "Use the selected design system context in this message as mandatory edit input. If details are missing or conflict, call `get-design-system` for that id before editing.",
    "Apply the system through `edit-design` while preserving the copied structure and every locked subtree. Do not call `generate-design`.",
  ];
}

interface DesignSystemGenerationContextResult {
  title?: string;
  agentContext?: string;
}

export async function loadDesignSystemGenerationContext(
  designSystemId?: string | null,
): Promise<string> {
  if (!designSystemId) return "";
  try {
    const result = (await callAction(
      "get-design-system",
      { id: designSystemId },
      { method: "GET" },
    )) as DesignSystemGenerationContextResult | undefined;
    if (result?.agentContext?.trim()) {
      return [
        "",
        result.agentContext.trim(),
        "",
        "The selected design system context above was hydrated before this agent run. Follow it directly; do not replace it with generic colors, fonts, spacing, or components.",
      ].join("\n");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown loading error";
    return [
      "",
      "## Selected Design System Context",
      `The selected design system id "${designSystemId}" could not be loaded before generation: ${message}`,
      "Before writing visual code, call `get-design-system` for this id. If it still fails, stop and tell the user the selected design system is unavailable instead of improvising a generic style.",
    ].join("\n");
  }
  return [
    "",
    "## Selected Design System Context",
    `The selected design system id "${designSystemId}" returned no generation context.`,
    "Call `get-design-system` for this id before writing visual code. If it still has no usable tokens/docs, stop and ask the user to finish design-system indexing instead of improvising a generic style.",
  ].join("\n");
}

export interface IntakeQuestionContextHint {
  coverage: IntakeTopicCoverage;
  contextUnavailable?: boolean;
  unavailableReason?: string;
}

export function designCanvasIntentDirectives(prompt?: string): string[] {
  const intent = resolveCanvasIntent(prompt);
  if (intent.kind === "fixed") {
    if (intent.source === "multiple-dimensions") {
      return [
        "The user requested separate exact-size outputs. Generate each output as its own fixed canvas, using its exact dimensions from the request and passing `devices: []`; do not combine them into responsive breakpoints or add mobile variants.",
        "After generating each output, run `take-design-screenshot` once at that output's exact dimensions.",
      ];
    }
    const canvas = intent.dimensions
      ? `${intent.preset ? `${intent.preset}, ` : ""}${intent.dimensions.width}×${intent.dimensions.height}px`
      : "one static canvas sized for the requested artwork";
    const screenshot = intent.dimensions
      ? `run \`take-design-screenshot\` once with widths: [${intent.dimensions.width}] and heights: [${intent.dimensions.height}].`
      : "run `take-design-screenshot` once at the generated canvas's exact width and height.";
    return [
      `Fixed canvas: ${canvas}. Generate one artwork canvas and pass \`devices: []\` to \`generate-design\`. A fixed canvas never gets device breakpoints, so give any other requested size or version its own call at that exact size.`,
      `After generation, ${screenshot}`,
    ];
  }

  return [
    'Responsive behavior is required for app and website UI unless the user gives exact pixel dimensions. Use mobile-first CSS, include a viewport meta tag, and reflow at narrow widths. For a Desktop or Both/responsive intake answer, pass `primaryViewport: "desktop"` and a 1440×1024 canvas frame; use `primaryViewport: "mobile"` only for an explicitly mobile-primary choice.',
    "After generate-design succeeds for responsive app UI, run `take-design-screenshot` at desktop and mobile viewports, then fix any overflow or layout breakage before reporting completion.",
  ];
}

export function designIntakeQuestionDirectives(
  designId: string,
  designSystemId?: string | null,
  referenceImageCount = 0,
  contextHint?: IntakeQuestionContextHint,
  prompt?: string,
): string[] {
  if (referenceImageCount > 0) {
    return designGenerationDirectives(
      designId,
      designSystemId,
      referenceImageCount,
      prompt,
    );
  }
  const intent = resolveCanvasIntent(prompt);
  const covered = contextHint ? coveredIntakeTopics(contextHint.coverage) : [];
  const coveredByPrompt = intent.kind === "fixed" ? ["formFactor"] : [];
  const coveredTopics = new Set([...covered, ...coveredByPrompt]);
  const uncovered = INTAKE_QUESTION_TOPICS.filter(
    (topic) => !coveredTopics.has(topic),
  );
  const uncoveredLabels = uncovered.map(
    (topic) => INTAKE_QUESTION_TOPIC_LABELS[topic],
  );
  return [
    `This is a new UI-started design for design id "${designId}". The design shell already exists - DO NOT call create-design.`,
    WEBSITE_STYLE_REFERENCE_DIRECTIVE,
    ...designSystemGenerationDirectives(designSystemId),
    ...referenceImageDirectives(referenceImageCount),
    "First, call `show-design-questions` with 4-6 tailored questions and then stop. Do NOT call generate-design or present-design-variants until the user submits or skips the questions.",
    covered.length
      ? `Available Creative Context already answers: ${covered.map((topic) => INTAKE_QUESTION_TOPIC_LABELS[topic]).join(", ")}. Do NOT ask about these - name what you're following from context in your summary instead.`
      : "",
    coveredByPrompt.length
      ? "The user's request already specifies a fixed artwork canvas; form factor is answered. Do not ask whether to make it desktop, mobile, or responsive."
      : "",
    `Make the questions feel like Claude Design intake, covering what's genuinely still open: ${uncoveredLabels.join(", ")}. Omit or rephrase anything the user's prompt already answered.`,
    contextHint?.contextUnavailable
      ? `Creative Context could not be checked before this run (${contextHint.unavailableReason ?? "lookup failed"}). That is different from no context existing - do not treat it as "nothing saved". Ask the normal question set above, and mention in your reply that saved context couldn't be verified this time.`
      : "",
    "Use concise option chips with `allowOther: true`; include a practical `Decide for me` option where useful. Use `multiSelect: true` for feature/interactions questions.",
    "Set a specific title like `Quick questions about your todo app` and a short description. After `show-design-questions` succeeds, wait for the user's answers.",
  ].filter(Boolean);
}

export function promptRequestsVariantExploration(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const asksForVariants =
    /\b(variant|variants|variation|variations|direction|directions|option|options|concept|concepts|exploration|explorations)\b/.test(
      normalized,
    );
  if (!asksForVariants) return false;
  return (
    /\b(2|3|4|5|two|three|four|five|multiple|several|distinct|different|choose|compare|side[-\s]?by[-\s]?side)\b/.test(
      normalized,
    ) || /\bto choose from\b/.test(normalized)
  );
}

export function variantContentDirective(
  prompt?: string,
  designSystemId?: string | null,
  referenceImageCount = 0,
): string {
  return referenceImageCount > 0 ||
    designSystemId ||
    hasSpecifiedDesignPrompt(prompt)
    ? "Give every variant complete self-contained HTML `content`: `present-design-variants` rejects direction-only variants for a fixed canvas, reference image, layout spec, or linked design system."
    : "Prefer label, description, accentColor, and feature bullets; omit large content HTML when needed because the action can render compact representative screens.";
}

export function designVariantGenerationDirectives(
  designId: string,
  designSystemId?: string | null,
  prompt?: string,
): string[] {
  return [
    `Use the \`present-design-variants --designId="${designId}"\` action first. The design already exists - DO NOT call create-design.`,
    WEBSITE_STYLE_REFERENCE_DIRECTIVE,
    ...designSystemGenerationDirectives(designSystemId),
    "The user's prompt already asks to explore multiple directions, so DO NOT call `show-design-questions` first and DO NOT call `generate-design` first.",
    `Call \`present-design-variants\` with 2-5 concise directions (3 when unspecified). ${variantContentDirective(prompt, designSystemId)}`,
    ...designCanvasIntentDirectives(prompt),
    'Wait for the user\'s chat pick, delete each unchosen variant screen at most once, call `get-design-snapshot` exactly once with `fileId` for the kept screen, then call `edit-design` exactly once on that same `fileId` in a bounded pass. Use `mode: "replace-file"` when expanding the representative placeholder into a complete but compact product UI in the chosen direction. Prioritize the primary workflow and render secondary details as visible controls, states, or affordances if the feature list is too large for one reliable edit. Do not repeat delete/snapshot cycles. Do not call `generate-design` after a variant pick. Stop after the first successful `edit-design` save.',
    DESIGN_MUTATION_REQUIRED_DIRECTIVE,
  ];
}

export function referenceImageDirectives(
  referenceImageCount: number,
): string[] {
  if (referenceImageCount < 1) return [];
  return [
    `The user attached ${referenceImageCount} reference image(s) to this message. Treat any image showing a UI as a layout specification to reproduce, not as loose inspiration.`,
    "Inspect the actual image pixels before calling generation tools. Read its regions, navigation, hierarchy, density, component grammar, spacing, and proportions from the image itself; a filename, path, or text description is not a substitute. If the image is unavailable in this turn, stop and ask the user to attach it again instead of guessing.",
    "Do NOT substitute your own composition, palette, or font for something the image or the linked design system already specifies — including choices a generic quality heuristic would discourage. Deviate only where the image is genuinely unreadable, and say so when you do.",
    "Recreate the visible structure and content as closely as the image allows. Do NOT call `show-design-questions` or `present-design-variants`; the screenshot already specifies the direction. Generate one design.",
  ];
}

export function referenceImageContextDirectives(
  referenceImageCount: number,
): string[] {
  if (referenceImageCount < 1) return [];
  return [
    `The user attached ${referenceImageCount} visual reference image(s) to this message. Inspect the image pixels before acting; a filename, path, or text description is not a substitute. If an image is unavailable in this turn, stop and ask the user to attach it again instead of guessing.`,
    "For a UI screenshot, use its visible regions, navigation, hierarchy, density, component grammar, spacing, and proportions as the reference. Apply the user's requested changes while preserving other visible structure.",
  ];
}

export function builderDesignEmbedSubmitData(
  message: string,
  images: readonly string[],
) {
  const context = referenceImageContextDirectives(images.length).join("\n");
  return {
    message,
    submit: true as const,
    ...(images.length
      ? {
          images: [...images],
          content: agentChatContentFromImages(message, images),
        }
      : {}),
    ...(context ? { context } : {}),
  };
}

export function structuralReferenceDirectives(label: string): string[] {
  return [
    `If the user's message asks for a design modeled after, similar to, or based on the selected element ("${label}") — rather than an edit to it — treat this markup as the reference specification.`,
    "In that case, read the real colors, spacing, typography, and hierarchy directly from the markup below rather than treating it as loose inspiration, and model the new design after those precise, literal values (hex/OKLCH colors, font families and sizes, padding/margin/gap numbers, border radii, class names) instead of approximating them.",
    "If the user's message is instead asking to edit or discuss this selected element itself, ignore this reference framing and handle it as a normal edit/question against the selection.",
  ];
}

export function designGenerationDirectives(
  designId: string,
  designSystemId?: string | null,
  referenceImageCount = 0,
  prompt?: string,
): string[] {
  return [
    `Use the \`generate-design --designId="${designId}"\` action with exactly one complete, renderable \`index.html\` file first. The design already exists - DO NOT call create-design.`,
    WEBSITE_STYLE_REFERENCE_DIRECTIVE,
    ...designSystemGenerationDirectives(designSystemId),
    ...referenceImageDirectives(referenceImageCount),
    ...(referenceImageCount > 0
      ? []
      : [
          `If the user asked to explore variations, call \`present-design-variants\` with 2-5 concise directions. ${variantContentDirective(prompt, designSystemId)}` +
            ' Wait for their chat pick, delete each unchosen variant screen at most once, call `get-design-snapshot` exactly once with `fileId` for the kept screen, then call `edit-design` exactly once on that same `fileId` in a bounded pass. Use `mode: "replace-file"` when expanding the representative placeholder into a complete but compact product UI in the chosen direction. Prioritize the primary workflow and render secondary details as visible controls, states, or affordances if the feature list is too large for one reliable edit. Do not repeat delete/snapshot cycles. Do not call `generate-design` after a variant pick. Stop after the first successful `edit-design` save. Otherwise generate one polished first direction.',
        ]),
    ...designCanvasIntentDirectives(prompt),
    "Keep the first pass bounded enough to finish quickly: one self-contained Alpine.js + Tailwind CDN HTML document, polished but concise. Add 3-6 tweaks only when they naturally fit the design.",
    DESIGN_MUTATION_REQUIRED_DIRECTIVE,
  ];
}

export function designTemplateRefinementDirectives(
  designId: string,
  templateId: string,
  designSystemId?: string | null,
  referenceImageCount = 0,
): string[] {
  return [
    `This design was copied from template "${templateId}". Its files, canvas dimensions, defaults, and locked layers already exist.`,
    WEBSITE_STYLE_REFERENCE_DIRECTIVE,
    ...designSystemTemplateEditDirectives(designSystemId),
    ...referenceImageContextDirectives(referenceImageCount),
    `Call \`get-design-snapshot --designId="${designId}"\` exactly once before editing.`,
    `The copied screens are edited in place, so they stop showing the template once this run saves. \`view-screen\` reports the template's authoritative dimensions and fonts as \`design.createdFromTemplate\` on every turn — keep them unchanged. Call \`get-design-template --designId="${designId}"\` when you need the template's original markup or locked layers.`,
    "Refine the existing template with `edit-design`; do not call `generate-design`, `delete-file`, or create a replacement screen.",
    'Layers marked `data-agent-native-locked="true"` and everything inside them must remain byte-for-byte unchanged. The server rejects changes to locked backgrounds, logos, and other fixed template layers.',
    "Preserve canvasFrames and the template's width and height. Change only the unlocked content needed for the user's request.",
    "Prefer one bounded search-replace edit pass. Use replace-file only when necessary, and keep every locked subtree exactly as it appeared in the snapshot.",
    "After edit-design succeeds, stop and summarize the refinement.",
    DESIGN_MUTATION_REQUIRED_DIRECTIVE,
  ];
}
