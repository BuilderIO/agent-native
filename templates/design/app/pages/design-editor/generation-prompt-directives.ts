import { callAction } from "@agent-native/core/client";
import type { TweakDefinition } from "@shared/api";

import type { UploadedFile } from "@/components/editor/PromptDialog";

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

export function imageAttachmentsFromUploadedFiles(
  files: UploadedFile[],
): string[] {
  return files
    .map((file) => file.dataUrl)
    .filter((dataUrl): dataUrl is string => !!dataUrl?.trim());
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

export function designIntakeQuestionDirectives(
  designId: string,
  designSystemId?: string | null,
): string[] {
  return [
    `This is a new UI-started design for design id "${designId}". The design shell already exists - DO NOT call create-design.`,
    ...designSystemGenerationDirectives(designSystemId),
    "First, call `show-design-questions` with 4-6 tailored questions and then stop. Do NOT call generate-design or present-design-variants until the user submits or skips the questions.",
    "Make the questions feel like Claude Design intake: form factor, aesthetic direction, important features/content, special interactions/polish, and whether to explore variations. Omit or rephrase anything the user's prompt already answered.",
    "Use concise option chips with `allowOther: true`; include a practical `Decide for me` option where useful. Use `multiSelect: true` for feature/interactions questions.",
    "Set a specific title like `Quick questions about your todo app` and a short description. After `show-design-questions` succeeds, wait for the user's answers.",
  ];
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

export function designVariantGenerationDirectives(
  designId: string,
  designSystemId?: string | null,
): string[] {
  return [
    `Use the \`present-design-variants --designId="${designId}"\` action first. The design already exists - DO NOT call create-design.`,
    ...designSystemGenerationDirectives(designSystemId),
    "The user's prompt already asks to explore multiple directions, so DO NOT call `show-design-questions` first and DO NOT call `generate-design` first.",
    "Call `present-design-variants` with 2-5 concise directions (3 when unspecified). Prefer label, description, accentColor, and feature bullets; omit large content HTML when needed because the action can render compact representative screens. Every web design must be responsive; default each desktop direction to width 1440 and height 1024. Use mobile dimensions only when the user explicitly requested a mobile-first primary artboard.",
    'Wait for the user\'s chat pick, delete each unchosen variant screen at most once, call `get-design-snapshot` exactly once with `fileId` for the kept screen, then call `edit-design` exactly once on that same `fileId` in a bounded pass. Use `mode: "replace-file"` when expanding the representative placeholder into a complete but compact product UI in the chosen direction. Prioritize the primary workflow and render secondary details as visible controls, states, or affordances if the feature list is too large for one reliable edit. Do not repeat delete/snapshot cycles. Do not call `generate-design` after a variant pick. Stop after the first successful `edit-design` save.',
  ];
}

export function designGenerationDirectives(
  designId: string,
  designSystemId?: string | null,
): string[] {
  return [
    `Use the \`generate-design --designId="${designId}"\` action with exactly one complete, renderable \`index.html\` file first. The design already exists - DO NOT call create-design.`,
    ...designSystemGenerationDirectives(designSystemId),
    'If the user asked to explore variations, call `present-design-variants` with 2-5 concise directions. Prefer label, description, accentColor, and feature bullets; omit large content HTML when needed because the action can render compact representative screens. Wait for their chat pick, delete each unchosen variant screen at most once, call `get-design-snapshot` exactly once with `fileId` for the kept screen, then call `edit-design` exactly once on that same `fileId` in a bounded pass. Use `mode: "replace-file"` when expanding the representative placeholder into a complete but compact product UI in the chosen direction. Prioritize the primary workflow and render secondary details as visible controls, states, or affordances if the feature list is too large for one reliable edit. Do not repeat delete/snapshot cycles. Do not call `generate-design` after a variant pick. Stop after the first successful `edit-design` save. Otherwise generate one polished first direction.',
    'Responsive behavior is mandatory for every web design: use a mobile-first layout, include a viewport meta tag, stack or collapse desktop columns at narrow widths, and never rely on a fixed-width desktop shell. Default to a desktop primary artboard. For a Desktop or Both/responsive intake answer, pass `primaryViewport: "desktop"` and `canvasFrames` with width 1440 and height 1024; pass `primaryViewport: "mobile"` only when the user explicitly chooses a mobile-primary artboard.',
    "Keep the first pass bounded enough to finish quickly: one self-contained Alpine.js + Tailwind CDN HTML document, polished but concise. Add 3-6 tweaks only when they naturally fit the design.",
    "After generate-design succeeds, run `take-design-screenshot` at desktop and mobile viewports. Fix any horizontal overflow or layout breakage with edit-design before summarizing what was created.",
  ];
}

export function designTemplateRefinementDirectives(
  designId: string,
  templateId: string,
  designSystemId?: string | null,
): string[] {
  return [
    `This design was copied from template "${templateId}". Its files, canvas dimensions, defaults, and locked layers already exist.`,
    ...designSystemGenerationDirectives(designSystemId),
    `Call \`get-design-snapshot --designId="${designId}"\` exactly once before editing.`,
    "Refine the existing template with `edit-design`; do not call `generate-design`, `delete-file`, or create a replacement screen.",
    'Layers marked `data-agent-native-locked="true"` and everything inside them must remain byte-for-byte unchanged. The server rejects changes to locked backgrounds, logos, and other fixed template layers.',
    "Preserve canvasFrames and the template's width and height. Change only the unlocked content needed for the user's request.",
    "Prefer one bounded search-replace edit pass. Use replace-file only when necessary, and keep every locked subtree exactly as it appeared in the snapshot.",
    "After edit-design succeeds, stop and summarize the refinement.",
  ];
}
